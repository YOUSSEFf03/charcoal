import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useProfitLoss, useVarianceReport, useArSummary, useStockValue, useContainerCosts, useDailyRevenue, useRevenueByType, usePnlByType } from '../hooks/useReports'
import DailyRevenueChart from '../components/DailyRevenueChart'
import RevenueByTypeChart from '../components/RevenueByTypeChart'
import { useWorkers, useLogWorkerPayment } from '../hooks/useWorkers'
import { useBagTypes } from '../hooks/useBagTypes'
import { useClients } from '../hooks/useClients'
import { useRate } from '../context/RateContext'
import { useToast } from '../context/ToastContext'
import { roundDp, formatUsd } from '../lib/money'
import { currentMonthToDateRange, currentWeekToDateRange } from '../lib/date'
import { exportExcel, type ExcelColumn } from '../lib/excelExport'
import { useExportColumnsModal } from '../components/ui/ExportColumnsModal'
import type { Worker } from '../types/api'

type Tab = 'pnl' | 'variance' | 'worker' | 'ledger' | 'stock'

const mono = "'IBM Plex Mono', monospace"

function OwnerTag() {
  return <span style={{ fontSize: 10, fontFamily: mono, background: '#1A1916', color: '#fff', padding: '2px 8px', borderRadius: 100, marginLeft: 8 }}>owner only</span>
}

function Mono({ children, color, bold }: { children: React.ReactNode; color?: string; bold?: boolean }) {
  return <span style={{ fontFamily: mono, fontWeight: bold ? 600 : undefined, color }}>{children}</span>
}

function BarRow({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--surface2)', borderRadius: 100, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 100, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', minWidth: 30, textAlign: 'right' }}>{label}</span>
    </div>
  )
}

// "Clear / All Time" sends no dateFrom/dateTo at all — matching how the
// backend already treats an absent date filter (see buildDateFilterWithDefault
// in reports.service.ts): it does NOT literally scan unbounded history, it
// falls back to its own existing DEFAULT_LOOKBACK_DAYS (90-day) safety net,
// same as this page's very first load before any date was ever touched.
// That's existing, intentional backend behavior (a guard against unfiltered
// full-table scans) — this button clears the fields exactly as specified,
// it doesn't invent a way to bypass that guard.
const DATE_PRESETS = [
  { label: 'Clear / All Time', range: () => ({ dateFrom: '', dateTo: '' }) },
  { label: 'This Week', range: currentWeekToDateRange },
  { label: 'This Month', range: currentMonthToDateRange },
]

const TAB_NAV = [
  { id: 'pnl' as const,      icon: 'ti-chart-pie',  label: 'P&L' },
  { id: 'variance' as const, icon: 'ti-arrows-diff', label: 'Variance' },
  { id: 'worker' as const,   icon: 'ti-tools',       label: 'Worker earnings' },
  { id: 'ledger' as const,   icon: 'ti-users',       label: 'Client ledger' },
  { id: 'stock' as const,    icon: 'ti-building-warehouse', label: 'Stock & costs' },
]

export default function Reports() {
  const [tab, setTab] = useState<Tab>('pnl')
  const [payOpen, setPayOpen] = useState(false)
  // Finding #16 fix: which worker's card was actually clicked — the shared pay
  // modal below must read the recipient from this, never from allWorkers[0].
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState('Cash')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))

  const { showToast } = useToast()
  const { openExportModal, exportColumnsModal } = useExportColumnsModal()

  // Date range drives all report queries. Defaults to current month-to-date —
  // the SAME shared helper Dashboard.tsx uses for its own default — so the two
  // pages open on identical numbers instead of one being dynamic and the
  // other hardcoded to a stale, unrelated period.
  const [dateFrom, setDateFrom] = useState(() => currentMonthToDateRange().dateFrom)
  const [dateTo, setDateTo] = useState(() => currentMonthToDateRange().dateTo)

  // Live report data sources.
  const pnlQ = useProfitLoss({ dateFrom, dateTo })
  const dailyRevenueQ = useDailyRevenue({ dateFrom, dateTo })
  const revenueByTypeQ = useRevenueByType({ dateFrom, dateTo })
  const pnlByTypeQ = usePnlByType({ dateFrom, dateTo })
  const varianceQ = useVarianceReport({ dateFrom, dateTo })

  // Worker tab data
  const workersQ = useWorkers()
  const bagTypesQ = useBagTypes()
  const logWorkerPayment = useLogWorkerPayment()
  const rateCtx = useRate()
  const allWorkers = workersQ.data ?? []
  const bagTypeNameById = new Map((bagTypesQ.data ?? []).map(b => [b.id, b.name]))

  // Client ledger tab data
  const clientsQ = useClients({ limit: 50 })
  const arQ = useArSummary()

  // Stock & costs tab data
  const stockValueQ = useStockValue()
  const containerCostsQ = useContainerCosts({ dateFrom, dateTo })

  const pnl = pnlQ.data
  const variance = varianceQ.data

  function handleRefresh() {
    setRefreshing(true)
    pnlQ.refetch()
    dailyRevenueQ.refetch()
    revenueByTypeQ.refetch()
    pnlByTypeQ.refetch()
    varianceQ.refetch()
    workersQ.refetch()
    clientsQ.refetch()
    stockValueQ.refetch()
    containerCostsQ.refetch()
    setTimeout(() => setRefreshing(false), 800)
  }

  return (
    <>
      <Topbar title="Reports">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: mono }}>Rate: {rateCtx.rate} LL/$</span>
        <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print Report</button>
      </Topbar>

      {/* Print-only context header — the sidebar/topbar/tab-nav/filter controls
          are hidden in print (see .no-print / @media print in index.css), so
          without this, a printout would show the active tab's data with no
          indication of which report or period it's for. Reuses the same
          tab/date state already driving the on-screen view — no second
          calculation, no separate print-specific data source. */}
      <div className="print-only" style={{ display: 'none', padding: '0 28px', marginTop: 16 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Farah Charcoal — {TAB_NAV.find(t => t.id === tab)?.label} Report</h1>
        <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
          Period: {dateFrom || 'All time'} → {dateTo || 'today'}
        </div>
      </div>

      {/* REPORT NAV */}
      <div className="no-print" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 28px', display: 'flex', gap: 2, overflowX: 'auto' }}>
        {TAB_NAV.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: tab === t.id ? 'var(--text)' : 'var(--text3)', cursor: 'pointer', borderBottom: `2px solid ${tab === t.id ? 'var(--text)' : 'transparent'}`, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} /> {t.label}
          </div>
        ))}
      </div>

      <div style={{ padding: '24px 28px', flex: 1 }}>

        {/* FILTERS */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: mono }}>Period</span>
          {DATE_PRESETS.map(preset => {
            const range = preset.range()
            // Derived from current state on every render, never a separate
            // "which preset is active" flag — so a manual Date From/To edit
            // that happens to no longer match any preset's computed range
            // correctly stops highlighting it, with no stale-state risk.
            const active = dateFrom === range.dateFrom && dateTo === range.dateTo
            return (
              <button
                key={preset.label}
                className="btn"
                style={{
                  fontSize: 12, padding: '5px 10px',
                  background: active ? 'var(--accent)' : undefined,
                  borderColor: active ? 'var(--accent)' : undefined,
                  color: active ? '#fff' : undefined,
                }}
                onClick={() => { setDateFrom(range.dateFrom); setDateTo(range.dateTo) }}
              >
                {preset.label}
              </button>
            )
          })}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text2)', outline: 'none' }} />
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text2)', outline: 'none' }} />
          {(tab === 'worker' || tab === 'ledger') && (
            <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
              (this tab shows all-time figures — not scoped to Period)
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={handleRefresh} disabled={refreshing}>
            <i className={`ti ti-refresh${refreshing ? ' spin' : ''}`} style={{ fontSize: 13 }} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* ── P&L ── */}
        {tab === 'pnl' && (
          <div>
            <div className="card">
              <div style={{ padding: '24px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1px 1fr 1px 1fr 1px 1fr', gap: 0 }}>
                {(() => {
                  const revenue = pnl ? parseFloat(pnl.revenue) : 0
                  const totalCosts = pnl ? roundDp(parseFloat(pnl.cogs) + parseFloat(pnl.bagCost) + parseFloat(pnl.varianceCost) + parseFloat(pnl.deliveryCost), 2) : 0
                  const gross = pnl ? parseFloat(pnl.grossProfit) : 0
                  const margin = revenue > 0 ? ((gross / revenue) * 100).toFixed(1) : '0.0'
                  const items = [
                    { label: 'Revenue',    value: pnlQ.isLoading ? '…' : formatUsd(pnl?.revenue, { decimals: 0 }), sub: pnl?.from && pnl?.to ? `${pnl.from} → ${pnl.to}` : 'selected period', color: undefined },
                    { label: 'Total costs', value: pnlQ.isLoading ? '…' : formatUsd(totalCosts, { decimals: 0 }), sub: 'COGS + bags + variance + delivery', color: 'var(--red)' },
                    { label: <>Gross profit <OwnerTag /></>, value: pnlQ.isLoading ? '…' : formatUsd(pnl?.grossProfit, { decimals: 0 }), sub: `${margin}% margin`, color: 'var(--accent)' },
                    { label: 'Currency', value: 'USD', sub: 'reporting currency', color: 'var(--accent)', smallVal: true },
                  ]
                  // Interleave a 1px divider between each content column so the
                  // rendered children match the 7-column grid (content, divider,
                  // content, divider, ...) exactly, regardless of item count.
                  return items.flatMap((item, i) => {
                    const content = (
                      <div key={`item-${i}`} style={{ padding: i === 0 ? '0 28px 0 0' : i === items.length - 1 ? '0 0 0 28px' : '0 28px' }}>
                        <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{item.label}</div>
                        <div style={{ fontSize: item.smallVal ? 20 : 28, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1, marginBottom: 4, color: item.color }}>{item.value}</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{item.sub}</div>
                      </div>
                    )
                    if (i === items.length - 1) return [content]
                    return [content, <div key={`div-${i}`} style={{ background: 'var(--border)' }} />]
                  })
                })()}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-chart-bar" /> Daily revenue <OwnerTag /></div>
                </div>
                <div style={{ padding: '14px 18px 18px' }}>
                  <DailyRevenueChart data={dailyRevenueQ.data?.data} isLoading={dailyRevenueQ.isLoading} height={200} />
                </div>
              </div>
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-chart-pie" /> Revenue by type <OwnerTag /></div>
                </div>
                <div style={{ padding: '14px 18px 18px' }}>
                  <RevenueByTypeChart data={revenueByTypeQ.data?.data} isLoading={revenueByTypeQ.isLoading} height={200} />
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              {[
                { title: 'Revenue breakdown', icon: 'ti-trending-up', iconColor: 'var(--accent)', rows: [['Total revenue', formatUsd(pnl?.revenue, { decimals: 0 }), 'green']], total: ['Total revenue', formatUsd(pnl?.revenue, { decimals: 0 })] },
                { title: 'Cost breakdown', icon: 'ti-trending-down', iconColor: 'var(--red)', ownerTag: true, rows: [['COGS (charcoal cost)', formatUsd(pnl?.cogs, { decimals: 0 }), 'red'], ['Bag costs', formatUsd(pnl?.bagCost, { decimals: 0 }), 'red'], ['Packing variances', formatUsd(pnl?.varianceCost, { decimals: 0 }), 'amber'], ['Delivery expenses', formatUsd(pnl?.deliveryCost, { decimals: 0 }), 'red']], total: ['Total costs', pnl ? formatUsd(roundDp(parseFloat(pnl.cogs) + parseFloat(pnl.bagCost) + parseFloat(pnl.varianceCost) + parseFloat(pnl.deliveryCost), 2), { decimals: 0 }) : '—', 'var(--red)'] },
              ].map(block => (
                <div key={block.title} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <i className={`ti ${block.icon}`} style={{ color: block.iconColor }} /> {block.title} {block.ownerTag && <OwnerTag />}
                  </div>
                  {block.rows.map(([label, val, color]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>{label}</span>
                      <span style={{ fontFamily: mono, fontWeight: 600, color: color === 'red' ? 'var(--red)' : color === 'green' ? 'var(--accent)' : color === 'amber' ? 'var(--accent2)' : undefined }}>{val}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface2)', borderTop: '1px solid var(--border)', fontSize: 14, fontWeight: 600 }}>
                    <span>{block.total[0]}</span>
                    <span style={{ fontFamily: mono, color: block.total[2] }}>{block.total[1]}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Net Profit — additive second tier. Deliberately its own card, below and
                visually distinct from Gross Profit above, so Gross Profit never reads as
                Net Profit and vice versa. Gross Profit itself is shown again here as the
                starting line so the relationship is explicit, not just a number that
                changed meaning. ── */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-report-money" /> Net profit <OwnerTag /></div>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>Gross profit − labor − general expenses − cash-handover expenses</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: 'var(--text2)' }}>Gross profit</span>
                <span style={{ fontFamily: mono, fontWeight: 600, color: 'var(--accent)' }}>{pnlQ.isLoading ? '…' : formatUsd(pnl?.grossProfit, { decimals: 0 })}</span>
              </div>
              {([
                ['Labor cost', pnl?.laborCost],
                ['General expenses', pnl?.generalExpense],
                ['Cash handover expenses', pnl?.handoverExpense],
              ] as const).map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text2)' }}>− {label}</span>
                  <span style={{ fontFamily: mono, fontWeight: 600, color: 'var(--red)' }}>{pnlQ.isLoading ? '…' : formatUsd(val, { decimals: 0 })}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'var(--surface2)', borderTop: '2px solid var(--text)', fontSize: 16, fontWeight: 700 }}>
                <span>Net profit</span>
                <span style={{ fontFamily: mono, color: pnl && parseFloat(pnl.netProfit) < 0 ? 'var(--red)' : 'var(--accent)' }}>
                  {pnlQ.isLoading ? '…' : formatUsd(pnl?.netProfit, { decimals: 0 })}
                </span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-flame" /> P&amp;L by charcoal type <OwnerTag /></div>
              </div>
              {pnlByTypeQ.isLoading && <div className="empty">Loading P&amp;L by charcoal type…</div>}
              {pnlByTypeQ.isError && <div className="empty">Failed to load P&amp;L by charcoal type.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => pnlByTypeQ.refetch()}>Retry</button></div></div>}
              {!pnlByTypeQ.isLoading && !pnlByTypeQ.isError && (pnlByTypeQ.data?.data.length ?? 0) === 0 && <div className="empty">No revenue in this period.</div>}
              {!pnlByTypeQ.isLoading && !pnlByTypeQ.isError && (pnlByTypeQ.data?.data.length ?? 0) > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      {['Charcoal type', 'Revenue', 'COGS', 'Gross profit', 'Margin'].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pnlByTypeQ.data!.data.map(row => {
                      const negative = parseFloat(row.grossProfit) < 0
                      return (
                        <tr key={row.charcoalType}>
                          <td><span style={{ fontWeight: 500 }}>{row.charcoalType}</span></td>
                          <td><Mono>{formatUsd(row.revenue, { decimals: 0 })}</Mono></td>
                          <td><Mono color="var(--red)">{formatUsd(row.cogs, { decimals: 0 })}</Mono></td>
                          <td><Mono bold color={negative ? 'var(--red)' : 'var(--accent)'}>{formatUsd(row.grossProfit, { decimals: 0 })}</Mono></td>
                          <td><span className={`badge ${negative ? 'badge-red' : 'badge-green'}`}>{row.marginPct}%</span></td>
                        </tr>
                      )
                    })}
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td><span style={{ fontWeight: 600 }}>Total</span></td>
                      <td><Mono bold>{formatUsd(pnlByTypeQ.data!.totalRevenue, { decimals: 0 })}</Mono></td>
                      <td><Mono bold color="var(--red)">{formatUsd(pnlByTypeQ.data!.totalCogs, { decimals: 0 })}</Mono></td>
                      <td><Mono bold color={parseFloat(pnlByTypeQ.data!.totalGrossProfit) < 0 ? 'var(--red)' : 'var(--accent)'}>{formatUsd(pnlByTypeQ.data!.totalGrossProfit, { decimals: 0 })}</Mono></td>
                      <td><span className={`badge ${parseFloat(pnlByTypeQ.data!.totalGrossProfit) < 0 ? 'badge-red' : 'badge-green'}`}>{pnlByTypeQ.data!.totalMarginPct}%</span></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}


        {/* ── VARIANCE ── */}
        {tab === 'variance' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div className="kpi-tile">
                <div className="kpi-tile-label">Total variance</div>
                <div className="kpi-tile-value" style={{ color: 'var(--accent2)' }}>{variance ? `${parseFloat(variance.totalVarianceKg).toFixed(0)} kg` : '—'}</div>
                <div className="kpi-tile-sub">across {variance?.total ?? 0} sessions</div>
              </div>
              <div className="kpi-tile">
                <div className="kpi-tile-label">Variance cost <OwnerTag /></div>
                <div className="kpi-tile-value" style={{ color: 'var(--red)' }}>{formatUsd(variance?.totalVarianceCost, { decimals: 0 })}</div>
                <div className="kpi-tile-sub">at weighted avg cost/kg</div>
              </div>
              <div className="kpi-tile">
                <div className="kpi-tile-label">Avg variance per session</div>
                <div className="kpi-tile-value">{variance && variance.total > 0 ? `${(parseFloat(variance.totalVarianceKg) / variance.total).toFixed(1)} kg` : '—'}</div>
                <div className="kpi-tile-sub">per packing session</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-flame" /> Variance by charcoal type</div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      {['Type', 'Sessions', 'Total var. (kg)', 'Avg %', 'Share of total'].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {/* byCharcoalType comes straight from the same GET /reports/variance
                        response the session log and Variance-by-worker table already use —
                        no separate request, and it's a full-table breakdown (not limited to
                        the current page), so it reconciles exactly with totalVarianceKg. */}
                    {(variance?.byCharcoalType ?? []).map(row => (
                      <tr key={row.charcoalType}>
                        <td><Mono>{row.charcoalType}</Mono></td>
                        <td><Mono>{row.sessions}</Mono></td>
                        <td><Mono color="var(--accent2)">{parseFloat(row.totalVarianceKg).toFixed(1)} kg</Mono></td>
                        <td><span className="badge badge-amber">{row.avgVariancePct}%</span></td>
                        <td><Mono>{row.shareOfTotalPct}%</Mono></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!variance || variance.byCharcoalType.length === 0) && <div className="empty">No variance records for this period.</div>}
              </div>
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-tools" /> Variance by worker</div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      {['Worker', 'Sessions', 'Total var.', 'Avg %'].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Aggregate the already-fetched per-session variance rows by worker —
                      // workerId/workerName/varianceKg/kgConsumed all come straight from the
                      // same GET /reports/variance response the session log below reuses.
                      const byWorker = new Map<string, { name: string; sessions: number; varianceKg: number; kgConsumed: number }>()
                      for (const r of variance?.data ?? []) {
                        const entry = byWorker.get(r.workerId) ?? { name: r.workerName, sessions: 0, varianceKg: 0, kgConsumed: 0 }
                        entry.sessions += 1
                        entry.varianceKg += parseFloat(r.varianceKg)
                        entry.kgConsumed += parseFloat(r.kgConsumed)
                        byWorker.set(r.workerId, entry)
                      }
                      return Array.from(byWorker.entries()).map(([workerId, w]) => {
                        const avgPct = w.kgConsumed > 0 ? (w.varianceKg / w.kgConsumed) * 100 : 0
                        return (
                          <tr key={workerId}>
                            <td><Mono>{w.name}</Mono></td>
                            <td><Mono>{w.sessions}</Mono></td>
                            <td><Mono color="var(--accent2)">{w.varianceKg.toFixed(1)} kg</Mono></td>
                            <td><span className="badge badge-amber">{avgPct.toFixed(1)}%</span></td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
                {(!variance || variance.data.length === 0) && <div className="empty">No variance records for this period.</div>}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-list" /> Session variance log</div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    {['Session', 'Date', 'Lot', 'kg consumed', 'kg output', 'Variance', 'Var. cost'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(variance?.data ?? []).map(r => (
                    <tr key={r.sessionId}>
                      <td><Mono>{r.sessionDisplayId ?? r.sessionId.slice(0, 8)}</Mono></td>
                      <td><span style={{ color: 'var(--text2)' }}>{new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></td>
                      <td><span>{r.lots.map(l => l.displayId ?? `${l.charcoalType}·${l.grade}`).join(', ') || '—'}</span></td>
                      <td><Mono>{parseFloat(r.kgConsumed).toFixed(0)} kg</Mono></td>
                      <td><Mono>{parseFloat(r.kgOutputTotal).toFixed(0)} kg</Mono></td>
                      <td><Mono color="var(--accent2)">{parseFloat(r.varianceKg).toFixed(1)} kg</Mono></td>
                      <td><Mono color="var(--red)">{formatUsd(r.varianceCost, { decimals: 0 })}</Mono></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!variance || variance.data.length === 0) && <div className="empty">No variance records for this period.</div>}
            </div>
          </div>
        )}

        {/* ── WORKER EARNINGS ── */}
        {tab === 'worker' && (
          <div>
            {workersQ.isLoading && <div className="empty">Loading worker data…</div>}
            {workersQ.isError && <div className="empty">Failed to load workers.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => workersQ.refetch()}>Retry</button></div></div>}
            {!workersQ.isLoading && allWorkers.length === 0 && <div className="empty">No workers yet. Add workers in the Employees page.</div>}

            {/* Summary across all workers — ALL-TIME, deliberately not scoped to the
                Period filter above (unlike every other tab on this page). Labeled
                explicitly so it's never mistaken for the P&L tab's period-scoped
                Labor Cost figure. See workers.service.ts computeTotals() — this is
                the running earned/paid/owed balance, not a period accrual. */}
            {!workersQ.isLoading && allWorkers.length > 0 && (() => {
              const totalEarned = roundDp(allWorkers.reduce((s, w) => s + parseFloat(w.totalEarned), 0), 2)
              const totalPaid   = roundDp(allWorkers.reduce((s, w) => s + parseFloat(w.totalPaid), 0), 2)
              const totalOwed   = roundDp(allWorkers.reduce((s, w) => s + parseFloat(w.totalOwed), 0), 2)
              return (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
                    All-time balances — not filtered by the Period selector above (compare with the P&amp;L tab's period-scoped Labor Cost).
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 14 }}>
                  <div className="kpi-tile">
                    <div className="kpi-tile-label">Total earned (all-time)</div>
                    <div className="kpi-tile-value">{formatUsd(totalEarned, { decimals: 0 })}</div>
                    <div className="kpi-tile-sub">{allWorkers.length} worker{allWorkers.length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="kpi-tile">
                    <div className="kpi-tile-label">Total paid out (all-time)</div>
                    <div className="kpi-tile-value" style={{ color: 'var(--accent)' }}>{formatUsd(totalPaid, { decimals: 0 })}</div>
                    <div className="kpi-tile-sub">cumulative payments</div>
                  </div>
                  <div className="kpi-tile">
                    <div className="kpi-tile-label">Total owed (current balance)</div>
                    <div className="kpi-tile-value" style={{ color: 'var(--accent2)' }}>{formatUsd(totalOwed, { decimals: 0 })}</div>
                    <div className="kpi-tile-sub">still to be paid</div>
                  </div>
                  </div>
                </>
              )
            })()}

            {/* Per-worker breakdown */}
            {!workersQ.isLoading && allWorkers.map(worker => (
              <div className="card" key={worker.id}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{worker.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      Earned: <strong style={{ color: 'var(--accent)' }}>{formatUsd(worker.totalEarned, { decimals: 0 })}</strong>
                      {' · '}Paid: <strong>{formatUsd(worker.totalPaid, { decimals: 0 })}</strong>
                      {' · '}Owed: <strong style={{ color: parseFloat(worker.totalOwed) > 0 ? 'var(--accent2)' : 'var(--text3)' }}>{formatUsd(worker.totalOwed, { decimals: 0 })}</strong>
                    </div>
                  </div>
                  {parseFloat(worker.totalOwed) > 0 && (
                    <button
                      style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => { setSelectedWorker(worker); setPayOpen(true) }}
                    >
                      <i className="ti ti-cash" style={{ fontSize: 13 }} /> Pay {formatUsd(worker.totalOwed, { decimals: 0 })}
                    </button>
                  )}
                </div>
                {(worker.totalBagsPacked ?? []).length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        {['Bag type', 'Bags packed', 'Rate / bag', 'Earned'].map(h => <th key={h}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(worker.totalBagsPacked ?? []).map(entry => {
                        const rateEntry = worker.ratesPerBagType.find(r => r.bagTypeId === entry.bagTypeId)
                        const rate = parseFloat(rateEntry?.ratePerBag ?? '0')
                        const earned = entry.count * rate
                        return (
                          <tr key={entry.bagTypeId}>
                            <td><Mono bold>{bagTypeNameById.get(entry.bagTypeId) ?? entry.bagTypeId.slice(0, 8)}</Mono></td>
                            <td><Mono>{entry.count.toLocaleString('en-US')}</Mono></td>
                            <td><Mono color="var(--text3)">${rate.toFixed(3)}</Mono></td>
                            <td><Mono color="var(--accent)" bold>${earned.toFixed(2)}</Mono></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">No packing sessions recorded yet.</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── CLIENT LEDGER ── */}
        {tab === 'ledger' && (
          <div>
            {(() => {
              const allClients = clientsQ.data?.data ?? []
              const ar = arQ.data
              const totalInvoiced  = parseFloat(ar?.totalInvoiced    ?? '0')
              const totalCollected = parseFloat(ar?.totalCollected   ?? '0')
              const outstanding    = parseFloat(ar?.totalOutstanding ?? '0')
              const clientCount = allClients.length
              const clientsWithBalance = allClients.filter(c => parseFloat(c.balance) > 0).length

              // Exports exactly what the table below renders: same rows, same column
              // order (Client, Type, Balance, Status), same "Has balance"/"Clear" labels.
              function exportLedger() {
                if (allClients.length === 0) { showToast('Nothing to export'); return }
                const columns: ExcelColumn<(typeof allClients)[number]>[] = [
                  { key: 'client', header: 'Client', value: c => c.name },
                  { key: 'type', header: 'Type', value: c => c.type },
                  { key: 'balance', header: 'Balance', type: 'currency', value: c => parseFloat(c.balance), total: 'sum' },
                  { key: 'status', header: 'Status', value: c => parseFloat(c.balance) > 0 ? 'Has balance' : 'Clear' },
                ]
                openExportModal({
                  title: 'Client Ledger', columns,
                  onExport: async selectedColumns => {
                    await exportExcel({
                      filename: 'client-ledger', sheetName: 'Client ledger', title: 'Client Ledger',
                      columns: selectedColumns, rows: allClients,
                    })
                    showToast(`Exported ${allClients.length} rows`)
                  },
                })
              }

              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 14 }}>
                    <div className="kpi-tile">
                      <div className="kpi-tile-label">Total invoiced</div>
                      <div className="kpi-tile-value">{arQ.isLoading ? '…' : formatUsd(totalInvoiced, { decimals: 0 })}</div>
                      <div className="kpi-tile-sub">{clientCount} clients</div>
                    </div>
                    <div className="kpi-tile">
                      <div className="kpi-tile-label">Total collected</div>
                      <div className="kpi-tile-value" style={{ color: 'var(--accent)' }}>{arQ.isLoading ? '…' : formatUsd(totalCollected, { decimals: 0 })}</div>
                      <div className="kpi-tile-sub">{totalInvoiced > 0 ? `${((totalCollected / totalInvoiced) * 100).toFixed(1)}% collection rate` : '—'}</div>
                    </div>
                    <div className="kpi-tile">
                      <div className="kpi-tile-label">Outstanding</div>
                      <div className="kpi-tile-value" style={{ color: 'var(--accent2)' }}>{arQ.isLoading ? '…' : formatUsd(outstanding, { decimals: 0 })}</div>
                      <div className="kpi-tile-sub">{clientsWithBalance} clients with balance</div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-head">
                      <div className="card-title"><i className="ti ti-users" /> Client ledger</div>
                      <button className="btn" style={{ fontSize: 12 }} onClick={exportLedger}><i className="ti ti-download" style={{ fontSize: 13 }} /> Export</button>
                    </div>
                    {clientsQ.isLoading && <div className="empty">Loading clients…</div>}
                    {clientsQ.isError && <div className="empty">Failed to load clients.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => clientsQ.refetch()}>Retry</button></div></div>}
                    {!clientsQ.isLoading && allClients.length === 0 && <div className="empty">No clients yet.</div>}
                    {!clientsQ.isLoading && allClients.length > 0 && (
                      <table className="data-table">
                        <thead>
                          <tr>
                            {['Client', 'Type', 'Balance', 'Status'].map(h => <th key={h}>{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {allClients.map(c => {
                            const bal = parseFloat(c.balance)
                            const hasBalance = bal > 0
                            return (
                              <tr key={c.id}>
                                <td><span style={{ fontWeight: 500 }}>{c.name}</span></td>
                                <td><span className="badge badge-gray">{c.type}</span></td>
                                <td><Mono bold color={hasBalance ? 'var(--accent2)' : 'var(--accent)'}>{formatUsd(c.balance, { decimals: 0 })}</Mono></td>
                                <td>{hasBalance
                                  ? <span className="badge badge-amber">Has balance</span>
                                  : <span className="badge badge-green">Clear</span>}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* ── STOCK & COSTS ── */}
        {tab === 'stock' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div className="kpi-tile">
                <div className="kpi-tile-label">Total stock value</div>
                <div className="kpi-tile-value">{stockValueQ.isLoading ? '…' : formatUsd(stockValueQ.data?.totalValue, { decimals: 0 })}</div>
                <div className="kpi-tile-sub">{stockValueQ.data?.total ?? 0} open lots · current, not scoped to Period</div>
              </div>
              <div className="kpi-tile">
                <div className="kpi-tile-label">Containers reported</div>
                <div className="kpi-tile-value">{containerCostsQ.isLoading ? '…' : (containerCostsQ.data?.total ?? 0)}</div>
                <div className="kpi-tile-sub">arrived · {dateFrom} → {dateTo}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-building-warehouse" /> Stock value by lot</div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    {['Charcoal', 'Remaining', 'Cost / kg', 'Value'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(stockValueQ.data?.data ?? []).map(row => (
                    <tr key={row.lotId}>
                      <td>{row.charcoalType} · Grade {row.grade}</td>
                      <td><Mono>{parseFloat(row.kgRemaining).toLocaleString()} kg</Mono></td>
                      <td><Mono>{formatUsd(row.costPerKg, { decimals: 2 })}</Mono></td>
                      <td><Mono bold color="var(--accent)">{formatUsd(row.lotValue, { decimals: 0 })}</Mono></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!stockValueQ.isLoading && (stockValueQ.data?.data.length ?? 0) === 0 && (
                <div className="empty">No stock lots with remaining value.</div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-ship" /> Container landed costs</div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    {['Container', 'Supplier', 'Charcoal', 'Paid bags', 'Tonnage', 'All-in $/ton', 'All-in $/kg'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(containerCostsQ.data?.data ?? []).flatMap(c => c.productLines.map(l => (
                    <tr key={l.id}>
                      <td>{c.number}</td>
                      <td>{c.supplierName}</td>
                      <td>{l.charcoalType} · Grade {l.grade}</td>
                      <td><Mono>{l.paidBags.toLocaleString()}</Mono></td>
                      <td><Mono>{parseFloat(l.computed.tonnage).toFixed(2)} t</Mono></td>
                      <td><Mono>{formatUsd(l.computed.allInCostPerTon, { decimals: 0 })}</Mono></td>
                      <td><Mono bold color="var(--accent)">{formatUsd(l.computed.allInCostPerKg, { decimals: 2 })}</Mono></td>
                    </tr>
                  )))}
                </tbody>
              </table>
              {!containerCostsQ.isLoading && (containerCostsQ.data?.data.length ?? 0) === 0 && (
                <div className="empty">No arrived containers in this period.</div>
              )}
            </div>
          </div>
        )}

      </div>


      {/* PAY WORKER MODAL */}
      {payOpen && selectedWorker && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && (setPayOpen(false), setSelectedWorker(null))}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Pay {selectedWorker.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Total owed: <strong style={{ color: 'var(--accent2)' }}>{formatUsd(selectedWorker.totalOwed, { decimals: 0 })}</strong></div>
              </div>
              <button className="panel-close-btn" onClick={() => { setPayOpen(false); setSelectedWorker(null) }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Payment date</label>
                <input className="form-input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (USD)</label>
                <input className="form-input" type="number" placeholder="0.00" value={payAmt} onChange={e => setPayAmt(e.target.value)} />
                {payAmt && (() => {
                  const owed = parseFloat(selectedWorker.totalOwed)
                  const entered = parseFloat(payAmt)
                  return (
                    <div style={{ marginTop: 6, fontSize: 12, color: entered >= owed ? 'var(--accent)' : 'var(--accent2)', fontFamily: mono }}>
                      {entered >= owed ? 'Fully settled ✓' : `Remaining: $${(owed - entered).toFixed(2)}`}
                    </div>
                  )
                })()}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Method</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Cash', 'Whish', 'OMT'].map(m => (
                    <div key={m} style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '7px 0', borderRadius: 'var(--radius)', border: `1px solid ${payMethod === m ? 'var(--text)' : 'var(--border)'}`, background: payMethod === m ? 'var(--text)' : 'transparent', color: payMethod === m ? '#fff' : 'var(--text2)', fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={() => setPayMethod(m)}>
                      {m}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => { setPayOpen(false); setSelectedWorker(null) }}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => {
                  if (!payAmt || parseFloat(payAmt) <= 0) return
                  logWorkerPayment.mutate(
                    { id: selectedWorker.id, body: { amount: payAmt, date: payDate, notes: 'Reports payment' } },
                    { onSuccess: () => { setPayOpen(false); showToast(`Payment logged for ${selectedWorker.name}`); setSelectedWorker(null) } }
                  )
                }}
              >
                <i className="ti ti-check" style={{ fontSize: 14 }} /> Confirm payment
              </button>
            </div>
          </div>
        </div>
      )}

      {exportColumnsModal}
    </>
  )
}
