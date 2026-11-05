import type { ReactNode } from 'react'
import type { DocLang } from '../../lib/i18n/docLang'

/**
 * Keeps numbers, refs, dates, phones and amounts left-to-right (<bdi dir="ltr">)
 * inside an RTL Arabic document. In English it renders its children untouched,
 * so English markup is identical to before.
 */
export function Ltr({ lang, children }: { lang: DocLang; children: ReactNode }) {
  return lang === 'ar' ? <bdi dir="ltr">{children}</bdi> : <>{children}</>
}
