import { Injectable } from '@nestjs/common';
import { ContainerTrackingAssignment, Prisma, TraqoAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ResolvedAssignment =
  | { kind: 'active'; account: TraqoAccount; assignment: ContainerTrackingAssignment }
  | { kind: 'ended' }
  | { kind: 'no_slot' };

export type AllocationFailureKind = 'unauthorized' | 'rate_limited' | 'payment_required';

const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // Traqo didn't send Retry-After
const PAYMENT_REQUIRED_COOLDOWN_MS = 60 * 60 * 1000; // re-attempt in 1h; may still self-heal sooner

/**
 * Assigns containers to Traqo accounts (max 4 active/account, 3 accounts),
 * and tracks each account's operational health. See the multi-account
 * architecture plan for the full design; summary of the invariants this
 * enforces:
 *
 *   - "Active" = a ContainerTrackingAssignment row with releasedAt IS NULL.
 *     Usage per account is always COUNT(*), never a stored counter (a
 *     denormalized counter can drift; a computed count can't).
 *   - Allocation is race-safe via SELECT ... FOR UPDATE on the specific
 *     TraqoAccount row being evaluated, re-counting inside the lock before
 *     inserting — mirrors this codebase's existing stock-lot locking pattern
 *     (see common/inventory/consume-lots.ts). A partial unique index on
 *     ContainerTrackingAssignment(containerId) WHERE releasedAt IS NULL is
 *     the DB-level backstop.
 *   - Release only ever happens because a refresh observed Traqo's own
 *     is_active===0 / closed_at!==null signal (releaseReason:
 *     "traqo_removed") — NEVER because our Container.status became
 *     'arrived'. See ContainerTrackingService.refreshTracking().
 */
@Injectable()
export class TraqoAccountAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve what a refresh should do for this container: use its existing
   * active assignment, allocate a new one (first-ever refresh), report that
   * tracking already ended (previously released as traqo_removed — no
   * reallocation), or report no slot is available. Must run inside the
   * caller's transaction so allocation is atomic with the throttle check.
   */
  async resolveForRefresh(tx: Prisma.TransactionClient, containerId: string): Promise<ResolvedAssignment> {
    const active = await tx.containerTrackingAssignment.findFirst({
      where: { containerId, releasedAt: null },
      include: { traqoAccount: true },
    });
    if (active) {
      return { kind: 'active', account: active.traqoAccount, assignment: active };
    }

    const lastReleased = await tx.containerTrackingAssignment.findFirst({
      where: { containerId, releasedAt: { not: null } },
      orderBy: { releasedAt: 'desc' },
    });
    if (lastReleased?.releaseReason === 'traqo_removed') {
      return { kind: 'ended' };
    }

    const allocated = await this.allocate(tx, containerId);
    if (!allocated) return { kind: 'no_slot' };
    return { kind: 'active', account: allocated.account, assignment: allocated.assignment };
  }

  /**
   * Find the lowest-usage eligible account with room and atomically create
   * an assignment for it, trying the next candidate if a race fills it
   * first. Returns null if every eligible account is at maxContainers (or
   * none are eligible) — callers must not call the Traqo provider in that
   * case.
   */
  private async allocate(
    tx: Prisma.TransactionClient,
    containerId: string,
  ): Promise<{ account: TraqoAccount; assignment: ContainerTrackingAssignment } | null> {
    const now = new Date();
    const candidates = await tx.traqoAccount.findMany({
      where: {
        active: true,
        OR: [
          { status: 'healthy' },
          { status: 'rate_limited', OR: [{ unavailableUntil: null }, { unavailableUntil: { lt: now } }] },
        ],
      },
    });
    if (candidates.length === 0) return null;

    const counts = await tx.containerTrackingAssignment.groupBy({
      by: ['traqoAccountId'],
      where: { traqoAccountId: { in: candidates.map((c) => c.id) }, releasedAt: null },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.traqoAccountId, c._count._all]));

    // Deterministic tie-break ordering: lowest current usage, then priority,
    // then id. This ordering is a snapshot only — the authoritative check
    // happens after each account's row is locked, below.
    const ordered = [...candidates].sort((a, b) => {
      const ca = countMap.get(a.id) ?? 0;
      const cb = countMap.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    for (const account of ordered) {
      // Lock this account row before re-counting — a concurrent allocation
      // attempt against the SAME account is forced to wait until this
      // transaction commits or rolls back, so the count below can never be
      // stale (mirrors consume-lots.ts's stock-lot locking pattern).
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "traqo_accounts" WHERE id = ${account.id} FOR UPDATE`);
      const activeCount = await tx.containerTrackingAssignment.count({
        where: { traqoAccountId: account.id, releasedAt: null },
      });
      if (activeCount < account.maxContainers) {
        const assignment = await tx.containerTrackingAssignment.create({
          data: { containerId, traqoAccountId: account.id },
        });
        return { account, assignment };
      }
    }
    return null;
  }

  /**
   * Release the container's active assignment because a refresh confirmed
   * Traqo's own is_active===0 / closed_at!==null signal. No-op if there is
   * no active assignment. Must run in the same transaction as the
   * ContainerTracking write that observed the signal.
   */
  async releaseAsTraqoRemoved(tx: Prisma.TransactionClient, containerId: string): Promise<void> {
    await tx.containerTrackingAssignment.updateMany({
      where: { containerId, releasedAt: null },
      data: { releasedAt: new Date(), releaseReason: 'traqo_removed' },
    });
  }

  /**
   * Record an account-level provider failure. 401 marks the account
   * auth_failed (excluded from NEW allocation only — existing assignments
   * to it are untouched, they'll just keep failing until an admin fixes the
   * key or a later call self-heals it via recordSuccess). 429 marks a
   * short, self-clearing rate_limited cooldown. 402 (shipment_limit_reached
   * / payment_overdue) marks payment_required, which — like auth_failed —
   * needs either a self-heal or manual attention, not just a short wait.
   */
  async recordFailure(
    accountId: string,
    kind: AllocationFailureKind,
    retryAfterSeconds?: number,
  ): Promise<void> {
    const now = new Date();
    if (kind === 'unauthorized') {
      await this.prisma.traqoAccount.update({
        where: { id: accountId },
        data: { status: 'auth_failed', lastFailureAt: now, lastFailureKind: kind },
      });
      return;
    }
    if (kind === 'rate_limited') {
      const cooldownMs = retryAfterSeconds ? retryAfterSeconds * 1000 : RATE_LIMIT_DEFAULT_COOLDOWN_MS;
      await this.prisma.traqoAccount.update({
        where: { id: accountId },
        data: {
          status: 'rate_limited',
          unavailableUntil: new Date(now.getTime() + cooldownMs),
          lastFailureAt: now,
          lastFailureKind: kind,
        },
      });
      return;
    }
    // payment_required
    await this.prisma.traqoAccount.update({
      where: { id: accountId },
      data: {
        status: 'payment_required',
        unavailableUntil: new Date(now.getTime() + PAYMENT_REQUIRED_COOLDOWN_MS),
        lastFailureAt: now,
        lastFailureKind: kind,
      },
    });
  }

  /**
   * A successful provider call on this account is evidence it's usable
   * again — self-heals a stale auth_failed/rate_limited/payment_required
   * status back to healthy. Only writes when a change is actually needed.
   */
  async recordSuccess(account: TraqoAccount): Promise<void> {
    if (account.status === 'healthy' && !account.unavailableUntil) return;
    await this.prisma.traqoAccount.update({
      where: { id: account.id },
      data: { status: 'healthy', unavailableUntil: null, lastFailureAt: null, lastFailureKind: null },
    });
  }
}
