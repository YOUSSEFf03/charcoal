import { t } from '../../lib/i18n/docLabels'
import { fmtDocDate, pickName } from '../../lib/i18n/docFormat'
import type { DocLang } from '../../lib/i18n/docLang'
import { COMPANY_INFO } from '../../lib/companyInfo'
import { invoiceLineView, invoiceStatusKey } from '../../lib/invoiceView'
import { primaryPhoneForDisplay } from '../../lib/phoneDisplay'
import type { InvoiceDetail } from '../../lib/types'
import { Ltr } from '../receipt/Ltr'

/**
 * The printable invoice receipt card (presentational only). Shared by the
 * /invoice/:id print route and the off-screen PDF render used by the
 * Print / Download / Share dialog, so both always show the same document.
 *
 * English keeps its historical receipt layout unchanged. Arabic uses a
 * structured RTL layout (InvoiceDocumentAr): company address, order ref and
 * client phone when present (omitted, never "—", when missing), each item as
 * product + labelled quantity / unit price, and a payment-status line. All
 * amounts are the server's values; nothing is recalculated.
 */
export function InvoiceDocument({ invoice, lang }: { invoice: InvoiceDetail; lang: DocLang }) {
  if (lang === 'ar') return <InvoiceDocumentAr invoice={invoice} />

  const issuedDate = invoice.issuedAt ?? invoice.createdAt
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const displayRef = invoice.displayId ?? invoice.id
  const money = (n: string | number) => `${Number(n).toFixed(2)} ${invoice.currency}`

  return (
    <div className="receipt" style={{ width: '100%', maxWidth: 380, fontSize: 13 }}>
      <div className="receipt-title">FARAH CHARCOAL</div>
      <div className="receipt-sub">{t(lang, 'invoice.taxInvoice')}</div>
      <hr className="receipt-divider" />
      <div className="receipt-row">
        <span>{t(lang, 'invoice.number')}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace" }} title={invoice.id}>{displayRef}</span>
      </div>
      <div className="receipt-row"><span>{t(lang, 'common.date')}</span><span>{fmtDate(issuedDate)}</span></div>
      {invoice.dueDate && <div className="receipt-row"><span>{t(lang, 'invoice.due')}</span><span>{fmtDate(invoice.dueDate)}</span></div>}
      <div className="receipt-row"><span>{t(lang, 'common.client')}</span><span>{invoice.client.name}</span></div>
      <hr className="receipt-divider" />
      {invoice.lines.map((line, i) => (
        <div className="receipt-row" key={i}>
          <span>
            {line.saleUnit === 'KG'
              ? `${line.kgQuantity} kg — ${line.description}`
              : `${line.qty}× ${line.bagTypeName}`}
          </span>
          <span>{Number(line.lineTotal).toFixed(2)}</span>
        </div>
      ))}
      <hr className="receipt-divider" />
      <div className="receipt-row total"><span>{t(lang, 'invoice.total')}</span><span>{money(invoice.total)}</span></div>
      <div className="receipt-row" style={{ color: 'var(--accent)' }}><span>{t(lang, 'invoice.paid')}</span><span>{money(invoice.paidAmount)}</span></div>
      {/* balanceDue — same field the Invoice Detail page shows, computed
          once by InvoicesService.findOne() so the two views can never
          silently disagree on what's still owed. */}
      <div className="receipt-row" style={{ color: Number(invoice.balanceDue) > 0 ? 'var(--red)' : 'var(--accent)', fontWeight: 700 }}>
        <span>{t(lang, 'invoice.balanceDue')}</span><span>{money(invoice.balanceDue)}</span>
      </div>
      <div className="receipt-sig">
        <div className="receipt-sig-line">{t(lang, 'invoice.clientSignature')}</div>
      </div>
    </div>
  )
}

const STATUS_COLOR = { owed: 'var(--red)', paid: 'var(--accent)', overpaid: 'var(--accent)' } as const

/** Arabic invoice: RTL, labelled and structured. Numbers/refs/dates stay LTR-isolated. */
function InvoiceDocumentAr({ invoice }: { invoice: InvoiceDetail }) {
  const lang: DocLang = 'ar'
  const fmtDate = (iso: string) => fmtDocDate(lang, iso)
  const displayRef = invoice.displayId ?? invoice.id
  // Real Arabic client name when the API provides one (the invoice client
  // projection may omit it); otherwise the English name. Never invented.
  const clientName = pickName(lang, invoice.client.name, (invoice.client as { nameAr?: string | null }).nameAr)
  const phone = primaryPhoneForDisplay(invoice.client.phones)
  const orderRef = invoice.order?.displayId ?? null
  const status = invoiceStatusKey(invoice.balanceDue)
  const money = (n: string | number) => (
    <Ltr lang={lang}>{Number(n).toFixed(2)} {invoice.currency}</Ltr>
  )

  return (
    <div className="receipt inv-ar" dir="rtl" lang="ar" style={{ width: '100%', maxWidth: 380 }}>
      <div className="receipt-title">{COMPANY_INFO.nameAr}</div>
      {COMPANY_INFO.addressAr && <div className="inv-company">{COMPANY_INFO.addressAr}</div>}
      <div className="receipt-sub">{t(lang, 'invoice.taxInvoice')}</div>
      <hr className="receipt-divider" />

      <div className="receipt-row">
        <span>{t(lang, 'invoice.number')}</span>
        <span className="inv-ref" title={invoice.id}><Ltr lang={lang}>{displayRef}</Ltr></span>
      </div>
      {orderRef && (
        <div className="receipt-row"><span>{t(lang, 'invoice.orderRef')}</span><span className="inv-ref"><Ltr lang={lang}>{orderRef}</Ltr></span></div>
      )}
      <div className="receipt-row"><span>{t(lang, 'common.date')}</span><span><Ltr lang={lang}>{fmtDate(invoice.issuedAt ?? invoice.createdAt)}</Ltr></span></div>
      {invoice.dueDate && <div className="receipt-row"><span>{t(lang, 'invoice.due')}</span><span><Ltr lang={lang}>{fmtDate(invoice.dueDate)}</Ltr></span></div>}
      <div className="receipt-row inv-client"><span>{t(lang, 'common.client')}</span><span>{clientName}</span></div>
      {phone && <div className="receipt-row"><span>{t(lang, 'common.phone')}</span><span><Ltr lang={lang}>{phone}</Ltr></span></div>}
      <hr className="receipt-divider" />

      <div className="inv-items-head"><span>{t(lang, 'invoice.items')}</span><span>{t(lang, 'common.amount')}</span></div>
      {invoice.lines.map((line, i) => {
        const v = invoiceLineView(lang, line)
        return (
          <div className="inv-item" key={i}>
            <div className="inv-item-main">
              <span><bdi>{v.product}</bdi></span>
              <span><Ltr lang={lang}>{v.total}</Ltr></span>
            </div>
            <div className="inv-item-meta">
              <span>{t(lang, 'common.quantity')}: {v.quantity}</span>
              {v.unitPrice && <span>{t(lang, 'invoice.unitPrice')}: <Ltr lang={lang}>{v.unitPrice}</Ltr></span>}
            </div>
          </div>
        )
      })}

      <div className="receipt-row total"><span>{t(lang, 'invoice.total')}</span><span>{money(invoice.total)}</span></div>
      <div className="receipt-row" style={{ color: 'var(--accent)' }}><span>{t(lang, 'invoice.paid')}</span><span>{money(invoice.paidAmount)}</span></div>
      {/* balanceDue comes from InvoicesService.findOne() — never recomputed here. */}
      <div className="receipt-row" style={{ color: Number(invoice.balanceDue) > 0 ? 'var(--red)' : 'var(--accent)', fontWeight: 700 }}>
        <span>{t(lang, 'invoice.balanceDue')}</span><span>{money(invoice.balanceDue)}</span>
      </div>
      <div className="inv-status" data-status={status} style={{ color: STATUS_COLOR[status] }}>
        {t(lang, `invoice.status.${status}`)}
      </div>

      <div className="receipt-sig">
        <div className="receipt-sig-line">{t(lang, 'invoice.clientSignature')}</div>
      </div>
    </div>
  )
}

export default InvoiceDocument
