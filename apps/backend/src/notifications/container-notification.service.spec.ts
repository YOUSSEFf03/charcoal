import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ContainerNotificationService } from './container-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceRegistryService } from './device-registry.service';
import { PushProvider } from './push.provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const CONTAINER_ID = 'container-1';
const TRACKING_ID = 'trk-1';

describe('ContainerNotificationService', () => {
  let service: ContainerNotificationService;
  let prisma: any;
  let deviceRegistry: any;
  let push: jest.Mocked<PushProvider>;

  beforeEach(() => {
    prisma = {
      containerTracking: { updateMany: fn() },
      container: {
        findUnique: fn().mockResolvedValue({ number: 'MSCU1234567', supplier: { name: 'ABC Charcoal Trading' } }),
        updateMany: fn(),
      },
    };
    deviceRegistry = {
      findActiveTokens: fn().mockResolvedValue(['tok-1', 'tok-2']),
      deactivateTokens: fn(),
    };
    push = { send: fn() };
    service = new ContainerNotificationService(
      prisma as unknown as PrismaService,
      deviceRegistry as unknown as DeviceRegistryService,
      push,
    );
  });

  describe('notifyEtaChangeIfNeeded', () => {
    const D1 = new Date('2026-09-17T00:00:00.000Z');

    it('does nothing when etaChangedAt is null (no notification-worthy change this refresh)', async () => {
      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: null, etaChangeNotifiedAt: null });
      expect(prisma.containerTracking.updateMany).not.toHaveBeenCalled();
      expect(push.send).not.toHaveBeenCalled();
    });

    it('does nothing when already notified for this exact change (etaChangeNotifiedAt >= etaChangedAt)', async () => {
      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: D1 });
      expect(prisma.containerTracking.updateMany).not.toHaveBeenCalled();
      expect(push.send).not.toHaveBeenCalled();
    });

    it('claims the change (compare-and-set) and sends to all active devices when genuinely un-notified', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 1 });
      push.send.mockResolvedValue([{ token: 'tok-1', status: 'ok', invalidToken: false }, { token: 'tok-2', status: 'ok', invalidToken: false }]);

      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: null });

      expect(prisma.containerTracking.updateMany).toHaveBeenCalledWith({
        where: {
          id: TRACKING_ID,
          etaChangedAt: D1,
          OR: [{ etaChangeNotifiedAt: null }, { etaChangeNotifiedAt: { lt: D1 } }],
        },
        data: { etaChangeNotifiedAt: D1 },
      });
      expect(push.send).toHaveBeenCalledWith(
        ['tok-1', 'tok-2'],
        expect.objectContaining({
          title: 'Container ETA Updated',
          body: expect.stringContaining('MSCU1234567'),
          data: { type: 'eta_changed', containerId: CONTAINER_ID },
        }),
      );
    });

    it('never sends when the compare-and-set loses the race (count !== 1) — a concurrent caller already claimed it', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 0 });

      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: null });

      expect(push.send).not.toHaveBeenCalled();
    });

    it('never sends to any device when there are none registered', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 1 });
      deviceRegistry.findActiveTokens.mockResolvedValue([]);

      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: null });

      expect(push.send).not.toHaveBeenCalled();
    });

    it('renders "unknown" in the body rather than crashing when eta somehow ends up null despite a change being claimed', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 1 });
      push.send.mockResolvedValue([]);

      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: null, etaChangedAt: D1, etaChangeNotifiedAt: null });

      expect(push.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: expect.stringContaining('unknown') }));
    });

    it('deactivates devices the push provider definitively reports invalid', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 1 });
      push.send.mockResolvedValue([
        { token: 'tok-1', status: 'ok', invalidToken: false },
        { token: 'tok-2', status: 'error', invalidToken: true },
      ]);

      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: null });

      expect(deviceRegistry.deactivateTokens).toHaveBeenCalledWith(['tok-2']);
    });

    it('never throws when the push provider itself rejects — the idempotency marker is already committed by then', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 1 });
      push.send.mockRejectedValue(new Error('provider down'));

      await expect(
        service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: null }),
      ).resolves.toBeUndefined();
    });

    it('does nothing if the container no longer exists between the refresh and this call', async () => {
      prisma.containerTracking.updateMany.mockResolvedValue({ count: 1 });
      prisma.container.findUnique.mockResolvedValue(null);

      await service.notifyEtaChangeIfNeeded({ id: TRACKING_ID, containerId: CONTAINER_ID, eta: D1, etaChangedAt: D1, etaChangeNotifiedAt: null });

      expect(push.send).not.toHaveBeenCalled();
    });
  });

  describe('notifyArrivalIfNeeded', () => {
    it('claims the arrival (compare-and-set) and sends to all active devices', async () => {
      prisma.container.updateMany.mockResolvedValue({ count: 1 });
      push.send.mockResolvedValue([{ token: 'tok-1', status: 'ok', invalidToken: false }, { token: 'tok-2', status: 'ok', invalidToken: false }]);

      await service.notifyArrivalIfNeeded(CONTAINER_ID);

      expect(prisma.container.updateMany).toHaveBeenCalledWith({
        where: { id: CONTAINER_ID, status: 'arrived', arrivalNotifiedAt: null },
        data: { arrivalNotifiedAt: expect.any(Date) },
      });
      expect(push.send).toHaveBeenCalledWith(
        ['tok-1', 'tok-2'],
        expect.objectContaining({ title: 'Container Arrived', body: expect.stringContaining('MSCU1234567'), data: { type: 'arrived', containerId: CONTAINER_ID } }),
      );
    });

    it('does NOT send again when the compare-and-set finds arrivalNotifiedAt already set (count 0) — "arrived -> arrived" produces nothing', async () => {
      prisma.container.updateMany.mockResolvedValue({ count: 0 });

      await service.notifyArrivalIfNeeded(CONTAINER_ID);

      expect(push.send).not.toHaveBeenCalled();
    });

    it('never throws when the push provider rejects', async () => {
      prisma.container.updateMany.mockResolvedValue({ count: 1 });
      push.send.mockRejectedValue(new Error('provider down'));

      await expect(service.notifyArrivalIfNeeded(CONTAINER_ID)).resolves.toBeUndefined();
    });
  });
});
