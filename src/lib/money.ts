/**
 * Round a number to the given decimal places using the multiply-round-divide
 * technique, which eliminates IEEE 754 accumulation drift for money/quantity.
 *
 * Examples of drift that this prevents:
 *   0.1 + 0.2                      → 0.30000000000000004
 *   roundDp(0.1 + 0.2)             → 0.30
 *   1234.56 / 89550                → 0.013789...  (LBP → USD quotient)
 *   roundDp(1234.56 / 89550)       → 0.01         (rounded to cents)
 *
 * @param n  - Value to round
 * @param dp - Decimal places: 2 for currency (cents), 3 for kg (millicents)
 */
export function roundDp(n: number, dp = 2): number {
  const factor = Math.pow(10, dp)
  return Math.round(n * factor) / factor
}

/**
 * Format a money value as a sign-aware, comma-grouped USD string.
 * Accepts a Decimal-string (as returned by the API), a plain number, or
 * null/undefined. Negative values render as "-$X", never "$-X".
 *
 * @param value    - Decimal string, number, or null/undefined
 * @param opts.decimals - 0 or 2 decimal places (default 2)
 * @param opts.fallback - text shown for null/undefined/NaN input (default '—')
 * @param opts.symbol   - currency symbol prefix, or false to omit it (default '$')
 */
export function formatUsd(
  value: string | number | null | undefined,
  opts?: { decimals?: 0 | 2; fallback?: string; symbol?: string | false },
): string {
  const n = typeof value === 'number' ? value : value != null ? parseFloat(value) : NaN
  if (!Number.isFinite(n)) return opts?.fallback ?? '—'
  const decimals = opts?.decimals ?? 2
  const symbol = opts?.symbol === false ? '' : opts?.symbol ?? '$'
  const sign = n < 0 ? '-' : ''
  return `${sign}${symbol}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
