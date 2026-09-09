/**
 * Real-Postgres + real-Traqo-API integration test — requires the dev DB
 * running (docker compose up -d) and a real TRAQO_API_KEY (or
 * TRAQO_API_KEY_1) configured, same as `npm run start:dev`. NOT part of
 * `npm test` (that suite is 100% mocked, see jest.config) — run explicitly
 * via `npm run test:integration`.
 *
 * Why this exists: proves the new multi-account plumbing (TraqoKeyResolver
 * -> TraqoAccountAllocationService -> TraqoTrackingProvider) actually works
 * end-to-end against Traqo's real API, not just against mocks. Deliberately
 * makes exactly ONE real Traqo call — enough to prove account resolution +
 * the response shape (including the new is_active/closed_at/traqoShipmentName
 * fields) without spending unnecessary quota.
 *
 * Scope limitation, stated explicitly rather than faked: this environment
 * only has a real key for Account 1 (via the TRAQO_API_KEY fallback —
 * TRAQO_API_KEY_1 was never renamed, per the approved continuity plan).
 * Accounts 2 and 3 have no real key configured here, so they cannot be
 * live-verified by this test — that requires the user to set
 * TRAQO_API_KEY_2 / TRAQO_API_KEY_3 in their real environment. This test
 * does NOT claim to have observed a real Traqo-side shipment closure
 * (is_active: false / closed_at set) — no completed shipment exists in
 * this account yet; that must be verified manually the first time a real
 * container the account tracks actually completes.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TraqoTrackingProvider } from '../src/containers/tracking/traqo-tracking.provider';
import { TraqoKeyResolver } from '../src/containers/tracking/traqo-key-resolver.service';
import { TraqoAccountAllocationService } from '../src/containers/tracking/traqo-account-allocation.service';

const REAL_CONTAINER_NUMBER = 'TCNU7200897';
const REAL_SEALINE = 'MAEU';

describe('Traqo multi-account — real API integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let provider: TraqoTrackingProvider;
  let keyResolver: TraqoKeyResolver;
  let allocation: TraqoAccountAllocationService;

  const testContainerId = '00000000-0000-4000-9100-000000000001';
  const testSupplierId = '00000000-0000-4000-9100-000000000002';
  const testUserId = '00000000-0000-4000-9100-000000000003';
  let accountId: string | null = null;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [TraqoTrackingProvider, TraqoKeyResolver, TraqoAccountAllocationService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    provider = moduleRef.get(TraqoTrackingProvider);
    keyResolver = moduleRef.get(TraqoKeyResolver);
    allocation = moduleRef.get(TraqoAccountAllocationService);

    await prisma.user.upsert({
      where: { id: testUserId },
      update: {},
      create: { id: testUserId, clerkId: 'test_traqo_real_owner', email: 'traqo-real-test@charcoal.test', name: 'Traqo Real Test', role: 'owner' },
    });
    await prisma.supplier.upsert({
      where: { id: testSupplierId },
      update: {},
      create: { id: testSupplierId, name: 'Traqo Real Test Supplier', country: 'Test' },
    });
    await prisma.container.upsert({
      where: { id: testContainerId },
      update: {},
      create: {
        id: testContainerId,
        number: `REAL${Date.now()}`.slice(0, 11),
        supplierId: testSupplierId,
        createdById: testUserId,
        sealine: REAL_SEALINE,
      },
    });
  });

  afterAll(async () => {
    await prisma.containerTrackingAssignment.deleteMany({ where: { containerId: testContainerId } });
    await prisma.container.deleteMany({ where: { id: testContainerId } });
    await prisma.supplier.deleteMany({ where: { id: testSupplierId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await moduleRef.close();
  });

  it('Account 1 resolves a real key via TraqoKeyResolver (through the legacy TRAQO_API_KEY fallback)', () => {
    const key = keyResolver.resolve('TRAQO_API_KEY_1');
    if (!key) {
      // eslint-disable-next-line no-console
      console.warn('SKIPPED: no TRAQO_API_KEY / TRAQO_API_KEY_1 configured in this environment.');
      return;
    }
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('allocates the test container to a real account, then makes exactly ONE real Traqo call through the full stack', async () => {
    const key = keyResolver.resolve('TRAQO_API_KEY_1');
    if (!key) {
      // eslint-disable-next-line no-console
      console.warn('SKIPPED: no real Traqo key configured — cannot make a live call.');
      return;
    }

    const resolved = await prisma.$transaction((tx) => allocation.resolveForRefresh(tx, testContainerId));
    expect(resolved.kind).toBe('active');
    if (resolved.kind !== 'active') return;
    accountId = resolved.account.id;

    const apiKey = keyResolver.resolve(resolved.account.envKeyName);
    expect(apiKey).toBeTruthy();

    // The one real, read-only Traqo API call this test makes.
    const normalized = await provider.trackContainer(REAL_CONTAINER_NUMBER, REAL_SEALINE, {
      apiKey: apiKey!,
      baseUrl: resolved.account.baseUrl ?? undefined,
    });

    expect(normalized.referenceNumber).toBe(REAL_CONTAINER_NUMBER);
    // The confirmed lifecycle fields (live-verified 2026-08-26) are present
    // on the response — whatever their current value is. Not asserting a
    // specific value here since the real shipment's state can change.
    expect(['boolean', 'object']).toContain(typeof normalized.isActive); // boolean or null (typeof null === 'object')
    expect(normalized.closedAt === null || normalized.closedAt instanceof Date).toBe(true);
    if (normalized.isActive === false || normalized.closedAt !== null) {
      // eslint-disable-next-line no-console
      console.warn(
        'NOTE: this real shipment now reports Traqo-side removal (is_active=false or closed_at set). ' +
          'This is the first real end-to-end observation of that signal — worth a manual sanity check.',
      );
    }
  }, 30000);

  it('persistence: the same container resolves to the same account on a second (non-network) check', async () => {
    if (!accountId) {
      // eslint-disable-next-line no-console
      console.warn('SKIPPED: previous test did not allocate an account (no key configured).');
      return;
    }
    const resolvedAgain = await prisma.$transaction((tx) => allocation.resolveForRefresh(tx, testContainerId));
    expect(resolvedAgain.kind).toBe('active');
    if (resolvedAgain.kind === 'active') expect(resolvedAgain.account.id).toBe(accountId);
  });
});
