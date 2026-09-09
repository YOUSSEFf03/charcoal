/**
 * Real-Postgres integration test — requires the dev DB running (docker
 * compose up -d) and DATABASE_URL configured. Run via `npm run test:integration`.
 *
 * Proves Phase B's ETA-change detection/persistence against real Postgres
 * rows, not mocked Prisma — specifically the properties that only a real
 * database can prove: values genuinely surviving a round trip, a second
 * refresh reading the FIRST refresh's actually-committed row (not a mock's
 * return value), and state surviving a fresh service/module instance
 * standing in for "the process restarted."
 *
 * Follows the same safety discipline as
 * container-tracking-scheduler.integration-spec.ts: every test operates
 * only on containers this file creates itself (tagged, cleaned up in
 * afterAll) and calls ContainerTrackingService.attemptRefresh() directly for
 * a specific container id — never ContainerTrackingScheduler.runOnce()'s
 * global assignment query, which would also touch this shared dev
 * database's pre-existing real active assignments.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContainersModule } from '../src/containers/containers.module';
import { ContainerTrackingService } from '../src/containers/tracking/container-tracking.service';
import {
  ContainerTrackingProvider,
  TRACKING_PROVIDER,
  NormalizedTracking,
} from '../src/containers/tracking/container-tracking.provider';
import { PUSH_PROVIDER, PushProvider } from '../src/notifications/push.provider';

/** Phase C: ContainersModule now transitively needs NotificationsModule (ConfigService for ExpoPushProvider) — see the same note in container-tracking-scheduler.integration-spec.ts. */
function fakePushProvider(): jest.Mocked<PushProvider> {
  return { send: (jest.fn() as any).mockResolvedValue([]) } as unknown as jest.Mocked<PushProvider>;
}

const TAG = `ETA_TEST_${Date.now()}`;
const CLERK_ID = 'user_test_owner';

function normalized(overrides: Partial<NormalizedTracking> = {}): NormalizedTracking {
  return {
    provider: 'traqo',
    referenceNumber: 'TESTNUM',
    sealine: 'MAEU',
    sealineName: 'Maersk',
    status: 'IN_TRANSIT',
    origin: 'Shanghai, CN',
    destination: 'Beirut, LB',
    vessel: 'TEST VESSEL',
    voyage: '001W',
    currentLocation: 'At sea',
    eta: null,
    isDelayed: false,
    shipmentUid: null,
    shipmentPublicUrl: null,
    traqoShipmentName: null,
    isActive: true,
    closedAt: null,
    providerUpdatedAt: null,
    events: [],
    raw: { test: true },
    ...overrides,
  };
}

describe('Phase B — ETA-change detection/persistence (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let trackingService: ContainerTrackingService;
  let fakeProvider: jest.Mocked<ContainerTrackingProvider>;

  let ownerId: string;
  let supplierId: string;
  let accountId: string;
  const createdContainerIds: string[] = [];

  async function createTrackedContainer(number: string) {
    const container = await prisma.container.create({
      data: { number, supplierId, sealine: 'MAEU', createdById: ownerId },
    });
    createdContainerIds.push(container.id);
    await prisma.containerTrackingAssignment.create({
      data: { containerId: container.id, traqoAccountId: accountId },
    });
    return container.id;
  }

  /** Forces the 15-minute throttle open again so the next attemptRefresh() call actually reaches the provider. */
  async function clearThrottle(containerId: string) {
    await prisma.containerTracking.update({
      where: { containerId },
      data: { lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
  }

  beforeAll(async () => {
    fakeProvider = { trackContainer: jest.fn(), listCarriers: jest.fn() } as unknown as jest.Mocked<ContainerTrackingProvider>;

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule],
    })
      .overrideProvider(TRACKING_PROVIDER)
      .useValue(fakeProvider)
      .overrideProvider(PUSH_PROVIDER)
      .useValue(fakePushProvider())
      .compile();

    prisma = moduleRef.get(PrismaService);
    trackingService = moduleRef.get(ContainerTrackingService);

    await prisma.user.upsert({
      where: { clerkId: CLERK_ID },
      update: {},
      create: { clerkId: CLERK_ID, email: 'owner@charcoal.com', name: 'Test Owner', role: 'owner' },
    });
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { clerkId: CLERK_ID } })).id;

    const supplier = await prisma.supplier.create({ data: { name: `${TAG} Supplier`, country: 'CN' } });
    supplierId = supplier.id;

    const account = await prisma.traqoAccount.create({
      data: { name: `${TAG} Account`, envKeyName: `${TAG}_UNUSED_KEY`, priority: 1 },
    });
    accountId = account.id;
  });

  // fakeProvider is shared (deliberately — it's bound once via
  // overrideProvider at module-compile time) across every test in this
  // file. Without resetting it between tests, a queued mockResolvedValueOnce
  // left over from one test (e.g. a call that never happened because a
  // throttle correctly short-circuited it) would be consumed by the WRONG
  // test's first call, silently corrupting that test's expected sequence.
  beforeEach(() => {
    fakeProvider.trackContainer.mockReset();
  });

  afterAll(async () => {
    await prisma.trackingEvent.deleteMany({ where: { tracking: { containerId: { in: createdContainerIds } } } });
    await prisma.containerTracking.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.containerTrackingAssignment.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.container.deleteMany({ where: { id: { in: createdContainerIds } } });
    await prisma.traqoAccount.delete({ where: { id: accountId } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await moduleRef.close();
  });

  it('first refresh (initial population): eta persists, previousEta is null, etaChangedAt is null — not a "change"', async () => {
    const containerId = await createTrackedContainer(`${TAG}-1`);
    const d1 = new Date('2026-09-15T00:00:00.000Z');
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-1`, eta: d1 }));

    const result = await trackingService.attemptRefresh(containerId);
    expect(result.outcome).toBe('success');

    const row = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(row.eta?.toISOString()).toBe(d1.toISOString());
    expect(row.previousEta).toBeNull();
    expect(row.etaChangedAt).toBeNull();
  });

  it('BREAK/PROVE — idempotency (task spec example): refresh1 (Sep15→Sep17) detects a change; refresh2 (Sep17→Sep17) does NOT produce another change; refresh3 (Sep17→Sep19) detects a NEW change; all read from the DB, not memory', async () => {
    const containerId = await createTrackedContainer(`${TAG}-2`);
    const sep15 = new Date('2026-09-15T00:00:00.000Z');
    const sep17 = new Date('2026-09-17T00:00:00.000Z');
    const sep19 = new Date('2026-09-19T00:00:00.000Z');

    // Baseline refresh — a brand-new container's very first refresh is
    // ALWAYS classified 'initial' (rule A), even though it resolves a real
    // ETA: there is no existing row yet, so there is nothing to have
    // "changed" from. etaChangedAt correctly stays null here — this
    // establishes the "old ETA = Sept 15" the task's example starts from,
    // it is not itself one of the three refreshes being tested.
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-2`, eta: sep15 }));
    await trackingService.attemptRefresh(containerId);
    const afterBaseline = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(afterBaseline.eta?.toISOString()).toBe(sep15.toISOString());
    expect(afterBaseline.etaChangedAt).toBeNull();

    // Refresh 1 (task spec numbering): Sep15 -> Sep17 — a real change.
    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-2`, eta: sep17 }));
    await trackingService.attemptRefresh(containerId);
    const afterRefresh1 = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(afterRefresh1.eta?.toISOString()).toBe(sep17.toISOString());
    expect(afterRefresh1.previousEta?.toISOString()).toBe(sep15.toISOString());
    expect(afterRefresh1.etaChangedAt).not.toBeNull();
    const changedAtAfterRefresh1 = afterRefresh1.etaChangedAt!.getTime();

    // Refresh 2: Sep17 -> Sep17 (same value — must NOT bump etaChangedAt again).
    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-2`, eta: sep17 }));
    await trackingService.attemptRefresh(containerId);
    const afterRefresh2 = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(afterRefresh2.eta?.toISOString()).toBe(sep17.toISOString());
    expect(afterRefresh2.etaChangedAt!.getTime()).toBe(changedAtAfterRefresh1); // unchanged — proves no duplicate change

    // Refresh 3: Sep17 -> Sep19 (a genuinely new ETA — must detect a fresh change).
    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-2`, eta: sep19 }));
    await trackingService.attemptRefresh(containerId);
    const afterRefresh3 = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(afterRefresh3.eta?.toISOString()).toBe(sep19.toISOString());
    expect(afterRefresh3.previousEta?.toISOString()).toBe(sep17.toISOString());
    expect(afterRefresh3.etaChangedAt!.getTime()).toBeGreaterThan(changedAtAfterRefresh1);
  });

  it('a revert (D2 -> D1) after a prior change is detected as another fresh change, not suppressed by earlier history', async () => {
    const containerId = await createTrackedContainer(`${TAG}-3`);
    const d1 = new Date('2026-09-15T00:00:00.000Z');
    const d2 = new Date('2026-09-19T00:00:00.000Z');

    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-3`, eta: d1 }));
    await trackingService.attemptRefresh(containerId);

    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-3`, eta: d2 }));
    await trackingService.attemptRefresh(containerId);
    const afterD2 = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    const changedAtAfterD2 = afterD2.etaChangedAt!.getTime();

    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-3`, eta: d1 }));
    await trackingService.attemptRefresh(containerId);
    const afterRevert = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });

    expect(afterRevert.eta?.toISOString()).toBe(d1.toISOString());
    expect(afterRevert.previousEta?.toISOString()).toBe(d2.toISOString());
    expect(afterRevert.etaChangedAt!.getTime()).toBeGreaterThan(changedAtAfterD2);
  });

  it('E) ETA becoming unavailable (D1 -> null): eta persists as null, previousEta preserves D1, etaChangedAt is NOT bumped', async () => {
    const containerId = await createTrackedContainer(`${TAG}-4`);
    const d0 = new Date('2026-09-10T00:00:00.000Z');
    const d1 = new Date('2026-09-15T00:00:00.000Z');

    // Baseline: the container's first-ever refresh (always 'initial' — see
    // the idempotency test above for why). Establishes a row to change FROM.
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-4`, eta: d0 }));
    await trackingService.attemptRefresh(containerId);

    // A real, known-to-known change — this is the non-null etaChangedAt
    // baseline we'll prove the next (unavailable) refresh does NOT disturb.
    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-4`, eta: d1 }));
    await trackingService.attemptRefresh(containerId);
    const afterKnown = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(afterKnown.etaChangedAt).not.toBeNull();
    const changedAtWhenKnown = afterKnown.etaChangedAt!.getTime();

    await clearThrottle(containerId);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-4`, eta: null }));
    await trackingService.attemptRefresh(containerId);
    const afterUnavailable = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });

    expect(afterUnavailable.eta).toBeNull();
    expect(afterUnavailable.previousEta?.toISOString()).toBe(d1.toISOString());
    expect(afterUnavailable.etaChangedAt!.getTime()).toBe(changedAtWhenKnown); // untouched — not treated as an ordinary change
  });

  it('BREAK/PROVE — a failed refresh corrupts nothing: eta/previousEta/etaChangedAt are byte-for-byte unchanged after a provider failure', async () => {
    const containerId = await createTrackedContainer(`${TAG}-5`);
    const d1 = new Date('2026-09-15T00:00:00.000Z');

    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-5`, eta: d1 }));
    await trackingService.attemptRefresh(containerId);
    const before = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });

    await clearThrottle(containerId);
    const { TrackingProviderError } = await import('../src/containers/tracking/container-tracking.provider');
    fakeProvider.trackContainer.mockRejectedValueOnce(new TrackingProviderError('not_found', 'x'));
    const failResult = await trackingService.attemptRefresh(containerId);
    expect(failResult.outcome).toBe('provider_error');

    const after = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(after.eta?.toISOString()).toBe(before.eta?.toISOString());
    expect(after.previousEta).toEqual(before.previousEta);
    expect(after.etaChangedAt?.getTime()).toBe(before.etaChangedAt?.getTime());
  });

  it('BREAK/PROVE — a throttled refresh (attempted immediately after a successful one) touches nothing', async () => {
    const containerId = await createTrackedContainer(`${TAG}-6`);
    const d1 = new Date('2026-09-15T00:00:00.000Z');

    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-6`, eta: d1 }));
    await trackingService.attemptRefresh(containerId);
    const before = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });

    // No clearThrottle() this time — lastFetchedAt is seconds old, well inside the 15-minute window.
    const result = await trackingService.attemptRefresh(containerId);
    expect(result.outcome).toBe('throttled');
    expect(fakeProvider.trackContainer).toHaveBeenCalledTimes(1); // never called a second time

    const after = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(after).toEqual(before);
  });

  it('PROVE — server-restart safety: a brand-new service/module instance still reads the real previous ETA from Postgres and detects the change correctly', async () => {
    const containerId = await createTrackedContainer(`${TAG}-7`);
    const d1 = new Date('2026-09-15T00:00:00.000Z');
    const d2 = new Date('2026-09-17T00:00:00.000Z');

    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-7`, eta: d1 }));
    await trackingService.attemptRefresh(containerId);
    await clearThrottle(containerId);

    // A fresh TestingModule/service instance stands in for "the backend
    // process restarted" — it shares nothing with `trackingService` above
    // except the database.
    const restartedProvider = { trackContainer: jest.fn(), listCarriers: jest.fn() } as unknown as jest.Mocked<ContainerTrackingProvider>;
    const restartedModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule],
    })
      .overrideProvider(TRACKING_PROVIDER)
      .useValue(restartedProvider)
      .overrideProvider(PUSH_PROVIDER)
      .useValue(fakePushProvider())
      .compile();
    const restartedService = restartedModule.get(ContainerTrackingService);

    restartedProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-7`, eta: d2 }));
    const result = await restartedService.attemptRefresh(containerId);
    expect(result.outcome).toBe('success');

    const after = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
    expect(after.eta?.toISOString()).toBe(d2.toISOString());
    expect(after.previousEta?.toISOString()).toBe(d1.toISOString()); // correctly read D1 from Postgres, not from any in-memory value
    expect(after.etaChangedAt).not.toBeNull();

    await restartedModule.close();
  });
});
