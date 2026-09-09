import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TraqoAccountAllocationService } from './traqo-account-allocation.service';

/**
 * Real-database test (same pattern as src/prisma/cash-holder.migration.spec.ts):
 * allocation's correctness depends on genuine Postgres row locking (SELECT
 * ... FOR UPDATE) and a genuine partial unique index — neither can be
 * meaningfully proven against a mocked Prisma client, so this talks to the
 * real dev database directly.
 *
 * Isolation: allocation queries ALL eligible TraqoAccount rows globally (as
 * it must in production), so this suite (a) temporarily deactivates any
 * pre-existing accounts (e.g. the 3 seeded production-style accounts) for
 * the duration of the run, restoring them exactly afterward, and (b) tears
 * down every account/container/assignment it creates after EACH test, so
 * one test's leftover capacity can never leak into the next test's
 * "exactly N slots" assertions.
 *
 * Covers the "break/prove" requirements from the multi-account spec:
 *   - allocation fills accounts in deterministic (usage, priority, id) order
 *   - a 5th container rolls over to the next account
 *   - 12 slots total (3 accounts x 4) get exactly filled, the 13th gets
 *     no_slot — the caller uses that to skip the Traqo call entirely
 *   - concurrent allocation against a near-full account never exceeds
 *     maxContainers (proves the FOR UPDATE lock + partial unique index)
 *   - release preserves history and frees the slot for reuse
 *   - an arrived Container.status has zero effect on assignment state
 *   - recordFailure/recordSuccess status transitions
 */
describe('TraqoAccountAllocationService (real database)', () => {
  const prisma = new PrismaClient();
  const service = new TraqoAccountAllocationService(prisma as unknown as PrismaService);

  const userId = '00000000-0000-4000-9000-a00000000001';
  const supplierId = '00000000-0000-4000-9000-a00000000002';

  let preExisting: { id: string; active: boolean }[] = [];
  let containerIds: string[] = [];
  let accountIds: string[] = [];
  let accountCounter = 0;
  let numberCounter = 0;

  async function makeContainer(status: 'port' | 'transit' | 'arrived' = 'port') {
    const number = `TQAL${(++numberCounter).toString().padStart(7, '0')}`;
    const c = await prisma.container.create({
      data: { number, supplierId, status, createdById: userId, sealine: 'MAEU' },
    });
    containerIds.push(c.id);
    return c;
  }

  /** Creates ONE account — for tests where a second/third eligible account would invalidate the assertion. */
  async function makeSingleAccount(maxContainers = 4) {
    const suffix = ++accountCounter;
    const a = await prisma.traqoAccount.create({
      data: { name: `Test Account #${suffix}`, envKeyName: `TEST_TRAQO_KEY_${suffix}`, priority: 1, maxContainers },
    });
    accountIds.push(a.id);
    return a;
  }

  /** Creates a trio of accounts (priority 1/2/3) — for tests about rollover/ordering across accounts. */
  async function makeAccounts(maxContainers = 4) {
    const suffix = ++accountCounter;
    const accounts = [];
    for (let i = 0; i < 3; i++) {
      const a = await prisma.traqoAccount.create({
        data: {
          name: `Test Account #${suffix}${String.fromCharCode(65 + i)}`,
          envKeyName: `TEST_TRAQO_KEY_${suffix}_${i}`,
          priority: i + 1,
          maxContainers,
        },
      });
      accountIds.push(a.id);
      accounts.push(a);
    }
    return accounts;
  }

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        clerkId: 'test_traqo_alloc_owner',
        email: 'traqo-alloc-test@charcoal.test',
        name: 'Traqo Alloc Test Owner',
        role: 'owner',
      },
    });
    await prisma.supplier.upsert({
      where: { id: supplierId },
      update: {},
      create: { id: supplierId, name: 'Traqo Alloc Test Supplier', country: 'Test' },
    });

    // Isolate the allocation universe: deactivate whatever TraqoAccount rows
    // already exist (e.g. the 3 seeded production-style accounts) so they
    // can't absorb allocations this suite expects to land on its own
    // freshly-created test accounts. Restored verbatim in afterAll.
    const existing = await prisma.traqoAccount.findMany();
    preExisting = existing.map((a) => ({ id: a.id, active: a.active }));
    if (preExisting.length > 0) {
      await prisma.traqoAccount.updateMany({
        where: { id: { in: preExisting.map((a) => a.id) } },
        data: { active: false },
      });
    }
  });

  afterAll(async () => {
    for (const a of preExisting) {
      await prisma.traqoAccount.update({ where: { id: a.id }, data: { active: a.active } });
    }
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    containerIds = [];
    accountIds = [];
  });

  afterEach(async () => {
    if (containerIds.length > 0) {
      await prisma.containerTrackingAssignment.deleteMany({ where: { containerId: { in: containerIds } } });
      await prisma.container.deleteMany({ where: { id: { in: containerIds } } });
    }
    if (accountIds.length > 0) {
      await prisma.containerTrackingAssignment.deleteMany({ where: { traqoAccountId: { in: accountIds } } });
      await prisma.traqoAccount.deleteMany({ where: { id: { in: accountIds } } });
    }
  });

  describe('deterministic allocation order and rollover', () => {
    it('rolls over to the next account once the current one hits maxContainers=1', async () => {
      // maxContainers=1 makes "full, must roll over" unambiguous to trace:
      // each account can hold exactly one container before the next
      // allocation is forced onto a different account.
      const [a1, a2, a3] = await makeAccounts(1);

      const c1 = await makeContainer();
      const r1 = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c1.id));
      expect(r1.kind).toBe('active');
      if (r1.kind === 'active') expect(r1.account.id).toBe(a1.id); // priority 1 wins the first (all-tied) pick

      const c2 = await makeContainer();
      const r2 = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c2.id));
      expect(r2.kind).toBe('active');
      if (r2.kind === 'active') expect(r2.account.id).toBe(a2.id); // a1 is full (1/1) — rolls over

      const c3 = await makeContainer();
      const r3 = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c3.id));
      expect(r3.kind).toBe('active');
      if (r3.kind === 'active') expect(r3.account.id).toBe(a3.id); // a1 and a2 both full — rolls over again

      // All 3 accounts are now full — the 4th gets no_slot.
      const c4 = await makeContainer();
      const r4 = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c4.id));
      expect(r4.kind).toBe('no_slot');
    });

    it('with equal usage, breaks ties by priority (deterministic — proves the exact spec wording)', async () => {
      // At maxContainers=4, allocating one container per account each round
      // keeps re-tying all three at equal usage, so priority order (1,2,3)
      // must win every tied round — this is the literal "lowest usage, then
      // priority, then id" rule from the spec, traced across two rounds.
      const [a1, a2, a3] = await makeAccounts(4);
      const picks: string[] = [];
      for (let i = 0; i < 6; i++) {
        const c = await makeContainer();
        const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
        expect(result.kind).toBe('active');
        if (result.kind === 'active') picks.push(result.account.id);
      }
      // Round 1 (all start tied at 0): priority order a1, a2, a3.
      // Round 2 (all tied again at 1 after round 1): priority order again.
      expect(picks).toEqual([a1.id, a2.id, a3.id, a1.id, a2.id, a3.id]);
    });
  });

  describe('full capacity (12 slots) and no_slot', () => {
    it('allocates exactly 12 containers across 3 accounts, the 13th gets no_slot with zero side effects', async () => {
      await makeAccounts(4);

      for (let i = 0; i < 12; i++) {
        const c = await makeContainer();
        const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
        expect(result.kind).toBe('active');
      }

      const thirteenth = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, thirteenth.id));
      expect(result.kind).toBe('no_slot');

      const assignment = await prisma.containerTrackingAssignment.findFirst({
        where: { containerId: thirteenth.id },
      });
      expect(assignment).toBeNull();
    }, 30000);
  });

  describe('DB-level backstop: partial unique index rejects a duplicate active assignment', () => {
    it('rejects a second active assignment row for the same container, even bypassing the allocation service entirely', async () => {
      const account = await makeSingleAccount(4);
      const c = await makeContainer();

      await prisma.containerTrackingAssignment.create({ data: { containerId: c.id, traqoAccountId: account.id } });

      // Bypasses TraqoAccountAllocationService entirely — a raw second
      // INSERT of an active (releasedAt: null) row for the SAME container.
      // The partial unique index must reject this at the DB level,
      // independent of any application-level lock.
      await expect(
        prisma.containerTrackingAssignment.create({ data: { containerId: c.id, traqoAccountId: account.id } }),
      ).rejects.toThrow();

      const activeCount = await prisma.containerTrackingAssignment.count({
        where: { containerId: c.id, releasedAt: null },
      });
      expect(activeCount).toBe(1);
    });
  });

  describe('concurrency: simultaneous allocation cannot exceed maxContainers', () => {
    it('never allocates more than maxContainers even with parallel requests racing the same account', async () => {
      const account = await makeSingleAccount(4);

      // 10 containers racing for 4 slots on the one eligible account.
      const containers = await Promise.all(Array.from({ length: 10 }, () => makeContainer()));

      const results = await Promise.all(
        containers.map((c) => prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id))),
      );

      const succeeded = results.filter((r) => r.kind === 'active');
      const noSlot = results.filter((r) => r.kind === 'no_slot');
      expect(succeeded.length).toBe(4);
      expect(noSlot.length).toBe(6);

      const activeCount = await prisma.containerTrackingAssignment.count({
        where: { traqoAccountId: account.id, releasedAt: null },
      });
      expect(activeCount).toBe(4); // never over-allocated, never negative

      // The partial unique index also guarantees no container got two
      // simultaneous active assignments.
      const allAssignments = await prisma.containerTrackingAssignment.findMany({
        where: { containerId: { in: containers.map((c) => c.id) }, releasedAt: null },
      });
      const byContainer = new Map<string, number>();
      for (const a of allAssignments) {
        byContainer.set(a.containerId, (byContainer.get(a.containerId) ?? 0) + 1);
      }
      for (const count of byContainer.values()) expect(count).toBe(1);
    }, 30000);
  });

  describe('release (releaseAsTraqoRemoved) — preserves history, frees the slot', () => {
    it('never touches ContainerTracking or TrackingEvent rows — release only ever writes the assignment', async () => {
      const account = await makeSingleAccount(4);
      const c = await makeContainer();
      await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));

      const tracking = await prisma.containerTracking.create({
        data: {
          containerId: c.id,
          referenceNumber: c.number,
          sealine: 'MAEU',
          status: 'DELIVERED',
          isActive: false,
          closedAt: new Date(),
          rawResponse: { fake: 'response' },
          events: { create: [{ description: 'Gate out', location: 'Shanghai' }] },
        },
        include: { events: true },
      });

      await prisma.$transaction((tx) => service.releaseAsTraqoRemoved(tx, c.id));

      const trackingAfter = await prisma.containerTracking.findUniqueOrThrow({
        where: { id: tracking.id },
        include: { events: true },
      });
      expect(trackingAfter.status).toBe('DELIVERED');
      expect(trackingAfter.rawResponse).toEqual({ fake: 'response' });
      expect(trackingAfter.events).toHaveLength(1);
      expect(trackingAfter.events[0].description).toBe('Gate out');

      await prisma.trackingEvent.deleteMany({ where: { trackingId: tracking.id } });
      await prisma.containerTracking.delete({ where: { id: tracking.id } });
      expect(account.id).toBeTruthy();
    });

    it('marks releasedAt/releaseReason, keeps the row, and frees the slot for a new container', async () => {
      const account = await makeSingleAccount(1); // maxContainers=1 to make "full" trivial to prove
      const c1 = await makeContainer();

      const first = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c1.id));
      expect(first.kind).toBe('active');

      // Account is now full — a second container gets no_slot.
      const c2 = await makeContainer();
      const blocked = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c2.id));
      expect(blocked.kind).toBe('no_slot');

      // Release c1 as traqo_removed.
      await prisma.$transaction((tx) => service.releaseAsTraqoRemoved(tx, c1.id));

      const released = await prisma.containerTrackingAssignment.findFirst({ where: { containerId: c1.id } });
      expect(released?.releasedAt).not.toBeNull();
      expect(released?.releaseReason).toBe('traqo_removed');
      // History preserved, not deleted.
      expect(released?.traqoAccountId).toBe(account.id);

      // The freed slot is immediately usable by c2.
      const retried = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c2.id));
      expect(retried.kind).toBe('active');
      if (retried.kind === 'active') expect(retried.account.id).toBe(account.id);

      // c1, once released as traqo_removed, must NOT be reallocated on a
      // later refresh — resolveForRefresh reports 'ended'.
      const afterRelease = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c1.id));
      expect(afterRelease.kind).toBe('ended');
    });
  });

  describe('arrival has zero effect on assignment state (the corrected lifecycle)', () => {
    it('keeps the assignment active when Container.status becomes arrived, with no release', async () => {
      await makeSingleAccount(4);
      const c = await makeContainer('port');

      const allocated = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(allocated.kind).toBe('active');
      const originalAssignmentId = allocated.kind === 'active' ? allocated.assignment.id : null;

      // Simulate the arrival transition directly (ContainersService.update()
      // deliberately contains zero tracking-assignment code — this proves
      // the assignment is untouched by a plain status write).
      await prisma.container.update({ where: { id: c.id }, data: { status: 'arrived' } });

      const stillActive = await prisma.containerTrackingAssignment.findFirst({
        where: { containerId: c.id, releasedAt: null },
      });
      expect(stillActive).not.toBeNull();

      // A refresh-equivalent resolve after arrival still returns the SAME
      // active assignment — arrival never triggers reallocation or release.
      const resolvedAfterArrival = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(resolvedAfterArrival.kind).toBe('active');
      if (resolvedAfterArrival.kind === 'active') {
        expect(resolvedAfterArrival.assignment.id).toBe(originalAssignmentId);
      }
    });
  });

  describe('account health: recordFailure / recordSuccess', () => {
    it('unauthorized marks auth_failed and excludes the account from new allocation', async () => {
      const account = await makeSingleAccount(4);
      await service.recordFailure(account.id, 'unauthorized');

      const updated = await prisma.traqoAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(updated.status).toBe('auth_failed');

      const c = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(result.kind).toBe('no_slot');
    });

    it('rate_limited sets a cooldown that excludes the account until it expires', async () => {
      const account = await makeSingleAccount(4);
      await service.recordFailure(account.id, 'rate_limited', 3600); // 1h cooldown

      const updated = await prisma.traqoAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(updated.status).toBe('rate_limited');
      expect(updated.unavailableUntil).not.toBeNull();
      expect(updated.unavailableUntil!.getTime()).toBeGreaterThan(Date.now());

      const c = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(result.kind).toBe('no_slot');
    });

    it('a rate_limited account becomes eligible again once its cooldown has passed', async () => {
      const account = await makeSingleAccount(4);
      await service.recordFailure(account.id, 'rate_limited', -1); // already-expired cooldown

      const c = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(result.kind).toBe('active');
    });

    it('payment_required marks the account unavailable for new allocation', async () => {
      const account = await makeSingleAccount(4);
      await service.recordFailure(account.id, 'payment_required');

      const updated = await prisma.traqoAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(updated.status).toBe('payment_required');

      const c = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(result.kind).toBe('no_slot');
    });

    it('recordSuccess self-heals a failed account back to healthy', async () => {
      const account = await makeSingleAccount(4);
      await service.recordFailure(account.id, 'rate_limited', 3600);
      const failed = await prisma.traqoAccount.findUniqueOrThrow({ where: { id: account.id } });
      await service.recordSuccess(failed);

      const healed = await prisma.traqoAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(healed.status).toBe('healthy');
      expect(healed.unavailableUntil).toBeNull();

      const c = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(result.kind).toBe('active');
      if (result.kind === 'active') expect(result.account.id).toBe(account.id);
    });

    it('an inactive (admin-disabled) account is excluded from allocation', async () => {
      const account = await makeSingleAccount(4);
      await prisma.traqoAccount.update({ where: { id: account.id }, data: { active: false } });

      const c = await makeContainer();
      const result = await prisma.$transaction((tx) => service.resolveForRefresh(tx, c.id));
      expect(result.kind).toBe('no_slot');
    });
  });
});
