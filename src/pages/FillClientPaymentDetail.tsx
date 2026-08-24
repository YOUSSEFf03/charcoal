import { useParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { usePayment } from '../hooks/usePayments'
import { formatUsd } from '../lib/money'
import { formatDateTime } from '../lib/date'

/**
 * Payment detail — accounting-sensitive record. PaymentsController exposes
 * no update/delete route (payments are immutable once created), so this
 * page shows no edit/delete action — that isn't a UI omission, it reflects
 * the actual backend contract.
 */
export default function FillClientPaymentDetail() {
  const { clientId, paymentId } = useParams<{ clientId: string; paymentId: string }>()

  const paymentQ = usePayment(paymentId ?? '')
  const payment = paymentQ.data

  if (paymentQ.isLoading) {
    return (
      <>
        <Topbar title="Payment" back={{ label: 'Payment History', to: `/fill-clients/${clientId}/payments` }} />
        <div className="content"><div className="empty">Loading…</div></div>
      </>
    )
  }
  if (paymentQ.isError || !payment) {
    return (
      <>
        <Topbar title="Payment" back={{ label: 'Payment History', to: `/fill-clients/${clientId}/payments` }} />
        <div className="content"><div className="empty">Payment not found.</div></div>
      </>
    )
  }

  return (
    <>
      <Topbar title={payment.displayId ?? 'Payment'} back={{ label: 'Payment History', to: `/fill-clients/${clientId}/payments` }} />
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{payment.displayId ?? 'Payment'}</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-user" /> {(payment as any).client?.name ?? '—'}</span>
              <span className="meta-row"><i className="ti ti-calendar" /> {formatDateTime(payment.date, { day: '2-digit' })}</span>
              <span className="badge badge-gray">{payment.method}</span>
            </div>
          </div>
          <div className="kpi-strip">
            <div className="kpi-tile green">
              <div className="kpi-tile-label">Amount</div>
              <div className="kpi-tile-value">{formatUsd(payment.amount)}</div>
              <div className="kpi-tile-sub">{payment.currency}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-info-circle" /> Details</div></div>
          <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 13 }}>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Method</div>{payment.method}</div>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Currency</div>{payment.currency}</div>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Received by</div>{payment.receiver?.name ?? payment.receiverName ?? '—'}</div>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Logged by</div>{payment.loggedBy?.name ?? '—'}</div>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Logged at</div>{formatDateTime(payment.createdAt, { day: '2-digit' })}</div>
            {payment.notes && (
              <div style={{ gridColumn: '1/-1' }}><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Reference / notes</div>{payment.notes}</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-link" /> Allocation</div></div>
          {!payment.allocations || payment.allocations.length === 0 ? (
            <div className="empty">Applied at the client level — not linked to a specific invoice.</div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Invoice</th><th className="right">Amount applied</th></tr></thead>
              <tbody>
                {payment.allocations.map(a => (
                  <tr key={a.id}>
                    <td>{a.invoice?.displayId ?? a.invoiceId}</td>
                    <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--text3)', padding: '4px 2px' }}>
          Payments are immutable once recorded — this page has no edit or delete action.
        </div>
      </div>
    </>
  )
}
