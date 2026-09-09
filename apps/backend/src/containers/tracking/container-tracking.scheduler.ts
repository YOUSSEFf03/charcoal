import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ContainerTrackingService } from './container-tracking.service';

/**
 * Delay between consecutive Traqo calls within one scheduled run. There are
 * at most 12 actively-tracked containers (3 Traqo accounts × 4 max each —
 * see TraqoAccountAllocationService), so firing all of them back-to-back
 * with zero spacing is a real possibility every hour. Traqo's own documented
 * failure mode for going too fast is a 429 (already handled per-account by
 * TraqoAccountAllocationService.recordFailure), but nothing in the existing
 * manual-refresh path proactively paces requests — it only reacts after the
 * fact. A scheduled batch, unlike a single user click, predictably produces
 * a burst, so this job stays conservative and spaces calls out. Not a class
 * constant so tests can drop it to 0 without waiting in real time.
 */
const DEFAULT_INTER_REFRESH_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SchedulerRunSummary {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

/**
 * Drives the hourly automatic tracking refresh. Deliberately thin: every
 * piece of Traqo/account/persistence logic lives in ContainerTrackingService
 * (via attemptRefresh()) — this class only decides WHICH containers to
 * refresh (active ContainerTrackingAssignment rows — the same authoritative
 * set the allocation system already caps at 12) and WHEN/HOW to iterate them
 * (sequentially, with a small delay, isolating one container's failure from
 * the rest). It never resolves a Traqo account, a key, or calls the provider
 * itself.
 */
@Injectable()
export class ContainerTrackingScheduler {
  private readonly logger = new Logger(ContainerTrackingScheduler.name);

  /** See DEFAULT_INTER_REFRESH_DELAY_MS doc comment. Not `readonly` so tests can zero it out. */
  private interRefreshDelayMs = DEFAULT_INTER_REFRESH_DELAY_MS;

  /**
   * Process-local reentrancy guard only — prevents two overlapping runs
   * within this one Node process (e.g. if a run somehow took over an hour).
   * This is NOT a distributed lock: if this service is ever deployed across
   * multiple instances, EACH instance will run its own @Cron independently
   * and this flag will not coordinate between them. That would need a
   * database-level lock (this codebase already has a precedent for exactly
   * that shape — TraqoAccountAllocationService's `SELECT ... FOR UPDATE` row
   * lock) added at that time. Deliberately not built now: the app runs as a
   * single Railway instance today, and adding cross-instance coordination
   * for a hazard that cannot currently occur would be premature.
   */
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingService: ContainerTrackingService,
  ) {}

  /**
   * Once at the top of every hour. No startup/boot-time refresh is
   * performed — the simplest behavior that satisfies "approximately every
   * hour" for Phase A; nothing in the current requirements calls for a
   * refresh sooner than the first natural hour boundary after deploy.
   */
  @Cron('0 * * * *', { name: 'container-tracking-hourly-refresh' })
  async handleHourlyRefresh(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Hourly tracking refresh skipped — a previous run is still in progress.');
      return;
    }
    this.isRunning = true;
    try {
      await this.runOnce();
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * The actual batch logic, separated from the @Cron-decorated handler so
   * tests can invoke exactly one run directly without mocking the cron
   * trigger or waiting for a real hour boundary.
   */
  async runOnce(): Promise<SchedulerRunSummary> {
    this.logger.log('Hourly container tracking refresh started.');

    // The authoritative set of containers currently under Traqo tracking —
    // NOT every Container row. releasedAt IS NULL is exactly what
    // TraqoAccountAllocationService treats as "active" everywhere else (see
    // resolveForRefresh/allocate), capped at 12 by construction (3 accounts
    // × maxContainers 4).
    const assignments = await this.prisma.containerTrackingAssignment.findMany({
      where: { releasedAt: null },
      select: { containerId: true },
    });

    this.logger.log(`Found ${assignments.length} active tracking assignment(s) to process.`);

    const summary: SchedulerRunSummary = { total: assignments.length, succeeded: 0, skipped: 0, failed: 0 };

    for (let i = 0; i < assignments.length; i++) {
      const { containerId } = assignments[i];

      try {
        // The only call into tracking logic — everything else (account
        // resolution, key lookup, the Traqo HTTP call, normalization,
        // persistence) happens inside this single existing method, exactly
        // as it does for a manual refresh.
        const result = await this.trackingService.attemptRefresh(containerId);

        switch (result.outcome) {
          case 'success':
            summary.succeeded++;
            this.logger.log(`Container ${containerId}: refreshed successfully.`);
            break;
          case 'throttled':
            summary.skipped++;
            this.logger.log(
              `Container ${containerId}: skipped — refreshed too recently (retry in ~${Math.ceil(result.retryAfterSeconds / 60)}m).`,
            );
            break;
          case 'no_slot':
            summary.skipped++;
            this.logger.log(`Container ${containerId}: skipped — no Traqo account slot currently available.`);
            break;
          case 'ended':
            summary.skipped++;
            this.logger.log(`Container ${containerId}: skipped — Traqo tracking already ended for this shipment.`);
            break;
          case 'no_sealine':
            // Shouldn't happen for an active assignment (sealine is required
            // before one can ever be created) — logged loudly if it ever does.
            summary.skipped++;
            this.logger.warn(`Container ${containerId}: skipped — no carrier (sealine) set.`);
            break;
          case 'not_found':
            // Shouldn't happen — ContainerTrackingAssignment.containerId is
            // an onDelete: Restrict FK, so the container can't disappear
            // while an active assignment references it. Logged loudly if it
            // ever does.
            summary.skipped++;
            this.logger.warn(`Container ${containerId}: skipped — container record no longer exists.`);
            break;
          case 'provider_error':
            summary.failed++;
            // Never log the provider's raw response/body — only our own
            // typed failure kind, same discipline ContainerTrackingService
            // already applies to the manual-refresh path.
            this.logger.warn(`Container ${containerId}: refresh failed (${result.error.kind}).`);
            break;
        }
      } catch (e) {
        // Anything unexpected (a bug, a DB hiccup unrelated to Traqo, etc.)
        // — never let one container's failure stop the batch.
        summary.failed++;
        this.logger.error(
          `Container ${containerId}: unexpected error during scheduled refresh.`,
          e instanceof Error ? e.stack : String(e),
        );
      }

      if (i < assignments.length - 1 && this.interRefreshDelayMs > 0) {
        await sleep(this.interRefreshDelayMs);
      }
    }

    this.logger.log(
      `Hourly container tracking refresh completed — ${summary.succeeded} succeeded, ${summary.skipped} skipped, ${summary.failed} failed (of ${summary.total}).`,
    );

    return summary;
  }
}
