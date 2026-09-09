/**
 * "YYYY-MM-DD" for a Date using its LOCAL calendar-day parts (getFullYear/
 * getMonth/getDate) — never toISOString(), which converts to UTC first and
 * can silently roll back a day for a timezone ahead of UTC (e.g. Beirut,
 * UTC+3) shortly after local midnight. Use this anywhere a date-only
 * `dateFrom`/`dateTo` string is built from `new Date()` on the frontend.
 */
export function toDateOnlyString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Current calendar month, local time — "first of this month" through
 * "today", both as "YYYY-MM-DD". The shared default P&L period for
 * Dashboard and Reports, so both pages open on the same numbers instead of
 * one being dynamic and the other hardcoded to a stale range. Both bounds
 * are derived from the same local-getter basis (via toDateOnlyString), so
 * dateFrom and dateTo can never disagree on which calendar day "today" is.
 */
export function currentMonthToDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date()
  return {
    dateFrom: toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: toDateOnlyString(now),
  }
}

/**
 * Current calendar week, local time — "most recent Sunday" through "today",
 * both as "YYYY-MM-DD". Sunday-start matches the existing week convention
 * already used for the "This week" KPI on WarehouseSales.tsx
 * (`d.setDate(d.getDate() - d.getDay())`); this just pairs that same
 * boundary math with toDateOnlyString() instead of toISOString(), so it
 * doesn't inherit that call site's UTC-rollback risk after local midnight.
 */
export function currentWeekToDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  return {
    dateFrom: toDateOnlyString(startOfWeek),
    dateTo: toDateOnlyString(now),
  }
}

/**
 * Format an ISO date string as "3 Aug 2026" (en-GB — day-month-year, the
 * convention used throughout the app and regionally correct for a
 * Lebanon-based business).
 *
 * @param iso      - ISO date/datetime string, or null/undefined
 * @param opts.day - 'numeric' ("3 Aug 2026") or '2-digit' ("03 Aug 2026"), default 'numeric'
 * @param opts.fallback - text shown for null/undefined/invalid input (default '—')
 */
export function formatDate(
  iso?: string | null,
  opts?: { day?: 'numeric' | '2-digit'; fallback?: string },
): string {
  if (!iso) return opts?.fallback ?? '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return opts?.fallback ?? '—'
  return d.toLocaleDateString('en-GB', { day: opts?.day ?? 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Like formatDate, but appends a time-of-day — unless the record is a
 * date-only value persisted at midnight UTC (e.g. warehouse-sale invoices,
 * payments), in which case rendering it in local time would produce a
 * fixed, misleading offset (e.g. 03:00 in Beirut/UTC+3) repeated across
 * unrelated rows, so it falls back to a bare date instead.
 */
export function formatDateTime(
  iso?: string | null,
  opts?: { day?: 'numeric' | '2-digit'; fallback?: string },
): string {
  if (!iso) return opts?.fallback ?? '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return opts?.fallback ?? '—'
  const isDateOnly =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  if (isDateOnly) return formatDate(iso, opts)
  const datePart = formatDate(iso, opts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${datePart} ${h}:${m}`
}

/**
 * Whole calendar days from "now" (local time) to an ISO date/datetime,
 * comparing LOCAL calendar dates only — never raw millisecond subtraction
 * (`new Date(a).getTime() - new Date(b).getTime()`) and never
 * `.toISOString().slice(0,10)`, both of which can misreport the day count
 * across a UTC-ahead timezone's local midnight (e.g. Beirut, UTC+3) the same
 * way toDateOnlyString() above was written to avoid. Both the ETA and "now"
 * are reduced to a LOCAL midnight Date via the same getFullYear/getMonth/
 * getDate constructor pattern before subtracting, so the result reflects the
 * calendar-day gap a person would actually count, and Math.round (not
 * Math.floor) absorbs the odd 23h/25h day a DST transition can produce
 * between two local-midnight instants.
 *
 * @returns positive = days in the future, 0 = today, negative = days in the
 *          past (overdue), or null if `iso` is missing/invalid.
 */
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((targetMidnight.getTime() - todayMidnight.getTime()) / msPerDay)
}

/**
 * Business-friendly ETA countdown label from an ISO date/datetime, built on
 * daysUntil() above. Never shows a negative number (e.g. "-3 days") — past
 * ETAs read as "N day(s) overdue" instead. Never fabricates a value: a
 * missing/invalid ETA reads as "ETA unavailable", not a guessed date.
 */
export function formatEtaCountdown(iso?: string | null): string {
  const days = daysUntil(iso)
  if (days === null) return 'ETA unavailable'
  if (days === 0) return 'Arrives today'
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} to arrival`
  const overdue = Math.abs(days)
  return `${overdue} day${overdue === 1 ? '' : 's'} overdue`
}
