import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';

/**
 * One-time historical correction for the Cash Handover expense-settlement bug
 * (forensic audit, 2026-08-30): CashHandoversService.create() used to debit
 * UserAccount.balance by only handedAmt, never the itemized
 * CashHandoverExpense total, leaving a permanent residual balance equal to
 * the expense total after every expense-bearing handover. The bug itself is
 * already fixed (create() now debits handedAmt + Σexpenses) — this service
 * only repairs the historical damage already baked into UserAccount.balance
 * for handovers created BEFORE that fix.
 *
 * ── Why "replay to the last zero-crossing" and not "sum every historical
 *    expense" ──────────────────────────────────────────────────────────────
 * A running ledger balance that touches exactly $0 at some point makes every
 * entry before that point irrelevant to the CURRENT balance — the account
 * genuinely settled to zero there, whatever led up to it. Forensic replay of
 * the real data proved this matters: of 5 historical expense-bearing
 * handovers (across 2 receivers), 3 had their nominal under-debit
 * subsequently, organically cleared by a LATER handover that happened to pay
 * in exactly the leftover amount (with no expense of its own) before the
 * balance ever accumulated further — e.g. a $100 shortfall from one handover
 * was fully recovered two days later by an unrelated-looking $100 handover.
 * A blind "add back every historical expense" correction would have
 * DOUBLE-COUNTED that money and left the balance more wrong than before,
 * not less. Only under-debits that occur AFTER a receiver's most recent
 * zero-crossing are still genuinely outstanding — this is what
 * computeCandidates() below actually computes, not a hardcoded case.
 */

export interface CashHandoverCorrectionCandidate {
  handoverId: string;
  receiverId: string;
  receiverName: string;
  date: Date;
  expenseTotal: string;
  alreadySettled: string;
  remainingCorrection: string;
}

export interface CashHandoverCorrectionApplyResult {
  handoverId: string;
  receiverId: string;
  amount: string;
  status: 'applied' | 'already_applied' | 'aborted_state_mismatch';
  detail?: string;
}

const CORRECTION_REFERENCE_PREFIX = 'cash-handover-correction:';
const CORRECTION_DESCRIPTION_PREFIX = 'HISTORICAL CORRECTION — Cash Handover Expense Settlement';

@Injectable()
export class CashHandoverCorrectionService {
  private readonly logger = new Logger(CashHandoverCorrectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerWriteService: LedgerWriteService,
  ) {}

  private correctionReferenceId(handoverId: string): string {
    return `${CORRECTION_REFERENCE_PREFIX}${handoverId}`;
  }

  /**
   * Pure replay: given one receiver's full AccountEntry history (ascending
   * date, with id as a deterministic tiebreaker) and a map of
   * handoverId -> nominal expense total for that receiver's affected
   * handovers, returns, per handover, how much of its nominal expense is
   * "already settled" (occurred at-or-before the receiver's last
   * zero-crossing) vs "still outstanding" (occurred strictly after it).
   *
   * Exported at module scope (not a class method) so it is trivially unit
   * testable with hand-built entry arrays, independent of Prisma.
   */
  static replay(
    entries: { amount: string; type: string; referenceId: string | null }[],
    expenseByHandoverId: Map<string, Decimal>,
  ): Map<string, { alreadySettled: Decimal; remaining: Decimal }> {
    let running = new Decimal(0);
    let lastZeroIndex = -1;
    entries.forEach((e, i) => {
      running = running.plus(e.amount);
      if (running.isZero()) lastZeroIndex = i;
    });

    const result = new Map<string, { alreadySettled: Decimal; remaining: Decimal }>();
    entries.forEach((e, i) => {
      if (e.type !== 'handover' || !e.referenceId) return;
      const expenseTotal = expenseByHandoverId.get(e.referenceId);
      if (!expenseTotal) return;
      result.set(e.referenceId, i <= lastZeroIndex
        ? { alreadySettled: expenseTotal, remaining: new Decimal(0) }
        : { alreadySettled: new Decimal(0), remaining: expenseTotal });
    });
    return result;
  }

  /**
   * Read-only. Zero database writes. Computes, for every historical
   * CashHandover with itemized expenses, whether its under-debit is still
   * outstanding in the receiver's CURRENT UserAccount.balance.
   */
  async computeCandidates(): Promise<CashHandoverCorrectionCandidate[]> {
    const affected = await this.prisma.cashHandover.findMany({
      where: { expenses: { some: {} }, receiverId: { not: null } },
      include: { expenses: true, receiver: { select: { id: true, name: true } } },
      orderBy: [{ receiverId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    const byReceiver = new Map<string, typeof affected>();
    for (const h of affected) {
      const list = byReceiver.get(h.receiverId!) ?? [];
      list.push(h);
      byReceiver.set(h.receiverId!, list);
    }

    const candidates: CashHandoverCorrectionCandidate[] = [];

    for (const [receiverId, handovers] of byReceiver) {
      const account = await this.prisma.userAccount.findUnique({ where: { userId: receiverId } });
      if (!account) {
        // No ledger account at all for this receiver — nothing was ever
        // debited/credited, so there is nothing to correct here.
        continue;
      }

      const entries = await this.prisma.accountEntry.findMany({
        where: { accountId: account.id },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { amount: true, type: true, referenceId: true },
      });

      const expenseByHandoverId = new Map<string, Decimal>();
      for (const h of handovers) {
        const total = h.expenses.reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0));
        expenseByHandoverId.set(h.id, total);
      }

      const replayResult = CashHandoverCorrectionService.replay(
        entries.map(e => ({ amount: e.amount.toString(), type: e.type, referenceId: e.referenceId })),
        expenseByHandoverId,
      );

      for (const h of handovers) {
        const r = replayResult.get(h.id);
        // A handover with no matching 'handover'-type entry at all (e.g. the
        // debitAccount() call somehow never ran) has nothing in the ledger to
        // correct against — skip rather than guess.
        if (!r) continue;
        candidates.push({
          handoverId: h.id,
          receiverId,
          receiverName: h.receiver?.name ?? h.receiverName,
          date: h.date,
          expenseTotal: (expenseByHandoverId.get(h.id) ?? new Decimal(0)).toFixed(2),
          alreadySettled: r.alreadySettled.toFixed(2),
          remainingCorrection: r.remaining.toFixed(2),
        });
      }
    }

    return candidates;
  }

  /**
   * Dry run: computeCandidates() plus a formatted summary. No writes.
   */
  async dryRun(): Promise<{
    candidates: CashHandoverCorrectionCandidate[];
    actionable: CashHandoverCorrectionCandidate[];
  }> {
    const candidates = await this.computeCandidates();
    const actionable = candidates.filter(c => new Decimal(c.remainingCorrection).gt(0));
    return { candidates, actionable };
  }

  /**
   * Apply mode. For each candidate with remainingCorrection > 0:
   *   1. Opens a transaction.
   *   2. Acquires a Postgres advisory lock scoped to this exact handover's
   *      correction key (pg_advisory_xact_lock — released automatically at
   *      commit/rollback) — genuine mutual exclusion against a second
   *      concurrent apply of the SAME correction, without any schema change
   *      (AccountEntry.referenceId has no unique constraint; this is the
   *      standard Postgres idiom for "run at most once" without one).
   *   3. Checks for an existing AccountEntry with this correction's own
   *      distinct referenceId (`cash-handover-correction:<handoverId>` —
   *      never used by any other write path, so an exact match is
   *      unambiguous, unlike matching on free-text description). If found,
   *      this correction was already applied — skip, no write.
   *   4. Re-runs the SAME replay computation fresh, inside the lock, and
   *      aborts (no write) if the recomputed remaining amount no longer
   *      matches what the caller expected (dto verification against a
   *      changed state) — protects against acting on stale dry-run output.
   *   5. Writes exactly one compensating debit via the EXISTING
   *      LedgerWriteService.debitAccount() path — never a direct
   *      AccountEntry insert, never a direct UserAccount.balance update.
   *
   * @param candidates - Exactly the candidates a prior dryRun() call
   *   produced (or a filtered subset) — re-verified fresh against the live
   *   database before any write, never trusted blindly.
   */
  async apply(candidates: CashHandoverCorrectionCandidate[]): Promise<CashHandoverCorrectionApplyResult[]> {
    const results: CashHandoverCorrectionApplyResult[] = [];

    for (const candidate of candidates) {
      const expectedRemaining = new Decimal(candidate.remainingCorrection);
      if (expectedRemaining.lte(0)) continue;

      const referenceId = this.correctionReferenceId(candidate.handoverId);

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${referenceId}))`,
        );

        const existing = await tx.accountEntry.findFirst({ where: { referenceId } });
        if (existing) {
          return {
            handoverId: candidate.handoverId, receiverId: candidate.receiverId,
            amount: candidate.remainingCorrection, status: 'already_applied' as const,
            detail: `AccountEntry ${existing.id} already exists for this correction`,
          };
        }

        // Re-verify the correction is still warranted under the CURRENT
        // ledger state, not the (possibly stale) state the dry run saw.
        const account = await tx.userAccount.findUnique({ where: { userId: candidate.receiverId } });
        if (!account) {
          return {
            handoverId: candidate.handoverId, receiverId: candidate.receiverId,
            amount: candidate.remainingCorrection, status: 'aborted_state_mismatch' as const,
            detail: 'Receiver has no UserAccount — state no longer matches the dry run',
          };
        }
        const handover = await tx.cashHandover.findUnique({
          where: { id: candidate.handoverId },
          include: { expenses: true },
        });
        if (!handover) {
          return {
            handoverId: candidate.handoverId, receiverId: candidate.receiverId,
            amount: candidate.remainingCorrection, status: 'aborted_state_mismatch' as const,
            detail: 'CashHandover no longer exists',
          };
        }
        const entries = await tx.accountEntry.findMany({
          where: { accountId: account.id },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { amount: true, type: true, referenceId: true },
        });
        const expenseTotal = handover.expenses.reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0));
        const replay = CashHandoverCorrectionService.replay(
          entries.map(e => ({ amount: e.amount.toString(), type: e.type, referenceId: e.referenceId })),
          new Map([[handover.id, expenseTotal]]),
        );
        const fresh = replay.get(handover.id);
        const freshRemaining = fresh?.remaining ?? new Decimal(0);
        if (!freshRemaining.equals(expectedRemaining)) {
          return {
            handoverId: candidate.handoverId, receiverId: candidate.receiverId,
            amount: candidate.remainingCorrection, status: 'aborted_state_mismatch' as const,
            detail: `Recomputed remaining (${freshRemaining.toFixed(2)}) no longer matches dry-run assumption (${expectedRemaining.toFixed(2)})`,
          };
        }

        await this.ledgerWriteService.debitAccount(
          tx, candidate.receiverId, expectedRemaining, referenceId, handover.date,
          `${CORRECTION_DESCRIPTION_PREFIX} — handover ${handover.id} (${handover.date.toISOString().slice(0, 10)}): retroactive expense debit missed by the pre-fix ledger.`,
        );

        return {
          handoverId: candidate.handoverId, receiverId: candidate.receiverId,
          amount: expectedRemaining.toFixed(2), status: 'applied' as const,
        };
      });

      this.logger.log(`Cash handover correction — ${result.status}: ${JSON.stringify(result)}`);
      results.push(result);
    }

    return results;
  }
}
