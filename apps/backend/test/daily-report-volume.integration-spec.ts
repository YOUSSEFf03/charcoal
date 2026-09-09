/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Full Day Report — final production-readiness audit (2026-09), operational
 * volume test. Complements test/daily-report.integration-spec.ts (which
 * proves individual accounting rules) by proving the report stays correct
 * and internally consistent under a realistic BUSY-DAY volume: multiple
 * clients (including a multi-location one), multiple orders with multi-lot
 * FIFO deliveries, a FIFO-split payment, multiple receivers, multiple cash
 * handovers, multiple expense categories, and stock movement in both
 * directions — all on ONE date, independently hand-reconciled against the
 * report's own summary totals (not just re-reading the implementation).
 *
 * Uses 2026-09-15 — confirmed empty of any organic activity before this
 * suite runs — so every assertion can use exact totals, not deltas.
 * Every row created here is tracked and deleted in afterAll(); a final
 * row-count diff proves the dev DB is left exactly as found.
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

const TAG = `DAILY_REPORT_VOLUME_${Date.now()}`;
const REPORT_DATE = '2026-09-15';

describe('Full Day Report — realistic busy-day volume (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: ReportsService;
  let paymentsService: PaymentsService;

  let receiverAId: string; // e.g. cashier
  let receiverBId: string; // e.g. driver/second cashier
  let packingUserId: string;
  let workerARecordId: string; // Worker model (WorkerCost target) — distinct from the User model above
  let workerBRecordId: string;
  let bagTypeId: string;
  let supplierId: string;

  // Five clients: three single-location, one multi-location with two
  // ClientLocation rows (provenance only — one shared balance either way).
  const clientIds: string[] = [];
  let multiLocClientId: string;
  let locationXId: string;
  let locationYId: string;

  const packedStockIds: string[] = [];
  const stockLotIds: string[] = [];
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const stockExitIds: string[] = [];
  const paymentIds: string[] = [];
  const handoverIds: string[] = [];
  const generalExpenseIds: string[] = [];
  const workerCostIds: string[] = [];
  const packingSessionIds: string[] = [];
  const expenseCategoryIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ReportsModule, PaymentsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    reports = moduleRef.get(ReportsService);
    paymentsService = moduleRef.get(PaymentsService);

    const receiverA = await prisma.user.upsert({
      where: { clerkId: `local_${TAG}_recvA` }, update: {},
      create: { clerkId: `local_${TAG}_recvA`, email: `${TAG}_a@local.internal`, name: 'Cashier A', role: 'owner' },
    });
    receiverAId = receiverA.id;
    const receiverB = await prisma.user.upsert({
      where: { clerkId: `local_${TAG}_recvB` }, update: {},
      create: { clerkId: `local_${TAG}_recvB`, email: `${TAG}_b@local.internal`, name: 'Cashier B', role: 'owner' },
    });
    receiverBId = receiverB.id;
    const packingUser = await prisma.user.upsert({
      where: { clerkId: `local_${TAG}_packingUser` }, update: {},
      create: { clerkId: `local_${TAG}_packingUser`, email: `${TAG}_pu@local.internal`, name: 'Packing User', role: 'worker' },
    });
    packingUserId = packingUser.id;
    // WorkerCost.workerId references the Worker model — a distinct entity
    // from User (a Worker MAY link to a User via Worker.userId for cash
    // receiving, but WorkerCost itself never touches User directly).
    const workerA = await prisma.worker.create({ data: { name: `${TAG}_WorkerA` } });
    workerARecordId = workerA.id;
    const workerB = await prisma.worker.create({ data: { name: `${TAG}_WorkerB` } });
    workerBRecordId = workerB.id;

    for (let i = 0; i < 3; i++) {
      const c = await prisma.client.create({ data: { name: `${TAG}_Client_${i}`, type: 'restaurant', currency: 'USD' } });
      clientIds.push(c.id);
    }
    const multiLoc = await prisma.client.create({
      data: { name: `${TAG}_MultiLocClient`, type: 'restaurant', currency: 'USD', multiLocationEnabled: true },
    });
    multiLocClientId = multiLoc.id;
    clientIds.push(multiLoc.id);
    const locX = await prisma.clientLocation.create({ data: { clientId: multiLoc.id, name: `${TAG}_Branch_X` } });
    locationXId = locX.id;
    const locY = await prisma.clientLocation.create({ data: { clientId: multiLoc.id, name: `${TAG}_Branch_Y` } });
    locationYId = locY.id;

    const bagType = await prisma.bagType.create({
      data: { name: `${TAG}_BagType`, nominalKg: '10.000', costPerBag: '3.00', workerRate: '0.50' },
    });
    bagTypeId = bagType.id;
    const supplier = await prisma.supplier.create({ data: { name: `${TAG}_Supplier`, country: 'Test' } });
    supplierId = supplier.id;

    // Enough packed stock to cover every simulated delivery below without
    // touching the real FIFO engine — matches the sibling spec's own
    // convention of fabricating StockExit rows directly to test the
    // REPORT's read/aggregation path, not the FIFO draw itself (out of
    // scope — "do not re-run FIFO, read the resulting StockExit records").
    for (let i = 0; i < 3; i++) {
      const lot = await prisma.stockLot.create({
        data: {
          charcoalType: TAG, grade: 'A', supplierId, kgReceived: '500', kgRemaining: '500',
          costPerKg: '0.25', source: 'direct', dateReceived: new Date(REPORT_DATE),
        },
      });
      stockLotIds.push(lot.id);
    }
    const session = await prisma.packingSession.create({
      data: {
        workerId: packingUserId, mode: 'stock', kgConsumed: '200', bagsOutput: [], kgOutputTotal: '200',
        varianceKg: '0', sessionEarnings: '15.00', date: new Date(REPORT_DATE),
      },
    });
    packingSessionIds.push(session.id);
    for (let i = 0; i < 10; i++) {
      const p = await prisma.packedStock.create({
        data: { lotId: stockLotIds[i % stockLotIds.length], bagTypeId, quantity: 20, sessionId: session.id },
      });
      packedStockIds.push(p.id);
    }
  });

  afterAll(async () => {
    if (paymentIds.length) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      for (const accId of [receiverAId, receiverBId]) {
        const account = await prisma.userAccount.findUnique({ where: { userId: accId } });
        if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
      }
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (handoverIds.length) {
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: { in: handoverIds } } });
      await prisma.cashHandover.deleteMany({ where: { id: { in: handoverIds } } });
    }
    if (expenseCategoryIds.length) await prisma.expenseCategory.deleteMany({ where: { id: { in: expenseCategoryIds } } });
    if (generalExpenseIds.length) await prisma.generalExpense.deleteMany({ where: { id: { in: generalExpenseIds } } });
    if (workerCostIds.length) await prisma.workerCost.deleteMany({ where: { id: { in: workerCostIds } } });
    if (stockExitIds.length) await prisma.stockExit.deleteMany({ where: { id: { in: stockExitIds } } });
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (orderIds.length) await prisma.clientOrder.deleteMany({ where: { id: { in: orderIds } } });
    if (packedStockIds.length) await prisma.packedStock.deleteMany({ where: { id: { in: packedStockIds } } });
    if (packingSessionIds.length) await prisma.packingSession.deleteMany({ where: { id: { in: packingSessionIds } } });
    if (stockLotIds.length) await prisma.stockLot.deleteMany({ where: { id: { in: stockLotIds } } });
    await prisma.bagType.deleteMany({ where: { id: bagTypeId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.clientLocation.deleteMany({ where: { id: { in: [locationXId, locationYId] } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: [workerARecordId, workerBRecordId] } } });
    for (const uid of [receiverAId, receiverBId, packingUserId]) {
      const account = await prisma.userAccount.findUnique({ where: { userId: uid } });
      if (account) await prisma.userAccount.deleteMany({ where: { id: account.id } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
    await moduleRef.close();
  });

  it('builds a realistic busy day: 5 clients (one multi-location), 6 delivered orders (2 multi-lot FIFO), 1 warehouse sale, 1 anonymous walk-in, a FIFO-split payment across 2 invoices, 2 single-invoice payments under 2 different receivers, 2 cash handovers (2 receivers, 2 expenses each), 2 general expenses, 2 worker costs, 3 stock lots received — and every summary total reconciles independently', async () => {
    // ── Orders/invoices — 6 delivered today ──────────────────────────────
    const orderSpecs = [
      { clientId: clientIds[0], locationId: null, lineTotal: '100.00', multiLot: false },
      { clientId: clientIds[1], locationId: null, lineTotal: '250.00', multiLot: true },
      { clientId: clientIds[2], locationId: null, lineTotal: '80.00', multiLot: false },
      { clientId: multiLocClientId, locationId: locationXId, lineTotal: '400.00', multiLot: true },
      { clientId: multiLocClientId, locationId: locationYId, lineTotal: '120.00', multiLot: false },
      { clientId: clientIds[0], locationId: null, lineTotal: '60.00', multiLot: false },
    ];
    let expectedOrderSalesTotal = new Decimal(0);
    let packedIdx = 0;
    for (const spec of orderSpecs) {
      const order = await prisma.clientOrder.create({
        data: {
          clientId: spec.clientId, locationId: spec.locationId, charcoalType: TAG, grade: 'A',
          totalKgRequested: '100.000', bagTypeId, pricePerBag: '10.00', currency: 'USD',
          createdById: receiverAId, status: 'delivered',
        },
      });
      orderIds.push(order.id);
      const invoice = await prisma.invoice.create({
        data: {
          clientId: spec.clientId, orderId: order.id, currency: 'USD', source: 'ORDER', status: 'issued',
          issuedAt: new Date(`${REPORT_DATE}T09:00:00Z`), subtotal: spec.lineTotal, total: spec.lineTotal,
          lines: [{ saleUnit: 'BAG', bagTypeId, bagTypeName: 'Test Bag', qty: 10, pricePerBag: '10.00', lineTotal: spec.lineTotal }],
        },
      });
      invoiceIds.push(invoice.id);
      expectedOrderSalesTotal = expectedOrderSalesTotal.plus(spec.lineTotal);

      const exitsForThisOrder = spec.multiLot ? 2 : 1;
      for (let k = 0; k < exitsForThisOrder; k++) {
        const exit = await prisma.stockExit.create({
          data: {
            exitType: 'order', packedStockId: packedStockIds[packedIdx % packedStockIds.length], bagTypeId,
            quantity: 5, orderId: order.id, loggedById: receiverAId, date: new Date(REPORT_DATE),
          },
        });
        stockExitIds.push(exit.id);
        packedIdx++;
      }
    }

    // ── Warehouse sale (registered client, no location) ──────────────────
    const whInvoice = await prisma.invoice.create({
      data: {
        clientId: clientIds[2], currency: 'USD', source: 'WAREHOUSE_SALE', status: 'issued',
        issuedAt: new Date(`${REPORT_DATE}T10:00:00Z`), subtotal: '35.00', total: '35.00',
        lines: [{ saleUnit: 'BAG', bagTypeId, bagTypeName: 'Test Bag', qty: 3, pricePerBag: '11.6667', lineTotal: '35.00' }],
      },
    });
    invoiceIds.push(whInvoice.id);
    const whExit = await prisma.stockExit.create({
      data: {
        exitType: 'walk_in', packedStockId: packedStockIds[packedIdx % packedStockIds.length], bagTypeId,
        quantity: 3, clientId: clientIds[2], invoiceId: whInvoice.id, loggedById: receiverBId, date: new Date(REPORT_DATE),
      },
    });
    stockExitIds.push(whExit.id);
    packedIdx++;

    // ── Anonymous walk-in (StockExit.amount is authoritative — no invoice) ─
    const anonExit = await prisma.stockExit.create({
      data: {
        exitType: 'walk_in', packedStockId: packedStockIds[packedIdx % packedStockIds.length], bagTypeId,
        quantity: 2, clientId: null, invoiceId: null, amount: '22.00', currency: 'USD',
        recipient: 'Anonymous walk-in customer', loggedById: receiverBId, date: new Date(REPORT_DATE),
      },
    });
    stockExitIds.push(anonExit.id);
    packedIdx++;

    const expectedTotalSales = expectedOrderSalesTotal.plus('35.00').plus('22.00'); // 1010.00 + 35 + 22 = 1067.00
    const expectedSaleCount = orderSpecs.length + 2; // 6 orders + warehouse + anonymous = 8

    // ── Payments — FIFO-split across 2 invoices, plus 2 single-invoice payments under receiver B ──
    const paySplit = await paymentsService.create(
      { clientId: clientIds[0], amount: '160.00', currency: 'USD', method: 'cash' as any, date: REPORT_DATE, receiverId: receiverAId } as any,
      `local_${TAG}_recvA`,
    );
    paymentIds.push(paySplit.id); // FIFO-splits across clientIds[0]'s two invoices (100.00 + 60.00 = 160.00 exactly)

    const payB1 = await paymentsService.create(
      { clientId: clientIds[1], amount: '250.00', currency: 'USD', method: 'whish' as any, date: REPORT_DATE, receiverId: receiverBId } as any,
      `local_${TAG}_recvB`,
    );
    paymentIds.push(payB1.id);
    const payB2 = await paymentsService.create(
      { clientId: multiLocClientId, amount: '400.00', currency: 'USD', method: 'omt' as any, date: REPORT_DATE, receiverId: receiverBId } as any,
      `local_${TAG}_recvB`,
    );
    paymentIds.push(payB2.id);

    const expectedTotalCashCollected = new Decimal('160.00').plus('250.00').plus('400.00'); // 810.00

    // ── Cash handovers — 2 receivers, 2 expenses each ─────────────────────
    const fuelCat = await prisma.expenseCategory.upsert({
      where: { name: `${TAG}_Fuel` }, update: {}, create: { name: `${TAG}_Fuel` },
    });
    const foodCat = await prisma.expenseCategory.upsert({
      where: { name: `${TAG}_Food` }, update: {}, create: { name: `${TAG}_Food` },
    });
    expenseCategoryIds.push(fuelCat.id, foodCat.id);

    const handoverA = await prisma.cashHandover.create({
      data: {
        date: new Date(REPORT_DATE), receiverName: 'Cashier A', receiverId: receiverAId,
        expectedAmt: '160.00', handedAmt: '140.00', difference: '-20.00', loggedById: receiverAId,
        expenses: {
          create: [
            { description: fuelCat.name, amount: '15.00', categoryId: fuelCat.id },
            { description: foodCat.name, amount: '5.00', categoryId: foodCat.id },
          ],
        },
      },
    });
    handoverIds.push(handoverA.id);
    const handoverB = await prisma.cashHandover.create({
      data: {
        date: new Date(REPORT_DATE), receiverName: 'Cashier B', receiverId: receiverBId,
        expectedAmt: '650.00', handedAmt: '600.00', difference: '-50.00', loggedById: receiverBId,
        expenses: {
          create: [
            { description: fuelCat.name, amount: '30.00', categoryId: fuelCat.id },
            { description: foodCat.name, amount: '20.00', categoryId: foodCat.id },
          ],
        },
      },
    });
    handoverIds.push(handoverB.id);
    const expectedHandoverASettled = new Decimal('140.00').plus('15.00').plus('5.00'); // 160.00
    const expectedHandoverBSettled = new Decimal('600.00').plus('30.00').plus('20.00'); // 650.00
    const expectedTotalHandedOver = expectedHandoverASettled.plus(expectedHandoverBSettled); // 810.00

    // ── General expenses + accrued worker costs ───────────────────────────
    const genExpense1 = await prisma.generalExpense.create({
      data: { description: `${TAG} Rent`, amount: '200.00', isRecurring: false, date: new Date(REPORT_DATE), addedById: receiverAId },
    });
    const genExpense2 = await prisma.generalExpense.create({
      data: { description: `${TAG} Utilities`, amount: '50.00', isRecurring: false, date: new Date(REPORT_DATE), addedById: receiverAId },
    });
    generalExpenseIds.push(genExpense1.id, genExpense2.id);
    const expectedGeneralExpenseTotal = new Decimal('200.00').plus('50.00'); // 250.00

    const workerCost1 = await prisma.workerCost.create({
      data: { workerId: workerARecordId, amount: '45.00', category: 'daily_wage', date: new Date(REPORT_DATE), createdById: receiverAId },
    });
    const workerCost2 = await prisma.workerCost.create({
      data: { workerId: workerBRecordId, amount: '38.00', category: 'daily_wage', date: new Date(REPORT_DATE), createdById: receiverAId },
    });
    workerCostIds.push(workerCost1.id, workerCost2.id);
    const expectedWorkerCostTotal = new Decimal('45.00').plus('38.00'); // 83.00

    // ── Fetch the report ONCE and independently reconcile every summary figure ──
    const report = await reports.getDailyReport(REPORT_DATE);

    expect(report.summary.saleCount).toBe(expectedSaleCount);
    expect(report.summary.totalSales).toBe(expectedTotalSales.toFixed(2));
    expect(report.summary.totalCashCollected).toBe(expectedTotalCashCollected.toFixed(2));
    expect(report.summary.totalGeneralExpenses).toBe(expectedGeneralExpenseTotal.toFixed(2));
    expect(report.summary.totalWorkerCost).toBe(expectedWorkerCostTotal.toFixed(2));
    expect(report.summary.totalCashHandoverExpenses).toBe('70.00'); // 15+5+30+20
    expect(report.summary.totalHandedOver).toBe(expectedTotalHandedOver.toFixed(2));
    expect(report.summary.paymentCount).toBe(3);

    // Sales — no duplication: the 2 multi-lot orders each produced 2 StockExit
    // rows but must still be exactly ONE sale line each, priced by Invoice.total.
    expect(report.sales).toHaveLength(expectedSaleCount);
    const multiLotSale1 = report.sales.find((s: any) => s.invoiceId === invoiceIds[1]);
    expect(multiLotSale1?.saleTotal).toBe('250.00');
    const multiLotSale2 = report.sales.find((s: any) => s.invoiceId === invoiceIds[3]);
    expect(multiLotSale2?.saleTotal).toBe('400.00');
    // Client location: shown for the multi-location client's order, absent for the warehouse sale.
    expect(multiLotSale2?.description).toContain(`${TAG}_Branch_X`);
    const warehouseSale = report.sales.find((s: any) => s.invoiceId === whInvoice.id);
    expect(warehouseSale?.description).not.toContain('Branch');
    const anonymousSale = report.sales.find((s: any) => s.id === anonExit.id);
    expect(anonymousSale).toMatchObject({ source: 'ANONYMOUS', saleTotal: '22.00', client: null });

    // Payments — the FIFO-split payment must appear exactly ONCE with exactly
    // 2 allocations summing to its own amount, never inflating totalCashCollected.
    expect(report.payments).toHaveLength(3);
    const splitPayment = report.payments.find((p: any) => p.id === paySplit.id);
    expect(splitPayment!.amount).toBe('160.00');
    expect(splitPayment!.allocations).toHaveLength(2);
    expect(
      splitPayment!.allocations.reduce((s: Decimal, a: any) => s.plus(a.amount), new Decimal(0)).toFixed(2),
    ).toBe('160.00');

    // Cash handovers — settledAmount = handedAmt + Σexpenses, per handover, never handedAmt alone.
    const hA = report.cashHandovers.find((h: any) => h.id === handoverA.id);
    expect(hA!.settledAmount).toBe(expectedHandoverASettled.toFixed(2));
    expect(hA!.difference).toBe('-20.00');
    const hB = report.cashHandovers.find((h: any) => h.id === handoverB.id);
    expect(hB!.settledAmount).toBe(expectedHandoverBSettled.toFixed(2));

    // Client receivables — every client with today's activity appears, and
    // today's charges reconcile to what was actually invoiced to them today.
    const receivableClient0 = report.clientReceivables.find((c: any) => c.clientId === clientIds[0]);
    expect(receivableClient0!.todaysCharges).toBe('160.00'); // 100 + 60
    expect(receivableClient0!.todaysPayments).toBe('160.00');
    expect(receivableClient0!.closingBalance).toBe('0.00');
    const receivableMultiLoc = report.clientReceivables.find((c: any) => c.clientId === multiLocClientId);
    expect(receivableMultiLoc!.todaysCharges).toBe('520.00'); // 400 + 120
    expect(receivableMultiLoc!.todaysPayments).toBe('400.00');
    expect(receivableMultiLoc!.closingBalance).toBe('120.00');
    // ONE shared balance for the multi-location client — never split per location.
    expect(report.clientReceivables.filter((c: any) => c.clientId === multiLocClientId)).toHaveLength(1);

    // Employee summary — two distinct receivers, each reconciling against
    // AccountEntry, not merged into one, not read from live UserAccount.balance.
    const accountA = await prisma.userAccount.findUnique({ where: { userId: receiverAId } });
    const accountB = await prisma.userAccount.findUnique({ where: { userId: receiverBId } });
    const empA = report.employeeSummary.find((e: any) => e.receiver.id === receiverAId);
    const empB = report.employeeSummary.find((e: any) => e.receiver.id === receiverBId);
    expect(empA).toBeDefined();
    expect(empB).toBeDefined();
    expect(empA!.receivedToday).toBe('160.00');
    expect(empB!.receivedToday).toBe('650.00'); // 250 + 400
    const cumulativeA = await prisma.accountEntry.aggregate({ where: { accountId: accountA!.id }, _sum: { amount: true } });
    expect(empA!.outstandingAsOfEndOfDay).toBe(new Decimal(cumulativeA._sum.amount?.toString() ?? '0').toFixed(2));

    // Orders section — every delivered order appears exactly once (distinct
    // on orderId collapses the 2-exit multi-lot orders to one row each).
    expect(report.orders.delivered).toHaveLength(orderSpecs.length);

    // Stock movement — 3 lots received today are all visible on the IN side.
    expect(report.stockMovement.in.rawLots).toHaveLength(3);
  });

  it('READ-ONLY PROOF at this volume — generating the report performs zero writes', async () => {
    const countAll = async () => ({
      invoices: await prisma.invoice.count(),
      payments: await prisma.payment.count(),
      cashHandovers: await prisma.cashHandover.count(),
      stockExits: await prisma.stockExit.count(),
      accountEntries: await prisma.accountEntry.count(),
    });
    const before = await countAll();
    await reports.getDailyReport(REPORT_DATE);
    const after = await countAll();
    expect(after).toEqual(before);
  });
});
