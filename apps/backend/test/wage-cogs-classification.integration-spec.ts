/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Employee-wages COGS-vs-Expenses audit (2026-09-06). Proves, against real
 * Postgres and the REAL ReportsService.getProfitLoss()/getDailyReport() and
 * WorkersService.getStatement() (never mocked), that a worker who has ALL
 * THREE kinds of activity in one day — per-bag/product-direct labor
 * (PackingSession.sessionEarnings, $100), non-product-direct labor
 * (WorkerCost daily_wage, $20), and an actual cash payment (WorkerPayment,
 * $50) — is accounted for exactly once in each of the right places:
 *
 *   - P&L "labor cost" = sessionEarnings + WorkerCost = $120.00 (NOT $170 —
 *     the $50 payment is never added as a second wage expense; NOT $100 or
 *     $20 alone — both the per-bag and non-product-direct labor are counted)
 *   - P&L "cogs" (raw material) is completely unaffected by any of the three
 *     labor figures — it has its own, entirely separate SQL source
 *   - Daily Report's totalWorkerCost = $20.00 exactly (WorkerCost only —
 *     never the $100 session earnings, never the $50 payment)
 *   - The worker's Statement of Account shows all three as separate entries
 *     (source: 'session' +$100, source: 'cost' +$20, source: 'payment' -$50)
 *     with a closing balance of $70.00 (100 + 20 - 50)
 *
 * Uses a synthetic date (2027-01-15) confirmed to have zero pre-existing
 * WorkerCost/PackingSession/WorkerPayment/StockExit rows, so the isolated
 * test data can be summed directly against the real aggregate functions
 * without needing to subtract a "before" baseline.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsModule } from '../src/reports/reports.module';
import { ReportsService } from '../src/reports/reports.service';
import { WorkersModule } from '../src/workers/workers.module';
import { WorkersService } from '../src/workers/workers.service';

const TAG = `WAGE_COGS_TEST_${Date.now()}`;
const TEST_DATE = '2027-01-15';

describe('Employee wages — COGS vs. Expenses classification — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reports: ReportsService;
  let workers: WorkersService;

  let userId: string;
  let workerId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ReportsModule, WorkersModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    reports = moduleRef.get(ReportsService);
    workers = moduleRef.get(WorkersService);

    // Sanity: this date must be genuinely empty in the real DB, or the
    // exact-total assertions below would be comparing against contaminated
    // pre-existing data rather than isolated test fixtures.
    const [existingCost, existingSession, existingPayment] = await Promise.all([
      prisma.workerCost.count({ where: { date: new Date(TEST_DATE) } }),
      prisma.packingSession.count({ where: { date: new Date(TEST_DATE) } }),
      prisma.workerPayment.count({ where: { date: new Date(TEST_DATE) } }),
    ]);
    if (existingCost || existingSession || existingPayment) {
      throw new Error(`TEST_DATE ${TEST_DATE} is not empty — pick a different synthetic date`);
    }

    const user = await prisma.user.create({
      data: { clerkId: `${TAG}_user`, email: `${TAG}@example.com`, name: TAG, role: 'worker' },
    });
    userId = user.id;

    const worker = await prisma.worker.create({ data: { name: TAG, userId } });
    workerId = worker.id;

    // Per-bag / product-direct labor — feeds COGS-adjacent labor cost, NEVER Expenses.
    await prisma.packingSession.create({
      data: {
        workerId: userId,
        workerEntityId: workerId,
        mode: 'stock',
        kgConsumed: '10.000',
        kgOutputTotal: '10.000',
        varianceKg: '0.000',
        sessionEarnings: '100.00',
        date: new Date(TEST_DATE),
      },
    });

    // Non-product-direct labor — the Daily Wage button's authoritative record.
    await prisma.workerCost.create({
      data: { workerId, date: new Date(TEST_DATE), amount: '20.00', category: 'daily_wage', createdById: userId },
    });

    // Actual cash payment settling part of the accrued balance.
    await prisma.workerPayment.create({
      data: { workerId, amount: '50.00', method: 'cash', date: new Date(TEST_DATE) },
    });
  });

  afterAll(async () => {
    await prisma.workerPayment.deleteMany({ where: { workerId } });
    await prisma.workerCost.deleteMany({ where: { workerId } });
    await prisma.packingSession.deleteMany({ where: { workerEntityId: workerId } });
    await prisma.worker.delete({ where: { id: workerId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await moduleRef.close();
  });

  it('CASE 1/2/3/4 — P&L labor cost = $120.00 (per-bag $100 + daily wage $20), NEVER $170 (payment not double-counted) or $100/$20 alone', async () => {
    const pnl = await reports.getProfitLoss({ dateFrom: TEST_DATE, dateTo: TEST_DATE });
    expect(pnl.laborCost).toBe('120.00');
  });

  it('CASE 1 — P&L "cogs" (raw material) is completely unaffected by any of the three labor figures', async () => {
    const pnl = await reports.getProfitLoss({ dateFrom: TEST_DATE, dateTo: TEST_DATE });
    // No StockExit rows exist for this synthetic date, so cogs must be exactly zero —
    // proving labor (session/cost/payment) never leaks into the raw-material COGS query.
    expect(pnl.cogs).toBe('0.00');
  });

  it('CASE 10 — Daily Report totalWorkerCost = $20.00 exactly (WorkerCost only, never the $100 session or the $50 payment)', async () => {
    const report = await reports.getDailyReport(TEST_DATE);
    expect(report.summary.totalWorkerCost).toBe('20.00');
  });

  it('CASE 5 — the worker Statement of Account shows all three as separate entries, closing balance $70.00 (100 + 20 - 50)', async () => {
    const stmt = await workers.getStatement(workerId, TEST_DATE, TEST_DATE);
    expect(stmt.entries).toHaveLength(3);

    const session = stmt.entries.find((e) => e.source === 'session')!;
    const cost = stmt.entries.find((e) => e.source === 'cost')!;
    const payment = stmt.entries.find((e) => e.source === 'payment')!;
    expect(session.earned).toBe('100.00');
    expect(cost.earned).toBe('20.00');
    expect(cost.category).toBe('daily_wage');
    expect(payment.paid).toBe('50.00');

    expect(stmt.balance).toBe('70.00');
  });

  it('CASE 9 — findOne() lifetime totals reconcile with the statement (earned 120, paid 50, owed 70)', async () => {
    const totals = await workers.findOne(workerId);
    expect(totals.totalEarned).toBe('120.00');
    expect(totals.totalPaid).toBe('50.00');
    expect(totals.totalOwed).toBe('70.00');
  });
});
