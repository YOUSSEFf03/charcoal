/**
 * Real-Postgres integration test — requires the dev DB running and DATABASE_URL
 * configured. Run via `npm run test:integration`.
 *
 * Forensic audit (2026-08-30): reproduces the FULL historical scenario found
 * in the real database (youssef: 4 expense-bearing handovers, only the last
 * one's under-debit still outstanding; abu baker: 1 expense-bearing handover,
 * already organically cleared) using isolated, uniquely-tagged fixtures, and
 * proves CashHandoverCorrectionService corrects exactly the outstanding case,
 * idempotently, without touching any historical record.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CashHandoversModule } from '../src/cash-handovers/cash-handovers.module';
import { CashHandoverCorrectionService } from '../src/cash-handovers/cash-handover-correction.service';
import { LedgerWriteService } from '../src/ledger/ledger-write.service';

const TAG = `CASH_CORRECTION_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

describe('CashHandoverCorrectionService — full historical scenario (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let correction: CashHandoverCorrectionService;
  let ledger: LedgerWriteService;

  let youssefId: string;
  let abuBakerId: string;
  const handoverIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CashHandoversModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    correction = moduleRef.get(CashHandoverCorrectionService);
    ledger = moduleRef.get(LedgerWriteService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID }, update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });

    const youssef = await prisma.user.create({
      data: { clerkId: `${TAG}_youssef`, email: `${TAG}_youssef@example.com`, name: `youssef_${TAG}`, role: 'sales_rep' },
    });
    youssefId = youssef.id;
    const abuBaker = await prisma.user.create({
      data: { clerkId: `${TAG}_abubaker`, email: `${TAG}_abubaker@example.com`, name: `abu_baker_${TAG}`, role: 'sales_rep' },
    });
    abuBakerId = abuBaker.id;
  });

  afterAll(async () => {
    for (const id of handoverIds) {
      await prisma.accountEntry.deleteMany({ where: { referenceId: id } });
      await prisma.accountEntry.deleteMany({ where: { referenceId: `cash-handover-correction:${id}` } });
      await prisma.cashHandoverExpense.deleteMany({ where: { cashHandoverId: id } });
      await prisma.cashHandover.delete({ where: { id } }).catch(() => {});
    }
    for (const uid of [youssefId, abuBakerId]) {
      const account = await prisma.userAccount.findUnique({ where: { userId: uid } });
      if (account) await prisma.accountEntry.deleteMany({ where: { accountId: account.id } });
      await prisma.userAccount.deleteMany({ where: { userId: uid } });
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await moduleRef.close();
  });

  async function credit(userId: string, amount: string, date: string, refId: string) {
    await prisma.$transaction(async (tx) => {
      await ledger.creditAccount(tx, userId, new Decimal(amount), 'sale_collected', refId, 'Test collection', new Date(date));
    });
  }

  /**
   * Directly reproduces a PRE-FIX historical handover: creates the
   * CashHandover(+expenses) row exactly as CashHandoversService.create()
   * would, but debits the ledger by ONLY handedAmt (the bug), never
   * handedAmt+expenses. Bypasses the (now-fixed) service deliberately — this
   * test's whole premise is "data created before the fix existed," so
   * calling the current create() would debit correctly and never reproduce
   * the historical shortfall to correct.
   */
  async function createHistoricalHandover(
    receiverId: string, date: string, expectedAmt: string, handedAmt: string,
    expenses: { description: string; amount: string }[] = [],
  ) {
    return prisma.$transaction(async (tx) => {
      const handover = await tx.cashHandover.create({
        data: {
          date: new Date(date), receiverId, receiverName: '(test)',
          expectedAmt, handedAmt, difference: (parseFloat(handedAmt) - parseFloat(expectedAmt)).toFixed(2),
          loggedById: (await tx.user.findUniqueOrThrow({ where: { clerkId: CLERK_ID } })).id,
          ...(expenses.length > 0 ? { expenses: { create: expenses } } : {}),
        },
      });
      await ledger.debitAccount(tx, receiverId, new Decimal(handedAmt), handover.id, new Date(date));
      return handover;
    });
  }

  it('reproduces the real dataset and computes exactly one actionable correction: youssef, the last handover, $40', async () => {
    // Youssef: 4 expense-bearing handovers, mirroring the real sequence
    // exactly — created via the PRE-FIX write shape (debit = handedAmt only).
    await credit(youssefId, '3982.03', '2026-08-09', `${TAG}-y-credit-1`);
    const h1 = await createHistoricalHandover(youssefId, '2026-08-09', '3962.03', '3982.03', [{ description: 'gaz', amount: '20.00' }]);
    handoverIds.push(h1.id);

    await credit(youssefId, '3300.00', '2026-08-24', `${TAG}-y-credit-2`);
    const h2 = await createHistoricalHandover(youssefId, '2026-08-24', '3200.00', '3200.00', [{ description: 'benzin', amount: '100.00' }]);
    handoverIds.push(h2.id);
    // Organic offset 2 days later — hands over exactly the $100 left sitting
    // in the balance, no expense of its own.
    const h2b = await createHistoricalHandover(youssefId, '2026-08-26', '100.00', '100.00');
    handoverIds.push(h2b.id);

    await credit(youssefId, '387.00', '2026-08-29', `${TAG}-y-credit-3`);
    const h3 = await createHistoricalHandover(youssefId, '2026-08-29', '367.00', '367.00', [{ description: 'benzin', amount: '20.00' }]);
    handoverIds.push(h3.id);
    // Same-day organic offset.
    const h3b = await createHistoricalHandover(youssefId, '2026-08-29', '20.00', '20.00');
    handoverIds.push(h3b.id);

    // The one handover that is still outstanding — reproduced via the REAL
    // (already-fixed) service is intentionally wrong here too: this specific
    // record represents "created before the fix shipped," so it must also
    // use the pre-fix write shape to genuinely need correcting.
    await credit(youssefId, '500.00', '2026-08-30', `${TAG}-y-credit-4`);
    const h4 = await createHistoricalHandover(youssefId, '2026-08-30', '460.00', '460.00', [{ description: 'fuel', amount: '40.00' }]);
    handoverIds.push(h4.id);

    // Abu baker: 1 expense-bearing handover, organically cleared same day.
    await credit(abuBakerId, '40.00', '2026-08-20', `${TAG}-ab-credit-1`);
    const ab1 = await createHistoricalHandover(abuBakerId, '2026-08-20', '20.00', '20.00', [{ description: 'fuel', amount: '20.00' }]);
    handoverIds.push(ab1.id);
    const ab1b = await createHistoricalHandover(abuBakerId, '2026-08-20', '20.00', '20.00');
    handoverIds.push(ab1b.id);

    // Ground truth current balances, matching the real audit exactly.
    const youssefAccount = await prisma.userAccount.findUnique({ where: { userId: youssefId } });
    const abuBakerAccount = await prisma.userAccount.findUnique({ where: { userId: abuBakerId } });
    expect(youssefAccount!.balance.toString()).toBe('40');
    expect(abuBakerAccount!.balance.toString()).toBe('0');

    // === DRY RUN ===
    const { candidates, actionable } = await correction.dryRun();
    const ours = candidates.filter(c => [h1.id, h2.id, h3.id, h4.id, ab1.id].includes(c.handoverId));
    expect(ours).toHaveLength(5);
    expect(ours.find(c => c.handoverId === h1.id)).toMatchObject({ remainingCorrection: '0.00', alreadySettled: '20.00' });
    expect(ours.find(c => c.handoverId === h2.id)).toMatchObject({ remainingCorrection: '0.00', alreadySettled: '100.00' });
    expect(ours.find(c => c.handoverId === h3.id)).toMatchObject({ remainingCorrection: '0.00', alreadySettled: '20.00' });
    expect(ours.find(c => c.handoverId === h4.id)).toMatchObject({ remainingCorrection: '40.00', alreadySettled: '0.00' });
    expect(ours.find(c => c.handoverId === ab1.id)).toMatchObject({ remainingCorrection: '0.00', alreadySettled: '20.00' });

    const ourActionable = actionable.filter(c => [h1.id, h2.id, h3.id, h4.id, ab1.id].includes(c.handoverId));
    expect(ourActionable).toEqual([expect.objectContaining({ handoverId: h4.id, receiverId: youssefId, remainingCorrection: '40.00' })]);

    // Dry run performed ZERO writes — balances unchanged.
    const youssefAfterDryRun = await prisma.userAccount.findUnique({ where: { userId: youssefId } });
    expect(youssefAfterDryRun!.balance.toString()).toBe('40');

    // === APPLY ===
    const results = await correction.apply(actionable.filter(c => c.receiverId === youssefId || c.receiverId === abuBakerId));
    expect(results).toEqual([{ handoverId: h4.id, receiverId: youssefId, amount: '40.00', status: 'applied' }]);

    // Youssef's balance is now exactly $0.00; abu baker untouched at $0.00.
    const youssefAfter = await prisma.userAccount.findUnique({ where: { userId: youssefId } });
    const abuBakerAfter = await prisma.userAccount.findUnique({ where: { userId: abuBakerId } });
    expect(youssefAfter!.balance.toString()).toBe('0');
    expect(abuBakerAfter!.balance.toString()).toBe('0');

    // Exactly ONE new AccountEntry was created (the correction), referencing h4.
    const correctionEntries = await prisma.accountEntry.findMany({ where: { referenceId: `cash-handover-correction:${h4.id}` } });
    expect(correctionEntries).toHaveLength(1);
    expect(parseFloat(correctionEntries[0].amount.toString())).toBeCloseTo(-40, 2);
    expect(correctionEntries[0].description).toContain('HISTORICAL CORRECTION');
    expect(correctionEntries[0].description).toContain(h4.id);

    // Original handovers, expenses, and every pre-existing AccountEntry are untouched.
    const h4Refetched = await prisma.cashHandover.findUniqueOrThrow({ where: { id: h4.id }, include: { expenses: true } });
    expect(parseFloat(h4Refetched.handedAmt.toString())).toBeCloseTo(460, 2);
    expect(h4Refetched.expenses).toHaveLength(1);
    expect(parseFloat(h4Refetched.expenses[0].amount.toString())).toBeCloseTo(40, 2);
    const originalH4Entry = await prisma.accountEntry.findFirst({ where: { referenceId: h4.id } });
    expect(parseFloat(originalH4Entry!.amount.toString())).toBeCloseTo(-460, 2); // untouched

    // === IDEMPOTENCY: running apply() again creates NO second debit ===
    const secondRun = await correction.apply(actionable.filter(c => c.receiverId === youssefId));
    expect(secondRun).toEqual([{
      handoverId: h4.id, receiverId: youssefId, amount: '40.00', status: 'already_applied',
      detail: expect.stringContaining(correctionEntries[0].id),
    }]);
    const correctionEntriesAfterSecondRun = await prisma.accountEntry.findMany({ where: { referenceId: `cash-handover-correction:${h4.id}` } });
    expect(correctionEntriesAfterSecondRun).toHaveLength(1); // still exactly one
    const youssefAfterSecondRun = await prisma.userAccount.findUnique({ where: { userId: youssefId } });
    expect(youssefAfterSecondRun!.balance.toString()).toBe('0'); // unchanged
  }, 30000);
});
