/**
 * Real-Postgres integration test — requires the dev DB running (docker compose up -d)
 * and DATABASE_URL configured. NOT part of `npm test` — run via `npm run test:integration`.
 *
 * Why this exists: the forensic audit (2026-08-28) found that every sale-history
 * display surface (WarehouseSales.tsx sales log, ClientDetail.tsx warehouse
 * purchases) rendered one row per StockExit, not per logical sale — so a walk-in
 * sale whose FIFO draw spanned more than one packed-stock/lot row showed up as
 * MULTIPLE rows for what was really one invoice, one payment, one sale. The fix
 * is StockExitsService.findAllGrouped() (GET /stock-exits/grouped), which
 * paginates over the DISTINCT group key (COALESCE(invoiceId, id)) at the
 * database level — critically NOT by grouping a fetched page of raw rows
 * client-side, which would still silently split a sale's rows across a page
 * boundary. This file proves both the grouping itself and that boundary case
 * against a real Postgres transaction (a mocked-Prisma unit test can assert the
 * raw-SQL query was called, but not that Postgres actually returns the correct
 * distinct-key pagination).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WalkInSalesModule } from '../src/walk-in-sales/walk-in-sales.module';
import { WalkInSalesService } from '../src/walk-in-sales/walk-in-sales.service';
import { StockExitsModule } from '../src/stock-exits/stock-exits.module';
import { StockExitsService } from '../src/stock-exits/stock-exits.service';

const TAG = `GROUPED_EXITS_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('Sale history grouping — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let walkInSales: WalkInSalesService;
  let stockExits: StockExitsService;

  let clientId: string;
  let bagTypeId: string;
  let receiverId: string;

  const createdPackingSessionIds: string[] = [];
  const createdPackedStockIds: string[] = [];

  async function makePackedStock(quantity: number, grade = 'A', charcoalType = TAG) {
    const lot = await prisma.stockLot.create({
      data: {
        charcoalType, grade, supplierId: (await prisma.supplier.findFirst())!.id,
        kgReceived: '1000.000', kgRemaining: '1000.000', costPerKg: '1.0000',
        source: 'container', dateReceived: new Date(),
      },
    });
    const session = await prisma.packingSession.create({
      data: {
        workerId: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
        mode: 'stock', kgConsumed: '0', kgOutputTotal: '0', varianceKg: '0', sessionEarnings: '0',
        date: new Date(), completedAt: new Date(), sessionLots: { create: [{ lotId: lot.id, kgUsed: '0' }] },
      },
    });
    createdPackingSessionIds.push(session.id);
    const packedStock = await prisma.packedStock.create({
      data: { lotId: lot.id, bagTypeId, quantity, reservedQuantity: 0, sessionId: session.id },
    });
    createdPackedStockIds.push(packedStock.id);
    return packedStock.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, WalkInSalesModule, StockExitsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    walkInSales = moduleRef.get(WalkInSalesService);
    stockExits = moduleRef.get(StockExitsService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID }, update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    const receiver = await prisma.user.create({
      data: { clerkId: `local_${TAG}_receiver`, email: `${TAG}_receiver@local.internal`, name: 'Grouped Test Receiver', role: 'receiver' },
    });
    receiverId = receiver.id;
    const client = await prisma.client.create({
      data: { name: `Grouped Test Client ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;
    const bt = await prisma.bagType.create({
      data: { name: TAG, nominalKg: '10.000', costPerBag: '1.0000', workerRate: '0.1000' },
    });
    bagTypeId = bt.id;
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
    if (createdPackingSessionIds.length) {
      await prisma.packingSessionLot.deleteMany({ where: { sessionId: { in: createdPackingSessionIds } } });
      await prisma.packingSession.deleteMany({ where: { id: { in: createdPackingSessionIds } } });
    }
    // startsWith, not an exact match — the multi-charcoal-type test creates
    // lots tagged `${TAG}_PICKING_AYIN` / `${TAG}_AYIN_PICKINGS`, not TAG
    // itself; an exact match here would leave them orphaned after the run.
    await prisma.stockLot.deleteMany({ where: { charcoalType: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: receiverId } });
    await prisma.bagType.deleteMany({ where: { id: bagTypeId } });
    await prisma.$disconnect();
  });

  it('a multi-batch sale (2 packed-stock lots) collapses into ONE grouped row, with both lines from Invoice.lines', async () => {
    const ps1 = await makePackedStock(30);
    const ps2 = await makePackedStock(40);

    const sale = await walkInSales.create(
      {
        clientId, date: '2026-08-20', method: 'cash' as const,
        bags: [
          { packedStockId: ps1, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 3, pricePerBag: '2.00', currency: 'USD' as const },
          { packedStockId: ps2, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 4, pricePerBag: '2.00', currency: 'USD' as const },
        ],
        receivedUsd: '14.00', receiverId,
      } as any,
      CLERK_ID,
    );

    // Ground truth: the sale really did produce 2 raw StockExit rows.
    const rawExits = await prisma.stockExit.findMany({ where: { invoiceId: sale.id } });
    expect(rawExits).toHaveLength(2);

    const result = await stockExits.findAllGrouped(1, 20, 'walk_in', '2026-08-20', '2026-08-20', clientId);
    expect(result.data).toHaveLength(1); // ONE row, not two
    expect(result.total).toBe(1);

    const row: any = result.data[0];
    expect(row.invoiceId).toBe(sale.id);
    expect(row.lineCount).toBe(2);
    expect(row.totalQtyBags).toBe(7); // 3 + 4
    expect(row.totalKg).toBe('70.000'); // 7 bags × 10.000 kg nominal
    const bagTypeIds = row.lines.map((l: any) => l.bagTypeId);
    expect(bagTypeIds).toEqual([bagTypeId, bagTypeId]);
    expect(row.lines.map((l: any) => l.qty).sort()).toEqual([3, 4]);
  });

  /**
   * Forensic audit (2026-08-29): "Warehouse Sales Log misrepresenting
   * multi-source sales" — the test above proves 2 lines survive grouping, but
   * both draw from lots sharing the SAME charcoalType/grade, so it never
   * actually proved each line keeps ITS OWN source when the two draws differ.
   * This is the real-Postgres proof that a sale spanning two genuinely
   * different charcoal lots (different type AND grade) never collapses to —
   * or loses — either one; each Invoice.lines entry is stamped with the exact
   * lot it was drawn from at write time (WalkInSalesService.create()), and
   * findAllGrouped() reads that array back verbatim.
   */
  it('a sale spanning two DIFFERENT charcoal types/grades preserves each line\'s own source — never collapses to one', async () => {
    const psGradeB = await makePackedStock(50, 'B', `${TAG}_PICKING_AYIN`);
    const psGradeA = await makePackedStock(60, 'A', `${TAG}_AYIN_PICKINGS`);

    // 2026-08-25 — deliberately outside every other test's date window in
    // this file (2026-08-20 through 2026-08-24 are all claimed by other
    // tests' exact-count/pagination assertions; reusing one of those dates
    // would silently inflate another test's raw-row ground truth).
    const sale = await walkInSales.create(
      {
        clientId, date: '2026-08-25', method: 'cash' as const,
        bags: [
          { packedStockId: psGradeB, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 20, pricePerBag: '2.00', currency: 'USD' as const },
          { packedStockId: psGradeA, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 30, pricePerBag: '2.00', currency: 'USD' as const },
        ],
        receivedUsd: '100.00', receiverId,
      } as any,
      CLERK_ID,
    );

    const result = await stockExits.findAllGrouped(1, 20, 'walk_in', '2026-08-25', '2026-08-25', clientId);
    expect(result.data).toHaveLength(1);
    const row: any = result.data[0];
    expect(row.lineCount).toBe(2);

    const byGrade = new Map(row.lines.map((l: any) => [l.grade, l]));
    expect(byGrade.get('B')).toMatchObject({ charcoalType: `${TAG}_PICKING_AYIN`, grade: 'B', qty: 20 });
    expect(byGrade.get('A')).toMatchObject({ charcoalType: `${TAG}_AYIN_PICKINGS`, grade: 'A', qty: 30 });
    // Never the same object/value repeated — this is what a "reads lines[0]
    // only" regression would produce (both entries reporting Grade B).
    expect(row.lines[0].charcoalType).not.toBe(row.lines[1].charcoalType);
  });

  it('PAGINATION BOUNDARY: with limit=1, a 2-line sale is never split across pages — grouping happens before pagination', async () => {
    // Three distinct, date-ordered logical sales, so limit=1 pagination has a
    // deterministic expected row per page (newest first).
    const psMulti1 = await makePackedStock(20);
    const psMulti2 = await makePackedStock(20);
    const multiSale = await walkInSales.create(
      {
        clientId, date: '2026-08-23', method: 'cash' as const,
        bags: [
          { packedStockId: psMulti1, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 2, pricePerBag: '2.00', currency: 'USD' as const },
          { packedStockId: psMulti2, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 2, pricePerBag: '2.00', currency: 'USD' as const },
        ],
      } as any,
      CLERK_ID,
    );

    const psSingle = await makePackedStock(20);
    const singleSale = await walkInSales.create(
      {
        clientId, date: '2026-08-22', method: 'cash' as const,
        bags: [{ packedStockId: psSingle, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 1, pricePerBag: '2.00', currency: 'USD' as const }],
      } as any,
      CLERK_ID,
    );

    const anonExit = await prisma.stockExit.create({
      data: {
        exitType: 'walk_in', date: new Date('2026-08-21'), clientId,
        packedStockId: psSingle, bagTypeId, quantity: 1, amount: '5.00',
        loggedById: (await prisma.user.findUnique({ where: { clerkId: CLERK_ID } }))!.id,
      },
    });

    // Confirm ground truth: 3 raw rows for multiSale + singleSale invoices'
    // exits, plus the anonymous one — 4 physical StockExit rows, 3 logical sales.
    const rawCount = await prisma.stockExit.count({
      where: { clientId, date: { gte: new Date('2026-08-21'), lte: new Date('2026-08-23') } },
    });
    expect(rawCount).toBe(4);

    const filterArgs = ['walk_in', '2026-08-21', '2026-08-23', clientId] as const;
    const totalResult = await stockExits.findAllGrouped(1, 1, ...filterArgs);
    expect(totalResult.total).toBe(3); // 3 logical sales, not 4 raw rows

    const page1 = await stockExits.findAllGrouped(1, 1, ...filterArgs);
    const page2 = await stockExits.findAllGrouped(2, 1, ...filterArgs);
    const page3 = await stockExits.findAllGrouped(3, 1, ...filterArgs);

    // Page 1 (newest): the multi-line sale, BOTH lines together, not split.
    expect(page1.data).toHaveLength(1);
    expect((page1.data[0] as any).invoiceId).toBe(multiSale.id);
    expect((page1.data[0] as any).lineCount).toBe(2);

    // Page 2: the single-line sale.
    expect(page2.data).toHaveLength(1);
    expect((page2.data[0] as any).invoiceId).toBe(singleSale.id);
    expect((page2.data[0] as any).lineCount).toBe(1);

    // Page 3 (oldest): the standalone anonymous exit.
    expect(page3.data).toHaveLength(1);
    expect((page3.data[0] as any).invoiceId).toBeNull();
    expect((page3.data[0] as any).id).toBe(anonExit.id);
    expect((page3.data[0] as any).rawExit).toBeDefined();
    expect((page3.data[0] as any).rawExit.id).toBe(anonExit.id);

    // No sale appears twice across the three pages, and none are missing.
    const allInvoiceOrExitIds = [page1, page2, page3].map((p) => (p.data[0] as any).id);
    expect(new Set(allInvoiceOrExitIds).size).toBe(3);
  });

  /**
   * Phase 5/9 (forensic audit, Warehouse Sale Log — 2026-08-31): the log's
   * "credited to receiver" figure must be the REAL AccountEntry
   * LedgerWriteService wrote, not a value re-derived from Payment.amount or
   * Invoice.total. This is the strongest possible proof — it creates a real
   * sale against the real dev Postgres DB (not a mock), reads back the
   * ledger's own AccountEntry row independently, and asserts the API
   * response matches it exactly, alongside every other SALE/PAYMENT/
   * RECEIVER/BALANCE field this task adds.
   */
  it('SALE/PAYMENT/RECEIVER/BALANCE fields match the real invoice, payment, and ledger AccountEntry rows in Postgres', async () => {
    const ps = await makePackedStock(25);
    const sale = await walkInSales.create(
      {
        clientId, date: '2026-08-27', method: 'cash' as const,
        bags: [{ packedStockId: ps, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 5, pricePerBag: '3.00', currency: 'USD' as const }],
        receivedUsd: '15.00', receiverId,
      } as any,
      CLERK_ID,
    );

    // Independent ground truth, read straight from Postgres — never through
    // the endpoint under test.
    const dbInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.id } });
    const dbPayment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: sale.id } });
    const dbAccount = await prisma.userAccount.findUniqueOrThrow({ where: { userId: receiverId } });
    const dbLedgerEntry = await prisma.accountEntry.findFirstOrThrow({
      where: { accountId: dbAccount.id, referenceId: dbPayment.id, type: 'payment_received' },
    });
    expect(dbLedgerEntry.amount.toFixed(2)).toBe('15.00'); // sanity: this IS the $15 sale

    const result = await stockExits.findAllGrouped(1, 20, 'walk_in', '2026-08-27', '2026-08-27', clientId);
    const row: any = result.data.find((r: any) => r.invoiceId === sale.id);
    expect(row).toBeDefined();

    expect(row.saleTotal).toBe(dbInvoice.total.toFixed(2));
    expect(row.paidAmount).toBe(dbInvoice.paidAmount.toFixed(2));
    expect(row.status).toBe(dbInvoice.status);
    expect(row.remaining).toBe('0.00');
    expect(row.client).toMatchObject({ id: clientId });

    expect(row.payments).toHaveLength(1);
    const p = row.payments[0];
    expect(p.paymentId).toBe(dbPayment.id);
    expect(p.method).toBe(dbPayment.method);
    expect(p.receiverId).toBe(receiverId);
    expect(p.appliedAmount).toBe('15.00');
    // The load-bearing assertion: the API's creditedAmount is the real
    // ledger row's amount, read independently above — not Payment.amount
    // recomputed, not Invoice.total, the actual AccountEntry.
    expect(p.creditedAmount).toBe(dbLedgerEntry.amount.toFixed(2));
  });

  it("getClientWarehouseSummary().totalCount reflects DISTINCT logical sales, not raw StockExit rows (the client-detail 'Purchases' KPI)", async () => {
    const ps1 = await makePackedStock(30);
    const ps2 = await makePackedStock(40);
    await walkInSales.create(
      {
        clientId, date: '2026-08-24', method: 'cash' as const,
        bags: [
          { packedStockId: ps1, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 3, pricePerBag: '2.00', currency: 'USD' as const },
          { packedStockId: ps2, bagTypeId, bagTypeName: 'Grouped Test Bag', quantity: 4, pricePerBag: '2.00', currency: 'USD' as const },
        ],
      } as any,
      CLERK_ID,
    );

    // Ground truth: this ONE sale produced 2 raw StockExit rows.
    const rawExitsForThisDay = await prisma.stockExit.count({
      where: { clientId, date: new Date('2026-08-24') },
    });
    expect(rawExitsForThisDay).toBe(2);

    const summary = await stockExits.getClientWarehouseSummary(clientId);
    // totalCount must reflect 1 logical sale from this day, on top of
    // whatever other logical sales this client accumulated from earlier
    // tests in this file — the assertion only needs the DELTA to be +1
    // (one sale), never +2 (the raw StockExit row count).
    const distinctBefore = new Set(
      (await prisma.stockExit.findMany({ where: { clientId, date: { not: new Date('2026-08-24') } }, select: { invoiceId: true, id: true } }))
        .map((e) => e.invoiceId ?? e.id),
    ).size;
    expect(summary.totalCount).toBe(distinctBefore + 1); // +1 sale, not +2 raw rows
  });
});
