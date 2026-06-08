import { useParams } from 'react-router-dom'
import { useInvoice } from '../hooks/useInvoices'

/**
 * Standalone printable invoice page.
 * Opened in a new tab from OrderDetail and ClientDetail via
 * <a href="/invoice/:id" target="_blank">.
 * No sidebar — full-page receipt layout optimised for window.print().
 */
export default function InvoicePrint() {
  const { id } = useParams<{ id: string }>()
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
      status === 401 ? 'Authentication required' :
      status === 404 ? 'Invoice not found' :
      isError ? 'Failed to load invoice' :
      'Invoice not found'
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#666' }}>
        {msg}
      </div>
    )
  }

  const issuedDate = invoice.issuedAt ?? invoice.createdAt
  const formattedDate = new Date(issuedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      {/* Print action bar — hidden when printing */}
      <div className="no-print" style={{ width: '100%', maxWidth: 480, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#666' }}>
          Invoice&nbsp;<strong style={{ fontFamily: "'IBM Plex Mono', monospace" }} title={invoice.id}>{invoice.displayId ?? invoice.id}</strong>
        </div>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print
        </button>
      </div>

      {/* Receipt card */}
      <div className="receipt" style={{ width: '100%', maxWidth: 380, fontSize: 13 }}>
        <div className="receipt-title">FARAH CHARCOAL</div>
        <div className="receipt-sub">Tax Invoice</div>
        <hr className="receipt-divider" />
        <div className="receipt-row">
          <span>Invoice #</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace" }} title={invoice.id}>{invoice.displayId ?? invoice.id}</span>
        </div>
        <div className="receipt-row"><span>Date</span><span>{formattedDate}</span></div>
        <div className="receipt-row"><span>Client</span><span>{invoice.client.name}</span></div>
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
        <div className="receipt-row total"><span>TOTAL</span><span>{Number(invoice.total).toFixed(2)} {invoice.currency}</span></div>
        <div className="receipt-row" style={{ color: 'var(--accent)' }}><span>PAID</span><span>{Number(invoice.paidAmount).toFixed(2)} {invoice.currency}</span></div>
        <div className="receipt-sig">
          <div className="receipt-sig-line">Client signature</div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  )
}
