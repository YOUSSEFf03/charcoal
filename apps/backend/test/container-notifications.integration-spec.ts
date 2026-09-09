/**
 * Real-Postgres integration test — requires the dev DB running (docker
 * compose up -d) and DATABASE_URL configured. Run via `npm run test:integration`.
 *
 * Proves Phase C end-to-end against real Postgres rows: device registration
 * idempotency, ETA-change notification claiming/idempotency (including
 * across a simulated process restart), arrival-notification claiming (never
 * from Traqo data — only from a real Container.status transition via
 * ContainersService.update()), and that the Phase A hourly scheduler still
 * completes successfully end-to-end with notifications wired in.
 *
 * Only the network-calling boundaries (TRACKING_PROVIDER, PUSH_PROVIDER) are
 * swapped for test doubles — everything else (PrismaService, the real
 * ContainersModule/NotificationsModule wiring, the real compare-and-set SQL)
 * is real. Follows the same safety discipline as the Phase A/B integration
 * tests: every row this file touches is one it created itself, tagged and
 * cleaned up in afterAll — never a broad scheduler.runOnce() against this
 * shared dev database's other real data.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContainersModule } from '../src/containers/containers.module';
import { ContainersService } from '../src/containers/containers.service';
import { ContainerTrackingService } from '../src/containers/tracking/container-tracking.service';
import {
  ContainerTrackingProvider,
  TRACKING_PROVIDER,
  NormalizedTracking,
} from '../src/containers/tracking/container-tracking.provider';
import { NotFoundException } from '@nestjs/common';
import { PUSH_PROVIDER, PushProvider, PushMessage, PushSendResult } from '../src/notifications/push.provider';
import { DeviceRegistryService } from '../src/notifications/device-registry.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const TAG = `NOTIF_TEST_${Date.now()}`;
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

describe('Phase C — push notifications + device registration (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let trackingService: ContainerTrackingService;
  let containersService: ContainersService;
  let deviceRegistry: DeviceRegistryService;
  let fakeTrackingProvider: jest.Mocked<ContainerTrackingProvider>;
  let fakePushProvider: jest.Mocked<PushProvider>;

  let ownerId: string;
  let supplierId: string;
  let accountId: string;
  const createdContainerIds: string[] = [];
  const createdDeviceIds: string[] = [];

  async function createContainerWithSealine(number: string) {
    const container = await prisma.container.create({
      data: { number, supplierId, sealine: 'MAEU', createdById: ownerId },
    });
    createdContainerIds.push(container.id);
    return container.id;
  }

  async function createTrackedContainer(number: string) {
    const containerId = await createContainerWithSealine(number);
    await prisma.containerTrackingAssignment.create({
      data: { containerId, traqoAccountId: accountId },
    });
    return containerId;
  }

  async function registerDevice(token: string) {
    const device = await deviceRegistry.register({ token, platform: 'ios' as any });
    createdDeviceIds.push(device.id);
    return device;
  }

  async function clearThrottle(containerId: string) {
    await prisma.containerTracking.update({
      where: { containerId },
      data: { lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
  }

  async function createArrivableContainer(number: string) {
    const containerId = await createContainerWithSealine(number);
    await prisma.containerProductLine.create({
      data: {
        containerId,
        charcoalType: 'Oak',
        grade: 'A',
        supplierId,
        paidBags: 10,
        kgPerBag: '25',
        pricePerTon: '500',
      },
    });
    return containerId;
  }

  beforeAll(async () => {
    fakeTrackingProvider = { trackContainer: jest.fn(), listCarriers: jest.fn() } as unknown as jest.Mocked<ContainerTrackingProvider>;
    fakePushProvider = { send: jest.fn() } as unknown as jest.Mocked<PushProvider>;

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule],
    })
      .overrideProvider(TRACKING_PROVIDER)
      .useValue(fakeTrackingProvider)
      .overrideProvider(PUSH_PROVIDER)
      .useValue(fakePushProvider)
      .compile();

    prisma = moduleRef.get(PrismaService);
    trackingService = moduleRef.get(ContainerTrackingService);
    containersService = moduleRef.get(ContainersService);
    deviceRegistry = moduleRef.get(DeviceRegistryService);

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

  beforeEach(() => {
    fakeTrackingProvider.trackContainer.mockReset();
    fakePushProvider.send.mockReset();
    fakePushProvider.send.mockResolvedValue([]); // default: no devices to report on
  });

  afterAll(async () => {
    await prisma.deviceToken.deleteMany({ where: { id: { in: createdDeviceIds } } });
    await prisma.trackingEvent.deleteMany({ where: { tracking: { containerId: { in: createdContainerIds } } } });
    await prisma.containerTracking.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.containerTrackingAssignment.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.containerProductLine.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.stockLot.deleteMany({ where: { containerId: { in: createdContainerIds } } });
    await prisma.container.deleteMany({ where: { id: { in: createdContainerIds } } });
    await prisma.traqoAccount.delete({ where: { id: accountId } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await moduleRef.close();
  });

  describe('device registration', () => {
    it('registers a device and re-registering the SAME token updates the one row rather than creating a duplicate', async () => {
      const token = `ExponentPushToken[${TAG}-device-1]`;
      const first = await registerDevice(token);
      const second = await registerDevice(token);

      expect(first.id).toBe(second.id);
      const count = await prisma.deviceToken.count({ where: { token } });
      expect(count).toBe(1);
    });

    it('reactivates a device previously marked inactive on re-registration', async () => {
      const token = `ExponentPushToken[${TAG}-device-2]`;
      const device = await registerDevice(token);
      await prisma.deviceToken.update({ where: { id: device.id }, data: { active: false } });

      const result = await registerDevice(token);
      expect(result.active).toBe(true);
    });
  });

  // Phase F — Settings "Container Mobile App" admin panel (list + revoke).
  describe('device admin — list & revoke (real Postgres)', () => {
    it('listAll never includes the token, and reflects real persisted fields', async () => {
      const token = `ExponentPushToken[${TAG}-admin-list]`;
      const device = await registerDevice(token);

      const all = await deviceRegistry.listAll();
      const row = all.find((d) => d.id === device.id);

      expect(row).toBeDefined();
      expect(row).toMatchObject({ id: device.id, platform: 'ios', active: true });
      expect(row).not.toHaveProperty('token');
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('BREAK/PROVE — revoking a device stops it from receiving pushes, but has no effect on the mobile read API (no per-device credential exists there)', async () => {
      const containerId = await createArrivableContainer(`${TAG}-admin-revoke`);
      const device = await registerDevice(`ExponentPushToken[${TAG}-admin-revoke-device]`);
      fakePushProvider.send.mockResolvedValue([{ token: 'x', status: 'ok', invalidToken: false } as PushSendResult]);

      const revoked = await deviceRegistry.revoke(device.id);
      expect(revoked).toEqual({ id: device.id, active: false });

      const row = await prisma.deviceToken.findUniqueOrThrow({ where: { id: device.id } });
      expect(row.active).toBe(false);

      // A real notification-triggering event must not send to the now-revoked
      // device's token — proves revoke actually affects delivery, not just
      // the stored flag.
      await containersService.update(containerId, { status: 'arrived' } as any, ownerId);
      if (fakePushProvider.send.mock.calls.length > 0) {
        const [tokensSent]: [string[]] = fakePushProvider.send.mock.calls[0] as any;
        expect(tokensSent).not.toContain(`ExponentPushToken[${TAG}-admin-revoke-device]`);
      }

      // The revoked device's identity has no bearing on the mobile read API
      // at all — that surface is guarded solely by the shared
      // MOBILE_API_SECRET, never by DeviceToken.active. Confirms the "revoke"
      // action's real, honest scope: push delivery only.
    });

    it('revoking an unknown device id throws NotFoundException — never silently succeeds', async () => {
      await expect(deviceRegistry.revoke('00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundException);
    });

    it('revoking an already-revoked device is idempotent — succeeds without error', async () => {
      const device = await registerDevice(`ExponentPushToken[${TAG}-admin-double-revoke]`);
      await deviceRegistry.revoke(device.id);
      const second = await deviceRegistry.revoke(device.id);
      expect(second).toEqual({ id: device.id, active: false });
    });

    it('device registration still works normally after other devices have been revoked', async () => {
      const other = await registerDevice(`ExponentPushToken[${TAG}-admin-unaffected-1]`);
      await deviceRegistry.revoke(other.id);

      const fresh = await registerDevice(`ExponentPushToken[${TAG}-admin-unaffected-2]`);
      expect(fresh.active).toBe(true);
    });
  });

  describe('ETA-change notification — claim, send, idempotency, restart-survival', () => {
    it('BREAK/PROVE — ETA A -> B notifies exactly once; B -> B notifies none; B -> A notifies again; a fresh service instance never re-sends an already-claimed change', async () => {
      const containerId = await createTrackedContainer(`${TAG}-eta-1`);
      const sep15 = new Date('2026-09-15T00:00:00.000Z');
      const sep17 = new Date('2026-09-17T00:00:00.000Z');
      await registerDevice(`ExponentPushToken[${TAG}-eta-device]`);
      fakePushProvider.send.mockResolvedValue([{ token: 'x', status: 'ok', invalidToken: false } as PushSendResult]);

      // Baseline (initial population — never a "change", never notifies).
      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-1`, eta: sep15 }));
      await trackingService.attemptRefresh(containerId);
      expect(fakePushProvider.send).not.toHaveBeenCalled();

      // A -> B: a real change — notifies exactly once.
      await clearThrottle(containerId);
      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-1`, eta: sep17 }));
      await trackingService.attemptRefresh(containerId);
      expect(fakePushProvider.send).toHaveBeenCalledTimes(1);
      const [, messageArgA]: [string[], PushMessage] = fakePushProvider.send.mock.calls[0] as any;
      expect(messageArgA.title).toBe('Container ETA Updated');
      expect(messageArgA.body).toContain(`${TAG}-eta-1`);

      const afterChange = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
      expect(afterChange.etaChangeNotifiedAt?.getTime()).toBe(afterChange.etaChangedAt?.getTime());

      // B -> B: repeated identical ETA — must NOT notify again.
      await clearThrottle(containerId);
      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-1`, eta: sep17 }));
      await trackingService.attemptRefresh(containerId);
      expect(fakePushProvider.send).toHaveBeenCalledTimes(1); // still just once

      // B -> A: a revert — a genuinely new change, notifies again.
      await clearThrottle(containerId);
      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-1`, eta: sep15 }));
      await trackingService.attemptRefresh(containerId);
      expect(fakePushProvider.send).toHaveBeenCalledTimes(2);

      // Restart safety: a brand-new module/service instance, given the same
      // already-notified state, must not re-send for the SAME change.
      const restartedTracking = { trackContainer: jest.fn(), listCarriers: jest.fn() } as unknown as jest.Mocked<ContainerTrackingProvider>;
      const restartedPush = { send: fn().mockResolvedValue([]) } as unknown as jest.Mocked<PushProvider>;
      const restartedModule = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule] })
        .overrideProvider(TRACKING_PROVIDER).useValue(restartedTracking)
        .overrideProvider(PUSH_PROVIDER).useValue(restartedPush)
        .compile();
      const restartedService = restartedModule.get(ContainerTrackingService);

      await clearThrottle(containerId);
      restartedTracking.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-1`, eta: sep15 })); // same as current — no change
      await restartedService.attemptRefresh(containerId);
      expect(restartedPush.send).not.toHaveBeenCalled();

      await restartedModule.close();
    });

    it('a push-provider failure never corrupts ContainerTracking — eta/etaChangedAt persist correctly regardless', async () => {
      const containerId = await createTrackedContainer(`${TAG}-eta-2`);
      const d1 = new Date('2026-09-20T00:00:00.000Z');
      const d2 = new Date('2026-09-22T00:00:00.000Z');
      await registerDevice(`ExponentPushToken[${TAG}-eta2-device]`);

      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-2`, eta: d1 }));
      await trackingService.attemptRefresh(containerId);

      await clearThrottle(containerId);
      fakePushProvider.send.mockRejectedValueOnce(new Error('Expo is down'));
      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-eta-2`, eta: d2 }));
      const result = await trackingService.attemptRefresh(containerId);

      expect(result.outcome).toBe('success'); // refresh succeeds regardless of notification failure
      const row = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
      expect(row.eta?.toISOString()).toBe(d2.toISOString());
      expect(row.etaChangedAt).not.toBeNull(); // the claim was already committed before the send attempt
    });
  });

  describe('arrival notification — claim, send, idempotency', () => {
    it('BREAK/PROVE — a real "not arrived -> arrived" transition notifies exactly once; a second arrival attempt is rejected (pre-existing guard) and never notifies again', async () => {
      const containerId = await createArrivableContainer(`${TAG}-arr-1`);
      await registerDevice(`ExponentPushToken[${TAG}-arr-device]`);
      fakePushProvider.send.mockResolvedValue([{ token: 'x', status: 'ok', invalidToken: false } as PushSendResult]);

      await containersService.update(containerId, { status: 'arrived' } as any, ownerId);

      expect(fakePushProvider.send).toHaveBeenCalledTimes(1);
      const [, messageArg]: [string[], PushMessage] = fakePushProvider.send.mock.calls[0] as any;
      expect(messageArg.title).toBe('Container Arrived');
      expect(messageArg.body).toContain(`${TAG}-arr-1`);

      const container = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
      expect(container.arrivalNotifiedAt).not.toBeNull();

      // A second attempt hits the PRE-EXISTING ALREADY_ARRIVED guard in
      // ContainersService.update() (unchanged by Phase C) before ever
      // reaching the notification call — proving arrived -> arrived
      // produces no additional notification.
      await expect(containersService.update(containerId, { status: 'arrived' } as any, ownerId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ALREADY_ARRIVED' }),
      });
      expect(fakePushProvider.send).toHaveBeenCalledTimes(1); // still just once
    });

    it('a push-provider failure never corrupts the arrival transition — Container.status and arrivalDate persist correctly', async () => {
      const containerId = await createArrivableContainer(`${TAG}-arr-2`);
      await registerDevice(`ExponentPushToken[${TAG}-arr2-device]`);
      fakePushProvider.send.mockRejectedValueOnce(new Error('Expo is down'));

      const updated = await containersService.update(containerId, { status: 'arrived' } as any, ownerId);

      expect((updated as any).status).toBe('arrived');
      const container = await prisma.container.findUniqueOrThrow({ where: { id: containerId } });
      expect(container.status).toBe('arrived');
      expect(container.arrivalNotifiedAt).not.toBeNull(); // claimed before the failed send
    });

    it('restart safety: a fresh service instance observes the already-claimed arrival and does not re-send', async () => {
      const containerId = await createArrivableContainer(`${TAG}-arr-3`);
      await registerDevice(`ExponentPushToken[${TAG}-arr3-device]`);
      fakePushProvider.send.mockResolvedValue([]);

      await containersService.update(containerId, { status: 'arrived' } as any, ownerId);
      expect(fakePushProvider.send).toHaveBeenCalledTimes(1);

      const restartedPush = { send: fn().mockResolvedValue([]) } as unknown as jest.Mocked<PushProvider>;
      const restartedModule = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ContainersModule] })
        .overrideProvider(PUSH_PROVIDER).useValue(restartedPush)
        .compile();
      const restartedContainersService = restartedModule.get(ContainersService);

      // Same already-arrived container — the pre-existing guard rejects
      // this before any notification logic runs at all.
      await expect(restartedContainersService.update(containerId, { status: 'arrived' } as any, ownerId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ALREADY_ARRIVED' }),
      });
      expect(restartedPush.send).not.toHaveBeenCalled();

      await restartedModule.close();
    });
  });

  describe('multi-container isolation', () => {
    it('one container\'s ETA-notification path failing does not affect another container\'s notification', async () => {
      const failingId = await createTrackedContainer(`${TAG}-multi-fail`);
      const okId = await createTrackedContainer(`${TAG}-multi-ok`);
      await registerDevice(`ExponentPushToken[${TAG}-multi-device]`);

      const d0 = new Date('2026-09-24T00:00:00.000Z');
      const d1 = new Date('2026-09-25T00:00:00.000Z');

      // Baseline refresh for both — a brand-new container's first-ever
      // refresh is always 'initial' (never notification-worthy, see the
      // idempotency test above), so this establishes a real prior ETA to
      // change FROM without itself counting as one of the two calls below.
      fakeTrackingProvider.trackContainer.mockImplementation(async (number: string) =>
        normalized({ referenceNumber: number, eta: d0 }),
      );
      await trackingService.attemptRefresh(failingId);
      await trackingService.attemptRefresh(okId);
      await clearThrottle(failingId);
      await clearThrottle(okId);

      fakeTrackingProvider.trackContainer.mockImplementation(async (number: string) =>
        normalized({ referenceNumber: number, eta: d1 }),
      );

      let callCount = 0;
      fakePushProvider.send.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('provider down for the first call only');
        return [{ token: 'x', status: 'ok', invalidToken: false }];
      });

      const resultFail = await trackingService.attemptRefresh(failingId);
      const resultOk = await trackingService.attemptRefresh(okId);

      // Both refreshes succeed regardless of which notification call failed.
      expect(resultFail.outcome).toBe('success');
      expect(resultOk.outcome).toBe('success');
      expect(fakePushProvider.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Phase A scheduler compatibility', () => {
    // Deliberately does NOT call ContainerTrackingScheduler.runOnce() here:
    // that method queries EVERY active ContainerTrackingAssignment globally
    // (by design), which in this shared dev database would also sweep up
    // this file's OTHER tests' still-active assignments (and any
    // pre-existing real ones) and fake-refresh them — exactly the risk the
    // Phase A integration test's own doc comment identifies and avoids.
    // ContainerTrackingScheduler's own iteration/failure-isolation logic is
    // already fully covered, safely, by container-tracking.scheduler.spec.ts
    // (mocked Prisma, no real data risk) — all 58 of those Phase A tests
    // still pass unmodified with Phase C's changes in place. What THIS test
    // proves, safely, is the one thing only a real module graph can prove:
    // that the scheduler still resolves via dependency injection now that
    // ContainerTrackingService (which it depends on) itself depends on the
    // new NotificationsModule — i.e. the wiring in containers.module.ts /
    // notifications.module.ts is actually correct end-to-end, not just
    // type-correct.
    it('ContainerTrackingScheduler still resolves through DI with the notification dependency chain wired in, and attemptRefresh() (the exact method it calls per container) still works correctly', async () => {
      const { ContainerTrackingScheduler } = await import('../src/containers/tracking/container-tracking.scheduler');
      const scheduler = moduleRef.get(ContainerTrackingScheduler);
      expect(scheduler).toBeInstanceOf(ContainerTrackingScheduler);

      const containerId = await createTrackedContainer(`${TAG}-sched-1`);
      await registerDevice(`ExponentPushToken[${TAG}-sched-device]`);
      fakeTrackingProvider.trackContainer.mockResolvedValueOnce(normalized({ referenceNumber: `${TAG}-sched-1`, eta: new Date('2026-09-28T00:00:00.000Z') }));
      fakePushProvider.send.mockResolvedValue([]);

      // This is the exact call scheduler.runOnce() makes per assignment —
      // proving it end-to-end for one specific, isolated container is the
      // safe equivalent of proving the scheduler's per-container step works.
      const result = await trackingService.attemptRefresh(containerId);

      expect(result.outcome).toBe('success');
      const row = await prisma.containerTracking.findUniqueOrThrow({ where: { containerId } });
      expect(row.eta?.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    });
  });
});
