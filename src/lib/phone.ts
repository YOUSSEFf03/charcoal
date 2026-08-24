// Phone-number normalization for WhatsApp deep links (wa.me / Web Share).
//
// Client.phones is a free-text JSON column with no format enforced at write
// time. Real data in this app's DB includes all of: "0312331" (local, no
// country code), "+961 70 000003" (correct international), "+961 03454385"
// (malformed — a redundant leading 0 survives after the 961 country code),
// "+961 3 000002", "+961 1 000001". A naive `.replace(/\D/g, '')` (the
// previous approach, used in both existing wa.me call sites) gets the first
// and third of those wrong: it either omits the country code entirely or
// leaves an extra digit in the middle, opening no chat or the wrong one.
//
// Every phone-entry placeholder across this app ("+961 3 000 000", "+961 XX
// XXX XXX", etc.) assumes Lebanon, so a bare/local number is normalized to
// Lebanon here too. An explicit '+<other country code>' is trusted as-is
// (digits only) rather than overridden — this app has no evidence of
// non-Lebanese clients, but a number a user deliberately typed with a
// different country's '+' prefix should never be silently reinterpreted.

/**
 * Normalize a stored phone number into the digits-only form WhatsApp deep
 * links expect (`https://wa.me/<digits>`, or the `Navigator.share`
 * equivalent). Never throws — returns '' for a number with no digits at all
 * (e.g. empty string), so callers can treat '' as "no usable number".
 */
export function toWhatsAppDigits(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('961')) {
    // Strip a redundant local-format leading 0 that survived after the
    // country code (e.g. "+961 03454385" → "9613454385").
    return '961' + digits.slice(3).replace(/^0+/, '')
  }
  if (trimmed.startsWith('+')) {
    // Explicit non-961 country code — trust it, don't assume Lebanon.
    return digits
  }
  // No country code at all — assume Lebanon (this app's only observed
  // market) and drop the local leading 0 (e.g. "0312331" → "961312331").
  return '961' + digits.replace(/^0+/, '')
}
