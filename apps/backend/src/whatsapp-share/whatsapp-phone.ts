/**
 * Server-side WhatsApp phone normalization + validation.
 *
 * Mirrors the frontend's `toWhatsAppDigits()` (src/lib/phone.ts) exactly, so
 * the number the backend approves is the same one the browser would dial:
 *   - "+961 03454385" → "9613454385" (redundant local 0 after 961 dropped)
 *   - "0312331"        → "961312331"  (no country code → Lebanon assumed)
 *   - "+33 6 12 34 56 78" → "33612345678" (explicit foreign code trusted)
 *
 * On top of that it VALIDATES the result (the frontend only normalizes):
 *   - 8–15 digits total (E.164 max is 15);
 *   - a Lebanese (961) number must have a 7–8 digit national part.
 */

export type PhoneValidation =
  | { ok: true; digits: string }
  | { ok: false; reason: 'EMPTY' | 'BAD_CHARACTERS' | 'BAD_LENGTH' };

/** Characters a human-typed phone number may legitimately contain. */
const ALLOWED_CHARS = /^[+\d\s().\-/]+$/;

export function toWhatsAppDigits(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('961')) return '961' + digits.slice(3).replace(/^0+/, '');
  if (trimmed.startsWith('+')) return digits;
  return '961' + digits.replace(/^0+/, '');
}

export function validateWhatsAppPhone(raw: string | null | undefined): PhoneValidation {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'EMPTY' };
  if (!ALLOWED_CHARS.test(trimmed)) return { ok: false, reason: 'BAD_CHARACTERS' };
  const digits = toWhatsAppDigits(trimmed);
  if (!digits) return { ok: false, reason: 'EMPTY' };
  if (digits.length < 8 || digits.length > 15) return { ok: false, reason: 'BAD_LENGTH' };
  if (digits.startsWith('961')) {
    const national = digits.length - 3;
    if (national < 7 || national > 8) return { ok: false, reason: 'BAD_LENGTH' };
  }
  return { ok: true, digits };
}
