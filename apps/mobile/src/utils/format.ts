/**
 * Date/ETA formatting, deliberately reimplemented here rather than imported
 * from the web app's `src/lib/date.ts` — this app has no dependency on the
 * web package (separate deployable, separate runtime, React Native has no
 * `Intl.DateTimeFormat` locale data guarantee identical to a browser's), but
 * the wording and thresholds below are copied verbatim from that file so the
 * two apps read identically to the one person who uses both.
 */

export function formatDate(iso?: string | null, fallback = '—'): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso?: string | null, fallback = '—'): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const isDateOnly =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (isDateOnly) return formatDate(iso, fallback);
  const datePart = formatDate(iso, fallback);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${datePart} ${h}:${m}`;
}

/** Whole calendar days from "now" (local time) to an ISO date/datetime. */
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((targetMidnight.getTime() - todayMidnight.getTime()) / msPerDay);
}

/**
 * Business-friendly ETA countdown label, matching the web app's wording
 * exactly ("N day(s) to arrival" / "Arrives today" / "N day(s) overdue" /
 * "ETA unavailable"). Never shows a negative number.
 */
export function formatEtaCountdown(iso?: string | null): string {
  const days = daysUntil(iso);
  if (days === null) return 'ETA unavailable';
  if (days === 0) return 'Arrives today';
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} to arrival`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
}

/** Color cue for the ETA countdown text — overdue reads red, imminent reads amber. */
export function etaCountdownColor(iso?: string | null): 'overdue' | 'soon' | 'normal' | 'unknown' {
  const days = daysUntil(iso);
  if (days === null) return 'unknown';
  if (days < 0) return 'overdue';
  if (days <= 3) return 'soon';
  return 'normal';
}

/**
 * Rough 0..1 position along the shipping-lane progress bar, derived only
 * from the ETA countdown — Traqo never gives us an actual "% of voyage
 * complete" field, or a departure date to measure elapsed time against. This
 * is a visual cue, not a precise metric: closer to 1 as the ETA nears,
 * clamped so the marker never sits exactly at either end of the bar.
 */
export function estimateLaneProgress(iso?: string | null): number {
  const days = daysUntil(iso);
  if (days === null) return 0.5;
  const ASSUMED_MAX_TRANSIT_DAYS = 35;
  const progress = 1 - days / ASSUMED_MAX_TRANSIT_DAYS;
  return Math.min(0.95, Math.max(0.05, progress));
}
