import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useOrder } from '../hooks/useOrders'
import { useBagTypes } from '../hooks/useBagTypes'
import { useArabicTranslations } from '../hooks/useTranslation'
import { lookupCharcoalTypeAr } from '../lib/charcoalTypeGlossary'
import {
  DeliveryReceiptDocument,
  RECEIPT_WIDTHS_MM,
  type DeliveryReceiptData,
  type DeliveryReceiptItem,
  type ReceiptWidthMm,
} from '../components/receipt/DeliveryReceiptDocument'

const WIDTH_STORAGE_KEY = 'dr-width-mm'

function loadStoredWidth(): ReceiptWidthMm {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
  return (RECEIPT_WIDTHS_MM as readonly number[]).includes(stored) ? (stored as ReceiptWidthMm) : 210
}

/**
 * Standalone printable Delivery Receipt — opened from OrderDetail.tsx via
 * <a href="/orders/:id/delivery-receipt" target="_blank">, same convention
 * as InvoicePrint.tsx ("/invoice/:id"). Real HTML/CSS document (see
 * DeliveryReceiptDocument), printed via window.print() + a paper-width-
 * specific @page rule below — no PDF/canvas/screenshot step.
 */
export default function DeliveryReceiptPrint() {
  const { id } = useParams<{ id: string }>()
  const orderQ = useOrder(id ?? '')
  const bagTypesQ = useBagTypes()
  const order = orderQ.data
  const [widthMm, setWidthMm] = useState<ReceiptWidthMm>(loadStoredWidth)

  function changeWidth(w: ReceiptWidthMm) {
    setWidthMm(w)
    localStorage.setItem(WIDTH_STORAGE_KEY, String(w))
  }

  const isBagOrder = !!order?.bagTypeId
  const pricePerUnit = order ? parseFloat(order.pricePerBag) : 0
  const totalKg = order ? parseFloat(order.totalKgRequested) : 0
  const bagTypeById = new Map((bagTypesQ.data ?? []).map((b) => [b.id, b]))
  const totalBags = order && isBagOrder
    ? (order.bagLines.length > 0
        ? order.bagLines.reduce((s, l) => s + l.quantity, 0)
        : order.bagType ? Math.round(totalKg / parseFloat(order.bagType.nominalKg)) : 0)
    : 0
  const totalAmount = order ? (isBagOrder ? totalBags * pricePerUnit : totalKg * pricePerUnit) : 0

  // Item rows — mirrors OrderDetail.tsx's "Order details" card exactly
  // (same bagLines-vs-single-bagType-vs-KG branching, same figures), just
  // reshaped for the receipt table. Every row shares order.charcoalType as
  // its English description, since a single order has one charcoal type —
  // only the bag size/unit varies per row.
  const items: DeliveryReceiptItem[] = []
  if (order) {
    if (isBagOrder && order.bagLines.length > 0) {
      order.bagLines.forEach((l, i) => {
        const bt = bagTypeById.get(l.bagTypeId)
        items.push({
          no: i + 1,
          descriptionEn: order.charcoalType,
          typeSize: bt ? `${parseFloat(bt.nominalKg)} KG` : '—',
          unit: 'BAG',
          quantity: l.quantity,
          unitPrice: pricePerUnit,
          lineTotal: l.quantity * pricePerUnit,
        })
      })
    } else if (isBagOrder) {
      items.push({
        no: 1,
        descriptionEn: order.charcoalType,
        typeSize: order.bagType ? `${parseFloat(order.bagType.nominalKg)} KG` : '—',
        unit: 'BAG',
        quantity: totalBags,
        unitPrice: pricePerUnit,
        lineTotal: totalAmount,
      })
    } else {
      items.push({
        no: 1,
        descriptionEn: order.charcoalType,
        typeSize: `Grade ${order.grade}`,
        unit: 'KG',
        quantity: totalKg,
        unitPrice: pricePerUnit,
        lineTotal: totalAmount,
      })
    }
  }

  // Known-terminology check FIRST — see charcoalTypeGlossary.ts. This
  // business's charcoalType field is free text, but every value that has
  // ever actually been entered is one of four known terms; for those, a
  // deterministic lookup is used instead of live machine translation, which
  // was found (audit, 2026-08-28) to sometimes return fluent but WRONG
  // Arabic for exactly these terms (e.g. "Restaurant Grade" → "rest line").
  // A known term with no verified Arabic yet (lookup.ar === null, pending
  // product decision) shows English only and is NOT sent to LibreTranslate
  // either — that's deliberately different from a charcoalType that isn't
  // one of the four known terms at all, which still falls through to
  // useArabicTranslations() (LibreTranslate + the existing no-Arabic-
  // detected filter), unchanged. Every row still shares one translation,
  // since all rows in one order share the same charcoalType.
  const known = order ? lookupCharcoalTypeAr(order.charcoalType) : { isKnown: false, ar: null }
  const translations = useArabicTranslations(order && !known.isKnown ? [order.charcoalType] : [])
  for (const it of items) it.descriptionAr = known.isKnown ? (known.ar ?? undefined) : translations.get(it.descriptionEn)

  if (orderQ.isLoading || bagTypesQ.isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #ddd', borderTopColor: '#1a1a1a', borderRadius: '50%', animation: 'drprint-spin 0.8s linear infinite' }} />
        <style>{`@keyframes drprint-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (orderQ.isError || !order) {
    const status = (orderQ.error as any)?.status as number | undefined
    const msg =
      status === 401 ? 'Authentication required' :
      status === 404 ? 'Order not found' :
      'Failed to load order'
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#666' }}>
        {msg}
      </div>
    )
  }

  const orderDisplay = order.displayId ?? `#${order.id.slice(0, 8).toUpperCase()}`
  // Delivery address: the shipment being delivered, when this order routes
  // through one (see OrderDetail.tsx's Shipments card); orders delivered
  // directly (no shipment — an existing, already-handled case there) fall
  // back to the client's own address. Multi-stop orders use the first
  // shipment's address.
  const address = order.shipments[0]?.address ?? order.client.address ?? '—'

  const data: DeliveryReceiptData = {
    receiptNo: orderDisplay,
    date: new Date().toLocaleDateString('en-GB'),
    customerName: order.client.name,
    customerNameAr: order.client.nameAr,
    address,
    currency: order.currency,
    items,
    totalItems: items.length,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    totalAmount,
    notes: order.notes,
  }

  return (
    <div className="dr-print-shell" style={{ minHeight: '100vh', background: '#e9e8e4', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px 60px' }}>
      <div className="no-print" style={{ width: '100%', maxWidth: 640, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#555' }}>
          Delivery Receipt&nbsp;<strong style={{ fontFamily: "'IBM Plex Mono', monospace" }} title={order.id}>{orderDisplay}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', border: '1px solid #ccc', borderRadius: 8, overflow: 'hidden' }}>
            {RECEIPT_WIDTHS_MM.map((w) => (
              <button
                key={w}
                onClick={() => changeWidth(w)}
                style={{
                  padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: widthMm === w ? '#1a1a1a' : '#fff', color: widthMm === w ? '#fff' : '#333',
                }}
              >
                {w}mm
              </button>
            ))}
          </div>
          <button
            onClick={() => window.print()}
            style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print
          </button>
        </div>
      </div>

      <DeliveryReceiptDocument data={data} widthMm={widthMm} />

      <style>{`
        @page { size: ${widthMm}mm auto; margin: 6mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  )
}
