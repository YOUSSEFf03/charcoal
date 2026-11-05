import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { parseDocLang, type DocLang, type ReceiptLang } from './docLang'

/**
 * Current document language from `?lang=` on the route; when absent, the
 * document's historical `fallback` ('en' by default). `setLang` rewrites
 * only the `lang` query param, using history replace.
 * On the Delivery Receipt route pass `{ allowBilingual: true, fallback: 'bilingual' }`.
 */
export function useDocLang(fallback?: DocLang): [DocLang, (lang: DocLang) => void]
export function useDocLang(opts: {
  allowBilingual: true
  fallback?: ReceiptLang
}): [ReceiptLang, (lang: ReceiptLang) => void]
export function useDocLang(
  arg?: DocLang | { allowBilingual: true; fallback?: ReceiptLang },
): [ReceiptLang, (lang: never) => void] {
  const location = useLocation()
  const navigate = useNavigate()

  const lang =
    typeof arg === 'object'
      ? parseDocLang(location.search, arg.fallback ?? 'bilingual', true)
      : parseDocLang(location.search, arg ?? 'en')

  const setLang = useCallback(
    (next: ReceiptLang) => {
      const params = new URLSearchParams(location.search)
      params.set('lang', next)
      navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: location.hash }, { replace: true })
    },
    [location.pathname, location.search, location.hash, navigate],
  )

  return [lang, setLang]
}
