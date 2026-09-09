/**
 * Deterministic EN→AR glossary for this business's known charcoal-type
 * terminology — a targeted fix for a real problem found auditing the
 * Delivery Receipt's translation: `ClientOrder.charcoalType` is free text
 * (an owner types it once when receiving a container — see
 * NewContainer.tsx), but LibreTranslate (src/hooks/useTranslation.ts) is
 * unreliable on it specifically. It's a self-hosted general-purpose MT
 * model, not a charcoal-industry glossary, and on short, capitalized,
 * context-free product terms it either passes English through untouched
 * (already caught — see ARABIC_RE in useTranslation.ts) or returns fluent,
 * confident, WRONG Arabic that filter cannot detect because it IS Arabic.
 * Verified live against this app's own docker-compose `libretranslate`
 * service: "Restaurant Grade" — an actual value already used on real orders
 * in this database — translates to "خط الاستراحة" ("rest line"), not a
 * charcoal grade.
 *
 * These four keys are EVERY distinct charcoalType value that exists in this
 * database today, confirmed via `SELECT "charcoalType", COUNT(*) FROM
 * client_orders GROUP BY "charcoalType"` (2026-08-28): "BBQ Hardwood"/"BBQ
 * hardwood" (20 orders, casing varies), "Shisha Charcoal" (4), "Restaurant
 * Grade" (4), "Premium Lumpwood" (4). Nothing else has ever been entered.
 * Deliberately NOT a general charcoal-species dictionary (no "oak",
 * "quebracho", "acacia", etc. — those aren't in use and would be exactly
 * the "large arbitrary dictionary" this is meant to avoid).
 *
 * IMPORTANT — values are intentionally `null` right now. An earlier version
 * of this file filled them in with developer-authored Arabic phrasing; that
 * was correctly rejected — those phrases were not sourced from any existing
 * business data (unlike Client.nameAr, which is real user-entered data) and
 * were never verified by a native Arabic speaker. Per product decision,
 * verified wording for these four terms will be supplied separately and
 * dropped in below. Until then: a `null` value means "this term is known,
 * and deliberately has no Arabic yet" — the receipt shows the English
 * description only for it and does NOT fall back to LibreTranslate (a known
 * term with no verified translation is not the same case as an unknown
 * term, which still goes through LibreTranslate as before — see
 * lookupCharcoalTypeAr()'s doc comment).
 */
const CHARCOAL_TYPE_AR: Record<string, string | null> = {
  'bbq hardwood': null, // pending verified Arabic wording
  'shisha charcoal': null, // pending verified Arabic wording
  'restaurant grade': null, // pending verified Arabic wording
  'premium lumpwood': null, // pending verified Arabic wording
}

export interface CharcoalTypeLookup {
  /** True if `charcoalType` is one of this business's four known terms (regardless of whether Arabic wording exists for it yet). */
  isKnown: boolean
  /** Verified Arabic wording, or null if `isKnown` is true but no verified wording has been supplied yet. Always null when `isKnown` is false. */
  ar: string | null
}

/**
 * Case/whitespace-insensitive lookup — "BBQ Hardwood" and "BBQ hardwood"
 * (both real values in this database) resolve to the same entry.
 *
 * Three possible outcomes for the caller (DeliveryReceiptPrint.tsx):
 *   - `{ isKnown: false }`            → not one of the four known terms;
 *     fall back to useArabicTranslations() (LibreTranslate), unchanged.
 *   - `{ isKnown: true, ar: null }`   → known term, verified wording not
 *     supplied yet; show the English description only. Do NOT call
 *     LibreTranslate — this is deliberately not the same as the "unknown
 *     term" case above.
 *   - `{ isKnown: true, ar: '...' }`  → known term with verified wording;
 *     use it directly, no network call.
 */
export function lookupCharcoalTypeAr(charcoalType: string): CharcoalTypeLookup {
  const key = charcoalType.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(CHARCOAL_TYPE_AR, key)) {
    return { isKnown: true, ar: CHARCOAL_TYPE_AR[key] }
  }
  return { isKnown: false, ar: null }
}
