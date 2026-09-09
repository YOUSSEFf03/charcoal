import { useQueries } from '@tanstack/react-query'
import { api } from '../lib/api'

/**
 * POST /translations — self-hosted LibreTranslate (see
 * apps/backend/src/translation/). Only en<->ar models are loaded
 * (docker-compose.yml's LT_LOAD_ONLY), which matches this app's only
 * real use case: translating English business text (e.g. an order's
 * charcoal type) into Arabic for bilingual printed documents.
 */
// Arabic script ranges (incl. presentation forms) — used only to detect
// LibreTranslate silently passing English text through untranslated (its
// self-hosted en/ar model does this for short, context-free product terms
// it doesn't recognize, e.g. "Mangrove", "BBQ hardwood" — verified live
// against this app's own docker-compose `libretranslate` service). This
// catches that specific "response has zero Arabic characters" failure mode
// only — it cannot detect a response that IS Arabic but wrong (e.g. the
// same model translated "oak charcoal" as "شحم البقر", beef fat); there is
// no automated way to catch a wrong-but-plausible translation from this
// model, so that residual risk is accepted per product decision.
const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/

// react-query treats a queryFn resolving to `undefined` as a bug (it logs
// "Query data cannot be undefined" and won't cache the result) — `null` is
// its documented way to cache a real "no data" result, so a detected
// passthrough resolves to `null`, never `undefined`.
async function translateToArabic(text: string): Promise<string | null> {
  const res = await api.post<{ translatedText: string }>('/translations', {
    q: text,
    source: 'en',
    target: 'ar',
  })
  const translated = res.data.translatedText
  return ARABIC_RE.test(translated) ? translated : null
}

/**
 * Translates a set of English strings to Arabic for display alongside the
 * English original (e.g. the Delivery Receipt's item descriptions).
 * Never blocks or throws — a failed/unavailable translation (LibreTranslate
 * down, rate-limited, or a same-as-input passthrough — see ARABIC_RE above)
 * simply omits that string's Arabic line rather than failing the whole
 * document; the English text is always shown regardless. react-query caches
 * each string indefinitely (translations of fixed business terms like "Oak"
 * don't change), so repeated prints of the same charcoal type never re-hit
 * the translation service.
 *
 * @returns Map from the original English string to its Arabic translation —
 *          entries are absent while pending, on failure, or on a detected
 *          passthrough, never `undefined` placeholders, so `map.get(text)`
 *          alone tells the caller whether a translation is ready to show.
 */
export function useArabicTranslations(texts: string[]): Map<string, string> {
  const unique = Array.from(new Set(texts.filter((t) => t.trim().length > 0)))
  const results = useQueries({
    queries: unique.map((text) => ({
      queryKey: ['translate', 'en', 'ar', text],
      queryFn: () => translateToArabic(text),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: 1,
    })),
  })
  const map = new Map<string, string>()
  unique.forEach((text, i) => {
    const translated = results[i]?.data
    if (translated) map.set(text, translated)
  })
  return map
}
