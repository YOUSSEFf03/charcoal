import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useInvoices, useIssueInvoice, useCancelInvoice } from '../hooks/useInvoices'
import { usePayments, useCreatePayment } from '../hooks/usePayments'
import { useClients } from '../hooks/useClients'
import type { Invoice, InvoiceStatus, PaymentMethod } from '../types/api'
import { useRate } from '../context/RateContext'

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

function fmtMoney(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Invoices() {
  const [tab, setTab] = useState<'invoices' | 'payments' | 'outstanding'>('invoices')
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'invoice' | 'payments'>('invoice')
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [payMethod, setPayMethod] = useState('Cash')
  const [usdAmt, setUsdAmt] = useState('')
  const [lbpAmt, setLbpAmt] = useState('')
  const [statusFilter, setStatusFilter] = useState('All status')
  // Invoice currently selected for the panel / pay modal.
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null)

  // Live data sources.
  const apiStatus = ({ 'Paid': 'paid', 'Partial': 'partially_paid', 'Unpaid': 'issued', 'Overdue': 'overdue' } as Record<string, string>)[statusFilter]
  const invoicesQ = useInvoices({ status: apiStatus, limit: 100 })
  const paymentsQ = usePayments({ limit: 100 })
  const outstandingQ = useInvoices({ status: 'overdue', limit: 100 })
  const clientsQ = useClients({ limit: 100 })
  const createPayment = useCreatePayment()
  const issueInvoice = useIssueInvoice()
  const cancelInvoice = useCancelInvoice()
  const { rawRate, rate: fmtRate } = useRate()

  const invoiceRows = invoicesQ.data?.data ?? []
  const paymentRows = paymentsQ.data?.data ?? []
  const outstandingRows = outstandingQ.data?.data ?? []
  const clientList = clientsQ.data?.data ?? []
  const clientNameById = new Map(clientList.map(c => [c.id, c.name]))

  // KPI computations from real data
  const totalInvoiced = invoiceRows.reduce((s, inv) => s + parseFloat(inv.total), 0)
  const totalCollected = paymentRows.reduce((s, p) => s + parseFloat(p.amount), 0)
  const totalOutstanding = invoiceRows
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((s, inv) => s + (parseFloat(inv.total) - parseFloat(inv.paidAmount)), 0)
  const totalOverdue = outstandingRows.reduce((s, inv) => s + (parseFloat(inv.total) - parseFloat(inv.paidAmount)), 0)
  const oldestOverdueDays = outstandingRows.length > 0
    ? Math.max(...outstandingRows.map(inv => inv.dueDate ? Math.max(0, Math.round((Date.now() - new Date(inv.dueDate).getTime()) / 86400000)) : 0))
    : 0

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  const invoiceBalance = activeInvoice ? parseFloat(activeInvoice.total) : 0
  const invoicePaid = activeInvoice ? parseFloat(activeInvoice.paidAmount) : 0
  const invoiceRemaining = invoiceBalance - invoicePaid

  function openPanel(inv: Invoice) {
    setActiveInvoice(inv)
    setPanelTab('invoice')
    setPanelOpen(true)
  }

  function submitPayment() {
    if (!activeInvoice) return
    const usd = parseFloat(usdAmt) || 0
    const lbp = parseFloat(lbpAmt) || 0
    const total = usd + (rawRate > 0 ? lbp / rawRate : 0)
    if (total <= 0) return
    createPayment.mutate(
      {
        clientId: activeInvoice.clientId,
        invoiceId: activeInvoice.id,
        amount: total.toFixed(2),
        currency: 'USD',
        method: payMethod.toLowerCase() as PaymentMethod,
        date: new Date().toISOString().slice(0, 10),
      },
      {
        onSuccess: () => {
          setPayModalOpen(false)
          setUsdAmt('')
          setLbpAmt('')
          showToast(`Payment logged for ${activeInvoice.id}`)
        },
      },
    )
  }

  const usdNum = parseFloat(usdAmt) || 0
  const lbpNum = parseFloat(lbpAmt) || 0
  const totalPay = usdNum + (rawRate > 0 ? lbpNum / rawRate : 0)
  const remaining = invoiceRemaining - totalPay
  const pct = invoiceRemaining > 0 ? Math.min(100, (totalPay / invoiceRemaining) * 100) : 0

  let recvBarClass = 'total-recv-bar none'
  if (pct >= 100) recvBarClass = 'total-recv-bar ok'
  else if (pct > 0) recvBarClass = 'total-recv-bar short'

  const paidPct = invoiceBalance > 0 ? Math.round((invoicePaid / invoiceBalance) * 100) : 0

  return (
    <>
      <Topbar title="Invoices & Payments">
        <span className="rate-display">{fmtRate} LL/$</span>
        <button className="btn btn-ghost" onClick={() => setExportOpen(true)}><i className="ti ti-download" /> Export</button>
      </Topbar>

      <div className="page-body">
        {/* KPI Row */}
        <div className="kpi-row">
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Total Invoiced</span>
              <span className="kpi-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                <i className="ti ti-file-invoice" />
              </span>
            </div>
            <div className="kpi-value">${fmtMoney(String(totalInvoiced))}</div>
            <div className="kpi-sub">{invoiceRows.length} invoices loaded</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Collected</span>
              <span className="kpi-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                <i className="ti ti-circle-check" />
              </span>
            </div>
            <div className="kpi-value">${fmtMoney(String(totalCollected))}</div>
            <div className="kpi-sub kpi-delta delta-up">
              {totalInvoiced > 0 ? <><i className="ti ti-trending-up" /> {Math.round((totalCollected / totalInvoiced) * 100)}% collection rate</> : 'No invoices'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Outstanding</span>
              <span className="kpi-icon" style={{ background: 'var(--accent2-bg)', color: 'var(--accent2)' }}>
                <i className="ti ti-clock" />
              </span>
            </div>
            <div className="kpi-value">${fmtMoney(String(totalOutstanding))}</div>
            <div className="kpi-sub">{invoiceRows.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled').length} open invoices</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Overdue</span>
              <span className="kpi-icon" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>
                <i className="ti ti-alert-triangle" />
              </span>
            </div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${fmtMoney(String(totalOverdue))}</div>
            <div className="kpi-sub kpi-delta delta-warn"><i className="ti ti-alert-circle" /> {outstandingRows.length} invoices overdue</div>
          </div>
        </div>

        {/* Page Tabs */}
        <div className="page-tabs">
          <button className={`page-tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => setTab('invoices')}>
            Invoices <span className="tab-count">{invoicesQ.data?.total ?? invoiceRows.length}</span>
          </button>
          <button className={`page-tab${tab === 'payments' ? ' active' : ''}`} onClick={() => setTab('payments')}>
            Payments <span className="tab-count">{paymentsQ.data?.total ?? paymentRows.length}</span>
          </button>
          <button className={`page-tab${tab === 'outstanding' ? ' active' : ''}`} onClick={() => setTab('outstanding')}>
            Outstanding <span className="tab-count red">{outstandingQ.data?.total ?? outstandingRows.length}</span>
          </button>
        </div>

        {/* Invoices Tab */}
        {tab === 'invoices' && (
          <div className="card">
            <div className="filters">
              <input className="filter-input" placeholder="Search invoices…" />
              <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option>All status</option>
                <option>Paid</option>
                <option>Partial</option>
                <option>Unpaid</option>
                <option>Overdue</option>
              </select>
              <select className="filter-select">
                <option>All clients</option>
              </select>
              <select className="filter-select">
                <option>This month</option>
                <option>Last month</option>
                <option>Custom</option>
              </select>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th>Items</th>
                  <th>Progress</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoicesQ.isLoading && [0, 1, 2].map(i => (
                  <tr key={i}><td colSpan={9}><div className="skeleton" style={{ width: '100%', height: 18 }} /></td></tr>
                ))}
                {invoicesQ.isError && (
                  <tr><td colSpan={9} className="empty">Failed to load invoices.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => invoicesQ.refetch()}>Retry</button></div></td></tr>
                )}
                {!invoicesQ.isLoading && !invoicesQ.isError && invoiceRows.map(inv => {
                  const total = parseFloat(inv.total)
                  const paid = parseFloat(inv.paidAmount)
                  const p = total > 0 ? Math.round((paid / total) * 100) : 0
                  return (
                    <tr key={inv.id} onClick={() => openPanel(inv)} style={{ cursor: 'pointer' }}>
                      <td><span className="mono">{inv.id}</span></td>
                      <td>{clientNameById.get(inv.clientId) ?? '—'}</td>
                      <td>{fmtDate(inv.issuedAt ?? inv.createdAt)}</td>
                      <td>{fmtDate(inv.dueDate)}</td>
                      <td style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>{inv.lines.length} line{inv.lines.length === 1 ? '' : 's'}</td>
                      <td style={{ minWidth: 120 }}>
                        <div className="pay-bar">
                          <div className="pay-bar-fill" style={{ width: `${p}%`, background: inv.status === 'paid' ? 'var(--accent)' : 'var(--accent2)' }} />
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>${fmtMoney(inv.paidAmount)} / ${fmtMoney(inv.total)}</div>
                      </td>
                      <td><strong>${fmtMoney(inv.total)}</strong></td>
                      <td>{statusBadge(inv.status)}</td>
                      <td>
                        {inv.status === 'draft' && (
                          <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); issueInvoice.mutate({ id: inv.id }, { onSuccess: () => showToast(`${inv.id} issued`) }) }}>
                            <i className="ti ti-send" /> Issue
                          </button>
                        )}
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && inv.status !== 'draft' && (
                          <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); setActiveInvoice(inv); setPayModalOpen(true) }}>
                            <i className="ti ti-cash" /> Pay
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {!invoicesQ.isLoading && !invoicesQ.isError && invoiceRows.length === 0 && (
                  <tr><td colSpan={9} className="empty">No invoices found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Payments Tab */}
        {tab === 'payments' && (
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Invoice</th>
                  <th>USD</th>
                  <th>LBP</th>
                  <th>Total (USD)</th>
                  <th>Method</th>
                  <th>Logged by</th>
                </tr>
              </thead>
              <tbody>
                {paymentsQ.isLoading && [0, 1, 2].map(i => (
                  <tr key={i}><td colSpan={8}><div className="skeleton" style={{ width: '100%', height: 18 }} /></td></tr>
                ))}
                {paymentsQ.isError && (
                  <tr><td colSpan={8} className="empty">Failed to load payments.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => paymentsQ.refetch()}>Retry</button></div></td></tr>
                )}
                {!paymentsQ.isLoading && !paymentsQ.isError && paymentRows.map(p => {
                  const amt = parseFloat(p.amount)
                  return (
                    <tr key={p.id}>
                      <td style={{ color: 'var(--text2)', fontSize: '0.83rem' }}>{fmtDate(p.date)}</td>
                      <td>{clientNameById.get(p.clientId) ?? '—'}</td>
                      <td><span className="mono">{p.invoiceId ?? '—'}</span></td>
                      <td><span className="mono">{p.currency === 'USD' ? `$${fmtMoney(p.amount)}` : '—'}</span></td>
                      <td><span className="mono" style={{ color: 'var(--text2)' }}>{p.currency === 'LBP' ? `LL ${amt.toLocaleString()}` : '—'}</span></td>
                      <td><strong>${p.currency === 'USD' ? fmtMoney(p.amount) : (rawRate > 0 ? amt / rawRate : 0).toFixed(2)}</strong></td>
                      <td>{methodBadge(p.method)}</td>
                      <td style={{ color: 'var(--text2)', fontSize: '0.83rem' }}>{p.loggedById}</td>
                    </tr>
                  )
                })}
                {!paymentsQ.isLoading && !paymentsQ.isError && paymentRows.length === 0 && (
                  <tr><td colSpan={8} className="empty">No payments recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Outstanding Tab */}
        {tab === 'outstanding' && (
          <>
            <div className="grid-3" style={{ marginBottom: 16 }}>
              <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4 }}>Total Outstanding</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent2)' }}>${fmtMoney(String(totalOutstanding))}</div>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4 }}>Overdue Amount</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--red)' }}>${fmtMoney(String(totalOverdue))}</div>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4 }}>Oldest Invoice</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{oldestOverdueDays > 0 ? `${oldestOverdueDays} days` : '—'}</div>
              </div>
            </div>
            <div className="card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client</th>
                    <th>Due Date</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Remaining</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingQ.isLoading && [0, 1, 2].map(i => (
                    <tr key={i}><td colSpan={8}><div className="skeleton" style={{ width: '100%', height: 18 }} /></td></tr>
                  ))}
                  {outstandingQ.isError && (
                    <tr><td colSpan={8} className="empty">Failed to load outstanding invoices.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => outstandingQ.refetch()}>Retry</button></div></td></tr>
                  )}
                  {!outstandingQ.isLoading && !outstandingQ.isError && outstandingRows.map(inv => {
                    const total = parseFloat(inv.total)
                    const paid = parseFloat(inv.paidAmount)
                    const daysOver = inv.dueDate ? Math.max(0, Math.round((Date.now() - new Date(inv.dueDate).getTime()) / 86400000)) : 0
                    return (
                      <tr key={inv.id}>
                        <td><span className="mono">{inv.id}</span></td>
                        <td>{clientNameById.get(inv.clientId) ?? '—'}</td>
                        <td>
                          <span style={{ color: daysOver > 0 ? 'var(--red)' : 'inherit' }}>
                            {fmtDate(inv.dueDate)} {daysOver > 0 && <span className="badge badge-red" style={{ marginLeft: 4 }}>{daysOver}d overdue</span>}
                          </span>
                        </td>
                        <td><span className="mono">${fmtMoney(inv.total)}</span></td>
                        <td><span className="mono" style={{ color: 'var(--accent)' }}>${fmtMoney(inv.paidAmount)}</span></td>
                        <td><strong style={{ color: daysOver > 0 ? 'var(--red)' : 'var(--accent2)' }}>${(total - paid).toLocaleString()}</strong></td>
                        <td>{statusBadge(inv.status)}</td>
                        <td>
                          <button className="btn btn-sm btn-ghost" onClick={() => { setActiveInvoice(inv); setPayModalOpen(true) }}>
                            <i className="ti ti-cash" /> Pay
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!outstandingQ.isLoading && !outstandingQ.isError && outstandingRows.length === 0 && (
                    <tr><td colSpan={8} className="empty">No outstanding invoices.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Invoice Panel */}
      {panelOpen && (
        <div className="panel-overlay" onClick={() => setPanelOpen(false)}>
          <div className="inv-panel" onClick={e => e.stopPropagation()}>
            <div className="panel-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{activeInvoice?.id ?? '—'}</span>
                  {activeInvoice && statusBadge(activeInvoice.status)}
                </div>
                <div style={{ color: 'var(--text2)', fontSize: '0.83rem', marginTop: 3 }}>{activeInvoice ? clientNameById.get(activeInvoice.clientId) ?? '—' : ''} · {fmtDate(activeInvoice?.issuedAt ?? activeInvoice?.createdAt)}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setPanelOpen(false)}>
                <i className="ti ti-x" />
              </button>
            </div>

            <div className="panel-tabs">
              <button className={`panel-tab${panelTab === 'invoice' ? ' active' : ''}`} onClick={() => setPanelTab('invoice')}>Invoice</button>
              <button className={`panel-tab${panelTab === 'payments' ? ' active' : ''}`} onClick={() => setPanelTab('payments')}>Payments</button>
            </div>

            <div className="panel-body">
              {panelTab === 'invoice' && (
                <>
                  {/* Balance Bar */}
                  <div className="balance-bar">
                    <div className="bb-row">
                      <span className="bb-mono">${invoicePaid.toLocaleString()} paid</span>
                      <span className="bb-mono" style={{ color: 'var(--red)' }}>${invoiceRemaining.toLocaleString()} remaining</span>
                    </div>
                    <div className="bb-progress">
                      <div className="bb-fill" style={{ width: `${paidPct}%` }} />
                    </div>
                    <div className="bb-labels">
                      <span style={{ color: 'var(--accent)' }}>{paidPct}% collected</span>
                      <span>Total: ${invoiceBalance.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Invoice Preview */}
                  <div className="inv-preview">
                    <div className="inv-lines-head">
                      <span>Item</span>
                      <span>Qty</span>
                      <span>Unit</span>
                      <span>Total</span>
                    </div>
                    <div className="inv-line">
                      <span>Restaurant Grade A</span>
                      <span>140 bags</span>
                      <span>$27.00</span>
                      <span>$3,780</span>
                    </div>
                    <div className="inv-totals">
                      <div className="inv-line">
                        <span style={{ color: 'var(--text2)' }}>Subtotal</span>
                        <span /><span />
                        <span>$3,780.00</span>
                      </div>
                      <div className="inv-line" style={{ fontWeight: 600 }}>
                        <span>Total</span>
                        <span /><span />
                        <span>$3,780.00</span>
                      </div>
                      <div className="inv-line" style={{ color: 'var(--accent)' }}>
                        <span>Paid</span>
                        <span /><span />
                        <span>$1,000.00</span>
                      </div>
                      <div className="inv-line" style={{ color: 'var(--red)', fontWeight: 700 }}>
                        <span>Remaining</span>
                        <span /><span />
                        <span>$2,780.00</span>
                      </div>
                    </div>
                  </div>

                  <div className="panel-section" style={{ marginTop: 16 }}>
                    <div className="panel-row">
                      <span className="panel-section-label">Due Date</span>
                      <span style={{ color: 'var(--red)' }}>May 26, 2026 <span className="badge badge-red">Overdue</span></span>
                    </div>
                    <div className="panel-row">
                      <span className="panel-section-label">Terms</span>
                      <span>Net 14 days</span>
                    </div>
                    <div className="panel-row">
                      <span className="panel-section-label">Issued by</span>
                      <span>Khalil Abi Nader</span>
                    </div>
                  </div>
                </>
              )}

              {panelTab === 'payments' && (
                <div className="panel-section">
                  <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '32px 0', fontSize: '0.87rem' }}>
                    <i className="ti ti-cash" style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }} />
                    1 payment logged
                  </div>
                  <div className="pay-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>$1,000.00</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>May 15, 2026 · Cash · Rami S</div>
                    </div>
                    {methodBadge('Cash')}
                  </div>
                </div>
              )}
            </div>

            <div className="panel-footer">
              <button className="panel-btn pbtn-ghost" onClick={() => setPrintOpen(true)}><i className="ti ti-printer" /> Print</button>
              {activeInvoice && activeInvoice.status !== 'cancelled' && activeInvoice.status !== 'paid' && (
                <button className="panel-btn pbtn-ghost" onClick={() => { if (activeInvoice) cancelInvoice.mutate(activeInvoice.id, { onSuccess: () => { setPanelOpen(false); showToast(`${activeInvoice.id} cancelled`) } }) }} disabled={cancelInvoice.isPending}>
                  <i className="ti ti-ban" /> Cancel invoice
                </button>
              )}
              <button className="panel-btn pbtn-green" onClick={() => setPayModalOpen(true)}>
                <i className="ti ti-cash" /> Log Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Payment Modal */}
      {payModalOpen && (
        <div className="modal-overlay" onClick={() => setPayModalOpen(false)}>
          <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Log Payment</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{activeInvoice?.id ?? '—'} · {activeInvoice ? clientNameById.get(activeInvoice.clientId) ?? '' : ''}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setPayModalOpen(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="modal-body">
              <div className="form-label">Amount Received</div>
              <div className="split-box">
                <div className="form-group">
                  <label className="form-label">USD</label>
                  <div className="input-with-icon">
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0.00"
                      value={usdAmt}
                      onChange={e => setUsdAmt(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text3)', fontWeight: 600, paddingTop: 20 }}>+</div>
                <div className="form-group">
                  <label className="form-label">LBP</label>
                  <div className="input-with-icon">
                    <span className="input-prefix">LL</span>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0"
                      value={lbpAmt}
                      onChange={e => setLbpAmt(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Total recv bar */}
              <div className={recvBarClass} style={{ margin: '12px 0 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Receiving: <strong>${totalPay.toFixed(2)}</strong></span>
                  <span style={{ color: 'var(--text3)' }}>{pct.toFixed(0)}%</span>
                </div>
                <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct >= 100 ? 'var(--accent)' : pct > 0 ? 'var(--accent2)' : 'transparent',
                    transition: 'width 0.2s'
                  }} />
                </div>
              </div>

              {/* Remaining box */}
              <div className="remaining-box" style={{ background: remaining <= 0 ? 'var(--accent-bg)' : 'var(--red-bg)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: '0.83rem', color: remaining <= 0 ? 'var(--accent)' : 'var(--red)' }}>
                  {remaining <= 0 ? 'Fully settled' : 'Remaining after payment'}
                </span>
                <strong style={{ color: remaining <= 0 ? 'var(--accent)' : 'var(--red)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {remaining <= 0 ? '✓ $0.00' : `$${remaining.toFixed(2)}`}
                </strong>
              </div>

              <div className="form-group">
                <label className="form-label">Payment Method</label>
                <div className="method-pills">
                  {['Cash', 'Whish', 'OMT', 'Bank'].map(m => (
                    <button
                      key={m}
                      className={`method-pill${payMethod === m ? ' sel' : ''}`}
                      onClick={() => setPayMethod(m)}
                    >{m}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <input type="text" className="form-input" placeholder="e.g. partial payment, check #1234…" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPayModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitPayment} disabled={createPayment.isPending || usdNum <= 0}>
                <i className="ti ti-check" /> {createPayment.isPending ? 'Saving…' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXPORT MODAL */}
      {exportOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setExportOpen(false)}>
          <div className="modal" style={{ width: 400 }}>
            <div className="modal-head">
              <div className="modal-title"><i className="ti ti-download" style={{ fontSize: 14, marginRight: 6 }} />Export invoices</div>
              <button className="panel-close-btn" onClick={() => setExportOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Format</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['PDF', 'CSV', 'Excel'].map(f => (
                    <div key={f} className="stop-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', background: f === 'PDF' ? 'var(--text)' : 'transparent', color: f === 'PDF' ? '#fff' : 'var(--text2)', borderColor: f === 'PDF' ? 'var(--text)' : 'var(--border)', padding: '7px 0', borderRadius: 'var(--radius)', border: '1px solid', fontSize: 13 }}>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Date range</label>
                <select className="form-input">
                  <option>This month (May 2026)</option>
                  <option>Last month</option>
                  <option>Last 3 months</option>
                  <option>Custom range</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Include</label>
                {['All invoices', 'Paid only', 'Unpaid / overdue only'].map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13, cursor: 'pointer' }}>
                    <input type="radio" name="inc" defaultChecked={opt === 'All invoices'} /> {opt}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setExportOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setExportOpen(false); showToast('Export ready — invoices_may2026.pdf') }}><i className="ti ti-download" style={{ fontSize: 14 }} /> Export</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT MODAL */}
      {printOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPrintOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-printer" style={{ fontSize: 14, marginRight: 6 }} />Print invoice</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>INV-0334 · Tyre Catering Group</div>
              </div>
              <button className="panel-close-btn" onClick={() => setPrintOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="receipt" style={{ fontSize: 13 }}>
                <div className="receipt-title">FARAH CHARCOAL</div>
                <div className="receipt-sub">Tax Invoice</div>
                <hr className="receipt-divider" />
                <div className="receipt-row"><span>Invoice #</span><span>INV-0334</span></div>
                <div className="receipt-row"><span>Date</span><span>May 12, 2026</span></div>
                <div className="receipt-row"><span>Due</span><span style={{ color: 'var(--red)' }}>May 26, 2026 (overdue)</span></div>
                <div className="receipt-row"><span>Client</span><span>Tyre Catering Group</span></div>
                <hr className="receipt-divider" />
                <div className="receipt-row"><span>Restaurant Grade A × 140 bags</span><span>$3,780</span></div>
                <hr className="receipt-divider" />
                <div className="receipt-row total"><span>TOTAL</span><span>$3,780.00</span></div>
                <div className="receipt-row" style={{ color: 'var(--accent)' }}><span>PAID</span><span>$1,000.00</span></div>
                <div className="receipt-row" style={{ color: 'var(--red)', fontWeight: 700 }}><span>REMAINING</span><span>$2,780.00</span></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPrintOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setPrintOpen(false); showToast('Printing INV-0334…') }}><i className="ti ti-printer" style={{ fontSize: 14 }} /> Print</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
