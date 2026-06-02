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
