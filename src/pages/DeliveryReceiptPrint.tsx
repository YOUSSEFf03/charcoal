import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useOrder } from '../hooks/useOrders'
import { useBagTypes } from '../hooks/useBagTypes'
import { useArabicTranslations } from '../hooks/useTranslation'
import { buildDeliveryReceiptData, receiptNeedsTranslation } from '../components/receipt/buildDeliveryReceiptData'
import { useDocLang } from '../lib/i18n/useDocLang'
import { DocLangToggle } from '../components/ui/DocLangToggle'
import {
  DeliveryReceiptDocument,
  RECEIPT_WIDTHS_MM,
  type ReceiptWidthMm,
} from '../components/receipt/DeliveryReceiptDocument'

const WIDTH_STORAGE_KEY = 'dr-width-mm'
const RECEIPT_LANG_OPTIONS = ['bilingual', 'en', 'ar'] as const

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
  // ?lang=bilingual|en|ar — absent keeps the historical bilingual layout.
  const [lang, setLang] = useDocLang({ allowBilingual: true, fallback: 'bilingual' })

  function changeWidth(w: ReceiptWidthMm) {
    setWidthMm(w)
    localStorage.setItem(WIDTH_STORAGE_KEY, String(w))
  }

  const bagTypes = bagTypesQ.data ?? []
  const translations = useArabicTranslations(receiptNeedsTranslation(order, lang) && order ? [order.charcoalType] : [])

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
  const data = buildDeliveryReceiptData(order, bagTypes, lang, translations)

  return (
    <div className="dr-print-shell" style={{ minHeight: '100vh', background: '#e9e8e4', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px 60px' }}>
      <div className="no-print" style={{ width: '100%', maxWidth: 640, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#555' }}>
          Delivery Receipt&nbsp;<strong style={{ fontFamily: "'IBM Plex Mono', monospace" }} title={order.id}>{orderDisplay}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DocLangToggle value={lang} onChange={setLang} options={RECEIPT_LANG_OPTIONS} />
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

      <DeliveryReceiptDocument data={data} widthMm={widthMm} lang={lang} />

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
