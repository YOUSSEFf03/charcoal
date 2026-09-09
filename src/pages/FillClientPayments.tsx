import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient, useClientBalance } from '../hooks/useClients'
import { usePayments } from '../hooks/usePayments'
import { useClientLedger } from '../hooks/useReports'
import { formatUsd } from '../lib/money'
import { formatDateTime, toDateOnlyString, currentMonthToDateRange, currentWeekToDateRange } from '../lib/date'

type RangePreset = 'All time' | 'This month' | 'This week' | 'Last month' | 'Custom'
const PAGE_SIZE = 20

/**
 * Dedicated Payment History page for a Fill Client — reuses the same
 * Payment model/PaymentsService as normal clients (no separate payment
 * calculation). "Total paid" for the selected period comes from the
 * authoritative client-ledger credit total (ReportsService.getClientLedger),
 * not a client-side sum of the paginated rows below.
 */
export default function FillClientPayments() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const clientQ = useClient(id ?? '')
  const client = clientQ.data
  const balanceQ = useClientBalance(id ?? '')

  const [rangePreset, setRangePreset] = useState<RangePreset>('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [page, setPage] = useState(1)

  const today = new Date()
  const { dateFrom, dateTo } = (() => {
    if (rangePreset === 'This month') return currentMonthToDateRange()
    if (rangePreset === 'This week') return currentWeekToDateRange()
    if (rangePreset === 'Last month') return {
      dateFrom: toDateOnlyString(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      dateTo: toDateOnlyString(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
    if (rangePreset === 'Custom') return { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
    return { dateFrom: undefined, dateTo: undefined }
  })()

  useEffect(() => { setPage(1) }, [rangePreset, customFrom, customTo])

  const filterActive = rangePreset !== 'All time'
  function clearFilters() { setRangePreset('All time'); setCustomFrom(''); setCustomTo('') }

  const paymentsQ = usePayments({ clientId: id, dateFrom, dateTo, page, limit: PAGE_SIZE, sortBy: 'date', sortOrder: 'desc' })
  const payments = paymentsQ.data?.data ?? []
  const total = paymentsQ.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const ledgerQ = useClientLedger(id ?? '', { dateFrom, dateTo })
  const totalPaid = ledgerQ.data ? ledgerQ.data.entries.reduce((s, e) => s + parseFloat(e.credit), 0) : 0
  const outstanding = balanceQ.data ? parseFloat(String(balanceQ.data.balance)) : 0

  return (
    <>
      <Topbar title="Payment history" back={{ label: 'Fill Client', to: `/fill-clients/${id}` }}>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/fill-clients/${id}`)}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> Log payment
        </button>
      </Topbar>
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{client?.name ?? '—'}</h1>
            <div className="page-header-meta"><span className="meta-row"><i className="ti ti-cash" /> Payment history</span></div>
          </div>
          <div className="kpi-strip">
            <div className="kpi-tile">
              <div className="kpi-tile-label">Payments</div>
              <div className="kpi-tile-value">{total}</div>
              <div className="kpi-tile-sub">{filterActive ? 'in this period' : 'all time'}</div>
            </div>
            <div className={`kpi-tile green`}>
              <div className="kpi-tile-label">Total paid</div>
              <div className="kpi-tile-value">{formatUsd(totalPaid)}</div>
              <div className="kpi-tile-sub">{filterActive ? 'in this period' : 'all time'}</div>
            </div>
            <div className={`kpi-tile ${outstanding > 0 ? 'amber' : ''}`}>
              <div className="kpi-tile-label">Outstanding</div>
              <div className="kpi-tile-value">{formatUsd(outstanding)}</div>
              <div className="kpi-tile-sub">current balance</div>
            </div>
          </div>
        </div>

        <div className="filter-row">
          <select className="filter-select" value={rangePreset} onChange={e => setRangePreset(e.target.value as RangePreset)}>
            <option>All time</option>
            <option>This month</option>
            <option>This week</option>
            <option>Last month</option>
            <option>Custom</option>
          </select>
          {rangePreset === 'Custom' && (
            <>
              <input type="date" className="filter-select" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
              <input type="date" className="filter-select" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
            </>
          )}
          {filterActive && <button className="btn" style={{ fontSize: 12 }} onClick={clearFilters}>Clear</button>}
        </div>

        <div className="card">
          {paymentsQ.isLoading && <div className="empty">Loading…</div>}
          {paymentsQ.isError && <div className="empty">Failed to load payments. Please try again.</div>}
          {!paymentsQ.isLoading && !paymentsQ.isError && payments.length === 0 && (
            <div className="empty">No payments {filterActive ? 'in this period' : 'recorded yet'}.</div>
          )}
          {!paymentsQ.isLoading && !paymentsQ.isError && payments.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Receiver</th>
                    <th className="right">Amount</th>
                    <th>Currency</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/fill-clients/${id}/payments/${p.id}`)}>
                      <td className="mono">{formatDateTime(p.date, { day: '2-digit' })}</td>
                      <td><span className="badge badge-gray">{p.method}</span></td>
                      {/* receiver (authoritative relation, same value cash attribution
                          uses) over receiverName (denormalized, goes stale on rename). */}
                      <td style={{ color: 'var(--text2)', fontSize: 12.5 }}>{p.receiver?.name ?? p.receiverName ?? '—'}</td>
                      <td className="right num" style={{ fontWeight: 600, color: 'var(--accent)' }}>+{formatUsd(p.amount)}</td>
                      <td className="mono" style={{ color: 'var(--text3)' }}>{p.currency}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12.5 }}>{p.notes ?? p.displayId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!paymentsQ.isLoading && payments.length > 0 && totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
              <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
              </button>
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>Page {page} of {totalPages}</span>
              <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
