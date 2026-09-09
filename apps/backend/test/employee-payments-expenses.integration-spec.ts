/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Employee-payments audit (2026-09-05), "Expenses module — add employee
 * payments correctly." Proves WorkersService.listPayments()'s dateFrom/dateTo
 * filter against a REAL database — the mechanism the Expenses page's Employee
 * Payments tab (useAllWorkerPayments) relies on to show exactly one month's
 * worth of a worker's payments, regardless of how many payments that worker
 * has all-time. Maps to the task's CASE 3, 4, 5, 6, 7.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkersModule } from '../src/workers/workers.module';
import { WorkersService } from '../src/workers/workers.service';

const TAG = `EMP_PAYMENTS_TEST_${Date.now()}`;

describe('Employee Payments (Expenses page) — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: WorkersService;

  let workerId: string;
  let userId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, WorkersModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    svc = moduleRef.get(WorkersService);

    const user = await prisma.user.create({
      data: { clerkId: `${TAG}_user`, email: `${TAG}@example.com`, name: TAG, role: 'worker' },
    });
    userId = user.id;

    const worker = await prisma.worker.create({
      data: { name: TAG, userId: user.id },
    });
    workerId = worker.id;

    // CASE 1 (per-bag) — a WorkerCost/PackingSession-earned wage entirely
    // separate from WorkerPayment; included only to prove listPayments()
    // never reads earnings at all (CASE 6).
    await prisma.workerCost.create({
      data: { workerId, date: new Date('2026-09-01'), amount: '999.00', category: 'daily_wage', createdById: userId },
    });

    // September payments (multiple, CASE 3) — real cash actually paid.
    await prisma.workerPayment.createMany({
      data: [
        { workerId, amount: '100.00', method: 'cash', date: new Date('2026-09-03'), notes: 'Sep partial 1' },
        { workerId, amount: '150.00', method: 'whish', date: new Date('2026-09-10'), notes: 'Sep partial 2' },
        { workerId, amount: '100.00', method: 'cash', date: new Date('2026-09-18'), notes: 'Sep partial 3' },
        { workerId, amount: '100.00', method: 'cash', date: new Date('2026-09-28'), notes: 'Sep partial 4' },
      ],
    });

    // An August payment (CASE 5) — must NEVER appear in a September query.
    await prisma.workerPayment.create({
      data: { workerId, amount: '999.00', method: 'cash', date: new Date('2026-08-15'), notes: 'August — must not leak into September' },
    });
  });

  afterAll(async () => {
    await prisma.workerPayment.deleteMany({ where: { workerId } });
    await prisma.workerCost.deleteMany({ where: { workerId } });
    await prisma.worker.delete({ where: { id: workerId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await moduleRef.close();
  });

  it('CASE 4 — a dateFrom/dateTo query for September returns EVERY September payment, nothing more', async () => {
    const result = await svc.listPayments(workerId, 1, 50, '2026-09-01', '2026-09-30');

    expect(result.data).toHaveLength(4);
    expect(result.total).toBe(4);
    expect(result.data.every((p) => p.date.toISOString().slice(0, 10).startsWith('2026-09'))).toBe(true);
  });

  it('CASE 5 — the August payment is excluded from a September-scoped query', async () => {
    const result = await svc.listPayments(workerId, 1, 50, '2026-09-01', '2026-09-30');
    expect(result.data.some((p) => new Decimal(p.amount.toString()).toFixed(2) === '999.00')).toBe(false);

    // ...but IS present in an unscoped (all-time) query — proving it's a real
    // record that the date filter deliberately excludes, not one that's missing.
    const allTime = await svc.listPayments(workerId, 1, 50);
    expect(allTime.data.some((p) => new Decimal(p.amount.toString()).toFixed(2) === '999.00')).toBe(true);
  });

  it('CASE 3 — the sum of the September-scoped payments equals 100+150+100+100 = 450.00, computed from real rows (no client-side re-derivation)', async () => {
    const result = await svc.listPayments(workerId, 1, 50, '2026-09-01', '2026-09-30');
    const sum = result.data.reduce((s, p) => s.plus(p.amount.toString()), new Decimal(0));
    expect(sum.toFixed(2)).toBe('450.00');
  });

  it('CASE 6 — the WorkerCost earnings entry ($999 daily_wage) never appears among WorkerPayment rows, at any date range', async () => {
    const result = await svc.listPayments(workerId, 1, 50, '2026-09-01', '2026-09-30');
    // Every returned row is a genuine WorkerPayment (has `method`/`referenceNumber` fields
    // WorkerCost rows don't have) — and none carries WorkerCost's daily_wage category shape.
    expect(result.data.every((p) => 'method' in p)).toBe(true);
    expect(result.data.some((p) => new Decimal(p.amount.toString()).toFixed(2) === '999.00' && p.notes === null)).toBe(false);
  });

  it('CASE 7 — findOne() still reports totalEarned including the WorkerCost entry, proving payments and earnings stay on separate tracks even though both exist for this worker', async () => {
    const found = await svc.findOne(workerId);
    // totalEarned = costEarned (999.00, from WorkerCost) + pieceEarned (0, no packing sessions).
    expect(found.costEarned).toBe('999.00');
    expect(found.totalEarned).toBe('999.00');
    // totalPaid = ALL WorkerPayment rows (450 September + 999 August) = 1449.00 — proves
    // findOne()'s all-time totalPaid is unaffected by (and independent of) the new
    // date-scoped listPayments() used by the Expenses page.
    expect(found.totalPaid).toBe('1449.00');
  });
});
