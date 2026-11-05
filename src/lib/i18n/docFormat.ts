import { formatDate } from '../date'
import { formatUsd } from '../money'
import type { DocLang } from './docLang'

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Format an ISO date for a document.
 * - 'en', style 'short' (default): identical to formatDate() -> "3 Aug 2026".
 * - style 'slash': "03/08/2026" (local calendar-day parts, as the receipt and statement PDF do).
 * - 'ar': always "03/08/2026" with Western digits (owner decision), regardless of style.
 * Null/invalid input returns `fallback` (default '—').
 */
export function fmtDocDate(
  lang: DocLang,
  iso?: string | null,
  opts?: { style?: 'short' | 'slash'; fallback?: string },
): string {
  const fallback = opts?.fallback ?? '—'
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  if (lang === 'en' && (opts?.style ?? 'short') === 'short') return formatDate(iso, { fallback })
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' }

/**
 * Format an amount with Western digits in every language (en-US grouping, 2dp).
 * - No currency: plain "1,234.50" (receipt/invoice rows).
 * - Known symbol (USD/EUR): "$1,234.50" / "-$200.00" in 'en' (same as formatUsd / the statement PDF);
 *   in 'ar' the symbol follows the number ("1,234.50 $") so it reads correctly RTL.
 * - Other currency codes (e.g. LBP): "1,234.50 LBP" in both languages.
 */
export function fmtDocMoney(lang: DocLang, n: number | string | null | undefined, currency?: string): string {
  if (!currency) return formatUsd(n, { symbol: false })
  const symbol = CURRENCY_SYMBOLS[currency]
  if (lang === 'en' && symbol) return formatUsd(n, { symbol })
  return `${formatUsd(n, { symbol: false })} ${symbol ?? currency}`
}

const UNIT_LABELS: Record<DocLang, Record<'BAG' | 'KG', string>> = {
  en: { BAG: 'BAG', KG: 'KG' },
  // Arabic values are DeliveryReceiptDocument's existing UNIT_LABEL_AR, verbatim.
  ar: { BAG: 'كيس', KG: 'كغ' },
}

/** Unit label: 'BAG'/'KG' in English, 'كيس'/'كغ' in Arabic. */
export function unitLabel(lang: DocLang, unit: 'BAG' | 'KG'): string {
  return UNIT_LABELS[lang][unit]
}

/** Display name for a language: the Arabic value when requested and non-blank, else English. Never invents Arabic. */
export function pickName(lang: DocLang, en: string, ar?: string | null): string {
  if (lang === 'ar' && ar && ar.trim()) return ar
  return en
}
