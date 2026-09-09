/**
 * Real-Postgres integration test — requires the dev DB running (docker
 * compose up -d) and DATABASE_URL configured. Run via `npm run test:integration`.
 *
 * Scope note: this deliberately does NOT call
 * ContainerTrackingScheduler.runOnce() against this shared dev database.
 * runOnce() queries EVERY active ContainerTrackingAssignment row globally
 * (by design — see the scheduler's own doc comment), and this dev DB already
 * has real, pre-existing active assignments from prior manual work. Since
 * this test overrides TRACKING_PROVIDER with a fake, running the full batch
 * here would fake-refresh those real containers and overwrite their genuine
 * ContainerTracking rows — exactly the kind of unrelated-data damage this
 * phase's instructions require protecting against. The scheduler's own
 * selection/iteration/failure-isolation control flow (which containers it
 * picks, that one failure doesn't stop the rest, the reentrancy guard) is
 * instead proven with mocked Prisma in container-tracking.scheduler.spec.ts,
 * where it can be asserted deterministically with no risk to real data.
 *
 * What THIS test proves against real Postgres: that
 * ContainerTrackingService.attemptRefresh() — the exact method the scheduler
 * calls once per container — correctly resolves a real Traqo account
 * assignment, persists a real transaction (upsert + event replacement), and
 * isolates one container's provider failure from another's success, all
 * against real rows this test creates and cleans up itself. Only the
 * network-calling boundary (TRACKING_PROVIDER) is swapped for a test double;
 * everything else (PrismaService, TraqoAccountAllocationService,
 * TraqoKeyResolver, the real ContainersModule wiring) is real.
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
  TrackingProviderError,
  NormalizedTracking,
} from '../src/containers/tracking/container-tracking.provider';
import { PUSH_PROVIDER, PushProvider } from '../src/notifications/push.provider';

const TAG = `SCHED_TEST_${Date.now()}`;
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
    eta: new Date('2026-10-01T00:00:00.000Z'),
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

describe('ContainerTrackingService.attemptRefresh — scheduler-equivalent flow (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let trackingService: ContainerTrackingService;
  let fakeProvider: jest.Mocked<ContainerTrackingProvider>;

  let ownerId: string;
  let supplierId: string;
  let accountId: string;
  const createdContainerIds: string[] = [];

  async function createTrackedContainer(number: string, sealine = 'MAEU') {
    const container = await prisma.container.create({
      data: { number, supplierId, sealine, createdById: ownerId },
    });
    createdContainerIds.push(container.id);
    await prisma.containerTrackingAssignment.create({
      data: { containerId: container.id, traqoAccountId: accountId },
    });
    return container.id;
  }

  beforeAll(async () => {
    fakeProvider = { trackContainer: jest.fn(), listCarriers: jest.fn() } as unknown as jest.Mocked<ContainerTrackingProvider>;
    // Phase C: ContainersModule now transitively depends on NotificationsModule
    // (ContainerTrackingService.attemptRefresh() calls
    // ContainerNotificationService on its success path). ConfigModule is
    // required for ExpoPushProvider's DI; PUSH_PROVIDER is faked so this
    // file never makes a real outbound network call regardless of whether
    // any device happens to be registered in the shared dev DB.
    const fakePush = { send: (jest.fn() as any).mockResolvedValue([]) } as unknown as jest.Mocked<PushProvider>;

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule],
    })
      .overrideProvider(TRACKING_PROVIDER)
      .useValue(fakeProvider)
      .overrideProvider(PUSH_PROVIDER)
      .useValue(fakePush)
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

    // A dedicated, inactive-by-default-irrelevant test account — its
    // envKeyName never resolves to a real key (TraqoKeyResolver.resolve()
    // simply returns undefined for an unset env var), which is fine: the
    // fake provider never inspects the apiKey it's given.
    const account = await prisma.traqoAccount.create({
      data: { name: `${TAG} Account`, envKeyName: `${TAG}_UNUSED_KEY`, priority: 1 },
    });
    accountId = account.id;
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

  it('persists a real tracking snapshot end-to-end, and the ContainerTrackingAssignment stays active', async () => {
    const containerId = await createTrackedContainer(`${TAG}-1`);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-1` }));

    const result = await trackingService.attemptRefresh(containerId);

    expect(result.outcome).toBe('success');
    expect(fakeProvider.trackContainer).toHaveBeenCalledWith(`${TAG}-1`, 'MAEU', expect.objectContaining({ apiKey: '' }));

    const stored = await prisma.containerTracking.findUnique({ where: { containerId }, include: { events: true } });
    expect(stored).not.toBeNull();
    expect(stored?.referenceNumber).toBe(`${TAG}-1`);
    expect(stored?.eta?.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    const assignment = await prisma.containerTrackingAssignment.findFirst({ where: { containerId } });
    expect(assignment?.releasedAt).toBeNull();
  });

  it('server-restart safety: a second attemptRefresh call reads the previous ETA from Postgres, not memory, and honors the 15-minute throttle', async () => {
    const containerId = await createTrackedContainer(`${TAG}-2`);
    fakeProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-2` }));
    await trackingService.attemptRefresh(containerId);

    // A brand-new module instance stands in for "the process restarted" —
    // nothing about the throttle decision below can come from an in-memory
    // value carried over from the call above, because this is a different
    // service instance with no shared state except the database.
    const restartedModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule],
    })
      .overrideProvider(TRACKING_PROVIDER)
      .useValue(fakeProvider)
      .overrideProvider(PUSH_PROVIDER)
      .useValue({ send: (jest.fn() as any).mockResolvedValue([]) } as unknown as jest.Mocked<PushProvider>)
      .compile();
    const restartedService = restartedModule.get(ContainerTrackingService);

    const result = await restartedService.attemptRefresh(containerId);
    expect(result.outcome).toBe('throttled');
    if (result.outcome === 'throttled') {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
    await restartedModule.close();
  });

  it('one container failing (provider_error) leaves another container unaffected — failure isolation at the persistence layer', async () => {
    const failingId = await createTrackedContainer(`${TAG}-3-fail`);
    const okId = await createTrackedContainer(`${TAG}-3-ok`);

    fakeProvider.trackContainer.mockImplementation(async (number: string) => {
      if (number === `${TAG}-3-fail`) {
        throw new TrackingProviderError('not_found', 'no such container');
      }
      return normalized({ referenceNumber: number });
    });

    const failResult = await trackingService.attemptRefresh(failingId);
    const okResult = await trackingService.attemptRefresh(okId);

    expect(failResult.outcome).toBe('provider_error');
    expect(okResult.outcome).toBe('success');

    const failingTracking = await prisma.containerTracking.findUnique({ where: { containerId: failingId } });
    expect(failingTracking).toBeNull(); // never persisted — a failed first-ever refresh writes nothing

    const okTracking = await prisma.containerTracking.findUnique({ where: { containerId: okId } });
    expect(okTracking?.referenceNumber).toBe(`${TAG}-3-ok`);
  });
});
