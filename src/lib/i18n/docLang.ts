/**
 * Document language selection for printable / exportable documents.
 *
 * There is deliberately NO saved default language: the user chooses every
 * time they print or share. A `?lang=` query param on a print route carries
 * that choice; when absent, each document uses its historical default
 * ('en', or 'bilingual' for the Delivery Receipt) so old links behave as today.
 */

export type DocLang = 'en' | 'ar'
/** The Delivery Receipt additionally supports its side-by-side EN + AR layout. */
export type ReceiptLang = DocLang | 'bilingual'

function isDocLang(v: unknown): v is DocLang {
  return v === 'en' || v === 'ar'
}

/**
 * Read `lang` from a query string ("?lang=ar", "lang=ar", or a URLSearchParams).
 * Returns `fallback` when absent or not an accepted value. Pass
 * `allowBilingual: true` (Delivery Receipt only) to also accept 'bilingual'.
 */
export function parseDocLang(search: string | URLSearchParams, fallback: DocLang): DocLang
export function parseDocLang(search: string | URLSearchParams, fallback: ReceiptLang, allowBilingual: true): ReceiptLang
export function parseDocLang(
  search: string | URLSearchParams,
  fallback: ReceiptLang,
  allowBilingual = false,
): ReceiptLang {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const v = params.get('lang')
  if (isDocLang(v)) return v
  if (allowBilingual && v === 'bilingual') return v
  return fallback
}

/** Text direction for a document root; the receipt's 'bilingual' layout keeps its existing LTR root. */
export function docDir(lang: ReceiptLang): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr'
}
