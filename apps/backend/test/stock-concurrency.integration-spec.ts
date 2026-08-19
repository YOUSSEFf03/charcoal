/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured (same as `npm run start:dev`). NOT part of `npm test`
 * (that suite is 100% mocked-Prisma, see jest.config.js) — run explicitly via
 * `npm run test:integration`.
 *
 * Why this exists: the concurrency fix this proves (SELECT ... FOR UPDATE locking on
 * StockLot/PackedStock rows in WalkInSalesService, consumeLots, and
 * ShipmentsService.createShipment) is only meaningful against a REAL PostgreSQL
 * READ COMMITTED transaction — a mocked-Prisma unit test can assert the lock SQL is
 * issued in the right order, but it cannot prove two concurrent transactions actually
 * serialize on that lock instead of both reading a stale pre-deduction value. Only a
 * test that opens two real overlapping transactions against a live database can catch
 * a regression in that guarantee.
 *
 * Uses real NestJS services (WalkInSalesService, PackingSessionsService,
 * ShipmentsService) wired to the real PrismaService — no HTTP layer, no auth guards,
 * just the service logic against a live database, run concurrently via Promise.all /
 * Promise.allSettled so two real transactions race on the same row(s). Creates its own
 * isolated fixtures per scenario and deletes everything it created in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WalkInSalesModule } from '../src/walk-in-sales/walk-in-sales.module';
import { WalkInSalesService } from '../src/walk-in-sales/walk-in-sales.service';
import { PackingSessionsModule } from '../src/packing-sessions/packing-sessions.module';
import { PackingSessionsService } from '../src/packing-sessions/packing-sessions.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { SettingsModule } from '../src/settings/settings.module';

const TAG = `CONCURRENCY_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Concurrent stock mutations — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let walkInSales: WalkInSalesService;
  let packingSessions: PackingSessionsService;
  let shipments: ShipmentsService;

  let clientId: string;
  let supplierId: string;
  let bagTypeId: string; // seeded bag type, nominalKg known
  let bagNominalKg: string;
  let workerEntityId: string;
  let orderId: string;

  // FK-safe teardown trackers.
  const createdLotIds: string[] = [];
  const createdPackingSessionIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdShipmentIds: string[] = [];
  const createdBagTypeIds: string[] = [];

  // A fresh, uniquely-named BagType per test that exercises ShipmentsService
  // .createShipment() — that path's FIFO reservation walk queries ALL
  // PackedStock rows sharing a bagTypeId (`WHERE "bagTypeId" = ...`), so
  // reusing the file-wide shared `bagTypeId` across multiple such tests would
  // let one test's leftover PackedStock rows silently pad another test's
  // "available quantity" pool and mask the exact contention each test is
  // trying to create. A dedicated BagType per test guarantees the row(s)
  // created for that test are the ONLY candidates the FIFO walk can see.
  async function makeBagType() {
    // nominalKg deliberately NOT a round number (e.g. never 10/5/etc.) — other
    // integration-spec files (e.g. stock-cogs.integration-spec.ts) locate their
    // OWN fixture bag type via an unscoped `findFirst({ where: { nominalKg } })`
    // by value, not by this row's unique name; a round nominalKg here could be
    // picked up by that query when suites run concurrently against the shared
    // dev DB, corrupting an unrelated test's fixture.
    const bt = await prisma.bagType.create({
      data: { name: `${TAG}_${Date.now()}_${Math.random().toString(36).slice(2)}`, nominalKg: '11.111', costPerBag: '1.0000', workerRate: '0.1000' },
    });
    createdBagTypeIds.push(bt.id);
    return bt.id;
  }

  async function makeLot(kgRemaining: string) {
    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TAG,
        grade: 'A',
        supplierId,
        kgReceived: kgRemaining,
        kgRemaining,
        costPerKg: '1.0000',
        source: 'container',
        dateReceived: new Date(),
      },
    });
    createdLotIds.push(lot.id);
    return lot.id;
  }

  // Inserts a PackedStock row directly (bypassing the packing-session flow), same
  // pattern test/stock-cogs.integration-spec.ts already uses for an isolated fixture.
  async function makePackedStock(quantity: number, reservedQuantity = 0, forBagTypeId: string = bagTypeId) {
    const lotId = await makeLot('100000.000'); // ample backing lot, not the row under test
    const session = await prisma.packingSession.create({
      data: {
        workerId: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
        mode: 'stock',
        kgConsumed: '0',
        kgOutputTotal: '0',
        varianceKg: '0',
        sessionEarnings: '0',
        date: new Date(),
        completedAt: new Date(),
        sessionLots: { create: [{ lotId, kgUsed: '0' }] },
      },
    });
    createdPackingSessionIds.push(session.id);
    const packedStock = await prisma.packedStock.create({
      data: { lotId, bagTypeId: forBagTypeId, quantity, reservedQuantity, sessionId: session.id },
    });
    createdPackedStockIds.push(packedStock.id);
    return packedStock.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, WalkInSalesModule, PackingSessionsModule, ShipmentsModule, SettingsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    walkInSales = moduleRef.get(WalkInSalesService);
    packingSessions = moduleRef.get(PackingSessionsService);
    shipments = moduleRef.get(ShipmentsService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const supplier = await prisma.supplier.findFirst();
    supplierId = supplier!.id;

    const client = await prisma.client.create({
      data: { name: `Concurrency Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;

    const bagType = await prisma.bagType.findFirst();
    bagTypeId = bagType!.id;
    bagNominalKg = bagType!.nominalKg.toString();

    const worker = await prisma.worker.create({ data: { name: `Concurrency Test Worker ${Date.now()}` } });
    workerEntityId = worker.id;

    const order = await prisma.clientOrder.create({
      data: {
        clientId,
        charcoalType: TAG,
        grade: 'A',
        totalKgRequested: '1.000',
        bagTypeId,
        pricePerBag: '10.00',
        currency: 'USD',
        createdById: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    // Delete in FK-safe order. Anything not created by a given scenario is a no-op.
    const invoices = await prisma.invoice.findMany({ where: { clientId } });
    for (const inv of invoices) {
      await prisma.paymentAllocation.deleteMany({ where: { invoiceId: inv.id } });
      await prisma.payment.deleteMany({ where: { invoiceId: inv.id } });
    }
    await prisma.stockExit.deleteMany({ where: { clientId } });
    await prisma.invoice.deleteMany({ where: { clientId } });

    if (createdShipmentIds.length > 0) {
      await prisma.shipmentReservation.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipmentBag.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } });
      await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    }
    await prisma.clientOrder.deleteMany({ where: { id: orderId } });

    if (createdPackedStockIds.length > 0) {
      await prisma.stockAdjustment.deleteMany({ where: { packedStockId: { in: createdPackedStockIds } } });
      await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    }
    if (createdPackingSessionIds.length > 0) {
      await prisma.packedStock.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdPackingSessionIds } } });
    }
    if (createdLotIds.length > 0) {
      await prisma.stockAdjustment.deleteMany({ where: { lotId: { in: createdLotIds } } });
      await prisma.stockLot.deleteMany({ where: { id: { in: createdLotIds } } });
    }
    await prisma.worker.deleteMany({ where: { id: workerEntityId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (createdBagTypeIds.length > 0) {
      await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    }

    await prisma.$disconnect();
  });

  // =========================================================================
  // 1) RAW LOT RACE — WalkInSalesService, KG line, absolute-write path
  // =========================================================================
  it('RAW LOT RACE: two concurrent 7kg walk-in KG sales against a 10kg lot — exactly one succeeds, final kgRemaining = 3.000', async () => {
    const lotId = await makeLot('10.000');
    const kgLine = (qty: string) => [{ lotId, kgQuantity: qty, description: 'Test KG', pricePerKg: '1.00', currency: 'USD' as const }];

    const results = await Promise.allSettled([
      walkInSales.create({ clientId, date: '2026-08-14', kgLines: kgLine('7.000'), method: 'cash' } as any, CLERK_ID),
      walkInSales.create({ clientId, date: '2026-08-14', kgLines: kgLine('7.000'), method: 'cash' } as any, CLERK_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const lot = await prisma.stockLot.findUnique({ where: { id: lotId } });
    expect(lot!.kgRemaining.toFixed(3)).toBe('3.000'); // never negative, never a lost update from both committing
  });

  // =========================================================================
  // 2) PACKED STOCK RACE — WalkInSalesService, bag line, atomic-decrement path
  // =========================================================================
  it('PACKED STOCK RACE: two concurrent 7-bag walk-in sales against 10 free bags — exactly one succeeds, final quantity = 3', async () => {
    const packedStockId = await makePackedStock(10, 0);
    const bagLine = (qty: number) => [{ packedStockId, bagTypeId, bagTypeName: 'Test Bag', quantity: qty, pricePerBag: '12.00', currency: 'USD' as const }];

    const results = await Promise.allSettled([
      walkInSales.create({ clientId, date: '2026-08-14', bags: bagLine(7), method: 'cash' } as any, CLERK_ID),
      walkInSales.create({ clientId, date: '2026-08-14', bags: bagLine(7), method: 'cash' } as any, CLERK_ID),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(3); // never negative, never both decrements applied
  });

  // =========================================================================
  // 3) CONSUME-LOTS RACE — PackingSessionsService (shared consumeLots primitive)
  // =========================================================================
  it('CONSUME-LOTS RACE: two concurrent packing sessions consuming ~11kg each from a 15kg lot — exactly one succeeds, kgRemaining never negative', async () => {
    const lotId = await makeLot('15.000');
    // Dedicated bag type with a KNOWN nominalKg — decouples this test's contention
    // (11.111 + 11.111 = 22.222 > 15) from whichever bag type happens to be seeded
    // first in the DB (and see makeBagType()'s own comment on why it's non-round).
    const testBagTypeId = await makeBagType();
    const dto = () => ({
      workerEntityId,
      lotInputs: [{ lotId, kg: '11.111' }], // consumed kg exactly equals produced output kg (11.111kg bag × 1) → variance 0
      bagsOutput: [{ bagTypeId: testBagTypeId, qty: 1 }],
      date: '2026-08-14',
    });

    const results = await Promise.allSettled([
      packingSessions.createPackingSession(dto() as any, CLERK_ID),
      packingSessions.createPackingSession(dto() as any, CLERK_ID),
    ]);
    // Track any PackedStock rows created by successful sessions for cleanup.
    for (const r of results) {
      if (r.status === 'fulfilled') {
        createdPackingSessionIds.push((r.value as any).id);
        for (const ps of (r.value as any).packedStocks ?? []) createdPackedStockIds.push(ps.id);
      }
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const lot = await prisma.stockLot.findUnique({ where: { id: lotId } });
    const remaining = parseFloat(lot!.kgRemaining.toFixed(3));
    expect(remaining).toBeGreaterThanOrEqual(0); // never oversold negative
    expect(lot!.kgRemaining.toFixed(3)).toBe('3.889'); // 15 − 11.111 — exactly one deduction applied, never both
  });

  // =========================================================================
  // 4) SHIPMENT RESERVATION RACE — ShipmentsService.createShipment
  // =========================================================================
  it('SHIPMENT RESERVATION RACE: two concurrent shipments each reserving 7 of 10 available bags — reservations never exceed available quantity', async () => {
    // Dedicated bag type — createShipment()'s FIFO walk queries ALL PackedStock rows
    // sharing this bagTypeId, so isolation is required for exact 10-vs-(7+7) contention.
    const shipmentBagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(10, 0, shipmentBagTypeId);
    const shipmentDto = () => ({ orderId, address: 'Concurrency test address', nominalKg: '1', bags: [{ bagTypeId: shipmentBagTypeId, quantity: 7 }] });

    const results = await Promise.allSettled([
      shipments.createShipment(shipmentDto() as any, CLERK_ID),
      shipments.createShipment(shipmentDto() as any, CLERK_ID),
    ]);
    for (const r of results) if (r.status === 'fulfilled') createdShipmentIds.push((r.value as any).id);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.reservedQuantity).toBe(7); // never 14 from both committing
    expect(ps!.reservedQuantity).toBeLessThanOrEqual(ps!.quantity);
  });

  // =========================================================================
  // 5) CROSS-PATH RACE — the actual reason this bug escaped the earlier
  // stock-exits-only lock fix: TWO DIFFERENT services (WalkInSalesService and
  // ShipmentsService) mutating the SAME PackedStock row concurrently.
  // =========================================================================
  it('CROSS-PATH RACE: a walk-in bag sale and a shipment reservation racing on the same 10-bag row never jointly exceed physical quantity', async () => {
    // Dedicated bag type — createShipment()'s FIFO walk queries ALL PackedStock rows
    // sharing this bagTypeId, so isolation is required for exact 10-vs-(7+7) contention.
    const crossPathBagTypeId = await makeBagType();
    const packedStockId = await makePackedStock(10, 0, crossPathBagTypeId);

    const results = await Promise.allSettled([
      walkInSales.create(
        { clientId, date: '2026-08-14', bags: [{ packedStockId, bagTypeId: crossPathBagTypeId, bagTypeName: 'Test Bag', quantity: 7, pricePerBag: '12.00', currency: 'USD' }], method: 'cash' } as any,
        CLERK_ID,
      ),
      shipments.createShipment({ orderId, address: 'Cross-path test', nominalKg: '1', bags: [{ bagTypeId: crossPathBagTypeId, quantity: 7 }] } as any, CLERK_ID),
    ]);
    if (results[1].status === 'fulfilled') createdShipmentIds.push((results[1].value as any).id);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1); // combined demand (14) exceeds supply (10) — only one path can win

    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    // Invariant that must hold regardless of which path won: physical quantity sold +
    // reserved can never exceed what physically existed, and free stock is never negative.
    expect(ps!.quantity - ps!.reservedQuantity).toBeGreaterThanOrEqual(0);
    expect(10 - ps!.quantity + ps!.reservedQuantity).toBeLessThanOrEqual(7); // only ONE 7-unit operation took effect
  });

  // =========================================================================
  // 6) MULTI-ROW LOCK ORDER — two transactions referencing the SAME two rows
  // in OPPOSITE DTO order must not deadlock, because both sort ids ascending
  // before locking (never lock in caller/DTO order).
  // =========================================================================
  it('MULTI-ROW LOCK ORDER: two concurrent multi-line walk-in sales referencing the same two packed-stock rows in reversed order do not deadlock', async () => {
    const psA = await makePackedStock(50, 0);
    const psB = await makePackedStock(50, 0);
    // Force a JS-level "reversed order" id pair regardless of DB-generated id values,
    // so the two DTOs genuinely request opposite iteration order.
    const [first, second] = [psA, psB].sort(); // ascending — what the sorted lock will use
    const reversedInput = [second, first];

    const dtoForward = {
      clientId, date: '2026-08-14', method: 'cash',
      bags: [first, second].map((id) => ({ packedStockId: id, bagTypeId, bagTypeName: 'Test Bag', quantity: 1, pricePerBag: '12.00', currency: 'USD' as const })),
    };
    const dtoReversed = {
      clientId, date: '2026-08-14', method: 'cash',
      bags: reversedInput.map((id) => ({ packedStockId: id, bagTypeId, bagTypeName: 'Test Bag', quantity: 1, pricePerBag: '12.00', currency: 'USD' as const })),
    };

    // Ample stock on both rows (50 each, only 1 requested from each) — this proves the
    // absence of a deadlock, not an availability rejection. A real deadlock would surface
    // as a rejected promise carrying a Postgres 40P01 error instead of a clean result.
    const results = await Promise.allSettled([
      walkInSales.create(dtoForward as any, CLERK_ID),
      walkInSales.create(dtoReversed as any, CLERK_ID),
    ]);

    for (const r of results) {
      expect(r.status).toBe('fulfilled');
      if (r.status === 'rejected') {
        // Surface the real error for diagnosis if this ever fails — a deadlock_detected
        // (40P01) here would mean the sorted-lock-order guarantee regressed.
        // eslint-disable-next-line no-console
        console.error('Unexpected rejection in deadlock-order test:', r.reason);
      }
    }
  });
});
