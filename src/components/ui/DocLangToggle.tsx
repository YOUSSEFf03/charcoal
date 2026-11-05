import type { DocLang, ReceiptLang } from '../../lib/i18n/docLang'

interface DocLangToggleProps {
  value: ReceiptLang
  onChange: (lang: ReceiptLang) => void
  /** Languages offered, in order. Default ['en', 'ar']; add 'bilingual' for documents that support it. */
  options?: readonly ReceiptLang[]
  className?: string
}

const OPTION_META: Record<ReceiptLang, { label: string; lang?: string }> = {
  en: { label: 'EN' },
  ar: { label: 'العربية', lang: 'ar' },
  bilingual: { label: 'Bilingual' },
}

const DEFAULT_OPTIONS: readonly ReceiptLang[] = ['en', 'ar']

/** Segmented EN / العربية [/ Bilingual] control for choosing a document language. Hidden when printing. */
export function DocLangToggle({ value, onChange, options = DEFAULT_OPTIONS, className }: DocLangToggleProps) {
  return (
    <div
      role="group"
      aria-label="Document language"
      className={`inline-flex overflow-hidden rounded-lg border border-gray-300 text-[13px] print:hidden ${className ?? ''}`}
    >
      {options.map((o) => {
        const meta = OPTION_META[o]
        const active = value === o
        return (
          <button
            key={o}
            type="button"
            lang={meta.lang}
            aria-pressed={active}
            onClick={() => onChange(o)}
            className={`px-3 py-1.5 font-semibold transition-colors ${
              active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}
