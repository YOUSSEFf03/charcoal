/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Employee Detail audit (2026-09-05), "Daily Wage button." Proves
 * WorkersService.logDailyWage() end-to-end against a real database: it reads
 * the real global Settings value, persists a real WorkerCost row, and
 * enforces one-per-day duplicate protection — using an ISOLATED, tagged
 * worker/user (never a real employee), with the daily_wage_rate Setting
 * restored to its original value in afterAll so this test never leaves
 * shared dev configuration altered.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsModule } from '../src/settings/settings.module';
import { SettingsService } from '../src/settings/settings.service';
import { WorkersModule } from '../src/workers/workers.module';
import { WorkersService } from '../src/workers/workers.service';

const TAG = `DAILY_WAGE_TEST_${Date.now()}`;

describe('Daily Wage button (Employee Detail) — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settings: SettingsService;
  let workers: WorkersService;

  let workerId: string;
  let userId: string;
  let clerkId: string;
  let originalDailyWageRow: { value: string } | null;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, SettingsModule, WorkersModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    settings = moduleRef.get(SettingsService);
    workers = moduleRef.get(WorkersService);

    // Preserve whatever the real daily_wage_rate setting is right now —
    // restored verbatim in afterAll, so this test never leaves shared dev
    // configuration changed.
    originalDailyWageRow = await prisma.setting.findUnique({ where: { key: 'daily_wage_rate' } });

    clerkId = `${TAG}_user`;
    const user = await prisma.user.create({
      data: { clerkId, email: `${TAG}@example.com`, name: TAG, role: 'owner' },
    });
    userId = user.id;

    const worker = await prisma.worker.create({ data: { name: TAG } });
    workerId = worker.id;
  });

  afterAll(async () => {
    await prisma.workerCost.deleteMany({ where: { workerId } });
    await prisma.worker.delete({ where: { id: workerId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    if (originalDailyWageRow) {
      await prisma.setting.update({ where: { key: 'daily_wage_rate' }, data: { value: originalDailyWageRow.value } });
    } else {
      await prisma.setting.deleteMany({ where: { key: 'daily_wage_rate' } });
    }
    await moduleRef.close();
  });

  it('refuses to create a $0.00 earning when the daily wage is not configured', async () => {
    await settings.setDailyWageRate(0);
    await expect(workers.logDailyWage(workerId, { date: '2026-09-05' }, clerkId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DAILY_WAGE_NOT_CONFIGURED' }),
    });
    const rows = await prisma.workerCost.findMany({ where: { workerId } });
    expect(rows).toHaveLength(0);
  });

  it('CASE 6/7 — uses the REAL configured Settings amount and persists a real WorkerCost(daily_wage) row', async () => {
    await settings.setDailyWageRate(20);

    const created = await workers.logDailyWage(workerId, { date: '2026-09-05' }, clerkId);

    expect(created.amount.toString()).toBe('20');
    expect(created.category).toBe('daily_wage');

    // Read back independently of the method under test — proves it's a REAL,
    // persisted row, not an in-memory/fake response.
    const row = await prisma.workerCost.findUnique({ where: { id: created.id } });
    expect(row).not.toBeNull();
    expect(row!.workerId).toBe(workerId);
    expect(row!.date.toISOString().slice(0, 10)).toBe('2026-09-05');

    // It participates in totalEarned/outstanding balance immediately.
    const totals = await workers.findOne(workerId);
    expect(totals.totalEarned).toBe('20.00');
    expect(totals.totalOwed).toBe('20.00');
  });

  it('CASE 8 — pressing the button again for the SAME date is rejected, not silently duplicated', async () => {
    await settings.setDailyWageRate(20);
    await expect(workers.logDailyWage(workerId, { date: '2026-09-05' }, clerkId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DAILY_WAGE_ALREADY_RECORDED' }),
    });
    const rows = await prisma.workerCost.findMany({ where: { workerId, category: 'daily_wage', date: new Date('2026-09-05') } });
    expect(rows).toHaveLength(1); // still exactly one — the earlier test's row, not two
  });

  it('a DIFFERENT date is allowed — duplicate protection is per calendar day, not per worker forever', async () => {
    await settings.setDailyWageRate(20);
    const created = await workers.logDailyWage(workerId, { date: '2026-09-06' }, clerkId);
    expect(created.date.toISOString().slice(0, 10)).toBe('2026-09-06');

    const totals = await workers.findOne(workerId);
    expect(totals.totalEarned).toBe('40.00'); // Sep 5 + Sep 6, both $20
  });

  it('the daily wage entry appears correctly in the Statement of Account', async () => {
    const stmt = await workers.getStatement(workerId, '2026-09-01', '2026-09-30');
    const dailyWageEntries = stmt.entries.filter((e: any) => e.category === 'daily_wage');
    expect(dailyWageEntries).toHaveLength(2);
    expect(dailyWageEntries.every((e: any) => e.earned === '20.00' && e.paid === '0.00')).toBe(true);
  });
});
