/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured. Run via `npm run test:integration`.
 *
 * Forensic audit (2026-08-29): "FIFO can choose between equally old sibling
 * PackedStock rows based on incidental database physical/query-plan
 * ordering." Root cause proved by the audit:
 *
 *   - A packing session that draws from N charcoal lots creates N PackedStock
 *     rows in ONE packedStock.createMany() call inside ONE transaction
 *     (packing-sessions.service.ts, splitBagsAcrossLots()).
 *   - Prisma Client computes ONE default `createdAt`/`updatedAt` per
 *     createMany() call and applies it to every row written by that batch —
 *     confirmed directly against this schema/client (two SEPARATE create()
 *     calls, even inside one transaction, do NOT tie; only rows from the same
 *     createMany() batch do). So sibling rows from one packing session ALWAYS
 *     share createdAt, with no possible fix on the timestamp side.
 *   - PackedStockService.getFifoDraw() ordered ONLY by createdAt ASC, so
 *     sibling rows' relative order was SQL-unspecified — resolved in
 *     practice by incidental physical tuple layout (proven against the real
 *     sale this audit traced, Invoice SI-0649, via EXPLAIN ANALYZE).
 *
 * The fix adds two tiebreakers with real, pre-existing business meaning —
 * lot.dateReceived (FIFO-of-raw-material: the sub-batch from the
 * OLDER-received lot leaves first) then lot.createdAt (same-day
 * dateReceived ties) — plus a terminal `id ASC` purely to guarantee a total
 * order. This file proves the fix deterministically, and reproduces the
 * exact failure this audit traced: two sibling PackedStock rows with
 * identical createdAt, deliberately inserted in the OPPOSITE order to what
 * lot.dateReceived says is correct, so a createdAt-only order would get it
 * backwards while the fixed order gets it right regardless of physical
 * layout.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PackedStockModule } from '../src/packed-stock/packed-stock.module';
import { PackedStockService } from '../src/packed-stock/packed-stock.service';
import { WalkInSalesModule } from '../src/walk-in-sales/walk-in-sales.module';
import { WalkInSalesService } from '../src/walk-in-sales/walk-in-sales.service';
import { StockExitsModule } from '../src/stock-exits/stock-exits.module';
import { StockExitsService } from '../src/stock-exits/stock-exits.service';

const TAG = `FIFO_ORDER_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('FIFO draw — deterministic sibling ordering (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let packedStock: PackedStockService;
  let walkInSales: WalkInSalesService;
  let stockExits: StockExitsService;

  let clientId: string;
  let receiverId: string;

  const createdBagTypeIds: string[] = [];
  const createdLotIds: string[] = [];
  const createdPackedStockIds: string[] = [];
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PackedStockModule, WalkInSalesModule, StockExitsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    packedStock = moduleRef.get(PackedStockService);
    walkInSales = moduleRef.get(WalkInSalesService);
    stockExits = moduleRef.get(StockExitsService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID }, update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    const receiver = await prisma.user.create({
      data: { clerkId: `local_${TAG}_receiver`, email: `${TAG}_receiver@local.internal`, name: 'FIFO Test Receiver', role: 'receiver' },
    });
    receiverId = receiver.id;
    const client = await prisma.client.create({
      data: { name: `FIFO Order Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    const invoices = await prisma.invoice.findMany({ where: { clientId } });
    for (const inv of invoices) await prisma.paymentAllocation.deleteMany({ where: { invoiceId: inv.id } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
    await prisma.stockExit.deleteMany({ where: { clientId } });
    await prisma.invoice.deleteMany({ where: { clientId } });
    const account = await prisma.userAccount.findUnique({ where: { userId: receiverId } });
    if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
    await prisma.userAccount.deleteMany({ where: { userId: receiverId } });
    if (createdPackedStockIds.length) await prisma.packedStock.deleteMany({ where: { id: { in: createdPackedStockIds } } });
    if (createdSessionIds.length) {
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (createdLotIds.length) await prisma.stockLot.deleteMany({ where: { id: { in: createdLotIds } } });
    if (createdBagTypeIds.length) await prisma.bagType.deleteMany({ where: { id: { in: createdBagTypeIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: receiverId } });
    await prisma.$disconnect();
  });

  // Each test gets its OWN bag type so pairs never interact with each
  // other's FIFO pool — each test is isolated and self-contained.
  async function makeBagType() {
    const bt = await prisma.bagType.create({
      data: { name: `${TAG}_${createdBagTypeIds.length}`, nominalKg: '5.000', costPerBag: '0.0500', workerRate: '0.1200' },
    });
    createdBagTypeIds.push(bt.id);
    return bt.id;
  }

  /**
   * Creates two StockLots with distinct dateReceived (older/newer), then
   * writes their two PackedStock rows in ONE createMany() call inside ONE
   * transaction — replicating splitBagsAcrossLots()'s real write shape, so
   * both rows genuinely share one identical createdAt (not simulated).
   * `insertOrder` controls which row is physically inserted FIRST — passing
   * 'newest-first' inserts the business-WRONG order first, so a
   * createdAt-only sort (matching real Postgres physical-layout behavior for
   * freshly-inserted, never-updated rows) would return the wrong answer.
   */
  async function makeTiedSiblingPair(
    bagTypeId: string,
    insertOrder: 'oldest-first' | 'newest-first',
    olderQty = 100,
    newerQty = 100,
  ) {
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const olderLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_TYPE_A`, grade: 'A', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: new Date('2026-08-01'),
      },
    });
    const newerLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_TYPE_B`, grade: 'B', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000',
        source: 'container', dateReceived: new Date('2026-08-15'),
      },
    });
    createdLotIds.push(olderLot.id, newerLot.id);

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: olderLot.id, kgUsed: '0' }, { lotId: newerLot.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    // ONE createMany() call, ONE transaction — the exact write shape
    // splitBagsAcrossLots() + packing-sessions.service.ts uses, so createdAt
    // genuinely ties (not simulated with an explicit equal timestamp).
    const rows = insertOrder === 'oldest-first'
      ? [{ lotId: olderLot.id, bagTypeId, quantity: olderQty, sessionId: session.id },
         { lotId: newerLot.id, bagTypeId, quantity: newerQty, sessionId: session.id }]
      : [{ lotId: newerLot.id, bagTypeId, quantity: newerQty, sessionId: session.id },
         { lotId: olderLot.id, bagTypeId, quantity: olderQty, sessionId: session.id }];
    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({ data: rows });
    });

    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));

    // Ground truth: both rows really do share one identical createdAt —
    // otherwise this test wouldn't be exercising the real bug condition.
    const timestamps = new Set(created.map((c) => c.createdAt.getTime()));
    expect(timestamps.size).toBe(1);

    const olderRow = created.find((c) => c.lotId === olderLot.id)!;
    const newerRow = created.find((c) => c.lotId === newerLot.id)!;
    return { olderRow, newerRow, olderLot, newerLot };
  }

  it('sibling rows with identical createdAt: FIFO draws from the OLDER-received lot first, when physically inserted newest-first (the adversarial case)', async () => {
    // Physically inserted NEWER-lot-first — the adversarial case: a
    // createdAt-only order (tie broken by incidental physical layout, which
    // for freshly-inserted rows matches statement/array order) would return
    // the newer lot first here. The business-correct answer is still the
    // older lot first.
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'newest-first');

    const plan = await packedStock.getFifoDraw(bagTypeId, 100);
    expect(plan.fulfilled).toBe(true);
    expect(plan.draws).toEqual([{ packedStockId: olderRow.id, quantity: 100 }]);
    expect(plan.draws[0].packedStockId).not.toBe(newerRow.id);
  });

  it('sibling rows with identical createdAt: FIFO draws from the OLDER-received lot first, when physically inserted oldest-first too (true determinism, not luck)', async () => {
    // Same assertion, opposite physical insertion order — proves the result
    // comes from lot.dateReceived, not from whichever physical layout this
    // particular createMany() happened to produce.
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'oldest-first');

    const plan = await packedStock.getFifoDraw(bagTypeId, 100);
    expect(plan.fulfilled).toBe(true);
    expect(plan.draws).toEqual([{ packedStockId: olderRow.id, quantity: 100 }]);
    expect(plan.draws[0].packedStockId).not.toBe(newerRow.id);
  });

  it('multi-source allocation still works correctly when the request exceeds the first (correctly-ordered) source', async () => {
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'newest-first');
    const plan = await packedStock.getFifoDraw(bagTypeId, 150);
    expect(plan.fulfilled).toBe(true);
    expect(plan.draws).toEqual([
      { packedStockId: olderRow.id, quantity: 100 },
      { packedStockId: newerRow.id, quantity: 50 },
    ]);
  });

  // ===========================================================================
  // FULL CHAIN — getFifoDraw() plan fed into the real WalkInSalesService.create()
  // write path, exactly as WarehouseSales.tsx does (fifoDraw.mutateAsync() then
  // one bagsPayload entry per draw). Proves the whole chain end to end:
  // PackedStock → FIFO plan → StockExit(s) → Invoice.lines, not just the plan.
  // (Forensic audit, 2026-08-29 — Phase 8 of the "still shows only one source"
  // investigation.)
  // ===========================================================================

  it('REQUEST EXCEEDS FIRST SOURCE: Source A=100, Source B=100, sale=200 → the sale genuinely consumes BOTH, and both are preserved through StockExit + Invoice.lines', async () => {
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow, olderLot, newerLot } = await makeTiedSiblingPair(bagTypeId, 'newest-first', 100, 100);

    // Exactly what WarehouseSales.tsx does: ask for the plan, then submit one
    // bags[] entry per draw.
    const plan = await packedStock.getFifoDraw(bagTypeId, 200);
    expect(plan.fulfilled).toBe(true);
    expect(plan.draws).toHaveLength(2); // ground truth: FIFO really did split this sale

    const sale = await walkInSales.create(
      {
        clientId, date: '2026-08-26', method: 'cash' as const,
        bags: plan.draws.map((d) => ({
          packedStockId: d.packedStockId, bagTypeId, bagTypeName: TAG,
          quantity: d.quantity, pricePerBag: '4.50', currency: 'USD' as const,
        })),
        receivedUsd: '900.00', receiverId,
      } as any,
      CLERK_ID,
    );

    // StockExit ground truth: 2 rows, matching the plan exactly.
    const exits = await prisma.stockExit.findMany({ where: { invoiceId: sale.id } });
    expect(exits).toHaveLength(2);
    expect(exits.map((e) => e.quantity).sort()).toEqual([100, 100]);
    expect(new Set(exits.map((e) => e.packedStockId))).toEqual(new Set([olderRow.id, newerRow.id]));

    // Invoice.lines ground truth: 2 lines, each carrying its OWN source —
    // never collapsed to one, never both stamped with the same lot.
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.id } });
    const lines = invoice.lines as any[];
    expect(lines).toHaveLength(2);
    const byLotType = new Map(lines.map((l) => [l.charcoalType, l]));
    expect(byLotType.get(olderLot.charcoalType)).toMatchObject({ grade: olderLot.grade, qty: 100 });
    expect(byLotType.get(newerLot.charcoalType)).toMatchObject({ grade: newerLot.grade, qty: 100 });

    // WarehouseSales.tsx's grouped history endpoint (the real source the
    // sales-log table/drawer reads) reflects both sources.
    const grouped = await stockExits.findAllGrouped(1, 20, 'walk_in', '2026-08-26', '2026-08-26', clientId);
    expect(grouped.data).toHaveLength(1);
    expect((grouped.data[0] as any).lineCount).toBe(2);
  });

  it('REQUEST FITS IN FIRST SOURCE: Source A=300, Source B=100, sale=200 → the sale consumes ONLY Source A; Source B is untouched', async () => {
    const bagTypeId = await makeBagType();
    const { olderRow, newerRow } = await makeTiedSiblingPair(bagTypeId, 'newest-first', 300, 100);

    const plan = await packedStock.getFifoDraw(bagTypeId, 200);
    expect(plan.fulfilled).toBe(true);
    expect(plan.draws).toEqual([{ packedStockId: olderRow.id, quantity: 200 }]); // ground truth: ONE draw only

    const sale = await walkInSales.create(
      {
        clientId, date: '2026-08-27', method: 'cash' as const,
        bags: plan.draws.map((d) => ({
          packedStockId: d.packedStockId, bagTypeId, bagTypeName: TAG,
          quantity: d.quantity, pricePerBag: '4.50', currency: 'USD' as const,
        })),
        receivedUsd: '900.00', receiverId,
      } as any,
      CLERK_ID,
    );

    const exits = await prisma.stockExit.findMany({ where: { invoiceId: sale.id } });
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ packedStockId: olderRow.id, quantity: 200 });

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.id } });
    expect((invoice.lines as any[])).toHaveLength(1);

    // Source B was never touched — still its full original quantity.
    const untouchedRow = await prisma.packedStock.findUniqueOrThrow({ where: { id: newerRow.id } });
    expect(untouchedRow.quantity).toBe(100);

    const grouped = await stockExits.findAllGrouped(1, 20, 'walk_in', '2026-08-27', '2026-08-27', clientId);
    expect(grouped.data).toHaveLength(1);
    expect((grouped.data[0] as any).lineCount).toBe(1);
  });

  // ===========================================================================
  // Remaining tiebreak levels (required test matrix, forensic audit 2026-08-29):
  // once createdAt AND lot.dateReceived both tie, the walk must keep resolving
  // deterministically through lot.createdAt, then id — never falling back to
  // incidental physical layout at any level.
  // ===========================================================================

  it('CASE 5 — same lot.dateReceived, different lot.createdAt: FIFO draws from the earlier-registered lot first', async () => {
    const bagTypeId = await makeBagType();
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const sameDate = new Date('2026-08-10');
    // Sequential, separate creates — real wall-clock lot.createdAt difference —
    // while dateReceived is identical, isolating lot.createdAt as the ONLY differentiator.
    const earlierLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_C5_EARLY`, grade: 'A', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: sameDate,
      },
    });
    const laterLot = await prisma.stockLot.create({
      data: {
        charcoalType: `${TAG}_C5_LATE`, grade: 'B', supplierId,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000',
        source: 'container', dateReceived: sameDate,
      },
    });
    createdLotIds.push(earlierLot.id, laterLot.id);
    expect(earlierLot.dateReceived.getTime()).toBe(laterLot.dateReceived.getTime());
    expect(earlierLot.createdAt.getTime()).toBeLessThan(laterLot.createdAt.getTime());

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: earlierLot.id, kgUsed: '0' }, { lotId: laterLot.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    // Physically insert the LATER lot's row FIRST — the adversarial case: with
    // createdAt and dateReceived both tied, a naive order would fall through
    // to incidental physical layout here, exactly like the original bug.
    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({
        data: [
          { lotId: laterLot.id, bagTypeId, quantity: 100, sessionId: session.id },
          { lotId: earlierLot.id, bagTypeId, quantity: 100, sessionId: session.id },
        ],
      });
    });
    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));
    expect(new Set(created.map((c) => c.createdAt.getTime())).size).toBe(1);

    const earlierRow = created.find((c) => c.lotId === earlierLot.id)!;
    const laterRow = created.find((c) => c.lotId === laterLot.id)!;

    const plan = await packedStock.getFifoDraw(bagTypeId, 100);
    expect(plan.draws).toEqual([{ packedStockId: earlierRow.id, quantity: 100 }]);
    expect(plan.draws[0].packedStockId).not.toBe(laterRow.id);
  });

  it('CASE 6 — createdAt, lot.dateReceived, AND lot.createdAt all tied: FIFO falls back to PackedStock.id ASC as the terminal deterministic tiebreak', async () => {
    const bagTypeId = await makeBagType();
    const supplierId = (await prisma.supplier.findFirst())!.id;
    const worker = await prisma.user.upsert({
      where: { clerkId: 'user_test_owner' }, update: {},
      create: { clerkId: 'user_test_owner', email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const sameDate = new Date('2026-08-12');
    // Both lots created via ONE createMany() call — same mechanism proven for
    // sibling PackedStock rows (one batch → one shared createdAt value) — so
    // lot.createdAt genuinely ties too, isolating id as the only remaining
    // differentiator. (Two separate create() calls, even inside one
    // $transaction, do NOT tie — verified: Prisma computes createdAt/updatedAt
    // client-side per statement, not via a DB-side transaction-scoped now().)
    const lotTypeX = `${TAG}_C6_X`;
    const lotTypeY = `${TAG}_C6_Y`;
    await prisma.stockLot.createMany({
      data: [
        {
          charcoalType: lotTypeX, grade: 'A', supplierId,
          kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
          source: 'container', dateReceived: sameDate,
        },
        {
          charcoalType: lotTypeY, grade: 'B', supplierId,
          kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '2.0000',
          source: 'container', dateReceived: sameDate,
        },
      ],
    });
    const lotX = await prisma.stockLot.findFirstOrThrow({ where: { charcoalType: lotTypeX } });
    const lotY = await prisma.stockLot.findFirstOrThrow({ where: { charcoalType: lotTypeY } });
    createdLotIds.push(lotX.id, lotY.id);
    expect(lotX.createdAt.getTime()).toBe(lotY.createdAt.getTime());
    expect(lotX.dateReceived.getTime()).toBe(lotY.dateReceived.getTime());

    const session = await prisma.packingSession.create({
      data: {
        workerId: worker.id, mode: 'stock',
        kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(),
        sessionLots: { create: [{ lotId: lotX.id, kgUsed: '0' }, { lotId: lotY.id, kgUsed: '0' }] },
      },
    });
    createdSessionIds.push(session.id);

    // Physically insert lotY's row FIRST — with every prior tiebreak level
    // tied, only PackedStock.id ASC is left to resolve the order.
    await prisma.$transaction(async (tx) => {
      await tx.packedStock.createMany({
        data: [
          { lotId: lotY.id, bagTypeId, quantity: 100, sessionId: session.id },
          { lotId: lotX.id, bagTypeId, quantity: 100, sessionId: session.id },
        ],
      });
    });
    const created = await prisma.packedStock.findMany({ where: { sessionId: session.id } });
    createdPackedStockIds.push(...created.map((c) => c.id));
    expect(new Set(created.map((c) => c.createdAt.getTime())).size).toBe(1);

    const [expectedFirst, expectedSecond] = [...created].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );

    const plan = await packedStock.getFifoDraw(bagTypeId, 100);
    expect(plan.draws).toEqual([{ packedStockId: expectedFirst.id, quantity: 100 }]);
    expect(plan.draws[0].packedStockId).not.toBe(expectedSecond.id);
  });
});
