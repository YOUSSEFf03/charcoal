import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ContainerTrackingService } from './container-tracking.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContainerTrackingProvider, TrackingProviderError } from './container-tracking.provider';
import { TraqoAccountAllocationService } from './traqo-account-allocation.service';
import { TraqoKeyResolver } from './traqo-key-resolver.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fn(): any {
  return jest.fn();
}

const CONTAINER_ID = 'container-1';

const TEST_ACCOUNT = {
  id: 'acct-1',
  name: 'Traqo Account 1',
  envKeyName: 'TRAQO_API_KEY_1',
  baseUrl: null,
  active: true,
  maxContainers: 4,
  priority: 1,
  status: 'healthy',
  unavailableUntil: null,
};

const TEST_ASSIGNMENT = { id: 'asg-1', containerId: CONTAINER_ID, traqoAccountId: 'acct-1', releasedAt: null };

function makeNormalized(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider: 'traqo',
    referenceNumber: 'MRSU6859427',
    sealine: 'MAEU',
    sealineName: 'Maersk',
    status: 'IN_TRANSIT',
    origin: 'Shanghai, CN',
    destination: 'Beirut, LB',
    vessel: 'MAERSK ESSEX',
    voyage: '412W',
    currentLocation: 'Port Said, EG',
    eta: new Date('2026-09-01T00:00:00.000Z'),
    isDelayed: false,
    shipmentUid: 'shp_123',
    shipmentPublicUrl: 'https://traqocontainer.com/s/shp_123',
    traqoShipmentName: 'SHP-76810',
    isActive: true,
    closedAt: null,
    providerUpdatedAt: new Date('2026-08-24T18:42:00.000Z'),
    events: [{ description: 'Gate out', location: 'Shanghai, CN', occurredAt: new Date('2026-08-01T00:00:00.000Z'), raw: {} }],
    raw: { reference_number: 'MRSU6859427' },
    ...overrides,
  };
}

describe('ContainerTrackingService', () => {
  let service: ContainerTrackingService;
  let prisma: any;
  let provider: jest.Mocked<ContainerTrackingProvider>;
  let allocation: jest.Mocked<TraqoAccountAllocationService>;
  let keyResolver: jest.Mocked<TraqoKeyResolver>;
  let notifications: { notifyEtaChangeIfNeeded: ReturnType<typeof fn> };
  let tx: any;

  beforeEach(() => {
    tx = {
      containerTracking: { upsert: fn(), findUniqueOrThrow: fn() },
      trackingEvent: { deleteMany: fn(), createMany: fn() },
    };
    prisma = {
      container: { findUnique: fn() },
      containerTracking: { findUnique: fn(), update: fn() },
      traqoAccount: { findFirst: fn() },
      $transaction: fn().mockImplementation((cb: any) => cb(tx)),
    };
    provider = { trackContainer: fn(), listCarriers: fn() };
    allocation = {
      resolveForRefresh: fn().mockResolvedValue({ kind: 'active', account: TEST_ACCOUNT, assignment: TEST_ASSIGNMENT }),
      recordFailure: fn(),
      recordSuccess: fn(),
      releaseAsTraqoRemoved: fn(),
    } as any;
    keyResolver = { resolve: fn().mockReturnValue('test-key-123') } as any;
    notifications = { notifyEtaChangeIfNeeded: fn().mockResolvedValue(undefined) };
    service = new ContainerTrackingService(
      prisma as unknown as PrismaService,
      provider,
      allocation,
      keyResolver,
      notifications as any,
    );
  });

  describe('getTracking', () => {
    it('throws NotFoundException when the container does not exist', async () => {
      prisma.container.findUnique.mockResolvedValue(null);
      await expect(service.getTracking(CONTAINER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the stored tracking snapshot with events, without calling the provider', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID });
      prisma.containerTracking.findUnique.mockResolvedValue({ id: 'trk-1', events: [] });

      const result = await service.getTracking(CONTAINER_ID);

      expect(result).toEqual({ id: 'trk-1', events: [] });
      expect(provider.trackContainer).not.toHaveBeenCalled();
    });

    it('returns null when the container has never been refreshed', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      expect(await service.getTracking(CONTAINER_ID)).toBeNull();
    });
  });

  describe('refreshTracking — validation', () => {
    it('throws NotFoundException when the container does not exist', async () => {
      prisma.container.findUnique.mockResolvedValue(null);
      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException(SEALINE_REQUIRED) when the container has no carrier set', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: null });
      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(provider.trackContainer).not.toHaveBeenCalled();
      expect(allocation.resolveForRefresh).not.toHaveBeenCalled();
    });
  });

  describe('refreshTracking — server-side throttle', () => {
    it('rejects with 429 REFRESH_TOO_SOON when the last fetch was under 15 minutes ago', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
      });

      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toMatchObject({
        getStatus: expect.any(Function),
      });
      expect(provider.trackContainer).not.toHaveBeenCalled();
      expect(allocation.resolveForRefresh).not.toHaveBeenCalled();

      try {
        await service.refreshTracking(CONTAINER_ID);
        throw new Error('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(429);
        expect((e as HttpException).getResponse()).toMatchObject({ code: 'REFRESH_TOO_SOON' });
      }
    });

    it('allows refresh when the last fetch was over 15 minutes ago', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      provider.trackContainer.mockResolvedValue(makeNormalized() as any);
      tx.containerTracking.upsert.mockResolvedValue({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValue({ id: 'trk-1', events: [] });

      await service.refreshTracking(CONTAINER_ID);
      expect(provider.trackContainer).toHaveBeenCalledWith('MRSU6859427', 'MAEU', {
        apiKey: 'test-key-123',
        baseUrl: undefined,
      });
    });

    it('never checks or branches on Container.status — arrival never short-circuits refresh', async () => {
      // Regression proof for the corrected lifecycle: arrival must have zero
      // effect on whether/how a refresh proceeds. The service doesn't even
      // read container.status.
      prisma.container.findUnique.mockResolvedValue({
        id: CONTAINER_ID,
        number: 'MRSU6859427',
        sealine: 'MAEU',
        status: 'arrived',
      });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      provider.trackContainer.mockResolvedValue(makeNormalized() as any);
      tx.containerTracking.upsert.mockResolvedValue({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValue({ id: 'trk-1', events: [] });

      await service.refreshTracking(CONTAINER_ID);
      expect(provider.trackContainer).toHaveBeenCalled();
      expect(allocation.releaseAsTraqoRemoved).not.toHaveBeenCalled();
    });
  });

  describe('refreshTracking — allocation outcomes', () => {
    it('throws 503 NO_TRACKING_SLOT_AVAILABLE and never calls the provider when no slot is available', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      allocation.resolveForRefresh.mockResolvedValue({ kind: 'no_slot' } as any);

      try {
        await service.refreshTracking(CONTAINER_ID);
        throw new Error('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(503);
        expect((e as HttpException).getResponse()).toMatchObject({ code: 'NO_TRACKING_SLOT_AVAILABLE' });
      }
      expect(provider.trackContainer).not.toHaveBeenCalled();
    });

    it('throws 409 TRACKING_ENDED and never calls the provider once released as traqo_removed', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      allocation.resolveForRefresh.mockResolvedValue({ kind: 'ended' } as any);

      try {
        await service.refreshTracking(CONTAINER_ID);
        throw new Error('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(409);
        expect((e as HttpException).getResponse()).toMatchObject({ code: 'TRACKING_ENDED' });
      }
      expect(provider.trackContainer).not.toHaveBeenCalled();
    });
  });

  describe('refreshTracking — successful persistence', () => {
    it('persists the normalized snapshot (including isActive/closedAt/traqoShipmentName) and replaces events', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null); // never refreshed before
      provider.trackContainer.mockResolvedValue(makeNormalized() as any);
      tx.containerTracking.upsert.mockResolvedValue({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValue({ id: 'trk-1', status: 'IN_TRANSIT', events: [] });

      const result = await service.refreshTracking(CONTAINER_ID);

      expect(tx.containerTracking.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { containerId: CONTAINER_ID },
          create: expect.objectContaining({
            containerId: CONTAINER_ID,
            referenceNumber: 'MRSU6859427',
            traqoShipmentName: 'SHP-76810',
            isActive: true,
            closedAt: null,
            lastError: null,
          }),
          update: expect.objectContaining({ referenceNumber: 'MRSU6859427', isActive: true, lastError: null }),
        }),
      );
      expect(tx.trackingEvent.deleteMany).toHaveBeenCalledWith({ where: { trackingId: 'trk-1' } });
      expect(tx.trackingEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ trackingId: 'trk-1', description: 'Gate out', location: 'Shanghai, CN' }),
        ],
      });
      expect(result).toEqual({ id: 'trk-1', status: 'IN_TRANSIT', events: [] });
      expect(allocation.recordSuccess).toHaveBeenCalledWith(TEST_ACCOUNT);
    });

    it('does not call trackingEvent.createMany when the provider returns zero events', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockResolvedValue(makeNormalized({ events: [] }) as any);
      tx.containerTracking.upsert.mockResolvedValue({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValue({ id: 'trk-1', events: [] });

      await service.refreshTracking(CONTAINER_ID);
      expect(tx.trackingEvent.createMany).not.toHaveBeenCalled();
    });
  });

  describe('refreshTracking — Traqo release signal (is_active / closed_at)', () => {
    async function run(overrides: Partial<Record<string, unknown>>) {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockResolvedValue(makeNormalized(overrides) as any);
      tx.containerTracking.upsert.mockResolvedValue({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValue({ id: 'trk-1', events: [] });
      await service.refreshTracking(CONTAINER_ID);
    }

    it('releases the assignment as traqo_removed when isActive === false', async () => {
      await run({ isActive: false, closedAt: null });
      expect(allocation.releaseAsTraqoRemoved).toHaveBeenCalledWith(tx, CONTAINER_ID);
    });

    it('releases the assignment as traqo_removed when closedAt !== null', async () => {
      await run({ isActive: true, closedAt: new Date('2026-09-20T00:00:00.000Z') });
      expect(allocation.releaseAsTraqoRemoved).toHaveBeenCalledWith(tx, CONTAINER_ID);
    });

    it('releases when both isActive === false and closedAt !== null', async () => {
      await run({ isActive: false, closedAt: new Date('2026-09-20T00:00:00.000Z') });
      expect(allocation.releaseAsTraqoRemoved).toHaveBeenCalledWith(tx, CONTAINER_ID);
    });

    it('does NOT release when isActive === true and closedAt === null (still tracked)', async () => {
      await run({ isActive: true, closedAt: null });
      expect(allocation.releaseAsTraqoRemoved).not.toHaveBeenCalled();
    });

    it('does NOT release when isActive is null (field absent from the response)', async () => {
      await run({ isActive: null, closedAt: null });
      expect(allocation.releaseAsTraqoRemoved).not.toHaveBeenCalled();
    });
  });

  describe('refreshTracking — failure preserves existing data', () => {
    it('leaves the existing tracking row untouched (except lastError) when the provider call fails', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      const existing = {
        id: 'trk-1',
        status: 'IN_TRANSIT',
        lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000),
      };
      prisma.containerTracking.findUnique.mockResolvedValue(existing);
      provider.trackContainer.mockRejectedValue(new TrackingProviderError('not_found', 'x'));

      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(HttpException);

      expect(prisma.containerTracking.update).toHaveBeenCalledWith({
        where: { containerId: CONTAINER_ID },
        data: { lastError: 'No tracking information was found for this container.' },
      });
      // The success-path persistence transaction (which would overwrite
      // status/etc.) must never run — only the allocation-resolution
      // transaction runs, before the provider call fails.
      expect(tx.containerTracking.upsert).not.toHaveBeenCalled();
      expect(allocation.releaseAsTraqoRemoved).not.toHaveBeenCalled();
      expect(allocation.recordSuccess).not.toHaveBeenCalled();
    });

    it('does not attempt to record lastError when no tracking row exists yet', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockRejectedValue(new TrackingProviderError('unauthorized', 'x'));

      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(HttpException);
      expect(prisma.containerTracking.update).not.toHaveBeenCalled();
    });
  });

  describe('refreshTracking — account health recording on failure', () => {
    it('records unauthorized (401) as an account-level auth_failed, excluding it from new allocation only', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockRejectedValue(new TrackingProviderError('unauthorized', 'x'));

      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(HttpException);
      expect(allocation.recordFailure).toHaveBeenCalledWith('acct-1', 'unauthorized');
    });

    it('records rate_limited (429) with the retryAfterSeconds — does NOT migrate the existing assignment', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockRejectedValue(new TrackingProviderError('rate_limited', 'x', 42));

      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(HttpException);
      expect(allocation.recordFailure).toHaveBeenCalledWith('acct-1', 'rate_limited', 42);
      // Never a new allocation call — the SAME account/assignment is kept.
      expect(allocation.resolveForRefresh).toHaveBeenCalledTimes(1);
    });

    it('records payment_required (402 shipment_limit_reached) as account-level exhaustion', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockRejectedValue(new TrackingProviderError('payment_required', 'x'));

      await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(HttpException);
      expect(allocation.recordFailure).toHaveBeenCalledWith('acct-1', 'payment_required');
    });

    for (const kind of ['not_found', 'bad_request', 'forbidden', 'upstream_error', 'invalid_response', 'network_error'] as const) {
      it(`does NOT record an account-level failure for ${kind} (a per-request/per-container problem, not evidence the account is unusable)`, async () => {
        prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
        prisma.containerTracking.findUnique.mockResolvedValue(null);
        provider.trackContainer.mockRejectedValue(new TrackingProviderError(kind, 'x'));

        await expect(service.refreshTracking(CONTAINER_ID)).rejects.toBeInstanceOf(HttpException);
        expect(allocation.recordFailure).not.toHaveBeenCalled();
      });
    }
  });

  describe('refreshTracking — error → HTTP mapping (business-friendly messages)', () => {
    const cases: Array<[TrackingProviderError['kind'], number, string]> = [
      ['unauthorized', 502, 'Tracking authentication failed. Please check the Traqo API configuration.'],
      ['forbidden', 502, 'Traqo developer access is not enabled.'],
      ['not_found', 404, 'No tracking information was found for this container.'],
      ['payment_required', 503, 'Traqo tracking limit has been reached.'],
      ['rate_limited', 429, 'Tracking service rate limit reached. Please try again later.'],
      ['upstream_error', 502, "Traqo's tracking provider is temporarily unavailable."],
      ['missing_api_key', 503, 'Tracking is not configured on this server.'],
      // Confirmed via a real Traqo 400 (2026-08-24, both "Invalid container
      // number format" and "Unknown sealine code" responses): this must be
      // a permanent/actionable 400, never the "temporarily unavailable, try
      // again" framing used for transient provider-side failures.
      ['bad_request', 400, "This container's number or carrier isn't recognized by the tracking provider. Please check them and try again."],
    ];

    for (const [kind, status, message] of cases) {
      it(`maps ${kind} to HTTP ${status} with a business-friendly message`, async () => {
        prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
        prisma.containerTracking.findUnique.mockResolvedValue(null);
        provider.trackContainer.mockRejectedValue(new TrackingProviderError(kind, 'raw provider detail'));

        try {
          await service.refreshTracking(CONTAINER_ID);
          throw new Error('expected to throw');
        } catch (e) {
          expect(e).toBeInstanceOf(HttpException);
          const err = e as HttpException;
          expect(err.getStatus()).toBe(status);
          const body = err.getResponse() as Record<string, unknown>;
          expect(body.error).toBe(message);
          // Never leak the provider's raw error text to the client.
          expect(body.error).not.toContain('raw provider detail');
        }
      });
    }
  });

  describe('listCarriers', () => {
    it('resolves credentials from the highest-priority active account and delegates to the provider', async () => {
      prisma.traqoAccount.findFirst.mockResolvedValue(TEST_ACCOUNT);
      provider.listCarriers.mockResolvedValue([{ scac: 'MAEU', name: 'Maersk' }]);

      const result = await service.listCarriers('mae');

      expect(result).toEqual([{ scac: 'MAEU', name: 'Maersk' }]);
      expect(prisma.traqoAccount.findFirst).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { priority: 'asc' },
      });
      expect(provider.listCarriers).toHaveBeenCalledWith(
        { apiKey: 'test-key-123', baseUrl: undefined },
        'mae',
      );
    });

    it('maps provider errors the same way as refresh', async () => {
      prisma.traqoAccount.findFirst.mockResolvedValue(TEST_ACCOUNT);
      provider.listCarriers.mockRejectedValue(new TrackingProviderError('upstream_error', 'x'));
      await expect(service.listCarriers()).rejects.toBeInstanceOf(HttpException);
    });

    it('passes an empty apiKey (never a raw key value) when no active account exists', async () => {
      prisma.traqoAccount.findFirst.mockResolvedValue(null);
      provider.listCarriers.mockResolvedValue([]);

      await service.listCarriers();

      expect(provider.listCarriers).toHaveBeenCalledWith({ apiKey: '', baseUrl: undefined }, undefined);
    });
  });

  // ---------------------------------------------------------------------
  // attemptRefresh() — the non-throwing core used by the scheduled batch
  // refresh (ContainerTrackingScheduler). Proves the exact same
  // decisions/side-effects as the refreshTracking() tests above, but
  // returned as a RefreshOutcome instead of thrown — this is what lets a
  // scheduled run treat "refreshed too recently" as a normal skip instead
  // of a noisy failure, without duplicating any of the logic above.
  // ---------------------------------------------------------------------
  describe('attemptRefresh — outcomes instead of exceptions', () => {
    it("returns { outcome: 'not_found' } and never throws when the container does not exist", async () => {
      prisma.container.findUnique.mockResolvedValue(null);
      await expect(service.attemptRefresh(CONTAINER_ID)).resolves.toEqual({ outcome: 'not_found' });
    });

    it("returns { outcome: 'no_sealine' } and never calls the provider/allocator when no carrier is set", async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: null });
      await expect(service.attemptRefresh(CONTAINER_ID)).resolves.toEqual({ outcome: 'no_sealine' });
      expect(provider.trackContainer).not.toHaveBeenCalled();
      expect(allocation.resolveForRefresh).not.toHaveBeenCalled();
    });

    it("returns { outcome: 'throttled', retryAfterSeconds } — same 15-minute window as the manual path — without calling the provider", async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
      });

      const result = await service.attemptRefresh(CONTAINER_ID);
      expect(result.outcome).toBe('throttled');
      if (result.outcome === 'throttled') {
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
      }
      expect(provider.trackContainer).not.toHaveBeenCalled();
      expect(allocation.resolveForRefresh).not.toHaveBeenCalled();
    });

    it("returns { outcome: 'no_slot' } without throwing when no Traqo account slot is available", async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      allocation.resolveForRefresh.mockResolvedValue({ kind: 'no_slot' } as any);

      await expect(service.attemptRefresh(CONTAINER_ID)).resolves.toEqual({ outcome: 'no_slot' });
      expect(provider.trackContainer).not.toHaveBeenCalled();
    });

    it("returns { outcome: 'ended' } without throwing once Traqo has confirmed the shipment closed", async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      allocation.resolveForRefresh.mockResolvedValue({ kind: 'ended' } as any);

      await expect(service.attemptRefresh(CONTAINER_ID)).resolves.toEqual({ outcome: 'ended' });
      expect(provider.trackContainer).not.toHaveBeenCalled();
    });

    it("returns { outcome: 'provider_error', error } without throwing, and still records account failure exactly like the manual path", async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      const existing = { id: 'trk-1', lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000) };
      prisma.containerTracking.findUnique.mockResolvedValue(existing);
      const providerError = new TrackingProviderError('unauthorized', 'x');
      provider.trackContainer.mockRejectedValue(providerError);

      const result = await service.attemptRefresh(CONTAINER_ID);
      expect(result).toEqual({ outcome: 'provider_error', error: providerError });
      expect(allocation.recordFailure).toHaveBeenCalledWith('acct-1', 'unauthorized');
      expect(prisma.containerTracking.update).toHaveBeenCalledWith({
        where: { containerId: CONTAINER_ID },
        data: { lastError: 'Tracking authentication failed. Please check the Traqo API configuration.' },
      });
    });

    it("returns { outcome: 'success', tracking } and persists exactly like the manual path on a clean refresh", async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(null);
      provider.trackContainer.mockResolvedValue(makeNormalized() as any);
      tx.containerTracking.upsert.mockResolvedValue({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValue({ id: 'trk-1', status: 'IN_TRANSIT', events: [] });

      const result = await service.attemptRefresh(CONTAINER_ID);
      expect(result).toEqual({ outcome: 'success', tracking: { id: 'trk-1', status: 'IN_TRANSIT', events: [] } });
      expect(allocation.recordSuccess).toHaveBeenCalledWith(TEST_ACCOUNT);
    });
  });

  describe('refreshTracking — still throws exactly as before (thin wrapper over attemptRefresh)', () => {
    it('throws the same 429 REFRESH_TOO_SOON for the case attemptRefresh reports as "throttled"', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        lastFetchedAt: new Date(Date.now() - 60 * 1000),
      });

      try {
        await service.refreshTracking(CONTAINER_ID);
        throw new Error('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(429);
        expect((e as HttpException).getResponse()).toMatchObject({ code: 'REFRESH_TOO_SOON' });
      }
    });
  });

  // ---------------------------------------------------------------------
  // Phase B — ETA-change detection/persistence. These prove the exact
  // upsert payload persistSuccess() sends to Prisma for each scenario in
  // the task spec (A–F), using the same mocked-Prisma harness as the tests
  // above. Real-Postgres persistence/idempotency/restart-survival is proven
  // separately in test/container-tracking-eta-change.integration-spec.ts.
  // ---------------------------------------------------------------------
  describe('Phase B — ETA-change detection persisted alongside the tracking upsert', () => {
    async function runRefresh(existingRow: { eta: Date | null; lastFetchedAt?: Date } | null, newEta: Date | null) {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue(
        existingRow ? { eta: existingRow.eta, lastFetchedAt: existingRow.lastFetchedAt ?? new Date(Date.now() - 20 * 60 * 1000) } : null,
      );
      provider.trackContainer.mockResolvedValueOnce(makeNormalized({ eta: newEta }) as any);
      tx.containerTracking.upsert.mockResolvedValueOnce({ id: 'trk-1' });
      tx.containerTracking.findUniqueOrThrow.mockResolvedValueOnce({ id: 'trk-1', eta: newEta, events: [] });
      return service.attemptRefresh(CONTAINER_ID);
    }

    it('A) no existing row (initial population): previousEta is null, etaChangedAt is never set', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');
      await runRefresh(null, D1);

      expect(tx.containerTracking.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ previousEta: null }),
        }),
      );
      const call = tx.containerTracking.upsert.mock.calls[0][0];
      expect(call.create).not.toHaveProperty('etaChangedAt');
    });

    it('B) existing row with null ETA + new ETA resolved: previousEta null, etaChangedAt IS set (became_known)', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');
      await runRefresh({ eta: null }, D1);

      const call = tx.containerTracking.upsert.mock.calls[0][0];
      expect(call.update).toMatchObject({ previousEta: null });
      expect(call.update.etaChangedAt).toBeInstanceOf(Date);
    });

    it('C) existing ETA + a different new ETA: previousEta = old value, etaChangedAt IS set', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');
      const D2 = new Date('2026-09-17T00:00:00.000Z');
      await runRefresh({ eta: D1 }, D2);

      const call = tx.containerTracking.upsert.mock.calls[0][0];
      expect(call.update.previousEta).toEqual(D1);
      expect(call.update.etaChangedAt).toBeInstanceOf(Date);
    });

    it('D) existing ETA equals new ETA (repeated hourly refresh, same value): etaChangedAt is NEVER set — idempotent', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');
      await runRefresh({ eta: D1 }, new Date(D1.getTime()));

      const call = tx.containerTracking.upsert.mock.calls[0][0];
      expect(call.update.previousEta).toEqual(D1);
      expect(call.update).not.toHaveProperty('etaChangedAt');
    });

    it('E) existing ETA + new ETA is null ("became unavailable"): eta is persisted as null, previousEta preserves the last known value, etaChangedAt is NOT set', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');
      await runRefresh({ eta: D1 }, null);

      const call = tx.containerTracking.upsert.mock.calls[0][0];
      expect(call.update.eta).toBeNull();
      expect(call.update.previousEta).toEqual(D1);
      expect(call.update).not.toHaveProperty('etaChangedAt');
    });

    it('F) throttled refresh: attemptRefresh returns before ever calling persistSuccess — no upsert, no ETA-change state touched', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        eta: new Date('2026-09-15T00:00:00.000Z'),
        lastFetchedAt: new Date(Date.now() - 60 * 1000), // 1 minute ago — well within the throttle window
      });

      const result = await service.attemptRefresh(CONTAINER_ID);

      expect(result.outcome).toBe('throttled');
      expect(provider.trackContainer).not.toHaveBeenCalled();
      expect(tx.containerTracking.upsert).not.toHaveBeenCalled();
    });

    it('F) failed provider refresh: no upsert runs — the pre-existing eta/previousEta/etaChangedAt are left completely untouched', async () => {
      prisma.container.findUnique.mockResolvedValue({ id: CONTAINER_ID, number: 'MRSU6859427', sealine: 'MAEU' });
      prisma.containerTracking.findUnique.mockResolvedValue({
        eta: new Date('2026-09-15T00:00:00.000Z'),
        lastFetchedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      provider.trackContainer.mockRejectedValueOnce(new TrackingProviderError('not_found', 'x'));

      const result = await service.attemptRefresh(CONTAINER_ID);

      expect(result.outcome).toBe('provider_error');
      // Only the failed-refresh lastError update runs — never the success
      // upsert that would carry eta/previousEta/etaChangedAt.
      expect(prisma.containerTracking.update).toHaveBeenCalledWith({
        where: { containerId: CONTAINER_ID },
        data: { lastError: 'No tracking information was found for this container.' },
      });
      expect(tx.containerTracking.upsert).not.toHaveBeenCalled();
    });

    it('idempotency across repeated calls: refresh 1 (become_known) sets etaChangedAt, refresh 2 (unchanged) does not touch it again', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');

      // Refresh 1: null -> D1 (became_known).
      await runRefresh({ eta: null }, D1);
      const firstCall = tx.containerTracking.upsert.mock.calls[0][0];
      expect(firstCall.update.etaChangedAt).toBeInstanceOf(Date);

      // Refresh 2: D1 -> D1 (no_change) — the "existing" row now reflects
      // refresh 1's persisted eta.
      await runRefresh({ eta: D1 }, new Date(D1.getTime()));
      const secondCall = tx.containerTracking.upsert.mock.calls[1][0];
      expect(secondCall.update).not.toHaveProperty('etaChangedAt');
    });

    it('a later refresh (D2) after a change (D1) still marks a fresh etaChangedAt — no suppression from history', async () => {
      const D1 = new Date('2026-09-15T00:00:00.000Z');
      const D2 = new Date('2026-09-19T00:00:00.000Z');

      await runRefresh({ eta: D1 }, D2); // refresh 3 in the task spec's example: D1 -> D2, a new change
      const call = tx.containerTracking.upsert.mock.calls[0][0];
      expect(call.update.etaChangedAt).toBeInstanceOf(Date);
      expect(call.update.previousEta).toEqual(D1);
    });
  });
});
