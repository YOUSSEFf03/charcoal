/**
 * Pure ETA-change classification — no I/O, no Prisma, no Date.now(). Used by
 * ContainerTrackingService.persistSuccess() to decide, on every successful
 * refresh, whether the ETA move that just happened is a notification-worthy
 * "change" (Phase C will consume this later) or something else that must NOT
 * be treated as one. Extracted to its own file so the six required Phase B
 * scenarios can be unit-tested directly, without needing Prisma/provider
 * mocks — mirrors how traqo-response.normalizer.ts is a standalone pure
 * function next to the service that calls it.
 *
 * Deliberately a real Date comparison (`.getTime()`), never string
 * formatting — two Date objects representing the same instant can otherwise
 * serialize differently (timezone, precision), which would either miss a
 * real change or manufacture a fake one.
 */
export type EtaChangeClassification =
  /** No existing ContainerTracking row at all — first-ever refresh. Never a "change": there was nothing to change from. */
  | 'initial'
  /** Existing eta and new eta are the same instant (or both null) — the ordinary "hourly refresh returned the same ETA" case. */
  | 'no_change'
  /** Existing row had eta = null, and this refresh resolved a real ETA for the first time. Notification-worthy. */
  | 'became_known'
  /** Existing row had a real eta, and this refresh resolved a DIFFERENT real eta. Notification-worthy. */
  | 'changed'
  /**
   * Existing row had a real eta, and this refresh's normalized response has
   * eta = null — the ETA became unavailable/unresolvable. Deliberately its
   * own category, NOT folded into 'changed': the existing notification
   * design (Phase 1 audit) only knows how to render a "previous ETA → new
   * ETA" message between two dates, and there is no confirmed business
   * requirement that "we lost the ETA" should produce that same kind of
   * alert. Phase B intentionally does not decide this — see
   * ContainerTrackingService.persistSuccess(), which only sets
   * etaChangedAt for 'became_known' | 'changed', never for this case.
   */
  | 'became_unavailable';

/** True exactly for the two classifications Phase C should treat as a notification-worthy ETA change. */
export function isNotifiableEtaChange(classification: EtaChangeClassification): boolean {
  return classification === 'became_known' || classification === 'changed';
}

/**
 * @param hadExistingRow Whether a ContainerTracking row already existed for
 *   this container before this refresh (independent of whether its `eta`
 *   was itself null — see 'became_known' vs 'initial').
 * @param previousEta The existing row's `eta` before this refresh (null if
 *   `hadExistingRow` is false, or if the row existed but its eta was null).
 * @param newEta The freshly normalized eta from this refresh's provider response.
 */
export function classifyEtaChange(
  hadExistingRow: boolean,
  previousEta: Date | null,
  newEta: Date | null,
): EtaChangeClassification {
  if (!hadExistingRow) return 'initial';
  if (previousEta === null && newEta === null) return 'no_change';
  if (previousEta === null && newEta !== null) return 'became_known';
  if (previousEta !== null && newEta === null) return 'became_unavailable';
  return previousEta.getTime() === (newEta as Date).getTime() ? 'no_change' : 'changed';
}
