/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Full Day Report (forensic audit, 2026-09), Phase 2. Proves, against real
 * Postgres and the REAL ReportsService.getDailyReport() (never mocked):
 *   - a multi-lot sale (FIFO draw spanning 2 lots → 2 StockExit rows sharing
 *     one invoiceId) counts as exactly ONE sale, never two (break/prove A)
 *   - a payment FIFO-split across two invoices (via the REAL
 *     PaymentAllocationService, through PaymentsService.create()) is counted
 *     ONCE as cash collected, never once per invoice it touched (break/prove B/C)
 *   - a cash-handover expense settlement matches CashHandoversService's own
 *     formula (handedAmt + Σ expenses)
 *   - a transaction dated the day BEFORE the report date never appears in the
 *     day-scoped sections, but DOES contribute to the client's opening balance
 *     (break/prove E, and CASE 20 of the audit's own test matrix)
 *   - a recurring GeneralExpense dated on an earlier day never leaks into a
 *     later day's report (confirmed business decision, Phase 1 §21.1)
 *   - client receivables only include clients with activity that day
 *     (confirmed business decision, Phase 1 §21.2), with a correct
 *     opening/today/closing roll-forward
 *   - generating the report performs ZERO writes (row counts unchanged)
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsModule } from '../src/reports/reports.module';
import { ReportsService } from '../src/reports/reports.service';
import { PaymentsModule } from '../src/payments/payments.module';
import { PaymentsService } from '../src/payments/payments.service';

const TAG = `DAILY_REPORT_TEST_${Date.now()}`;
const CLERK_ID = `local_${TAG}_owner`;
const REPORT_DATE = '2026-08-31';
const PREV_DATE = '2026-08-30';

describe('Full Day Report — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: ReportsService;
  let paymentsService: PaymentsService;

  let userId: string;
  let clientId: string;
  let bagTypeId: string;
  let lotAId: string;
  let lotBId: string;
  let packedAId: string;
  let packedBId: string;

  const createdInvoiceIds: string[] = [];
  const createdExitIds: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdHandoverIds: string[] = [];
  const createdGeneralExpenseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdShipmentIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ReportsModule, PaymentsModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    reports = moduleRef.get(ReportsService);
    paymentsService = moduleRef.get(PaymentsService);

    const user = await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: `${TAG}@local.internal`, name: 'Test Owner', role: 'owner' },
    });
    userId = user.id;

    const client = await prisma.client.create({
      data: { name: `Daily Report Test ${Date.now()}`, type: 'restaurant', currency: 'USD' },
    });
    clientId = client.id;

    const bagType = await prisma.bagType.create({
      data: { name: `${TAG}_BagType`, nominalKg: '25.000', costPerBag: '5.00', workerRate: '1.00' },
    });
    bagTypeId = bagType.id;

    const supplier = await prisma.supplier.create({ data: { name: `${TAG}_Supplier`, country: 'Test' } });

    const lotA = await prisma.stockLot.create({
      data: { charcoalType: TAG, grade: 'A', supplierId: supplier.id, kgReceived: '1000', kgRemaining: '1000', costPerKg: '0.20', source: 'direct', dateReceived: new Date(REPORT_DATE) },
    });
    lotAId = lotA.id;
    const lotB = await prisma.stockLot.create({
      data: { charcoalType: TAG, grade: 'A', supplierId: supplier.id, kgReceived: '1000', kgRemaining: '1000', costPerKg: '0.20', source: 'direct', dateReceived: new Date(REPORT_DATE) },
    });
    lotBId = lotB.id;

    const session = await prisma.packingSession.create({
      data: {
        workerId: userId, mode: 'stock', kgConsumed: '50', bagsOutput: [], kgOutputTotal: '50', varianceKg: '0',
        sessionEarnings: '0', date: new Date(REPORT_DATE),
      },
    });
    const packedA = await prisma.packedStock.create({ data: { lotId: lotAId, bagTypeId, quantity: 1, sessionId: session.id } });
    packedAId = packedA.id;
    const packedB = await prisma.packedStock.create({ data: { lotId: lotBId, bagTypeId, quantity: 1, sessionId: session.id } });
    packedBId = packedB.id;
  });

  afterAll(async () => {
    if (createdShipmentIds.length) await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } });
    if (createdPaymentIds.length) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: createdPaymentIds } } });
      const account = await prisma.userAccount.findUnique({ where: { userId } });
      if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    if (createdHandoverIds.length) {
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: { in: createdHandoverIds } } });
      await prisma.cashHandover.deleteMany({ where: { id: { in: createdHandoverIds } } });
    }
    if (createdGeneralExpenseIds.length) {
      await prisma.generalExpense.deleteMany({ where: { id: { in: createdGeneralExpenseIds } } });
    }
    if (createdExitIds.length) await prisma.stockExit.deleteMany({ where: { id: { in: createdExitIds } } });
    if (createdInvoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    if (createdOrderIds.length) await prisma.clientOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.packedStock.deleteMany({ where: { id: { in: [packedAId, packedBId] } } });
    await prisma.packingSession.deleteMany({ where: { workerId: userId, kgConsumed: '50' } });
    await prisma.stockLot.deleteMany({ where: { id: { in: [lotAId, lotBId] } } });
    await prisma.bagType.deleteMany({ where: { id: bagTypeId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.supplier.deleteMany({ where: { name: `${TAG}_Supplier` } });
    // Test-created fixture user (unique clerkId per run) — must be deleted by
    // exact ID, or every run leaves behind a new "Test Owner" row. Cascades
    // to any leftover UserAccount (its AccountEntry rows are already removed
    // above).
    await prisma.user.deleteMany({ where: { id: userId } });
    await moduleRef.close();
  });

  it('break/prove A (warehouse sale) — a multi-lot sale (2 StockExit rows, 1 invoiceId) counts as exactly ONE sale, never two', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued',
        issuedAt: new Date(`${REPORT_DATE}T10:00:00Z`), subtotal: '200.00', total: '200.00',
        lines: [{ saleUnit: 'BAG', bagTypeId, bagTypeName: 'Test Bag', qty: 2, pricePerBag: '100.00', lineTotal: '200.00' }],
      },
    });
    createdInvoiceIds.push(invoice.id);
    const exitA = await prisma.stockExit.create({
      data: { exitType: 'walk_in', packedStockId: packedAId, bagTypeId, quantity: 1, clientId, invoiceId: invoice.id, loggedById: userId, date: new Date(REPORT_DATE) },
    });
    const exitB = await prisma.stockExit.create({
      data: { exitType: 'walk_in', packedStockId: packedBId, bagTypeId, quantity: 1, clientId, invoiceId: invoice.id, loggedById: userId, date: new Date(REPORT_DATE) },
    });
    createdExitIds.push(exitA.id, exitB.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    const thisSale = report.sales.filter((s: any) => s.invoiceId === invoice.id);
    expect(thisSale).toHaveLength(1);
    expect(thisSale[0].saleTotal).toBe('200.00');
  });

  it('break/prove A (normal order) — an ORDER-sourced multi-lot delivery (2 StockExit rows linked by orderId, never invoiceId) still counts as exactly ONE sale, priced by Invoice.total', async () => {
    // Regression fixture for the real dev-data bug this fix addresses:
    // StockExit.invoiceId is ONLY ever set by WalkInSalesService — an ORDER
    // delivery's StockExit rows are linked via orderId instead, and NEVER
    // carry an `amount` of their own. A sales section that depended on
    // StockExit (invoiceId grouping or StockExit.amount) would show this
    // sale as $0 across two ungrouped rows instead of one real $200 sale.
    const order = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: TAG, grade: 'A', totalKgRequested: '50.000',
        bagTypeId, pricePerBag: '100.00', currency: 'USD', createdById: userId, status: 'delivered',
      },
    });
    const orderInvoice = await prisma.invoice.create({
      data: {
        clientId, orderId: order.id, currency: 'USD', source: 'ORDER', status: 'issued',
        issuedAt: new Date(`${REPORT_DATE}T11:00:00Z`), subtotal: '200.00', total: '200.00',
        lines: [{ saleUnit: 'BAG', bagTypeId, bagTypeName: 'Test Bag', qty: 2, pricePerBag: '100.00', lineTotal: '200.00' }],
      },
    });
    createdInvoiceIds.push(orderInvoice.id);
    const orderExitA = await prisma.stockExit.create({
      data: { exitType: 'order', packedStockId: packedAId, bagTypeId, quantity: 1, orderId: order.id, loggedById: userId, date: new Date(REPORT_DATE) },
    });
    const orderExitB = await prisma.stockExit.create({
      data: { exitType: 'order', packedStockId: packedBId, bagTypeId, quantity: 1, orderId: order.id, loggedById: userId, date: new Date(REPORT_DATE) },
    });
    createdExitIds.push(orderExitA.id, orderExitB.id);
    createdOrderIds.push(order.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    const thisSale = report.sales.filter((s: any) => s.invoiceId === orderInvoice.id);
    expect(thisSale).toHaveLength(1);
    expect(thisSale[0].saleTotal).toBe('200.00');
    expect(thisSale[0].source).toBe('ORDER');
  });

  it('break/prove B/C — a payment FIFO-split across two invoices (real PaymentAllocationService) is counted ONCE as cash collected, never once per invoice', async () => {
    // Baseline BEFORE creating this test's fixture — getDailyReport() aggregates
    // company-wide, so asserting against a DELTA (not an exact absolute total)
    // keeps this test robust to any other unrelated data that may already
    // exist on REPORT_DATE in a shared dev DB.
    const before = await reports.getDailyReport(REPORT_DATE);
    const baselineCashCollected = new Decimal(before.summary.totalCashCollected);

    const invA = await prisma.invoice.create({
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date(`${REPORT_DATE}T09:00:00Z`), subtotal: '100.00', total: '100.00', lines: [] },
    });
    const invB = await prisma.invoice.create({
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date(`${REPORT_DATE}T09:05:00Z`), subtotal: '150.00', total: '150.00', lines: [] },
    });
    createdInvoiceIds.push(invA.id, invB.id);

    // Real PaymentsService.create() — no invoiceId, so PaymentAllocationService
    // FIFO-splits $250 across invA ($100) then invB ($150).
    const payment = await paymentsService.create(
      { clientId, amount: '250.00', currency: 'USD', method: 'cash' as any, date: REPORT_DATE, receiverId: userId } as any,
      CLERK_ID,
    );
    createdPaymentIds.push(payment.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    const thisPayment = report.payments.find((p: any) => p.id === payment.id);
    expect(thisPayment).toBeDefined();
    expect(thisPayment!.amount).toBe('250.00');
    expect(thisPayment!.allocations).toHaveLength(2);
    expect(thisPayment!.allocations.map((a: any) => a.amount).sort()).toEqual(['100.00', '150.00']);
    // The single payment must contribute exactly $250 to cashCollected — never
    // $100 + $150 counted a SECOND time on top of the payment's own $250.
    const paymentsForThisClientToday = report.payments.filter((p: any) => p.id === payment.id);
    expect(paymentsForThisClientToday).toHaveLength(1);
    const afterCashCollected = new Decimal(report.summary.totalCashCollected);
    expect(afterCashCollected.minus(baselineCashCollected).toFixed(2)).toBe('250.00');
  });

  it('cash handover: settledAmount matches handedAmt + Σ expenses, exactly as CashHandoversService.create() computes it', async () => {
    const category = await prisma.expenseCategory.upsert({
      where: { name: `${TAG}_Fuel` }, update: {}, create: { name: `${TAG}_Fuel` },
    });
    const handover = await prisma.cashHandover.create({
      data: {
        date: new Date(REPORT_DATE), receiverName: 'Test Owner', receiverId: userId,
        expectedAmt: '500.00', handedAmt: '460.00', difference: '-40.00', loggedById: userId,
        expenses: { create: [{ description: category.name, amount: '40.00', categoryId: category.id }] },
      },
    });
    createdHandoverIds.push(handover.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    const thisHandover = report.cashHandovers.find((h: any) => h.id === handover.id);
    expect(thisHandover).toBeDefined();
    expect(thisHandover!.settledAmount).toBe('500.00');
    await prisma.expenseCategory.deleteMany({ where: { name: `${TAG}_Fuel` } });
  });

  it('CASE 20 — a transaction dated the day BEFORE the report date never appears in day-scoped sections, but DOES contribute to opening balance', async () => {
    const priorInvoice = await prisma.invoice.create({
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date(`${PREV_DATE}T12:00:00Z`), subtotal: '300.00', total: '300.00', lines: [] },
    });
    createdInvoiceIds.push(priorInvoice.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    expect(report.sales.some((s: any) => s.invoiceId === priorInvoice.id)).toBe(false);
    // The client's opening balance for REPORT_DATE must include this
    // prior-day invoice even though it never appears in a day-scoped section.
    const receivable = report.clientReceivables.find((c: any) => c.clientId === clientId);
    expect(receivable).toBeDefined();
    expect(parseFloat(receivable!.openingBalance)).toBeGreaterThanOrEqual(300);
  });

  it('exceptions — an invoice cancelled today (no dedicated cancelledAt column; updatedAt is the only day signal) is surfaced, but never as a financial reversal', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'cancelled',
        issuedAt: new Date(`${REPORT_DATE}T08:00:00Z`), subtotal: '75.00', total: '75.00', lines: [],
        updatedAt: new Date(`${REPORT_DATE}T14:00:00Z`),
      },
    });
    createdInvoiceIds.push(invoice.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    const match = report.exceptions.find((e: any) => e.referenceId === invoice.id);
    expect(match).toBeDefined();
    expect(match!.type).toBe('invoice_cancelled');
    expect(match!.description).toContain('75.00');
    // Cancelled invoices are excluded from Sales entirely (status filter),
    // never shown as a negative/reversing sale line.
    expect(report.sales.some((s: any) => s.invoiceId === invoice.id)).toBe(false);
  });

  it('exceptions — a shipment returned today (no dedicated returnedAt column; updatedAt is the only day signal) is surfaced, and never implies the invoice was reversed', async () => {
    const order = await prisma.clientOrder.create({
      data: {
        clientId, charcoalType: TAG, grade: 'A', totalKgRequested: '25.000',
        bagTypeId, pricePerBag: '100.00', currency: 'USD', createdById: userId, status: 'delivered',
      },
    });
    createdOrderIds.push(order.id);
    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id, address: 'Test address', nominalKg: '25.000', status: 'returned',
        updatedAt: new Date(`${REPORT_DATE}T15:00:00Z`),
      },
    });
    createdShipmentIds.push(shipment.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    const match = report.exceptions.find((e: any) => e.referenceId === order.id && e.type === 'shipment_returned');
    expect(match).toBeDefined();
    expect(match!.description).toContain(order.displayId ?? order.id);
  });

  it('year boundary + exact Beirut midnight edges — 2025-12-31 23:59 Beirut excluded, 2026-01-01 00:00:01 Beirut included, 2026-01-01 23:59 Beirut included, 2026-01-02 00:00:01 Beirut excluded', async () => {
    const YEAR_BOUNDARY_DATE = '2026-01-01';
    // January is Lebanese STANDARD time (EET, UTC+2) — NOT the UTC+3 (EEST,
    // summer DST) offset the rest of this file's August fixtures use. Beirut
    // midnight in winter = 22:00 UTC the previous day. Using the wrong offset
    // here would silently test nothing (both instants would land in the same
    // UTC calendar day) — this date was deliberately chosen to prove the
    // service's zonedMidnightUtc() is genuinely DST-aware (real Intl/IANA
    // Asia/Beirut lookup), not a hardcoded +3.
    const beforeMidnight = await prisma.invoice.create({ // 2025-12-31T23:59 Beirut = 2025-12-31T21:59Z — the LAST instant of Dec 31
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date('2025-12-31T21:59:00Z'), subtotal: '11.00', total: '11.00', lines: [] },
    });
    const rightAtMidnight = await prisma.invoice.create({ // 2026-01-01T00:00:01 Beirut = 2025-12-31T22:00:01Z — the FIRST instant of Jan 1, still Dec 31 in UTC
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date('2025-12-31T22:00:01Z'), subtotal: '12.00', total: '12.00', lines: [] },
    });
    const lastOfDay = await prisma.invoice.create({ // 2026-01-01T23:59 Beirut = 2026-01-01T21:59Z
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date('2026-01-01T21:59:00Z'), subtotal: '13.00', total: '13.00', lines: [] },
    });
    const nextDayMidnight = await prisma.invoice.create({ // 2026-01-02T00:00:01 Beirut = 2026-01-01T22:00:01Z
      data: { clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued', issuedAt: new Date('2026-01-01T22:00:01Z'), subtotal: '14.00', total: '14.00', lines: [] },
    });
    createdInvoiceIds.push(beforeMidnight.id, rightAtMidnight.id, lastOfDay.id, nextDayMidnight.id);

    const report = await reports.getDailyReport(YEAR_BOUNDARY_DATE);
    const ids = report.sales.map((s: any) => s.invoiceId);

    expect(ids).not.toContain(beforeMidnight.id);
    expect(ids).toContain(rightAtMidnight.id);
    expect(ids).toContain(lastOfDay.id);
    expect(ids).not.toContain(nextDayMidnight.id);
  });

  it('exceptions — Beirut business-day boundary: an invoice cancelled (updatedAt) the day BEFORE the report date never leaks in', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        clientId, currency: 'USD', source: 'WAREHOUSE_SALE', status: 'cancelled',
        issuedAt: new Date(`${PREV_DATE}T08:00:00Z`), subtotal: '30.00', total: '30.00', lines: [],
        updatedAt: new Date(`${PREV_DATE}T20:00:00Z`),
      },
    });
    createdInvoiceIds.push(invoice.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    expect(report.exceptions.some((e: any) => e.referenceId === invoice.id)).toBe(false);
  });

  it('confirmed business decision (Phase 1 §21.1) — a recurring GeneralExpense dated on an earlier day never leaks into THIS day\'s report', async () => {
    const earlierExpense = await prisma.generalExpense.create({
      data: { description: `${TAG} Rent`, amount: '500.00', isRecurring: true, date: new Date(PREV_DATE), addedById: userId },
    });
    createdGeneralExpenseIds.push(earlierExpense.id);

    const report = await reports.getDailyReport(REPORT_DATE);

    expect(report.expenses.generalExpenses.some((e: any) => e.id === earlierExpense.id)).toBe(false);
  });

  it('confirmed business decision (Phase 1 §21.2) — client receivables include only clients with activity on the report date', async () => {
    const inactiveClient = await prisma.client.create({
      data: { name: `${TAG} Inactive Client`, type: 'restaurant', currency: 'USD' },
    });
    try {
      const report = await reports.getDailyReport(REPORT_DATE);
      expect(report.clientReceivables.some((c: any) => c.clientId === inactiveClient.id)).toBe(false);
    } finally {
      await prisma.client.deleteMany({ where: { id: inactiveClient.id } });
    }
  });

  it('READ-ONLY PROOF (real Postgres) — generating the report performs zero writes across every touched table', async () => {
    const countAll = async () => ({
      invoices: await prisma.invoice.count(),
      stockExits: await prisma.stockExit.count(),
      payments: await prisma.payment.count(),
      allocations: await prisma.paymentAllocation.count(),
      accountEntries: await prisma.accountEntry.count(),
      cashHandovers: await prisma.cashHandover.count(),
      cashHandoverExpenses: await prisma.cashHandoverExpense.count(),
      generalExpenses: await prisma.generalExpense.count(),
      workerCosts: await prisma.workerCost.count(),
      clientOrders: await prisma.clientOrder.count(),
      stockLots: await prisma.stockLot.count(),
      packingSessions: await prisma.packingSession.count(),
      clients: await prisma.client.count(),
    });

    const before = await countAll();
    await reports.getDailyReport(REPORT_DATE);
    const after = await countAll();

    expect(after).toEqual(before);
  });
});
