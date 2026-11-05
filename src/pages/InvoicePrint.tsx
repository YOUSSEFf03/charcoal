
import { useParams } from 'react-router-dom'
import { useInvoice } from '../hooks/useInvoices'
import { useDocLang } from '../lib/i18n/useDocLang'
import { DocLangToggle } from '../components/ui/DocLangToggle'
import { t } from '../lib/i18n/docLabels'
import type { DocLang } from '../lib/i18n/docLang'
import { InvoiceDocument } from '../components/documents/InvoiceDocument'


/**
 * Standalone printable invoice page.
 * Opened in a new tab from OrderDetail and ClientDetail via
 * <a href="/invoice/:id" target="_blank">.
 * No sidebar — full-page receipt layout optimised for window.print().
 *
 * Language: `/invoice/:id?lang=en|ar`. Absent or invalid => English (the
 * historical output, unchanged). `ar` renders the receipt card with
 * dir="rtl" lang="ar", dictionary labels (docLabels.ts) and LTR-isolated
 * numbers/refs/dates.
 */
export default function InvoicePrint() {
  const { id } = useParams<{ id: string }>()
  const [lang, setLang] = useDocLang('en')
  const { data: invoice, isLoading, isError, error } = useInvoice(id ?? '')

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid #ddd',
            borderTopColor: '#1a1a1a',
            borderRadius: '50%',
            animation: 'invprint-spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes invprint-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (isError || !invoice) {
    const status = (error as any)?.status as number | undefined
    const msg =
      status === 401 ? t(lang, 'invoice.authRequired') :
      status === 404 ? t(lang, 'invoice.notFound') :
      isError ? t(lang, 'invoice.loadFailed') :
      t(lang, 'invoice.notFound')
    return (
      <div
        dir={lang === 'ar' ? 'rtl' : undefined}
        lang={lang === 'ar' ? 'ar' : undefined}
        style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#666' }}
      >
        {msg}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      {/* Print action bar — hidden when printing */}
      <div className="no-print" style={{ width: '100%', maxWidth: 480, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#666' }}>
          Invoice&nbsp;<strong style={{ fontFamily: "'IBM Plex Mono', monospace" }} title={invoice.id}>{invoice.displayId ?? invoice.id}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DocLangToggle value={lang} onChange={(l) => setLang(l as DocLang)} />
          <button
            onClick={() => window.print()}
            style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print
          </button>
        </div>
      </div>

      <InvoiceDocument invoice={invoice} lang={lang} />

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  )
}
