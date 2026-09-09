import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CarrierOption,
  ContainerTrackingProvider,
  TRACKING_PROVIDER,
  TrackingErrorKind,
  TrackingProviderError,
} from './container-tracking.provider';
import { TraqoAccountAllocationService } from './traqo-account-allocation.service';
import { TraqoKeyResolver } from './traqo-key-resolver.service';
import { classifyEtaChange, isNotifiableEtaChange } from './eta-change';
import { ContainerNotificationService } from '../../notifications/container-notification.service';

/**
 * Server-enforced minimum time between live Traqo lookups for the same
 * container, regardless of what the frontend sends. Protects the account's
 * shipment-slot/rate-limit quota from a user mashing "Refresh tracking" —
 * the frontend must never be trusted to self-limit this (see task spec
 * "API PROTECTION"). 15 minutes is conservative for a manual-refresh-only
 * v1; tune later if Traqo's actual plan limits turn out to allow more.
 *
 * Unaffected by multi-account routing: this throttle is per-container, keyed
 * off ContainerTracking.lastFetchedAt, regardless of which Traqo account the
 * container is assigned to. Account-level API rate limiting (429) is a
 * separate, account-scoped concern handled by TraqoAccountAllocationService.
 */
const MIN_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const TRACKING_EVENTS_ORDER = { occurredAt: 'asc' as const };

const HTTP_STATUS_BY_KIND: Record<TrackingErrorKind, HttpStatus> = {
  missing_api_key: HttpStatus.SERVICE_UNAVAILABLE,
  unauthorized: HttpStatus.BAD_GATEWAY,
  forbidden: HttpStatus.BAD_GATEWAY,
  not_found: HttpStatus.NOT_FOUND,
  payment_required: HttpStatus.SERVICE_UNAVAILABLE,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  upstream_error: HttpStatus.BAD_GATEWAY,
  invalid_response: HttpStatus.BAD_GATEWAY,
  network_error: HttpStatus.BAD_GATEWAY,
  bad_request: HttpStatus.BAD_REQUEST,
};

/**
 * Business-friendly messages for each provider failure kind. Never derived
 * from the provider's raw response — these are our own fixed copy.
 */
function publicMessage(e: TrackingProviderError): string {
  switch (e.kind) {
    case 'missing_api_key':
      return 'Tracking is not configured on this server.';
    case 'unauthorized':
      return 'Tracking authentication failed. Please check the Traqo API configuration.';
    case 'forbidden':
      return 'Traqo developer access is not enabled.';
    case 'not_found':
      return 'No tracking information was found for this container.';
    case 'payment_required':
      return 'Traqo tracking limit has been reached.';
    case 'rate_limited':
      return 'Tracking service rate limit reached. Please try again later.';
    case 'upstream_error':
      return "Traqo's tracking provider is temporarily unavailable.";
    case 'bad_request':
      return "This container's number or carrier isn't recognized by the tracking provider. Please check them and try again.";
    case 'invalid_response':
    case 'network_error':
    default:
      return 'Tracking is temporarily unavailable. Please try again later.';
  }
}

function toHttpException(e: TrackingProviderError): HttpException {
  return new HttpException(
    {
      error: publicMessage(e),
      code: `TRACKING_${e.kind.toUpperCase()}`,
      ...(e.retryAfterSeconds ? { details: { retryAfterSeconds: e.retryAfterSeconds } } : {}),
    },
    HTTP_STATUS_BY_KIND[e.kind] ?? HttpStatus.BAD_GATEWAY,
  );
}

/**
 * Outcome of one refresh attempt, returned by attemptRefresh() instead of
 * thrown — see that method's doc comment for why. `tracking` on 'success' is
 * intentionally untyped here (matches the Prisma include shape returned by
 * the persistence transaction); callers that need it typed narrow on
 * `outcome === 'success'`.
 */
export type RefreshOutcome =
  | { outcome: 'success'; tracking: Awaited<ReturnType<ContainerTrackingService['persistSuccess']>> }
  | { outcome: 'not_found' }
  | { outcome: 'no_sealine' }
  | { outcome: 'throttled'; retryAfterSeconds: number }
  | { outcome: 'ended' }
  | { outcome: 'no_slot' }
  | { outcome: 'provider_error'; error: TrackingProviderError };

@Injectable()
export class ContainerTrackingService {
  private readonly logger = new Logger(ContainerTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACKING_PROVIDER) private readonly provider: ContainerTrackingProvider,
    private readonly allocation: TraqoAccountAllocationService,
    private readonly keyResolver: TraqoKeyResolver,
    private readonly notifications: ContainerNotificationService,
  ) {}

  private async requireContainer(containerId: string) {
    const container = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!container) {
      throw new NotFoundException({ error: 'Container not found', code: 'NOT_FOUND' });
    }
    return container;
  }

  /** Read the last stored tracking snapshot — never calls the provider. */
  async getTracking(containerId: string) {
    await this.requireContainer(containerId);
    return this.prisma.containerTracking.findUnique({
      where: { containerId },
      include: { events: { orderBy: TRACKING_EVENTS_ORDER } },
    });
  }

  /**
   * Carrier lookup is account-agnostic reference data (not tied to any one
   * container's assignment), so it just uses whichever eligible account
   * sorts first by priority rather than going through the allocator.
   */
  async listCarriers(search?: string): Promise<CarrierOption[]> {
    const account = await this.prisma.traqoAccount.findFirst({
      where: { active: true },
      orderBy: { priority: 'asc' },
    });
    const apiKey = account ? this.keyResolver.resolve(account.envKeyName) : undefined;
    try {
      return await this.provider.listCarriers(
        { apiKey: apiKey ?? '', baseUrl: account?.baseUrl ?? undefined },
        search,
      );
    } catch (e) {
      if (e instanceof TrackingProviderError) throw toHttpException(e);
      throw e;
    }
  }

  /**
   * Manual refresh (HTTP-facing): thin wrapper around attemptRefresh() that
   * translates its non-throwing RefreshOutcome back into the exact
   * exceptions/status codes/messages this endpoint has always thrown. Every
   * existing caller (ContainersController, the frontend, the existing test
   * suite) keeps behaving identically — this method's own logic never
   * changed, it just moved into attemptRefresh() so the scheduler
   * (ContainerTrackingScheduler) can drive the same refresh without
   * triggering an HTTP exception for an expected "already refreshed
   * recently" condition in the middle of a batch run.
   */
  async refreshTracking(containerId: string) {
    const result = await this.attemptRefresh(containerId);
    switch (result.outcome) {
      case 'success':
        return result.tracking;
      case 'not_found':
        throw new NotFoundException({ error: 'Container not found', code: 'NOT_FOUND' });
      case 'no_sealine':
        throw new BadRequestException({
          error: 'Select a carrier for this container before refreshing tracking.',
          code: 'SEALINE_REQUIRED',
        });
      case 'throttled':
        throw new HttpException(
          {
            error: `Tracking was refreshed recently. Please wait ${Math.ceil(result.retryAfterSeconds / 60)} more minute(s) before refreshing again.`,
            code: 'REFRESH_TOO_SOON',
            details: { retryAfterSeconds: result.retryAfterSeconds },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'ended':
        throw new HttpException(
          { error: 'Traqo tracking has ended for this shipment.', code: 'TRACKING_ENDED' },
          HttpStatus.CONFLICT,
        );
      case 'no_slot':
        throw new HttpException(
          { error: 'No Traqo tracking slot available.', code: 'NO_TRACKING_SLOT_AVAILABLE' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      case 'provider_error':
        throw toHttpException(result.error);
    }
  }

  /**
   * Core refresh logic — identical behavior to what refreshTracking() used
   * to do inline, just returning a RefreshOutcome instead of throwing for
   * every non-success case. This is what makes the scheduled batch refresh
   * (ContainerTrackingScheduler) possible without duplicating a single line
   * of Traqo/allocation/persistence logic: it calls this exact method per
   * container and switches on the outcome instead of catching exceptions,
   * so a container that was "refreshed too recently" is a normal, silent
   * skip in a batch run rather than a noisy failure — while the HTTP-facing
   * refreshTracking() above still throws for that same case, unchanged.
   *
   * Still the only method that ever calls the Traqo provider — the
   * scheduler never resolves an account, a key, or talks to the provider
   * itself; it only calls this method.
   */
  async attemptRefresh(containerId: string): Promise<RefreshOutcome> {
    const container = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!container) {
      return { outcome: 'not_found' };
    }

    if (!container.sealine) {
      return { outcome: 'no_sealine' };
    }

    const existing = await this.prisma.containerTracking.findUnique({ where: { containerId } });

    if (existing) {
      const elapsedMs = Date.now() - existing.lastFetchedAt.getTime();
      if (elapsedMs < MIN_REFRESH_INTERVAL_MS) {
        const retryAfterSeconds = Math.ceil((MIN_REFRESH_INTERVAL_MS - elapsedMs) / 1000);
        return { outcome: 'throttled', retryAfterSeconds };
      }
    }

    const resolved = await this.prisma.$transaction((tx) => this.allocation.resolveForRefresh(tx, containerId));

    if (resolved.kind === 'ended') {
      return { outcome: 'ended' };
    }
    if (resolved.kind === 'no_slot') {
      return { outcome: 'no_slot' };
    }

    const { account } = resolved;
    const apiKey = this.keyResolver.resolve(account.envKeyName);

    let normalized;
    try {
      normalized = await this.provider.trackContainer(container.number, container.sealine, {
        apiKey: apiKey ?? '',
        baseUrl: account.baseUrl ?? undefined,
      });
    } catch (e) {
      if (e instanceof TrackingProviderError) {
        if (existing) {
          await this.prisma.containerTracking.update({
            where: { containerId },
            data: { lastError: publicMessage(e) },
          });
        }
        if (e.kind === 'unauthorized') {
          await this.allocation.recordFailure(account.id, 'unauthorized');
        } else if (e.kind === 'rate_limited') {
          await this.allocation.recordFailure(account.id, 'rate_limited', e.retryAfterSeconds);
        } else if (e.kind === 'payment_required') {
          await this.allocation.recordFailure(account.id, 'payment_required');
        }
        // Every other kind (network_error, invalid_response, upstream_error,
        // not_found, bad_request, forbidden) is a per-request/per-container
        // problem, not evidence the ACCOUNT is unusable — the assignment and
        // account health are deliberately left untouched.
        return { outcome: 'provider_error', error: e };
      }
      throw e;
    }

    await this.allocation.recordSuccess(account);
    const tracking = await this.persistSuccess(containerId, normalized, {
      hadExistingRow: existing !== null,
      previousEta: existing?.eta ?? null,
    });

    // Notification delivery (Phase C) is intentionally OUTSIDE
    // persistSuccess()'s transaction and wrapped so it can never affect the
    // outcome returned here — tracking persistence already committed by
    // this point regardless of what happens next. Covers both callers of
    // attemptRefresh() (the manual endpoint and the hourly scheduler)
    // uniformly, with no duplicated logic in either.
    try {
      await this.notifications.notifyEtaChangeIfNeeded(tracking);
    } catch (e) {
      this.logger.error(
        `Notification dispatch failed for container ${containerId} — tracking refresh itself already succeeded and is unaffected.`,
        e instanceof Error ? e.stack : String(e),
      );
    }

    return { outcome: 'success', tracking };
  }

  /**
   * Persists a successful normalized response. Not `private`: RefreshOutcome
   * (above) derives its `tracking` field's type from this method's return
   * type via indexed access, which TypeScript only permits for non-private
   * members. Still only ever called from attemptRefresh() above — nothing
   * external calls it.
   *
   * `previousState` is what attemptRefresh() already read as `existing`
   * BEFORE calling the provider — passed through rather than re-read here so
   * this stays a single extra field on an object already fetched for the
   * 15-minute throttle check, not a second query. This method only ever
   * runs on the success path (see attemptRefresh()), which is exactly what
   * guarantees a failed/throttled/skipped refresh can never create or alter
   * any ETA-change state — there is no code path into this method other
   * than a successful provider response.
   *
   * ETA-change detection (Phase B — mobile tracking project): classifies how
   * `eta` moved (see classifyEtaChange()) and, for the two notification-
   * worthy classifications only, stamps etaChangedAt. `previousEta` is
   * captured on every successful refresh regardless of classification, so a
   * future notification can render "previous ETA → new ETA" even after
   * `eta` itself has already been overwritten. etaChangeNotifiedAt is never
   * written here — it's reserved for Phase C.
   */
  async persistSuccess(
    containerId: string,
    normalized: Awaited<ReturnType<ContainerTrackingProvider['trackContainer']>>,
    previousState: { hadExistingRow: boolean; previousEta: Date | null },
  ) {
    const classification = classifyEtaChange(previousState.hadExistingRow, previousState.previousEta, normalized.eta);

    const sharedFields = {
      provider: normalized.provider,
      referenceNumber: normalized.referenceNumber,
      sealine: normalized.sealine,
      sealineName: normalized.sealineName,
      status: normalized.status,
      origin: normalized.origin,
      destination: normalized.destination,
      vessel: normalized.vessel,
      voyage: normalized.voyage,
      currentLocation: normalized.currentLocation,
      eta: normalized.eta,
      isDelayed: normalized.isDelayed,
      shipmentUid: normalized.shipmentUid,
      shipmentPublicUrl: normalized.shipmentPublicUrl,
      traqoShipmentName: normalized.traqoShipmentName,
      isActive: normalized.isActive,
      closedAt: normalized.closedAt,
      providerUpdatedAt: normalized.providerUpdatedAt,
      lastFetchedAt: new Date(),
      lastError: null,
      rawResponse: normalized.raw as Prisma.InputJsonValue,
      previousEta: previousState.previousEta,
    };
    // Only set on an actual notification-worthy change — omitted (not even
    // `null`) otherwise, so Prisma leaves the column exactly as it was. This
    // is what makes a repeated identical ETA across many hourly refreshes
    // idempotent: etaChangedAt only ever moves forward when eta genuinely
    // becomes-known or changes, never on a refresh that reconfirms it.
    const etaChangeFields = isNotifiableEtaChange(classification) ? { etaChangedAt: new Date() } : {};

    return this.prisma.$transaction(async (tx) => {
      const tracking = await tx.containerTracking.upsert({
        where: { containerId },
        create: { containerId, ...sharedFields, ...etaChangeFields },
        update: { ...sharedFields, ...etaChangeFields },
      });

      // Traqo returns the full timeline each call, not deltas — replace in full.
      await tx.trackingEvent.deleteMany({ where: { trackingId: tracking.id } });
      if (normalized.events.length > 0) {
        await tx.trackingEvent.createMany({
          data: normalized.events.map((event) => ({
            trackingId: tracking.id,
            description: event.description,
            location: event.location,
            occurredAt: event.occurredAt,
            raw: (event.raw ?? null) as Prisma.InputJsonValue,
          })),
        });
      }

      // The confirmed Traqo-side removal signal (never Container.status).
      if (normalized.isActive === false || normalized.closedAt !== null) {
        await this.allocation.releaseAsTraqoRemoved(tx, containerId);
      }

      return tx.containerTracking.findUniqueOrThrow({
        where: { id: tracking.id },
        include: { events: { orderBy: TRACKING_EVENTS_ORDER } },
      });
    });
  }
}
