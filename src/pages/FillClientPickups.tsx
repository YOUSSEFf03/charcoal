import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useStockExits } from '../hooks/useWarehouse'
import { useClientLedger } from '../hooks/useReports'
import { formatUsd } from '../lib/money'
import { formatDateTime, toDateOnlyString, currentMonthToDateRange, currentWeekToDateRange } from '../lib/date'

type RangePreset = 'All time' | 'This month' | 'This week' | 'Last month' | 'Custom'
const PAGE_SIZE = 20

/**
 * Dedicated Pickups history page for a Fill Client — StockExit rows with
 * exitType='client_bags_fill' (there is no separate Pickup model; see
 * FillClientDetail.tsx's doc comments). Server-side paginated + date-
 * filterable via the same GET /stock-exits endpoint the overview already
 * used, just without the overview's small display cap.
 */
export default function FillClientPickups() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const clientQ = useClient(id ?? '')
  const client = clientQ.data

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

  const pickupsQ = useStockExits({ clientId: id, exitType: 'client_bags_fill', hasAmount: true, page, limit: PAGE_SIZE, dateFrom, dateTo })
  const pickups = pickupsQ.data?.data ?? []
  const total = pickupsQ.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // "Total amount" is the ledger's debit total for the same period — the
  // authoritative, unbounded figure (ReportsService.getClientLedger()
  // already labels Fill Client debits as pickups; no separate accounting
  // math here). Per-page bag count is shown on the page itself, not as a
  // headline "all-time" KPI, since no unbounded bag-count aggregate exists.
  const ledgerQ = useClientLedger(id ?? '', { dateFrom, dateTo })
  const totalAmount = ledgerQ.data ? ledgerQ.data.entries.reduce((s, e) => s + parseFloat(e.debit), 0) : 0

  function parseBags(reason: string | null) {
    if (!reason) return { count: 0, detail: '' }
    try {
      const s = JSON.parse(reason) as { qty: number; size?: number; charcoal?: string }[]
      return { count: s.reduce((a, i) => a + i.qty, 0), detail: s.map(i => `${i.qty}× ${i.size ?? '?'}kg`).join(', ') }
    } catch {
      return { count: 0, detail: reason }
    }
  }
  const pageBagTotal = pickups.reduce((s: number, pk: any) => s + parseBags(pk.reason).count, 0)

  return (
    <>
      <Topbar title="Pickups" back={{ label: 'Fill Client', to: `/fill-clients/${id}` }}>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/fill-clients/${id}`)}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> New pickup
        </button>
      </Topbar>
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{client?.name ?? '—'}</h1>
            <div className="page-header-meta"><span className="meta-row"><i className="ti ti-truck" /> Pickup history</span></div>
          </div>
          <div className="kpi-strip">
            <div className="kpi-tile">
              <div className="kpi-tile-label">Total pickups</div>
              <div className="kpi-tile-value">{total}</div>
              <div className="kpi-tile-sub">{filterActive ? 'in this period' : 'all time'}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Total amount</div>
              <div className="kpi-tile-value">{formatUsd(totalAmount)}</div>
              <div className="kpi-tile-sub">{filterActive ? 'in this period' : 'all time'}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Bags (this page)</div>
              <div className="kpi-tile-value">{pageBagTotal}</div>
              <div className="kpi-tile-sub">page {page} of {totalPages}</div>
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
          {pickupsQ.isLoading && <div className="empty">Loading…</div>}
          {pickupsQ.isError && <div className="empty">Failed to load pickups. Please try again.</div>}
          {!pickupsQ.isLoading && !pickupsQ.isError && pickups.length === 0 && (
            <div className="empty">No pickups {filterActive ? 'in this period' : 'recorded yet'}.</div>
          )}
          {!pickupsQ.isLoading && !pickupsQ.isError && pickups.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Driver / recipient</th>
                    <th>Bags</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pickups.map((pk: any) => {
                    const { count, detail } = parseBags(pk.reason)
                    return (
                      <tr key={pk.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/fill-clients/${id}/pickups/${pk.id}`)}>
                        <td className="mono">{formatDateTime(pk.date, { day: '2-digit' })}</td>
                        <td style={{ color: 'var(--text2)' }}>{pk.recipient ?? '—'}</td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{count > 0 ? count : '—'}</span>
                          {detail && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{detail}</span>}
                        </td>
                        <td className="right num" style={{ fontWeight: 600, color: pk.amount ? 'var(--accent)' : 'var(--text3)' }}>
                          {pk.amount ? formatUsd(pk.amount) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!pickupsQ.isLoading && pickups.length > 0 && totalPages > 1 && (
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
