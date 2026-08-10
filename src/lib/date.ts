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
