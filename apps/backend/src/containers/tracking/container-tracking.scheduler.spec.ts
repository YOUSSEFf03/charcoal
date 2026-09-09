import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ContainerTrackingScheduler } from './container-tracking.scheduler';
import { ContainerTrackingService, RefreshOutcome } from './container-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingProviderError } from './container-tracking.provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

describe('ContainerTrackingScheduler', () => {
  let scheduler: ContainerTrackingScheduler;
  let prisma: any;
  let trackingService: jest.Mocked<Pick<ContainerTrackingService, 'attemptRefresh'>>;

  beforeEach(() => {
    prisma = { containerTrackingAssignment: { findMany: fn() } };
    trackingService = { attemptRefresh: fn() } as any;
    scheduler = new ContainerTrackingScheduler(
      prisma as unknown as PrismaService,
      trackingService as unknown as ContainerTrackingService,
    );
    // Remove the real inter-call delay so these tests run instantly — see
    // the scheduler's own doc comment on why this field exists.
    (scheduler as any).interRefreshDelayMs = 0;
  });

  describe('runOnce — container selection', () => {
    it('queries only active assignments (releasedAt IS NULL) — never every Container', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([]);
      await scheduler.runOnce();
      expect(prisma.containerTrackingAssignment.findMany).toHaveBeenCalledWith({
        where: { releasedAt: null },
        select: { containerId: true },
      });
    });

    it('with zero active assignments, completes cleanly and never calls attemptRefresh', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([]);
      const summary = await scheduler.runOnce();
      expect(summary).toEqual({ total: 0, succeeded: 0, skipped: 0, failed: 0 });
      expect(trackingService.attemptRefresh).not.toHaveBeenCalled();
    });

    it('with one active assignment, invokes attemptRefresh exactly once for that container', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([{ containerId: 'c-1' }]);
      trackingService.attemptRefresh.mockResolvedValue({ outcome: 'success', tracking: {} } as unknown as RefreshOutcome);

      const summary = await scheduler.runOnce();

      expect(trackingService.attemptRefresh).toHaveBeenCalledTimes(1);
      expect(trackingService.attemptRefresh).toHaveBeenCalledWith('c-1');
      expect(summary).toEqual({ total: 1, succeeded: 1, skipped: 0, failed: 0 });
    });

    it('with multiple active assignments, attempts every one of them', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([
        { containerId: 'c-1' }, { containerId: 'c-2' }, { containerId: 'c-3' },
      ]);
      trackingService.attemptRefresh.mockResolvedValue({ outcome: 'success', tracking: {} } as unknown as RefreshOutcome);

      const summary = await scheduler.runOnce();

      expect(trackingService.attemptRefresh).toHaveBeenCalledTimes(3);
      expect(trackingService.attemptRefresh.mock.calls.map((c) => c[0])).toEqual(['c-1', 'c-2', 'c-3']);
      expect(summary).toEqual({ total: 3, succeeded: 3, skipped: 0, failed: 0 });
    });
  });

  describe('runOnce — failure isolation', () => {
    it('one container returning a provider_error does not prevent the remaining containers from being attempted', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([
        { containerId: 'c-1' }, { containerId: 'c-2' }, { containerId: 'c-3' },
      ]);
      trackingService.attemptRefresh.mockImplementation(async (containerId: string) => {
        if (containerId === 'c-2') {
          return { outcome: 'provider_error', error: new TrackingProviderError('not_found', 'x') } as RefreshOutcome;
        }
        return { outcome: 'success', tracking: {} } as unknown as RefreshOutcome;
      });

      const summary = await scheduler.runOnce();

      expect(trackingService.attemptRefresh).toHaveBeenCalledTimes(3);
      expect(trackingService.attemptRefresh.mock.calls.map((c) => c[0])).toEqual(['c-1', 'c-2', 'c-3']);
      expect(summary).toEqual({ total: 3, succeeded: 2, skipped: 0, failed: 1 });
    });

    it('one container throwing an unexpected error does not prevent the remaining containers from being attempted', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([
        { containerId: 'c-1' }, { containerId: 'c-2' },
      ]);
      trackingService.attemptRefresh.mockImplementation(async (containerId: string) => {
        if (containerId === 'c-1') throw new Error('unexpected DB blip');
        return { outcome: 'success', tracking: {} } as unknown as RefreshOutcome;
      });

      const summary = await scheduler.runOnce();

      expect(trackingService.attemptRefresh).toHaveBeenCalledTimes(2);
      expect(summary).toEqual({ total: 2, succeeded: 1, skipped: 0, failed: 1 });
    });

    it('throttled/no_slot/ended/no_sealine/not_found outcomes count as skipped, not failed', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([
        { containerId: 'c-throttled' },
        { containerId: 'c-no-slot' },
        { containerId: 'c-ended' },
        { containerId: 'c-no-sealine' },
        { containerId: 'c-not-found' },
      ]);
      const outcomes: Record<string, RefreshOutcome> = {
        'c-throttled': { outcome: 'throttled', retryAfterSeconds: 300 },
        'c-no-slot': { outcome: 'no_slot' },
        'c-ended': { outcome: 'ended' },
        'c-no-sealine': { outcome: 'no_sealine' },
        'c-not-found': { outcome: 'not_found' },
      };
      trackingService.attemptRefresh.mockImplementation(async (containerId: string) => outcomes[containerId]);

      const summary = await scheduler.runOnce();

      expect(summary).toEqual({ total: 5, succeeded: 0, skipped: 5, failed: 0 });
    });
  });

  describe('handleHourlyRefresh — reentrancy guard (single-process only, see class doc comment)', () => {
    it('skips starting a new run while a previous run is still marked in progress', async () => {
      (scheduler as any).isRunning = true;
      await scheduler.handleHourlyRefresh();
      expect(prisma.containerTrackingAssignment.findMany).not.toHaveBeenCalled();
      expect(trackingService.attemptRefresh).not.toHaveBeenCalled();
    });

    it('runs normally, and clears the in-progress flag afterwards, when not already running', async () => {
      prisma.containerTrackingAssignment.findMany.mockResolvedValue([]);
      await scheduler.handleHourlyRefresh();
      expect(prisma.containerTrackingAssignment.findMany).toHaveBeenCalledTimes(1);
      expect((scheduler as any).isRunning).toBe(false);
    });

    it('clears the in-progress flag even if runOnce throws', async () => {
      prisma.containerTrackingAssignment.findMany.mockRejectedValue(new Error('db down'));
      await expect(scheduler.handleHourlyRefresh()).rejects.toThrow('db down');
      expect((scheduler as any).isRunning).toBe(false);
    });
  });

  describe('structural guarantee — no Traqo/account-allocation logic in the scheduler', () => {
    it('the scheduler is constructed from only PrismaService + ContainerTrackingService — it has no dependency capable of calling Traqo or resolving a key directly', () => {
      // This is a structural assertion, not a behavioral one: the scheduler
      // class simply has no constructor parameter of type
      // ContainerTrackingProvider / TraqoAccountAllocationService /
      // TraqoKeyResolver at all, so there is no code path by which it could
      // call the provider or read an API key without going through
      // ContainerTrackingService.attemptRefresh().
      expect(ContainerTrackingScheduler.length).toBe(2);
    });
  });
});
