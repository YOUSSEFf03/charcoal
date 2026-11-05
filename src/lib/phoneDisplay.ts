/**
 * Phone for display: keeps digits, "+", spaces, "-", "(" and ")" only, so a
 * stray character typed into the stored number (e.g. a backtick) never
 * prints. Display only — the stored value is untouched. "" when nothing is left.
 */
export function cleanPhoneForDisplay(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^\d+\-() ]/g, '').replace(/\s+/g, ' ').trim()
}

/** First active phone of a client, cleaned for display; "" when there is none. */
export function primaryPhoneForDisplay(
  phones: ReadonlyArray<{ number: string; isActive?: boolean }> | null | undefined,
): string {
  for (const p of phones ?? []) {
    if (p.isActive === false) continue
    const cleaned = cleanPhoneForDisplay(p.number)
    if (cleaned) return cleaned
  }
  return ''
}
