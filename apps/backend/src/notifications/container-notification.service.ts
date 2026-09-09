import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, PushMessage, PushProvider } from './push.provider';
import { DeviceRegistryService } from './device-registry.service';

/**
 * Business timezone used for any date shown to a human — same value as
 * reports.service.ts's BUSINESS_TIMEZONE constant (not imported from there:
 * that constant isn't exported, and duplicating one literal timezone string
 * is far cheaper than exporting cross-module coupling for it). Keep these
 * two in sync if the business ever changes timezone.
 */
const BUSINESS_TIMEZONE = 'Asia/Beirut';

function formatEtaForNotification(eta: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(eta);
}

/** The minimal shape ContainerTrackingService.attemptRefresh() already has in hand after a successful persist — see that method's call site. */
export interface EtaChangeCheckInput {
  id: string;
  containerId: string;
  eta: Date | null;
  etaChangedAt: Date | null;
  etaChangeNotifiedAt: Date | null;
}

/**
 * Decides whether a container-tracking event is notification-worthy and, if
 * so, sends it — the only place in the backend that turns a persisted
 * tracking/container state change into an actual push notification.
 *
 * Idempotency for BOTH event kinds uses the same shape: an atomic
 * compare-and-set UPDATE that only ever "succeeds" (count === 1) for the
 * single caller that is first to observe a given not-yet-notified state.
 * This is what makes the flow safe under the failure modes the task calls
 * out explicitly:
 *   - mark-then-send-then-fails: NOT possible here — the compare-and-set
 *     IS the "mark," and it happens BEFORE the send call, so if the process
 *     crashes between marking and sending, the notification is lost exactly
 *     once (no state corruption, no retry-generated duplicate) — see the
 *     class-level "at-most-once" note below for why this is the accepted
 *     tradeoff, not a bug.
 *   - send-then-crash-before-persisting: NOT possible here either, for the
 *     same reason — the persist happens first.
 *   - two concurrent refreshes/requests observing the same event: only one
 *     UPDATE can match a `WHERE ... IS NULL` (or `< matchedValue`)
 *     predicate and actually change a row; Postgres guarantees that
 *     atomically per-row, so exactly one caller proceeds to send.
 *
 * Delivery itself is best-effort / at-most-once, not exactly-once: once this
 * service has claimed the event (the compare-and-set succeeded), a push
 * provider failure or a crash before the HTTP call completes means the
 * notification is not retried — true exactly-once push delivery is not
 * achievable with a fire-and-forget HTTP provider like Expo's without a
 * durable outbox/retry-queue, which is exactly the "unnecessary queue
 * infrastructure" this phase was told not to add. This is documented here
 * explicitly per the task's own instruction to do so when exactly-once
 * isn't achievable.
 */
@Injectable()
export class ContainerNotificationService {
  private readonly logger = new Logger(ContainerNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceRegistry: DeviceRegistryService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  private async sendToActiveDevices(message: PushMessage): Promise<void> {
    const tokens = await this.deviceRegistry.findActiveTokens();
    if (tokens.length === 0) return;

    let results;
    try {
      results = await this.push.send(tokens, message);
    } catch (e) {
      // A total request-level failure (see PushProvider's doc comment) —
      // logged and swallowed. The caller (notifyEtaChangeIfNeeded /
      // notifyArrivalIfNeeded) has already committed its idempotency marker
      // by this point; this failure is never allowed to affect tracking or
      // container state.
      this.logger.error('Push provider send failed', e instanceof Error ? e.stack : String(e));
      return;
    }

    const invalidTokens = results.filter((r) => r.invalidToken).map((r) => r.token);
    if (invalidTokens.length > 0) {
      await this.deviceRegistry.deactivateTokens(invalidTokens);
    }
  }

  /**
   * Called after every successful tracking refresh — both the manual
   * endpoint and the hourly scheduler funnel through
   * ContainerTrackingService.attemptRefresh(), which calls this exactly
   * once per successful persist. Never called on a throttled/failed/skipped
   * refresh (attemptRefresh() only reaches its success branch, where this is
   * called, on an actual successful persist — see that method).
   *
   * Fires only for the two Phase B classifications that represent a real
   * ETA change ('became_known' | 'changed' — see eta-change.ts); Phase B
   * already encodes that distinction into whether `etaChangedAt` was
   * stamped, so this method never needs to re-run the classification
   * itself, only compare two timestamps.
   */
  async notifyEtaChangeIfNeeded(tracking: EtaChangeCheckInput): Promise<void> {
    if (!tracking.etaChangedAt) return; // no notification-worthy change this refresh
    if (tracking.etaChangeNotifiedAt && tracking.etaChangeNotifiedAt.getTime() >= tracking.etaChangedAt.getTime()) {
      return; // already notified for this (or a later) change
    }

    // Atomic compare-and-set: only succeeds for a row whose etaChangedAt
    // still equals the value THIS caller observed and whose
    // etaChangeNotifiedAt is still behind it. A concurrent caller (or a
    // still-in-flight duplicate) that loses the race gets count === 0 and
    // does nothing further.
    const claimed = await this.prisma.containerTracking.updateMany({
      where: {
        id: tracking.id,
        etaChangedAt: tracking.etaChangedAt,
        OR: [{ etaChangeNotifiedAt: null }, { etaChangeNotifiedAt: { lt: tracking.etaChangedAt } }],
      },
      data: { etaChangeNotifiedAt: tracking.etaChangedAt },
    });
    if (claimed.count !== 1) return;

    const container = await this.prisma.container.findUnique({
      where: { id: tracking.containerId },
      select: { number: true, supplier: { select: { name: true } } },
    });
    if (!container) return; // container deleted between the refresh and here — nothing to notify about

    const etaText = tracking.eta ? formatEtaForNotification(tracking.eta) : 'unknown';
    await this.sendToActiveDevices({
      title: 'Container ETA Updated',
      body: `${container.number} (${container.supplier.name}) — new ETA ${etaText}`,
      data: { type: 'eta_changed', containerId: tracking.containerId },
    });
  }

  /**
   * Called only from ContainersService.update() immediately after a
   * successful "not arrived -> arrived" transaction — never from tracking
   * refresh, never from Traqo isActive/closedAt. See that call site for why
   * this is the sole, guard-enforced transition point (a second arrival
   * attempt on an already-arrived container throws ALREADY_ARRIVED before
   * ever reaching here, by that method's own pre-existing logic).
   *
   * Still independently idempotent via its own compare-and-set (rather than
   * relying solely on that upstream guard) so a hypothetical future second
   * caller of this method, or the pre-existing lack of row-locking in that
   * transaction under real concurrency, can never double-send.
   */
  async notifyArrivalIfNeeded(containerId: string): Promise<void> {
    const claimed = await this.prisma.container.updateMany({
      where: { id: containerId, status: 'arrived', arrivalNotifiedAt: null },
      data: { arrivalNotifiedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      select: { number: true, supplier: { select: { name: true } } },
    });
    if (!container) return;

    await this.sendToActiveDevices({
      title: 'Container Arrived',
      body: `${container.number} (${container.supplier.name}) has arrived`,
      data: { type: 'arrived', containerId },
    });
  }
}
