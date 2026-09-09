/**
 * Real-Postgres integration test — requires the dev DB running and DATABASE_URL
 * configured. Run via `npm run test:integration`.
 *
 * Business-model audit (2026-09-04): "A Cash Handover is NOT an employee
 * expense." Reproduces the canonical example end to end against the real
 * database and CashHandoversService.create() (the current, already-correct
 * write path — unlike cash-handover-correction.integration-spec.ts, this
 * needs no pre-fix historical shape):
 *
 *   Gaz collects $100 → spends $10 on benzin (a BUSINESS expense) →
 *   hands the accountant $90.
 *
 * Proves getBusinessExpenses() represents this correctly (business expense,
 * cash holder = Gaz, reconciliation context reconstructs the original $100),
 * the ledger settlement rule is unchanged (still debits the full $100), and
 * the expense is never duplicated against a same-period GeneralExpense.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CashHandoversModule } from '../src/cash-handovers/cash-handovers.module';
import { CashHandoversService } from '../src/cash-handovers/cash-handovers.service';
import { LedgerWriteService } from '../src/ledger/ledger-write.service';

const TAG = `BIZ_EXPENSE_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('Business Expenses — Cash Handover expense is a BUSINESS expense, not an employee expense (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CashHandoversService;
  let ledger: LedgerWriteService;

  let gazId: string;
  let categoryId: string;
  const handoverIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CashHandoversModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(CashHandoversService);
    ledger = moduleRef.get(LedgerWriteService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID }, update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const gaz = await prisma.user.create({
      data: { clerkId: `${TAG}_gaz`, email: `${TAG}_gaz@example.com`, name: `Gaz_${TAG}`, role: 'sales_rep' },
    });
    gazId = gaz.id;

    const category = await prisma.expenseCategory.create({ data: { name: `Benzin_${TAG}` } });
    categoryId = category.id;
  });

  afterAll(async () => {
    for (const id of handoverIds) {
      await prisma.accountEntry.deleteMany({ where: { referenceId: id } });
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: id } });
      await prisma.cashHandover.delete({ where: { id } }).catch(() => {});
    }
    await prisma.generalExpense.deleteMany({ where: { description: { contains: TAG } } });
    await prisma.expenseCategory.delete({ where: { id: categoryId } }).catch(() => {});
    const account = await prisma.userAccount.findUnique({ where: { userId: gazId } });
    if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
    await prisma.userAccount.deleteMany({ where: { userId: gazId } });
    await prisma.user.delete({ where: { id: gazId } }).catch(() => {});
    await moduleRef.close();
  });

  it('CASE 1 — $100 collected, $10 benzin expense, $90 handed: settlement, reconciliation, and cash-holder attribution are all correct', async () => {
    // Gaz collects $100 (credited to his ledger balance exactly like a real sale/payment would).
    await prisma.$transaction(async (tx) => {
      await ledger.creditAccount(tx, gazId, new Decimal('100.00'), 'sale_collected', `${TAG}-credit`, 'Test collection', new Date('2026-09-03'));
    });

    const handover = await service.create(
      {
        date: '2026-09-03',
        receiverId: gazId,
        expectedAmt: '90.00', // collected($100) - expense($10)
        handedAmt: '90.00',
        expenses: [{ categoryId, amount: '10.00' }],
      },
      CLERK_ID,
    );
    handoverIds.push(handover.id);

    // ── Ledger settlement rule is UNCHANGED: debits the full $100 (handed + expenses), not just $90. ──
    const account = await prisma.userAccount.findUnique({ where: { userId: gazId } });
    expect(new Decimal(account!.balance.toString()).toFixed(2)).toBe('0.00'); // $100 credited, $100 settled (handed+expense) → net zero.

    // ── getBusinessExpenses(): the SAME record, represented as a business expense. ──
    const rows = await service.getBusinessExpenses('2026-09-01', '2026-09-30');
    const row = rows.find((r) => r.cashHandoverId === handover.id);
    expect(row).toBeDefined();

    // The expense itself.
    expect(row!.amount).toBe('10.00');
    expect(row!.categoryName).toBe(`Benzin_${TAG}`);

    // CASE 3 — expense date is the CASH HANDOVER date (Sept 3), never any other date.
    expect(new Date(row!.date).toISOString().slice(0, 10)).toBe('2026-09-03');

    // CASE 4 — the employee is represented ONLY as the cash holder, never as the expense owner.
    expect(row!.cashHolderId).toBe(gazId);
    expect(row!.cashHolderName).toBe(`Gaz_${TAG}`);
    expect(row).not.toHaveProperty('employeeId');
    expect(row).not.toHaveProperty('employeeName');

    // Reconciliation context reconstructs the original $100: collected = expectedAmt + expenses.
    expect(row!.handoverExpectedAmt).toBe('90.00');
    expect(row!.handoverHandedAmt).toBe('90.00');
    expect(row!.handoverExpensesTotal).toBe('10.00');
    const collected = new Decimal(row!.handoverExpectedAmt).plus(row!.handoverExpensesTotal);
    expect(collected.toFixed(2)).toBe('100.00');

    // CASE 2 — appears EXACTLY ONCE in the business-expense list, no duplicate row for the same occurrence.
    expect(rows.filter((r) => r.cashHandoverId === handover.id)).toHaveLength(1);
  });

  it('CASE 5 — a direct/general company expense in the same period is never pulled into getBusinessExpenses() (different source, no cross-contamination)', async () => {
    const general = await prisma.generalExpense.create({
      data: {
        description: `Rent_${TAG}`, amount: '200.00', isRecurring: false,
        date: new Date('2026-09-03'), addedById: (await prisma.user.findUniqueOrThrow({ where: { clerkId: CLERK_ID } })).id,
      },
    });

    const rows = await service.getBusinessExpenses('2026-09-01', '2026-09-30');
    expect(rows.some((r) => r.description.includes('Rent'))).toBe(false);

    await prisma.generalExpense.delete({ where: { id: general.id } });
  });
});
