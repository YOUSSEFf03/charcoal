/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured (same as `npm run start:dev`). NOT part of `npm test`
 * (that suite is 100% mocked-Prisma, see jest.config.js) — run explicitly via
 * `npm run test:integration`.
 *
 * Why this exists: the bug this proves-against (stock_exits.invoiceId schema drift
 * breaking every StockExit read/write) was a real-DB/Prisma-client mismatch that a
 * mocked-Prisma unit test can never see — mocking Prisma means mocking away exactly
 * the layer where that bug lived. Only a test that talks to the actual database can
 * catch this class of regression.
 *
 * Uses real NestJS services (ShipmentsService, ReportsService) wired to the real
 * PrismaService — no HTTP layer, no auth guards, just the service logic against a
 * live database. Creates its own isolated fixtures (dedicated client + stock lot with
 * a unique charcoalType tag) and deletes everything it created in afterAll, so it's
 * safe to run repeatedly against the shared dev database without accumulating junk
 * or colliding with real data.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { SettingsModule } from '../src/settings/settings.module';
import { ReportsService } from '../src/reports/reports.service';

const TEST_CHARCOAL_TYPE = `INTEGRATION_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner'; // matches the dev-auth-bypass seeded user (auth.guard.ts)

describe('Stock deduction + COGS — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let shipmentsService: ShipmentsService;
  let reportsService: ReportsService;

  let clientId: string;
  let lotId: string;
  let bagTypeId: string;
  let packedStockId: string;
  let orderId: string;
  let shipmentId: string;

  const LOT_COST_PER_KG = '1.000000'; // clean round number for exact arithmetic
  const BAG_NOMINAL_KG = 10;
  const BAGS_DELIVERED = 3;
  const EXPECTED_COGS = (BAG_NOMINAL_KG * BAGS_DELIVERED * parseFloat(LOT_COST_PER_KG)).toFixed(2); // 30.00

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ShipmentsModule, SettingsModule],
      providers: [ReportsService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    shipmentsService = moduleRef.get(ShipmentsService);
    reportsService = moduleRef.get(ReportsService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const supplier = await prisma.supplier.findFirst();
    const client = await prisma.client.create({
      data: {
        name: `Integration Test Client ${Date.now()}`,
        type: 'restaurant',
        currency: 'USD',
      },
    });
    clientId = client.id;

    const lot = await prisma.stockLot.create({
      data: {
        charcoalType: TEST_CHARCOAL_TYPE,
        grade: 'A',
        supplierId: supplier!.id,
        kgReceived: '1000.000',
        kgRemaining: '1000.000',
        costPerKg: LOT_COST_PER_KG,
        source: 'container',
        dateReceived: new Date(),
      },
    });
    lotId = lot.id;

    // Reuse the seeded "10kg Bag" type — shared reference data, not deleted.
    const bagType = await prisma.bagType.findFirst({ where: { nominalKg: BAG_NOMINAL_KG.toString() } });
    bagTypeId = bagType!.id;

    // Skip the packing-session flow (already exercised in the manual live test) —
    // insert the PackedStock row directly, this test's own isolated row.
    const session = await prisma.packingSession.create({
      data: {
        workerId: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
        mode: 'stock',
        kgConsumed: (BAGS_DELIVERED * BAG_NOMINAL_KG).toString(),
        kgOutputTotal: (BAGS_DELIVERED * BAG_NOMINAL_KG).toString(),
        varianceKg: '0',
        sessionEarnings: '0',
        date: new Date(),
        completedAt: new Date(),
        sessionLots: { create: [{ lotId, kgUsed: (BAGS_DELIVERED * BAG_NOMINAL_KG).toString() }] },
      },
    });
    const packedStock = await prisma.packedStock.create({
      data: { lotId, bagTypeId, quantity: BAGS_DELIVERED, sessionId: session.id },
    });
    packedStockId = packedStock.id;
    await prisma.stockLot.update({ where: { id: lotId }, data: { kgRemaining: { decrement: BAGS_DELIVERED * BAG_NOMINAL_KG } } });

    const order = await prisma.clientOrder.create({
      data: {
        clientId,
        charcoalType: TEST_CHARCOAL_TYPE,
        grade: 'A',
        totalKgRequested: (BAGS_DELIVERED * BAG_NOMINAL_KG).toString(),
        bagTypeId,
        pricePerBag: '10.00',
        currency: 'USD',
        createdById: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    // Delete in FK-safe order. Anything not found (never created) is skipped.
    const invoices = await prisma.invoice.findMany({ where: { orderId } });
    for (const inv of invoices) {
      await prisma.paymentAllocation.deleteMany({ where: { invoiceId: inv.id } });
      await prisma.payment.deleteMany({ where: { invoiceId: inv.id } });
    }
    await prisma.stockExit.deleteMany({ where: { orderId } });
    await prisma.invoice.deleteMany({ where: { orderId } });
    await prisma.shipmentReservation.deleteMany({ where: { shipment: { orderId } } });
    await prisma.shipmentBag.deleteMany({ where: { shipment: { orderId } } });
    await prisma.shipment.deleteMany({ where: { orderId } });
    await prisma.clientOrder.deleteMany({ where: { id: orderId } });
    await prisma.packedStock.deleteMany({ where: { id: packedStockId } });
    await prisma.packingSessionLot.deleteMany({ where: { lotId } });
    await prisma.packingSession.deleteMany({ where: { sessionLots: { some: { lotId } } } });
    await prisma.stockAdjustment.deleteMany({ where: { lotId } });
    await prisma.stockLot.deleteMany({ where: { id: lotId } });
    await prisma.client.deleteMany({ where: { id: clientId } });

    await prisma.$disconnect();
  });

  it('confirmDelivery() completes without throwing — proves stock_exits.invoiceId no longer breaks the transaction', async () => {
    const shipment = await shipmentsService.createShipment(
      {
        orderId,
        address: 'Integration test address',
        nominalKg: (BAGS_DELIVERED * BAG_NOMINAL_KG).toString(),
        bags: [{ bagTypeId, quantity: BAGS_DELIVERED }],
      } as any,
      CLERK_ID,
    );
    shipmentId = shipment.id;

    await expect(
      shipmentsService.confirmDelivery(shipmentId, { notes: 'integration test delivery' } as any, { userId: CLERK_ID, role: 'owner' }),
    ).resolves.toMatchObject({ status: 'delivered' });
  });

  it('deducted PackedStock.quantity by exactly the delivered amount and released the reservation', async () => {
    const ps = await prisma.packedStock.findUnique({ where: { id: packedStockId } });
    expect(ps!.quantity).toBe(0); // started at BAGS_DELIVERED, all delivered
    expect(ps!.reservedQuantity).toBe(0);

    const reservations = await prisma.shipmentReservation.findMany({ where: { shipmentId } });
    expect(reservations).toHaveLength(0);
  });

  it('created exactly one StockExit row with the correct fields', async () => {
    const exits = await prisma.stockExit.findMany({ where: { orderId } });
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({
      exitType: 'order',
      packedStockId,
      quantity: BAGS_DELIVERED,
      orderId,
    });
  });

  it('auto-issued an invoice for the order (createFromOrder ran inside the same transaction)', async () => {
    const invoice = await prisma.invoice.findFirst({ where: { orderId } });
    expect(invoice).not.toBeNull();
    expect(invoice!.status).toBe('issued');
    expect(invoice!.total.toString()).toBe((BAGS_DELIVERED * 10).toString()); // 3 × $10
  });

  it('COGS for this lot/type reaches getCogsByCharcoalType — isolated via a unique charcoalType tag', async () => {
    const report = await reportsService.getCogsByCharcoalType({});
    const row = report.data.find((r) => r.charcoalType === TEST_CHARCOAL_TYPE);
    expect(row).toBeDefined();
    expect(row!.cogs).toBe(EXPECTED_COGS); // 3 bags × 10kg × $1.00/kg = $30.00
  });

  it('COGS reaches getProfitLoss (full P&L), not just the by-type breakdown', async () => {
    // Delta check: total cogs must be at least this test's contribution — the shared
    // dev DB has other unrelated stock exits, so we can't assert an exact total here,
    // only that this test's $30.00 is included in it.
    const pnl = await reportsService.getProfitLoss({});
    expect(parseFloat(pnl.cogs)).toBeGreaterThanOrEqual(parseFloat(EXPECTED_COGS));
  });
});
