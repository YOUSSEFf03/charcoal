import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useInvoices, useIssueInvoice, useCancelInvoice } from '../hooks/useInvoices'
import { usePayments, useCreatePayment } from '../hooks/usePayments'
import { useClients } from '../hooks/useClients'
import { useArSummary } from '../hooks/useReports'
import { useCashReceivers } from '../hooks/useUsers'
import type { Invoice, InvoiceStatus, PaymentMethod } from '../types/api'
import { useRate } from '../context/RateContext'
import { roundDp, formatUsd } from '../lib/money'
import { formatDate, toDateOnlyString, currentMonthToDateRange } from '../lib/date'

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

function fmtMoney(value?: string | null) { return formatUsd(value, { decimals: 2, symbol: false, fallback: '0' }) }
function fmtDate(iso?: string | null) { return formatDate(iso) }

// The Log Payment modal's pill labels don't all lowercase to a valid
// PaymentMethod enum value — Prisma/CreatePaymentDto's enum is
// 'bank_transfer', not 'bank', so a plain .toLowerCase() on the 'Bank' pill
// produced a value @IsEnum(PaymentMethod) always rejects with a 422,
// meaning a user could never actually submit a bank-transfer payment here.
const PAY_METHOD_TO_ENUM: Record<string, PaymentMethod> = {
  Cash: 'cash',
  Whish: 'whish',
  OMT: 'omt',
  Bank: 'bank_transfer',
}

export default function Invoices() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'invoices' | 'payments' | 'outstanding'>('invoices')
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [payMethod, setPayMethod] = useState('Cash')
  const [usdAmt, setUsdAmt] = useState('')
  const [lbpAmt, setLbpAmt] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [payReceiverId, setPayReceiverId] = useState('')
  const [statusFilter, setStatusFilter] = useState('All status')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('')       // UUID or '' = all
  const [dateRange, setDateRange] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // Invoice currently selected for the panel / pay modal.
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Compute ISO date bounds from the date-range selector. toDateOnlyString
  // (local calendar-day parts) — never toISOString().slice(0,10), which
  // converts to UTC first and silently rolls the date back a day in a
  // timezone ahead of UTC (Beirut, UTC+3), e.g. "This month" opening on 31
  // July instead of 1 August.
  const today = new Date()
  const { dateFrom, dateTo } = (() => {
    if (dateRange === 'This month') return currentMonthToDateRange()
    if (dateRange === 'Last month') return {
      dateFrom: toDateOnlyString(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      dateTo: toDateOnlyString(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
    if (dateRange === 'Custom') return { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
    return { dateFrom: undefined, dateTo: undefined }
  })()

  // Pagination — same proven architecture as Orders & Delivery: the backend's
  // findAll() is already correctly paginated (skip/take + a matching count());
  // this page previously requested a single fixed limit:100 batch with no way
  // to reach anything beyond it.
  const INVOICES_PAGE_SIZE = 20
  const [page, setPage] = useState(1)
  const [outstandingPage, setOutstandingPage] = useState(1)

  // Every server-side filter must land back on page 1 — otherwise a user on
  // page 5 of "All status" could apply a filter with only 1 matching page and
  // see an empty page 5 instead of their results. debouncedSearch (not the
  // raw `search` keystroke state) is the correct dependency here since that's
  // what actually reaches the API.
  useEffect(() => { setPage(1) }, [statusFilter, clientFilter, debouncedSearch, dateFrom, dateTo])

  // Live data sources.
  const apiStatus = ({ 'Paid': 'paid', 'Partial': 'partially_paid', 'Unpaid': 'issued', 'Overdue': 'overdue' } as Record<string, string>)[statusFilter]
  const invoicesQ = useInvoices({
    status: apiStatus,
    clientId: clientFilter || undefined,
    search: debouncedSearch || undefined,
    dateFrom,
    dateTo,
    page,
    limit: INVOICES_PAGE_SIZE,
  })
  const paymentsQ = usePayments({ limit: 100 })
  // outstandingQ feeds the Outstanding tab TABLE only — not used for KPI numbers.
  // Paginated independently of the main tab (own page state) — it has no
  // filters of its own beyond the fixed status:'overdue', so nothing else can
  // invalidate its current page.
  const outstandingQ = useInvoices({ status: 'overdue', page: outstandingPage, limit: INVOICES_PAGE_SIZE })
  const clientsQ = useClients({ limit: 100 })
  const arQ = useArSummary()
  const createPayment = useCreatePayment()
  const issueInvoice = useIssueInvoice()
  const cancelInvoice = useCancelInvoice()
  const { rawRate, rate: fmtRate } = useRate()

  // receiverId must be a real User ID (payments_receiverId_fkey) so the
  // payment credits that user's cash-handover ledger. See Payment.tsx's
  // matching comment — useCashReceivers() replaces the old combination of
  // useWorkers() (wrong FK) + useReceivers() + a fake hardcoded "Owner".
  const receiversQ = useCashReceivers()
  const allReceivers = receiversQ.data ?? []
  // Bank transfer lands directly in the company account — no person holds
  // custody of the cash, so (per CASH_MANAGEMENT_FINAL_BLUEPRINT.md's "a
  // bank_transfer payment never touches the cash ledger") it's the one
  // method here exempt from the receiver requirement. Cash/Whish/OMT are all
  // personal-custody methods — same rule PaymentsService.create() enforces
  // server-side (RECEIVER_REQUIRED_METHODS).
  const receiverRequired = payMethod !== 'Bank'

  const invoiceRows = invoicesQ.data?.data ?? []
  const paymentRows = paymentsQ.data?.data ?? []
  const outstandingRows = outstandingQ.data?.data ?? []
  const invoiceTotal = invoicesQ.data?.total ?? invoiceRows.length
  const invoiceTotalPages = Math.max(1, Math.ceil(invoiceTotal / INVOICES_PAGE_SIZE))
  const outstandingTotal = outstandingQ.data?.total ?? outstandingRows.length
  const outstandingTotalPages = Math.max(1, Math.ceil(outstandingTotal / INVOICES_PAGE_SIZE))
  const clientList = clientsQ.data?.data ?? []
  const clientNameById = new Map(clientList.map(c => [c.id, c.name]))
  // Real backend display IDs (INV-001 …) keyed by invoice id, for resolving the
  // related invoice of a payment row (payments carry only invoiceId).
  const invoiceDisplayById = new Map(
    [...invoiceRows, ...outstandingRows].map(inv => [inv.id, inv.displayId]),
  )
  // Display code for the active (clicked) invoice.
  const activeInvoiceDisplay = activeInvoice
    ? activeInvoice.displayId ?? activeInvoice.id
    : '—'

  // KPI values — full-table SQL aggregates from the backend (never a reduce over a page).
  const ar = arQ.data
  const totalInvoiced    = parseFloat(ar?.totalInvoiced    ?? '0')
  const totalCollected   = parseFloat(ar?.totalCollected   ?? '0')
  const totalOutstanding = parseFloat(ar?.totalOutstanding ?? '0')
  const totalOverdue     = parseFloat(ar?.totalOverdue     ?? '0')
  const oldestOverdueDays = ar?.oldestOverdueDays ?? 0

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  const invoiceBalance = activeInvoice ? parseFloat(activeInvoice.total) : 0
  const invoicePaid = activeInvoice ? parseFloat(activeInvoice.paidAmount) : 0
  const invoiceRemaining = roundDp(invoiceBalance - invoicePaid, 2)

  function submitPayment() {
    if (!activeInvoice) return
    const usd = parseFloat(usdAmt) || 0
    const lbp = parseFloat(lbpAmt) || 0
    const total = roundDp(usd + (rawRate > 0 ? lbp / rawRate : 0), 2)
    if (total <= 0) return
    if (receiverRequired && !payReceiverId) {
      showToast('Receiver is required.')
      return
    }
    createPayment.mutate(
      {
        clientId: activeInvoice.clientId,
        invoiceId: activeInvoice.id,
        amount: total.toFixed(2),
        currency: 'USD',
        method: PAY_METHOD_TO_ENUM[payMethod] ?? (payMethod.toLowerCase() as PaymentMethod),
        date: toDateOnlyString(new Date()),
        notes: payNotes || null,
        ...(payReceiverId ? { receiverId: payReceiverId } : {}),
      },
      {
        onSuccess: () => {
          setPayModalOpen(false)
          setUsdAmt('')
          setLbpAmt('')
          setPayNotes('')
          setPayReceiverId('')
          showToast(`Payment logged for ${activeInvoiceDisplay}`)
        },
      },
    )
  }

  const usdNum = parseFloat(usdAmt) || 0
  const lbpNum = parseFloat(lbpAmt) || 0
  const totalPay = roundDp(usdNum + (rawRate > 0 ? lbpNum / rawRate : 0), 2)
  const remaining = roundDp(invoiceRemaining - totalPay, 2)
  const pct = invoiceRemaining > 0 ? Math.min(100, (totalPay / invoiceRemaining) * 100) : 0

  let recvBarClass = 'total-recv-bar none'
  if (pct >= 100) recvBarClass = 'total-recv-bar ok'
  else if (pct > 0) recvBarClass = 'total-recv-bar short'

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
            <div className="kpi-value">{arQ.isLoading ? '…' : `$${fmtMoney(String(totalInvoiced))}`}</div>
            <div className="kpi-sub">{ar?.openInvoiceCount ?? '—'} open invoices</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Collected</span>
              <span className="kpi-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                <i className="ti ti-circle-check" />
              </span>
            </div>
            <div className="kpi-value">{arQ.isLoading ? '…' : `$${fmtMoney(String(totalCollected))}`}</div>
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
            <div className="kpi-value">{arQ.isLoading ? '…' : `$${fmtMoney(String(totalOutstanding))}`}</div>
            <div className="kpi-sub">{ar?.openInvoiceCount ?? '—'} not yet paid</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Overdue</span>
              <span className="kpi-icon" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>
                <i className="ti ti-alert-triangle" />
              </span>
            </div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>{arQ.isLoading ? '…' : `$${fmtMoney(String(totalOverdue))}`}</div>
            <div className="kpi-sub kpi-delta delta-warn"><i className="ti ti-alert-circle" /> {ar?.overdueCount ?? '—'} invoices overdue</div>
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
              <div className="filter-input">
                <i className="ti ti-search" />
                <input
                  type="text"
                  placeholder="Search invoice # or client name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option>All status</option>
                <option>Paid</option>
                <option>Partial</option>
                <option>Unpaid</option>
                <option>Overdue</option>
              </select>
              <select className="filter-select" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
                <option value="">All clients</option>
                {clientList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="filter-select" value={dateRange} onChange={e => setDateRange(e.target.value)}>
                <option>All time</option>
                <option>This month</option>
                <option>Last month</option>
                <option>Custom</option>
              </select>
              {dateRange === 'Custom' && (
                <>
                  <input
                    type="date"
                    className="filter-select"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                  />
                  <input
                    type="date"
                    className="filter-select"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                  />
                </>
              )}
              {(search || clientFilter || dateRange !== 'All time') && (
                <button
                  className="btn"
                  style={{ fontSize: 12 }}
                  onClick={() => { setSearch(''); setClientFilter(''); setDateRange('All time'); setCustomFrom(''); setCustomTo('') }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="table-scroll">
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
                      <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                        <td><span className="mono" title={inv.id}>{inv.displayId ?? inv.id}</span></td>
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
                            <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); issueInvoice.mutate({ id: inv.id }, { onSuccess: () => showToast(`${inv.displayId ?? inv.id} issued`) }) }}>
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
            {!invoicesQ.isLoading && !invoicesQ.isError && invoiceRows.length > 0 && invoiceTotalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                </button>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Page {page} of {invoiceTotalPages}
                </span>
                <button className="btn" disabled={page >= invoiceTotalPages} onClick={() => setPage(p => Math.min(invoiceTotalPages, p + 1))}>
                  Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {tab === 'payments' && (
          <div className="card">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Invoice</th>
                    <th>USD</th>
                    <th>LBP</th>
                    <th>Total (USD)</th>
                    <th>Method</th>
                    <th>Receiver</th>
                    <th>Logged by</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsQ.isLoading && [0, 1, 2].map(i => (
                    <tr key={i}><td colSpan={10}><div className="skeleton" style={{ width: '100%', height: 18 }} /></td></tr>
                  ))}
                  {paymentsQ.isError && (
                    <tr><td colSpan={10} className="empty">Failed to load payments.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => paymentsQ.refetch()}>Retry</button></div></td></tr>
                  )}
                  {!paymentsQ.isLoading && !paymentsQ.isError && paymentRows.map(p => {
                    const amt = parseFloat(p.amount)
                    return (
                      <tr key={p.id}>
                        <td><span className="mono" title={p.id}>{p.displayId ?? p.id.slice(0, 8)}</span></td>
                        <td style={{ color: 'var(--text2)', fontSize: '0.83rem' }}>{fmtDate(p.date)}</td>
                        <td>{clientNameById.get(p.clientId) ?? '—'}</td>
                        <td><span className="mono" title={p.invoiceId ?? undefined}>{p.invoiceId ? (invoiceDisplayById.get(p.invoiceId) ?? p.invoiceId) : '—'}</span></td>
                        <td><span className="mono">{p.currency === 'USD' ? `$${fmtMoney(p.amount)}` : '—'}</span></td>
                        <td><span className="mono" style={{ color: 'var(--text2)' }}>{p.currency === 'LBP' ? `LL ${amt.toLocaleString()}` : '—'}</span></td>
                        <td><strong>${p.currency === 'USD' ? fmtMoney(p.amount) : (rawRate > 0 ? amt / rawRate : 0).toFixed(2)}</strong></td>
                        <td>{methodBadge(p.method)}</td>
                        {/* receiver (authoritative relation, same value cash attribution
                            uses) over receiverName (denormalized, goes stale on rename). */}
                        <td style={{ color: 'var(--text2)', fontSize: '0.83rem' }}>{p.receiver?.name ?? p.receiverName ?? '—'}</td>
                        <td style={{ color: 'var(--text2)', fontSize: '0.83rem' }}>{p.loggedBy?.name ?? p.loggedById}</td>
                      </tr>
                    )
                  })}
                  {!paymentsQ.isLoading && !paymentsQ.isError && paymentRows.length === 0 && (
                    <tr><td colSpan={10} className="empty">No payments recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Outstanding Tab */}
        {tab === 'outstanding' && (
          <>
            <div className="grid-3" style={{ marginBottom: 16 }}>
              <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4 }}>Total Outstanding</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent2)' }}>{arQ.isLoading ? '…' : `$${fmtMoney(String(totalOutstanding))}`}</div>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4 }}>Overdue Amount</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--red)' }}>{arQ.isLoading ? '…' : `$${fmtMoney(String(totalOverdue))}`}</div>
              </div>
              <div className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4 }}>Oldest Invoice</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{arQ.isLoading ? '…' : oldestOverdueDays > 0 ? `${oldestOverdueDays} days` : '—'}</div>
              </div>
            </div>
            <div className="card">
              <div className="table-scroll">
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
                        <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                          <td><span className="mono" title={inv.id}>{inv.displayId ?? inv.id}</span></td>
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
                            <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); setActiveInvoice(inv); setPayModalOpen(true) }}>
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
              {!outstandingQ.isLoading && !outstandingQ.isError && outstandingRows.length > 0 && outstandingTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                  <button className="btn" disabled={outstandingPage <= 1} onClick={() => setOutstandingPage(p => Math.max(1, p - 1))}>
                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    Page {outstandingPage} of {outstandingTotalPages}
                  </span>
                  <button className="btn" disabled={outstandingPage >= outstandingTotalPages} onClick={() => setOutstandingPage(p => Math.min(outstandingTotalPages, p + 1))}>
                    Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Log Payment Modal */}
      {payModalOpen && (
        <div className="modal-overlay open" onClick={() => setPayModalOpen(false)}>
          <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Log Payment</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{activeInvoiceDisplay} · {activeInvoice ? clientNameById.get(activeInvoice.clientId) ?? '' : ''}</div>
              </div>
              <button className="btn btn-ghost" aria-label="Close" onClick={() => setPayModalOpen(false)}><i className="ti ti-x" /></button>
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
                <label className="form-label">
                  Received by {receiverRequired && <span style={{ color: 'var(--red)' }}>*</span>}
                  {!receiverRequired && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> (optional for bank transfer)</span>}
                </label>
                <select className="form-input" value={payReceiverId} onChange={e => setPayReceiverId(e.target.value)}>
                  <option value="">— select receiver —</option>
                  {allReceivers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {receiverRequired && !payReceiverId && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Receiver is required.</div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. partial payment, check #1234…"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPayModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitPayment} disabled={createPayment.isPending || usdNum <= 0 || (receiverRequired && !payReceiverId)}>
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
              <button className="panel-close-btn" aria-label="Close" onClick={() => setExportOpen(false)}>✕</button>
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

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
