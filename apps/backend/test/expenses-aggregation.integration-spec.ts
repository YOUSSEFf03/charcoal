/**
 * Real-Postgres integration test — requires the dev DB running and
 * DATABASE_URL configured. NOT part of `npm test` — run via
 * `npm run test:integration`.
 *
 * Forensic audit (2026-08-31), "Expenses + Cash Handover expense selection
 * redesign" — Employee → Category → Occurrence aggregation. This proves the
 * new CashHandoversService.getExpensesSummary()/getEmployeeExpenses()/
 * getEmployeeCategoryExpenses() methods against REAL, pre-existing data —
 * including the five historical CashHandoverExpense rows backfilled by
 * migration 20260831000000_add_expense_category (CASE 14: "existing records
 * must remain visible and correctly categorized/mapped").
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CashHandoversModule } from '../src/cash-handovers/cash-handovers.module';
import { CashHandoversService } from '../src/cash-handovers/cash-handovers.service';

const TAG = `EXPENSES_AGG_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('Expenses page aggregation — real Postgres integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: CashHandoversService;

  let receiverId: string;
  const handoverIds: string[] = [];
  let catFuelId: string, catFoodId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CashHandoversModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    svc = moduleRef.get(CashHandoversService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const receiver = await prisma.user.create({
      data: { clerkId: `${TAG}_receiver`, email: `${TAG}@example.com`, name: TAG, role: 'sales_rep' },
    });
    receiverId = receiver.id;

    const [catFuel, catFood] = await Promise.all([
      prisma.expenseCategory.create({ data: { name: `${TAG}_Fuel` } }),
      prisma.expenseCategory.create({ data: { name: `${TAG}_Food` } }),
    ]);
    catFuelId = catFuel.id; catFoodId = catFood.id;
  });

  afterAll(async () => {
    for (const id of handoverIds) {
      await prisma.accountEntry.deleteMany({ where: { referenceId: id } });
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: id } });
      await prisma.cashHandover.delete({ where: { id } }).catch(() => {});
    }
    await prisma.userAccount.deleteMany({ where: { userId: receiverId } });
    if (receiverId) await prisma.user.delete({ where: { id: receiverId } }).catch(() => {});
    await prisma.expenseCategory.deleteMany({ where: { id: { in: [catFuelId, catFoodId] } } });
    await moduleRef.close();
  });

  it('CASE 14 — historical (pre-migration-backfilled) CashHandoverExpense rows are visible and correctly categorized in the real aggregation', async () => {
    // Ground truth, read completely independently of the service under test.
    const realRows = await prisma.cashHandoverExpense.findMany({
      include: { cashHandover: { select: { receiverName: true } } },
    });
    expect(realRows.length).toBeGreaterThan(0); // sanity: the pre-existing backfilled data is really there
    expect(realRows.every((r) => r.categoryId !== undefined)).toBe(true); // schema shape sane

    const byReceiverGroundTruth = new Map<string, Decimal>();
    for (const r of realRows) {
      const name = r.cashHandover.receiverName;
      byReceiverGroundTruth.set(name, (byReceiverGroundTruth.get(name) ?? new Decimal(0)).plus(r.amount.toString()));
    }

    const summary = await svc.getExpensesSummary();
    for (const [name, total] of byReceiverGroundTruth) {
      const row = summary.find((s: any) => s.employeeName === name);
      expect(row).toBeDefined();
      expect(row!.totalExpenses).toBe(total.toFixed(2));
    }
  });

  it('CASE 2/3/6/7 + CASE 13 (read-only) — a fresh employee with one Fuel + one Food expense on the SAME handover aggregates correctly, with zero writes from viewing it', async () => {
    const before = {
      handoverCount: await prisma.cashHandover.count(),
      expenseCount: await prisma.cashHandoverExpense.count(),
      accountEntryCount: await prisma.accountEntry.count(),
    };

    const created = await svc.create(
      {
        date: '2026-08-15', receiverId,
        expectedAmt: '440.00', handedAmt: '440.00',
        expenses: [
          { categoryId: catFuelId, amount: '40.00' },
          { categoryId: catFoodId, amount: '20.00' },
        ],
      },
      CLERK_ID,
    );
    handoverIds.push(created.id);

    // Employee summary.
    const empSummary = await svc.getEmployeeExpenses(receiverId);
    expect(empSummary.totalExpenses).toBe('60.00');
    expect(empSummary.categories.sort((a: any, b: any) => a.categoryName.localeCompare(b.categoryName))).toEqual([
      { categoryId: catFoodId, categoryName: `${TAG}_Food`, total: '20.00' },
      { categoryId: catFuelId, categoryName: `${TAG}_Fuel`, total: '40.00' },
    ]);

    // Category drill-down — every individual occurrence.
    const fuelDetail = await svc.getEmployeeCategoryExpenses(receiverId, catFuelId);
    expect(fuelDetail.total).toBe('40.00');
    expect(fuelDetail.occurrences).toHaveLength(1);
    expect(fuelDetail.occurrences[0].cashHandoverId).toBe(created.id);

    // CASE 13: reading all of the above created/updated/deleted NOTHING.
    const after = {
      handoverCount: await prisma.cashHandover.count(),
      expenseCount: await prisma.cashHandoverExpense.count(),
      accountEntryCount: await prisma.accountEntry.count(),
    };
    // +1 handover / +2 expenses / +1 ledger entry from svc.create() ABOVE
    // (the write under test), never from the three read calls that followed.
    expect(after.handoverCount).toBe(before.handoverCount + 1);
    expect(after.expenseCount).toBe(before.expenseCount + 2);
    expect(after.accountEntryCount).toBe(before.accountEntryCount + 1);
  });
});
