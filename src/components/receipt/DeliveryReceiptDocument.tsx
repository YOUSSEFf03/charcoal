import type { ReactNode } from 'react'
import farahLogo from '../../assets/farah-charcoal-logo.png'
import { t, type DocLabelKey } from '../../lib/i18n/docLabels'
import type { ReceiptLang } from '../../lib/i18n/docLang'
import { pickName, unitLabel } from '../../lib/i18n/docFormat'

/** Physical paper widths this document supports — see index.css's `.dr-page[data-w]` rules. */
export const RECEIPT_WIDTHS_MM = [80, 150, 180, 210] as const
export type ReceiptWidthMm = (typeof RECEIPT_WIDTHS_MM)[number]

export interface DeliveryReceiptItem {
  no: number
  /** English item description — always present (e.g. order.charcoalType). */
  descriptionEn: string
  /** Machine-translated Arabic description — absent while translating or if translation failed; never fabricated. */
  descriptionAr?: string
  /** "5 KG", "Grade A" — the bag's nominal size, or the order's grade for a by-weight line. */
  typeSize: string
  unit: 'BAG' | 'KG'
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface DeliveryReceiptData {
  receiptNo: string
  /** Pre-formatted display date (dd/mm/yyyy) — see buildDeliveryReceiptData(). */
  date: string
  customerName: string
  /** Client.nameAr — real stored Arabic name, never machine-translated. */
  customerNameAr?: string | null
  address: string
  currency: string
  items: DeliveryReceiptItem[]
  totalItems: number
  totalQuantity: number
  totalAmount: number
  /** Order.notes — already Arabic by this app's existing convention (see OrderDetail.tsx). */
  notes: string | null
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Bilingual cell content. 'bilingual' keeps the original markup (EN, line
 * break, small AR line); 'en' / 'ar' render only their own half.
 */
function Bi({ lang, en, ar }: { lang: ReceiptLang; en: ReactNode; ar: ReactNode }) {
  if (lang === 'en') return <>{en}</>
  if (lang === 'ar') return <span className="dr-th-ar">{ar}</span>
  return (
    <>
      {en}
      <br />
      <span className="dr-th-ar">{ar}</span>
    </>
  )
}

/**
 * Renders `data` as a real HTML/CSS document — text stays text, borders stay
 * CSS, the logo stays the original PNG asset. No canvas, no rasterization.
 * `widthMm` drives layout (not just a scale transform) via `.dr-page[data-w]`
 * / `[data-compact]` rules in index.css: 80mm stacks the EN/AR blocks and
 * compacts the table; 150/180/210mm keep the approved two-column layout.
 *
 * `lang` (optional, default 'bilingual' = the historical side-by-side layout):
 * 'en' renders English only; 'ar' renders Arabic only with dir="rtl" lang="ar"
 * on the root and numbers/refs/phones isolated LTR via <bdi>. Fixed labels
 * come from the typed dictionary (docLabels.ts); data falls back to English
 * when no real Arabic value exists (never invented).
 */
export function DeliveryReceiptDocument({
  data,
  widthMm,
  lang = 'bilingual',
}: {
  data: DeliveryReceiptData
  widthMm: ReceiptWidthMm
  lang?: ReceiptLang
}) {
  const compact = widthMm <= 80
  const showEn = lang !== 'ar'
  const showAr = lang !== 'en'
  const isAr = lang === 'ar'
  /** Isolate LTR runs (numbers, refs, phones) inside the RTL Arabic document only. */
  const ltr = (v: ReactNode): ReactNode => (isAr ? <bdi dir="ltr">{v}</bdi> : v)
  const en = (key: DocLabelKey) => t('en', key)
  const ar = (key: DocLabelKey) => t('ar', key)
  const L = (key: DocLabelKey) => <Bi lang={lang} en={en(key)} ar={ar(key)} />

  return (
    <div
      className="dr-page"
      data-w={widthMm}
      data-lang={lang === 'bilingual' ? undefined : lang}
      data-compact={compact || undefined}
      dir={isAr ? 'rtl' : undefined}
      lang={isAr ? 'ar' : undefined}
    >
      <div className="dr-logo-row">
        <img src={farahLogo} alt="Farah Charcoal" className="dr-logo" />
      </div>

      <div className="dr-title-row">
        {showEn && <div className="dr-title-en">{en('receipt.title')}</div>}
        {showAr && <div className="dr-title-ar">{ar('receipt.title')}</div>}
      </div>
      <hr className="dr-rule" />

      <div className="dr-bi-row">
        {showEn && <div className="dr-field"><span className="dr-label">{en('receipt.receiptNo')}</span><span className="dr-colon">:</span><span className="dr-value">{data.receiptNo}</span></div>}
        {showAr && <div className="dr-field dr-ar"><span className="dr-label">{ar('receipt.receiptNo')}</span><span className="dr-colon">:</span><span className="dr-value">{ltr(data.receiptNo)}</span></div>}
      </div>
      <div className="dr-bi-row">
        {showEn && <div className="dr-field"><span className="dr-label">{en('common.date')}</span><span className="dr-colon">:</span><span className="dr-value">{data.date}</span></div>}
        {showAr && <div className="dr-field dr-ar"><span className="dr-label">{ar('common.date')}</span><span className="dr-colon">:</span><span className="dr-value">{ltr(data.date)}</span></div>}
      </div>
      <hr className="dr-rule" />

      <div className="dr-bi-row">
        {showEn && <div className="dr-field"><span className="dr-label">{en('receipt.customer')}</span><span className="dr-colon">:</span><span className="dr-value">{data.customerName}</span></div>}
        {showAr && <div className="dr-field dr-ar"><span className="dr-label">{ar('receipt.customer')}</span><span className="dr-colon">:</span><span className="dr-value">{pickName('ar', data.customerName, data.customerNameAr)}</span></div>}
      </div>
      <div className="dr-bi-row">
        {showEn && <div className="dr-field"><span className="dr-label">{en('common.address')}</span><span className="dr-colon">:</span><span className="dr-value">{data.address}</span></div>}
        {showAr && <div className="dr-field dr-ar"><span className="dr-label">{ar('common.address')}</span><span className="dr-colon">:</span><span className="dr-value">{data.address}</span></div>}
      </div>
      <hr className="dr-rule dr-rule-thick" />

      <table className="dr-table">
        <thead>
          <tr>
            <th className="dr-c-no">{L('receipt.no')}</th>
            <th className="dr-c-desc">{L('receipt.itemDescription')}</th>
            {!compact && <th className="dr-c-type">{L('receipt.typeSize')}</th>}
            <th className="dr-c-unit">{L('common.unit')}</th>
            <th className="dr-c-qty">{L('common.quantity')}</th>
            <th className="dr-c-price">{L('common.unitPrice')}</th>
            <th className="dr-c-total">{L('common.total')}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.no}>
              <td className="dr-c-no">{it.no}</td>
              <td className="dr-c-desc">
                <div>{isAr ? pickName('ar', it.descriptionEn, it.descriptionAr) : it.descriptionEn}</div>
                {lang === 'bilingual' && it.descriptionAr && <div className="dr-desc-ar">{it.descriptionAr}</div>}
                {compact && <div className="dr-desc-sub">{ltr(it.typeSize)}</div>}
              </td>
              {!compact && <td className="dr-c-type">{ltr(it.typeSize)}</td>}
              <td className="dr-c-unit">
                {lang === 'bilingual' && <>{it.unit} <span className="dr-th-ar">/ {unitLabel('ar', it.unit)}</span></>}
                {lang === 'en' && unitLabel('en', it.unit)}
                {isAr && unitLabel('ar', it.unit)}
              </td>
              <td className="dr-c-qty">{ltr(it.quantity)}</td>
              <td className="dr-c-price">{ltr(fmtAmount(it.unitPrice))}</td>
              <td className="dr-c-total">{ltr(fmtAmount(it.lineTotal))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dr-totals-row">
        <div className="dr-totals-cell">
          <div className="dr-totals-label"><Bi lang={lang} en={<>{en('receipt.totalItems')}: {data.totalItems}</>} ar={<>{ar('receipt.totalItems')}: {ltr(data.totalItems)}</>} /></div>
        </div>
        <div className="dr-totals-cell">
          <div className="dr-totals-label"><Bi lang={lang} en={<>{en('receipt.totalQuantity')}: {data.totalQuantity}</>} ar={<>{ar('receipt.totalQuantity')}: {ltr(data.totalQuantity)}</>} /></div>
        </div>
        <div className="dr-totals-cell dr-totals-amount">
          <div className="dr-totals-label"><Bi lang={lang} en={<>{en('receipt.totalAmount')} ({data.currency})</>} ar={<>{ar('receipt.totalAmount')} ({ltr(data.currency)})</>} /></div>
          <div className="dr-totals-value">{ltr(fmtAmount(data.totalAmount))}</div>
        </div>
      </div>

      <div className="dr-notes-row">
        {lang === 'bilingual' && <><span className="dr-label">Notes</span><span className="dr-th-ar">/ ملاحظات</span></>}
        {lang === 'en' && <span className="dr-label">{en('common.notes')}</span>}
        {isAr && <span className="dr-label">{ar('common.notes')}</span>}
        <span className="dr-notes-line">{data.notes || ''}</span>
      </div>

      <div className="dr-sig-row">
        <div className="dr-sig-block">
          <div className="dr-label">
            {lang === 'bilingual' && <>Signature <span className="dr-th-ar">/ التوقيع</span></>}
            {lang === 'en' && en('common.signature')}
            {isAr && ar('common.signature')}
          </div>
          <div className="dr-sig-line" />
        </div>
        <div className="dr-sig-total">
          <div className="dr-totals-label"><Bi lang={lang} en={<>{en('receipt.totalAmount')} ({data.currency})</>} ar={<>{ar('receipt.totalAmount')} ({ltr(data.currency)})</>} /></div>
          <div className="dr-totals-value dr-totals-value-lg">{ltr(fmtAmount(data.totalAmount))}</div>
        </div>
      </div>

      <div className="dr-footer">
        <span>
          <i className="ti ti-map-pin" />{' '}
          {lang === 'bilingual' && <>{en('receipt.footerAddress')} <span className="dr-th-ar">{ar('receipt.footerAddress')}</span></>}
          {lang === 'en' && en('receipt.footerAddress')}
          {isAr && ar('receipt.footerAddress')}
        </span>
        <span><i className="ti ti-phone" /> {ltr('+961 70 123 456')}</span>
        <span><i className="ti ti-mail" /> {ltr('info@farahcharcoal.com')}</span>
        <span><i className="ti ti-world" /> {ltr('www.farahcharcoal.com')}</span>
      </div>
    </div>
  )
}
