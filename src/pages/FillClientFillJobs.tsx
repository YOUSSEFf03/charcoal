import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useFillJobs, useFillJobYtdSummary } from '../hooks/useFillJobs'
import { formatUsd } from '../lib/money'
import { formatDateTime, toDateOnlyString, currentMonthToDateRange, currentWeekToDateRange } from '../lib/date'

type RangePreset = 'All time' | 'This month' | 'This week' | 'Last month' | 'Custom'
const PAGE_SIZE = 20

/**
 * Dedicated Fill Jobs history page for a Fill Client. FillJob has no status
 * field and no update endpoint (create-only — see fill-jobs.service.ts) —
 * no status badge, no edit action is shown here.
 */
export default function FillClientFillJobs() {
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

  const jobsQ = useFillJobs(id ?? '', { page, limit: PAGE_SIZE, dateFrom, dateTo })
  const jobs = jobsQ.data?.data ?? []
  const total = jobsQ.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Unbounded YTD totals — only an accurate "all time" figure when no date
  // filter narrower than the current year is applied; shown as a supporting
  // reference, not claimed to equal the filtered period's totals.
  const ytdQ = useFillJobYtdSummary(id ?? '')

  const pageKgTotal = jobs.reduce((s, fj) => s + parseFloat(fj.totalCharcoalKg), 0)
  const pageBagsTotal = jobs.reduce((s, fj) => s + fj.totalBags, 0)
  const pageCostTotal = jobs.reduce((s, fj) => s + parseFloat(fj.totalCost), 0)

  return (
    <>
      <Topbar title="Fill jobs" back={{ label: 'Fill Client', to: `/fill-clients/${id}` }}>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/fill-clients/${id}`)}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> New fill job
        </button>
      </Topbar>
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{client?.name ?? '—'}</h1>
            <div className="page-header-meta"><span className="meta-row"><i className="ti ti-list" /> Fill job history</span></div>
          </div>
          <div className="kpi-strip">
            <div className="kpi-tile">
              <div className="kpi-tile-label">Total jobs</div>
              <div className="kpi-tile-value">{total}</div>
              <div className="kpi-tile-sub">{filterActive ? 'in this period' : 'all time'}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Charcoal kg (this page)</div>
              <div className="kpi-tile-value">{pageKgTotal.toFixed(1)}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Bags (this page)</div>
              <div className="kpi-tile-value">{pageBagsTotal}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Cost (this page)</div>
              <div className="kpi-tile-value">{formatUsd(pageCostTotal)}</div>
            </div>
            {ytdQ.data?.hasData && (
              <div className="kpi-tile">
                <div className="kpi-tile-label">Bags YTD</div>
                <div className="kpi-tile-value">{ytdQ.data.bagsYTD}</div>
                <div className="kpi-tile-sub">{ytdQ.data.jobCount} jobs this year</div>
              </div>
            )}
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
          {jobsQ.isLoading && <div className="empty">Loading…</div>}
          {jobsQ.isError && <div className="empty">Failed to load fill jobs. Please try again.</div>}
          {!jobsQ.isLoading && !jobsQ.isError && jobs.length === 0 && (
            <div className="empty">No fill jobs {filterActive ? 'in this period' : 'recorded yet'}.</div>
          )}
          {!jobsQ.isLoading && !jobsQ.isError && jobs.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Worker</th>
                  <th className="right">Charcoal kg</th>
                  <th className="right">Bags</th>
                  <th className="right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(fj => (
                  <tr key={fj.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/fill-clients/${id}/fill-jobs/${fj.id}`)}>
                    <td className="mono">{formatDateTime(fj.date, { day: '2-digit' })}</td>
                    <td style={{ color: 'var(--text2)' }}>{fj.workerEntity?.name ?? '—'}</td>
                    <td className="right num">{parseFloat(fj.totalCharcoalKg).toFixed(1)} kg</td>
                    <td className="right num" style={{ fontWeight: 600 }}>{fj.totalBags}</td>
                    <td className="right num" style={{ color: 'var(--accent2)' }}>{formatUsd(fj.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!jobsQ.isLoading && jobs.length > 0 && totalPages > 1 && (
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
