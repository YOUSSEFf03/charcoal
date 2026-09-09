import farahLogo from '../../assets/farah-charcoal-logo.png'

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

const UNIT_LABEL_AR: Record<DeliveryReceiptItem['unit'], string> = { BAG: 'كيس', KG: 'كغ' }

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Renders `data` as a real HTML/CSS document — text stays text, borders stay
 * CSS, the logo stays the original PNG asset. No canvas, no rasterization.
 * `widthMm` drives layout (not just a scale transform) via `.dr-page[data-w]`
 * / `[data-compact]` rules in index.css: 80mm stacks the EN/AR blocks and
 * compacts the table; 150/180/210mm keep the approved two-column layout.
 */
export function DeliveryReceiptDocument({ data, widthMm }: { data: DeliveryReceiptData; widthMm: ReceiptWidthMm }) {
  const compact = widthMm <= 80

  return (
    <div className="dr-page" data-w={widthMm} data-compact={compact || undefined}>
      <div className="dr-logo-row">
        <img src={farahLogo} alt="Farah Charcoal" className="dr-logo" />
      </div>

      <div className="dr-title-row">
        <div className="dr-title-en">DELIVERY RECEIPT</div>
        <div className="dr-title-ar">سند تسليم</div>
      </div>
      <hr className="dr-rule" />

      <div className="dr-bi-row">
        <div className="dr-field"><span className="dr-label">Receipt No.</span><span className="dr-colon">:</span><span className="dr-value">{data.receiptNo}</span></div>
        <div className="dr-field dr-ar"><span className="dr-label">رقم السند</span><span className="dr-colon">:</span><span className="dr-value">{data.receiptNo}</span></div>
      </div>
      <div className="dr-bi-row">
        <div className="dr-field"><span className="dr-label">Date</span><span className="dr-colon">:</span><span className="dr-value">{data.date}</span></div>
        <div className="dr-field dr-ar"><span className="dr-label">التاريخ</span><span className="dr-colon">:</span><span className="dr-value">{data.date}</span></div>
      </div>
      <hr className="dr-rule" />

      <div className="dr-bi-row">
        <div className="dr-field"><span className="dr-label">Customer</span><span className="dr-colon">:</span><span className="dr-value">{data.customerName}</span></div>
        <div className="dr-field dr-ar"><span className="dr-label">الزبون</span><span className="dr-colon">:</span><span className="dr-value">{data.customerNameAr || data.customerName}</span></div>
      </div>
      <div className="dr-bi-row">
        <div className="dr-field"><span className="dr-label">Address</span><span className="dr-colon">:</span><span className="dr-value">{data.address}</span></div>
        <div className="dr-field dr-ar"><span className="dr-label">العنوان</span><span className="dr-colon">:</span><span className="dr-value">{data.address}</span></div>
      </div>
      <hr className="dr-rule dr-rule-thick" />

      <table className="dr-table">
        <thead>
          <tr>
            <th className="dr-c-no">No.<br /><span className="dr-th-ar">الرقم</span></th>
            <th className="dr-c-desc">Item Description<br /><span className="dr-th-ar">اسم الصنف</span></th>
            {!compact && <th className="dr-c-type">Type / Size<br /><span className="dr-th-ar">النوع / الحجم</span></th>}
            <th className="dr-c-unit">Unit<br /><span className="dr-th-ar">الوحدة</span></th>
            <th className="dr-c-qty">Qty<br /><span className="dr-th-ar">الكمية</span></th>
            <th className="dr-c-price">Unit Price<br /><span className="dr-th-ar">سعر الوحدة</span></th>
            <th className="dr-c-total">Total<br /><span className="dr-th-ar">الإجمالي</span></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.no}>
              <td className="dr-c-no">{it.no}</td>
              <td className="dr-c-desc">
                <div>{it.descriptionEn}</div>
                {it.descriptionAr && <div className="dr-desc-ar">{it.descriptionAr}</div>}
                {compact && <div className="dr-desc-sub">{it.typeSize}</div>}
              </td>
              {!compact && <td className="dr-c-type">{it.typeSize}</td>}
              <td className="dr-c-unit">{it.unit} <span className="dr-th-ar">/ {UNIT_LABEL_AR[it.unit]}</span></td>
              <td className="dr-c-qty">{it.quantity}</td>
              <td className="dr-c-price">{fmtAmount(it.unitPrice)}</td>
              <td className="dr-c-total">{fmtAmount(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dr-totals-row">
        <div className="dr-totals-cell">
          <div className="dr-totals-label">Total Items: {data.totalItems}<br /><span className="dr-th-ar">إجمالي الأصناف: {data.totalItems}</span></div>
        </div>
        <div className="dr-totals-cell">
          <div className="dr-totals-label">Total Quantity: {data.totalQuantity}<br /><span className="dr-th-ar">إجمالي الكمية: {data.totalQuantity}</span></div>
        </div>
        <div className="dr-totals-cell dr-totals-amount">
          <div className="dr-totals-label">TOTAL AMOUNT ({data.currency})<br /><span className="dr-th-ar">الإجمالي ({data.currency})</span></div>
          <div className="dr-totals-value">{fmtAmount(data.totalAmount)}</div>
        </div>
      </div>

      <div className="dr-notes-row">
        <span className="dr-label">Notes</span><span className="dr-th-ar">/ ملاحظات</span>
        <span className="dr-notes-line">{data.notes || ''}</span>
      </div>

      <div className="dr-sig-row">
        <div className="dr-sig-block">
          <div className="dr-label">Signature <span className="dr-th-ar">/ التوقيع</span></div>
          <div className="dr-sig-line" />
        </div>
        <div className="dr-sig-total">
          <div className="dr-totals-label">TOTAL AMOUNT ({data.currency})<br /><span className="dr-th-ar">الإجمالي ({data.currency})</span></div>
          <div className="dr-totals-value dr-totals-value-lg">{fmtAmount(data.totalAmount)}</div>
        </div>
      </div>

      <div className="dr-footer">
        <span><i className="ti ti-map-pin" /> Zgharta, North Lebanon, Lebanon <span className="dr-th-ar">زغرتا، شمال لبنان، لبنان</span></span>
        <span><i className="ti ti-phone" /> +961 70 123 456</span>
        <span><i className="ti ti-mail" /> info@farahcharcoal.com</span>
        <span><i className="ti ti-world" /> www.farahcharcoal.com</span>
      </div>
    </div>
  )
}
