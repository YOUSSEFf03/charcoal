import { useParams, useNavigate, Link } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useInvoice, useCancelInvoice } from '../hooks/useInvoices'
import { formatDate } from '../lib/date'

function statusBadge(status: string) {
  if (status === 'paid') return <span className="badge badge-green">Paid</span>
  if (status === 'partially_paid' || status === 'partial') return <span className="badge badge-amber">Partial</span>
  if (status === 'issued') return <span className="badge badge-blue">Issued</span>
  if (status === 'overdue') return <span className="badge badge-red">Overdue</span>
  if (status === 'cancelled') return <span className="badge badge-gray">Cancelled</span>
  return <span className="badge badge-gray">Draft</span>
}

function methodBadge(method: string) {
  if (!method) return null
  const m = method.toLowerCase()
  if (m === 'whish') return <span className="badge badge-purple">{method}</span>
  if (m === 'omt') return <span className="badge badge-blue">{method}</span>
  return <span className="badge badge-gray">{method}</span>
}

// This page and InvoicePrint.tsx both format amounts the same way — with the
// invoice's own currency, not an assumed "$" — since an invoice can be USD or
// LBP (Invoice.currency) and both views must never silently disagree.
function fmtAmt(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'
}

function fmtDate(iso?: string | null) { return formatDate(iso) }

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const invoiceQ = useInvoice(id ?? '')
  const cancelInvoice = useCancelInvoice()
  const invoice = invoiceQ.data

  if (invoiceQ.isLoading) {
    return (
      <>
        <Topbar title="Invoice" back={{ label: 'Invoices', to: '/invoices' }} />
        <div className="content">
          <div className="skeleton" style={{ width: '40%', height: 28, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 240 }} />
        </div>
      </>
    )
  }

  if (invoiceQ.isError || !invoice) {
    const status = (invoiceQ.error as { status?: number } | null)?.status
    const msg = status === 404 ? 'Invoice not found.' : 'Failed to load invoice.'
    return (
      <>
        <Topbar title="Invoice" back={{ label: 'Invoices', to: '/invoices' }} />
        <div className="content">
          <div className="empty">
            {msg}
            {status !== 404 && <div><button className="btn" style={{ marginTop: 10 }} onClick={() => invoiceQ.refetch()}>Retry</button></div>}
          </div>
        </div>
      </>
    )
  }

  const invoiceDisplay = invoice.displayId ?? invoice.id
  // Same guard InvoiceCalculatorService.validateCancellable() enforces server-side
  // (INVALID_TRANSITION / PAYMENT_EXISTS) — this only prevents offering an action
  // that would already fail; the backend remains the authoritative check.
  const canCancel = invoice.status !== 'cancelled' && invoice.status !== 'paid' && parseFloat(invoice.paidAmount) === 0
  const balanceDue = invoice.balanceDue ?? (parseFloat(invoice.total) - parseFloat(invoice.paidAmount)).toFixed(2)

  return (
    <>
      <Topbar title={invoiceDisplay} back={{ label: 'Invoices', to: '/invoices' }}>
        {/* Reuses the existing, already-authoritative print/PDF page (same
            GET /invoices/:id this page reads) — window.print() there lets the
            user save as PDF. No second invoice-rendering system. */}
        <a className="btn" href={`/invoice/${invoice.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print / PDF
        </a>
        {canCancel && (
          <button
            className="btn"
            style={{ color: 'var(--red)' }}
            disabled={cancelInvoice.isPending}
            onClick={() => {
              if (!confirm(`Cancel invoice ${invoiceDisplay}? This cannot be undone.`)) return
              cancelInvoice.mutate(invoice.id, {
                onSuccess: () => navigate('/invoices'),
                onError: (err: any) => alert(err?.error ?? 'Failed to cancel invoice'),
              })
            }}
          >
            <i className="ti ti-ban" style={{ fontSize: 15 }} /> Cancel invoice
          </button>
        )}
      </Topbar>

      <div className="content">
        {/* HEADER */}
        <div className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontWeight: 700, fontSize: '1.15rem' }} title={invoice.id}>{invoiceDisplay}</span>
                {statusBadge(invoice.status)}
              </div>
              <div style={{ color: 'var(--text2)', fontSize: '0.87rem', marginTop: 4 }}>
                Issued {fmtDate(invoice.issuedAt ?? invoice.createdAt)}
                {invoice.dueDate && <> · Due {fmtDate(invoice.dueDate)}</>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>Client</div>
              <Link to={`/clients/${invoice.client.id}`} style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                {invoice.client.name}
              </Link>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, alignItems: 'start' }}>
          <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* INVOICE ITEMS */}
            <div className="card">
              <div className="card-head"><div className="card-title"><i className="ti ti-list" /> Items</div></div>
              <table className="data-table">
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Unit price</th><th className="right">Total</th></tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, i) => (
                    <tr key={i}>
                      {line.saleUnit === 'KG' ? (
                        <>
                          <td>{line.description}</td>
                          <td>{line.kgQuantity} kg</td>
                          <td>{fmtAmt(line.pricePerKg)} {invoice.currency}/kg</td>
                          <td className="right">{fmtAmt(line.lineTotal)} {invoice.currency}</td>
                        </>
                      ) : (
                        <>
                          <td>{line.bagTypeName ?? line.bagTypeId}</td>
                          <td>{line.qty} bags</td>
                          <td>{fmtAmt(line.pricePerBag)} {invoice.currency}</td>
                          <td className="right">{fmtAmt(line.lineTotal)} {invoice.currency}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {invoice.lines.length === 0 && (
                    <tr><td colSpan={4} className="empty">No line items.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <td colSpan={3} style={{ fontWeight: 600 }}>Subtotal</td>
                    <td className="right" style={{ fontWeight: 600 }}>{fmtAmt(invoice.subtotal)} {invoice.currency}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* PAYMENTS — allocations is the authoritative "what's actually
                applied to this invoice" record (see InvoicesService.findOne()'s
                doc comment): it includes amounts FIFO-allocated here from a
                client-level payment, which the raw `payments` relation misses. */}
            <div className="card">
              <div className="card-head"><div className="card-title"><i className="ti ti-cash" /> Payments applied</div></div>
              {invoice.allocations.length === 0 && (
                <div className="empty" style={{ padding: '20px 18px' }}>No payments applied yet.</div>
              )}
              {invoice.allocations.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr><th>Receipt #</th><th>Date</th><th>Method</th><th className="right">Applied</th></tr>
                  </thead>
                  <tbody>
                    {invoice.allocations.map(a => (
                      <tr key={a.id}>
                        <td className="mono">{a.payment.displayId ?? a.payment.id.slice(0, 8)}</td>
                        <td>{fmtDate(a.payment.date)}</td>
                        <td>{methodBadge(a.payment.method)}</td>
                        <td className="right">{fmtAmt(a.amount)} {invoice.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* TOTALS */}
            <div className="card" style={{ padding: 16 }}>
              <div className="card-title" style={{ marginBottom: 10 }}><i className="ti ti-receipt" /> Totals</div>
              <div className="panel-row"><span className="panel-section-label">Subtotal</span><span>{fmtAmt(invoice.subtotal)} {invoice.currency}</span></div>
              <div className="panel-row" style={{ fontWeight: 600 }}><span className="panel-section-label">Total</span><span>{fmtAmt(invoice.total)} {invoice.currency}</span></div>
              <div className="panel-row" style={{ color: 'var(--accent)' }}><span className="panel-section-label">Paid</span><span>{fmtAmt(invoice.paidAmount)} {invoice.currency}</span></div>
              <div className="panel-row" style={{ color: parseFloat(balanceDue) > 0 ? 'var(--red)' : 'var(--accent)', fontWeight: 700 }}>
                <span className="panel-section-label">Balance due</span><span>{fmtAmt(balanceDue)} {invoice.currency}</span>
              </div>
            </div>

            {/* CUSTOMER */}
            <div className="card" style={{ padding: 16 }}>
              <div className="card-title" style={{ marginBottom: 10 }}><i className="ti ti-user" /> Customer</div>
              <div className="panel-row"><span className="panel-section-label">Name</span><span>{invoice.client.name}</span></div>
              <div className="panel-row"><span className="panel-section-label">Type</span><span style={{ textTransform: 'capitalize' }}>{invoice.client.type}</span></div>
              <div className="panel-row"><span className="panel-section-label">Currency</span><span>{invoice.client.currency}</span></div>
              {(invoice.client.phones ?? []).filter(p => p.isActive).slice(0, 2).map((p, i) => (
                <div className="panel-row" key={i}><span className="panel-section-label">{p.label}</span><span>{p.number}</span></div>
              ))}
            </div>

            {/* SOURCE */}
            <div className="card" style={{ padding: 16 }}>
              <div className="card-title" style={{ marginBottom: 10 }}><i className="ti ti-ship" /> Source</div>
              {invoice.order ? (
                <div className="panel-row">
                  <span className="panel-section-label">Order</span>
                  <Link to={`/orders/${invoice.order.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {invoice.order.displayId ?? invoice.order.id.slice(0, 8)}
                  </Link>
                </div>
              ) : (
                <div className="panel-row"><span className="panel-section-label">Type</span><span>Warehouse sale (no order)</span></div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
