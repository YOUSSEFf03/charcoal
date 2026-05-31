import { useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import Topbar from '../components/layout/Topbar'
import { useProfitLoss, useVarianceReport } from '../hooks/useReports'
import { useWorkers, useLogWorkerPayment } from '../hooks/useWorkers'
import { useBagTypes } from '../hooks/useBagTypes'
import { useClients } from '../hooks/useClients'
import { useInvoices } from '../hooks/useInvoices'
import { useRate } from '../context/RateContext'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

function usd(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
}

type Tab = 'pnl' | 'variance' | 'worker' | 'ledger'

const mono = "'IBM Plex Mono', monospace"

const REVENUE_DATA = [840,0,1200,640,0,2100,480,720,0,1640,840,0,2800,1200,960,0,3400,2100,1840,1200,1640]
const REVENUE_LABELS = REVENUE_DATA.map((_, i) => String(i + 1))

const barData = {
  labels: REVENUE_LABELS,
  datasets: [{ data: REVENUE_DATA, backgroundColor: '#1D6B4A', borderRadius: 3, borderSkipped: false as const }],
}
const barOptions = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'IBM Plex Mono', size: 10 }, color: '#9B9890' } },
    y: { grid: { color: '#E4E1D9' }, ticks: { font: { family: 'IBM Plex Mono', size: 10 }, color: '#9B9890', callback: (v: number | string) => `$${Number(v).toLocaleString()}` } },
  },
}

const donutData = {
  labels: ['BBQ Hardwood', 'Shisha', 'Restaurant'],
  datasets: [{ data: [22100, 11200, 5150], backgroundColor: ['#1D6B4A', '#B45309', '#1D4ED8'], borderWidth: 0, hoverOffset: 4 }],
}
const donutOptions = { responsive: true, cutout: '68%', plugins: { legend: { display: false } } }

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 14, ...style }}>{children}</div>
}

function CardHead({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
        <i className={`ti ${icon}`} style={{ fontSize: 15, color: 'var(--text2)' }} /> {children}
      </div>
    </div>
  )
}

function OwnerTag() {
  return <span style={{ fontSize: 10, fontFamily: mono, background: '#1A1916', color: '#fff', padding: '2px 8px', borderRadius: 100, marginLeft: 8 }}>owner only</span>
}

function SvCard({ label, value, sub, color }: { label: React.ReactNode; value: string; sub: string; color?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.8, marginBottom: 4, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{sub}</div>
    </div>
  )
}

function DataTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '8px 18px', fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: '1px solid var(--border)', fontWeight: 400, background: 'var(--surface2)' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
            {row.map((cell, ci) => (
              <td key={ci} style={{ padding: '10px 18px', fontSize: 13, verticalAlign: 'middle' }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
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

const TAB_NAV = [
  { id: 'pnl' as const,      icon: 'ti-chart-pie',  label: 'P&L' },
  { id: 'variance' as const, icon: 'ti-arrows-diff', label: 'Variance' },
  { id: 'worker' as const,   icon: 'ti-tools',       label: 'Worker earnings' },
  { id: 'ledger' as const,   icon: 'ti-users',       label: 'Client ledger' },
]

export default function Reports() {
  const [tab, setTab] = useState<Tab>('pnl')
  const [exportOpen, setExportOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState('')
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState('Cash')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))

  // Date range drives all report queries.
  const [dateFrom, setDateFrom] = useState('2026-05-01')
  const [dateTo, setDateTo] = useState('2026-05-31')

  // Live report data sources.
  const pnlQ = useProfitLoss({ dateFrom, dateTo })
  const varianceQ = useVarianceReport({ dateFrom, dateTo })

  // Worker tab data
  const workersQ = useWorkers()
  const bagTypesQ = useBagTypes()
  const logWorkerPayment = useLogWorkerPayment()
  const rateCtx = useRate()
  const allWorkers = workersQ.data ?? []
  const firstWorker = allWorkers[0]
  const bagTypeNameById = new Map((bagTypesQ.data ?? []).map(b => [b.id, b.name]))

  // Client ledger tab data
  const clientsQ = useClients({ limit: 50 })
  const invoicesQ = useInvoices({ limit: 100 })

  const pnl = pnlQ.data
  const variance = varianceQ.data

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function handleRefresh() {
    setRefreshing(true)
    pnlQ.refetch()
    varianceQ.refetch()
    workersQ.refetch()
    clientsQ.refetch()
    invoicesQ.refetch()
    setTimeout(() => setRefreshing(false), 800)
  }

  return (
    <>
      <Topbar title="Reports">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: mono }}>Rate: {rateCtx.rate} LL/$</span>
        <button className="btn" onClick={() => setExportOpen(true)}><i className="ti ti-download" style={{ fontSize: 15 }} /> Export PDF</button>
      </Topbar>

      {/* REPORT NAV */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 28px', display: 'flex', gap: 2, overflowX: 'auto' }}>
        {TAB_NAV.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: tab === t.id ? 'var(--text)' : 'var(--text3)', cursor: 'pointer', borderBottom: `2px solid ${tab === t.id ? 'var(--text)' : 'transparent'}`, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} /> {t.label}
          </div>
        ))}
      </div>

      <div style={{ padding: '24px 28px', flex: 1 }}>

        {/* FILTERS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: mono }}>Period</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text2)', outline: 'none' }} />
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text2)', outline: 'none' }} />
          <select style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', outline: 'none' }}>
            <option>All charcoal types</option><option>BBQ Hardwood</option><option>Shisha</option><option>Restaurant Grade</option>
          </select>
          <select style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', outline: 'none' }}>
            <option>All clients</option><option>Restaurants only</option><option>Wholesale only</option><option>Export only</option>
          </select>
          <div style={{ flex: 1 }} />
          <button className="btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={handleRefresh} disabled={refreshing}>
            <i className={`ti ti-refresh${refreshing ? ' spin' : ''}`} style={{ fontSize: 13 }} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* ── P&L ── */}
        {tab === 'pnl' && (
          <div>
            <Card>
              <div style={{ padding: '24px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1px 1fr 1px 1fr 1px 1fr', gap: 0 }}>
                {(() => {
                  const revenue = pnl ? parseFloat(pnl.revenue) : 0
                  const totalCosts = pnl ? parseFloat(pnl.cogs) + parseFloat(pnl.bagCost) + parseFloat(pnl.varianceCost) + parseFloat(pnl.deliveryCost) : 0
                  const gross = pnl ? parseFloat(pnl.grossProfit) : 0
                  const margin = revenue > 0 ? ((gross / revenue) * 100).toFixed(1) : '0.0'
                  return [
                    { label: 'Revenue',    value: pnlQ.isLoading ? '…' : usd(pnl?.revenue), sub: pnl ? `${pnl.from} → ${pnl.to}` : 'selected period', color: undefined },
                    { label: 'Total costs', value: pnlQ.isLoading ? '…' : `$${totalCosts.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, sub: 'COGS + bags + variance + delivery', color: 'var(--red)' },
                    { label: <>Gross profit <OwnerTag /></>, value: pnlQ.isLoading ? '…' : usd(pnl?.grossProfit), sub: `${margin}% margin`, color: 'var(--accent)' },
                    { label: 'Currency', value: pnl?.currency ?? 'USD', sub: 'reporting currency', color: 'var(--accent)', smallVal: true },
                  ]
                })().map((item, i) => (
                  <div key={i} style={i % 2 === 1 ? { background: 'var(--border)' } : { padding: i === 0 ? '0 28px 0 0' : i === 6 ? '0 0 0 28px' : '0 28px' }}>
                    {i % 2 === 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{item.label}</div>
                        <div style={{ fontSize: item.smallVal ? 20 : 28, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1, marginBottom: 4, color: item.color }}>{item.value}</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{item.sub}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
              <Card style={{ marginBottom: 0 }}>
                <CardHead icon="ti-chart-bar">Daily revenue — May 2026</CardHead>
                <div style={{ padding: 16 }}><Bar data={barData} options={barOptions} style={{ maxHeight: 200 }} /></div>
              </Card>
              <Card style={{ marginBottom: 0 }}>
                <CardHead icon="ti-chart-pie">Revenue by type</CardHead>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Doughnut data={donutData} options={donutOptions} style={{ maxHeight: 160, maxWidth: 160 }} />
                  <div style={{ flex: 1 }}>
                    {[{ color: '#1D6B4A', label: 'BBQ Hardwood', val: '$22,100' }, { color: '#B45309', label: 'Shisha', val: '$11,200' }, { color: '#1D4ED8', label: 'Restaurant Grade', val: '$5,150' }].map(r => (
                      <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{r.label}</span>
                        <span style={{ fontFamily: mono, fontWeight: 600 }}>{r.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              {[
                { title: 'Revenue breakdown', icon: 'ti-trending-up', iconColor: 'var(--accent)', rows: [['Total revenue', usd(pnl?.revenue), 'green']], total: ['Total revenue', usd(pnl?.revenue)] },
                { title: 'Cost breakdown', icon: 'ti-trending-down', iconColor: 'var(--red)', ownerTag: true, rows: [['COGS (charcoal cost)', usd(pnl?.cogs), 'red'], ['Bag costs', usd(pnl?.bagCost), 'red'], ['Packing variances', usd(pnl?.varianceCost), 'amber'], ['Delivery expenses', usd(pnl?.deliveryCost), 'red']], total: ['Total costs', pnl ? `$${(parseFloat(pnl.cogs) + parseFloat(pnl.bagCost) + parseFloat(pnl.varianceCost) + parseFloat(pnl.deliveryCost)).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—', 'var(--red)'] },
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

            <Card>
              <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <i className="ti ti-flame" style={{ fontSize: 15, color: 'var(--text2)' }} /> P&amp;L by charcoal type <OwnerTag />
                </div>
              </div>
              <DataTable
                headers={['Type / grade', 'Revenue', 'COGS', 'Bag cost', 'Variance cost', 'Gross profit', 'Margin']}
                rows={[
                  ['BBQ Hardwood · A', <Mono color="var(--accent)">$22,100</Mono>, <Mono color="var(--red)">$13,600</Mono>, <Mono color="var(--red)">$1,640</Mono>, <Mono color="var(--accent2)">$740</Mono>, <Mono color="var(--accent)" bold>$6,120</Mono>, <span className="badge badge-green">27.7%</span>],
                  ['Shisha · B',        <Mono color="var(--accent)">$11,200</Mono>, <Mono color="var(--red)">$7,940</Mono>,  <Mono color="var(--red)">$840</Mono>,   <Mono color="var(--accent2)">$380</Mono>, <Mono color="var(--accent)" bold>$2,040</Mono>, <span className="badge badge-amber">18.2%</span>],
                  ['Restaurant Grade · A', <Mono color="var(--accent)">$5,150</Mono>, <Mono color="var(--red)">$2,640</Mono>, <Mono color="var(--red)">$360</Mono>, <Mono color="var(--accent2)">$170</Mono>, <Mono color="var(--accent)" bold>$1,980</Mono>, <span className="badge badge-green">38.4%</span>],
                ]}
              />
            </Card>
          </div>
        )}


        {/* ── VARIANCE ── */}
        {tab === 'variance' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', marginBottom: 4 }}>Total variance</div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5, color: 'var(--accent2)' }}>{variance ? `${parseFloat(variance.totalVarianceKg).toFixed(0)} kg` : '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>across {variance?.rows.length ?? 0} sessions</div>
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', marginBottom: 4 }}>Variance cost <OwnerTag /></div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5, color: 'var(--red)' }}>{usd(variance?.totalVarianceCostUsd)}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>at weighted avg cost/kg</div>
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', marginBottom: 4 }}>Avg variance per session</div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5 }}>{variance && variance.rows.length > 0 ? `${(parseFloat(variance.totalVarianceKg) / variance.rows.length).toFixed(1)} kg` : '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>per packing session</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Card style={{ marginBottom: 0 }}>
                <CardHead icon="ti-flame">Variance by charcoal type</CardHead>
                <DataTable
                  headers={['Type', 'Sessions', 'Total var. kg', 'Var. cost', 'Avg %']}
                  rows={[
                    ['BBQ Hardwood · A',   <Mono>18</Mono>, <Mono color="var(--accent2)">−640 kg</Mono>,  <Mono color="var(--red)">$474</Mono>, <span className="badge badge-amber">2.6%</span>],
                    ['Shisha · B',          <Mono>14</Mono>, <Mono color="var(--accent2)">−510 kg</Mono>,  <Mono color="var(--red)">$454</Mono>, <span className="badge badge-amber">3.1%</span>],
                    ['Restaurant Grade · A', <Mono>10</Mono>, <Mono color="var(--accent2)">−270 kg</Mono>, <Mono color="var(--red)">$246</Mono>, <span className="badge badge-green">2.2%</span>],
                  ]}
                />
              </Card>
              <Card style={{ marginBottom: 0 }}>
                <CardHead icon="ti-tools">Variance by worker</CardHead>
                <DataTable
                  headers={['Worker', 'Sessions', 'Total var.', 'Avg %']}
                  rows={[['Hasan Moussa', <Mono>42</Mono>, <Mono color="var(--accent2)">−1,420 kg</Mono>, <span className="badge badge-amber">2.8%</span>]]}
                />
                <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>Only one worker. Variance of 2–4% is normal (dust, breakage, moisture loss).</div>
              </Card>
            </div>
            <Card>
              <CardHead icon="ti-list">Session variance log</CardHead>
              <DataTable
                headers={['Session', 'Date', 'Lot', 'kg consumed', 'kg output', 'Variance', 'Var. cost']}
                rows={(variance?.rows ?? []).map(r => [
                  <Mono>{r.sessionId.slice(0, 8)}</Mono>,
                  <span style={{ color: 'var(--text2)' }}>{new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>,
                  <span>{r.lotId.slice(0, 8)}</span>,
                  <Mono>{parseFloat(r.kgConsumed).toFixed(0)} kg</Mono>,
                  <Mono>{parseFloat(r.kgOutputTotal).toFixed(0)} kg</Mono>,
                  <Mono color="var(--accent2)">{parseFloat(r.varianceKg).toFixed(1)} kg</Mono>,
                  <Mono color="var(--red)">{usd(r.varianceCostUsd)}</Mono>,
                ])}
              />
              {(!variance || variance.rows.length === 0) && <div className="empty">No variance records for this period.</div>}
            </Card>
          </div>
        )}

        {/* ── WORKER EARNINGS ── */}
        {tab === 'worker' && (
          <div>
            {workersQ.isLoading && <div className="empty">Loading worker data…</div>}
            {workersQ.isError && <div className="empty">Failed to load workers.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => workersQ.refetch()}>Retry</button></div></div>}
            {!workersQ.isLoading && allWorkers.length === 0 && <div className="empty">No workers yet. Add workers in the Employees page.</div>}

            {/* Summary across all workers */}
            {!workersQ.isLoading && allWorkers.length > 0 && (() => {
              const totalEarned = allWorkers.reduce((s, w) => s + parseFloat(w.totalEarned), 0)
              const totalPaid   = allWorkers.reduce((s, w) => s + parseFloat(w.totalPaid), 0)
              const totalOwed   = allWorkers.reduce((s, w) => s + parseFloat(w.totalOwed), 0)
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 14 }}>
                  <SvCard label="Total earned (all workers)" value={usd(String(totalEarned))} sub={`${allWorkers.length} worker${allWorkers.length !== 1 ? 's' : ''}`} />
                  <SvCard label="Total paid out"            value={usd(String(totalPaid))}   sub="cumulative payments" color="var(--accent)" />
                  <SvCard label="Total owed"                value={usd(String(totalOwed))}   sub="still to be paid"    color="var(--accent2)" />
                </div>
              )
            })()}

            {/* Per-worker breakdown */}
            {!workersQ.isLoading && allWorkers.map(worker => (
              <Card key={worker.id}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{worker.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      Earned: <strong style={{ color: 'var(--accent)' }}>{usd(worker.totalEarned)}</strong>
                      {' · '}Paid: <strong>{usd(worker.totalPaid)}</strong>
                      {' · '}Owed: <strong style={{ color: parseFloat(worker.totalOwed) > 0 ? 'var(--accent2)' : 'var(--text3)' }}>{usd(worker.totalOwed)}</strong>
                    </div>
                  </div>
                  {parseFloat(worker.totalOwed) > 0 && (
                    <button
                      style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => setPayOpen(true)}
                    >
                      <i className="ti ti-cash" style={{ fontSize: 13 }} /> Pay {usd(worker.totalOwed)}
                    </button>
                  )}
                </div>
                {worker.totalBagsPacked.length > 0 ? (
                  <DataTable
                    headers={['Bag type', 'Bags packed', 'Rate / bag', 'Earned']}
                    rows={worker.totalBagsPacked.map(entry => {
                      const rateEntry = worker.ratesPerBagType.find(r => r.bagTypeId === entry.bagTypeId)
                      const rate = rateEntry?.ratePerBag ?? 0
                      const earned = entry.count * rate
                      return [
                        <Mono bold>{bagTypeNameById.get(entry.bagTypeId) ?? entry.bagTypeId.slice(0, 8)}</Mono>,
                        <Mono>{entry.count.toLocaleString('en-US')}</Mono>,
                        <Mono color="var(--text3)">${rate.toFixed(3)}</Mono>,
                        <Mono color="var(--accent)" bold>${earned.toFixed(2)}</Mono>,
                      ]
                    })}
                  />
                ) : (
                  <div className="empty">No packing sessions recorded yet.</div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* ── CLIENT LEDGER ── */}
        {tab === 'ledger' && (
          <div>
            {(() => {
              const allInvoices = invoicesQ.data?.data ?? []
              const allClients = clientsQ.data?.data ?? []
              const totalInvoiced = allInvoices.reduce((s, inv) => s + parseFloat(inv.total), 0)
              const totalCollected = allInvoices.reduce((s, inv) => s + parseFloat(inv.paidAmount), 0)
              const outstanding = totalInvoiced - totalCollected
              const clientCount = allClients.length
              const clientsWithBalance = allClients.filter(c => parseFloat(c.balance) > 0).length
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 14 }}>
                    <SvCard label="Total invoiced" value={invoicesQ.isLoading ? '…' : usd(String(totalInvoiced))} sub={`${clientCount} clients`} />
                    <SvCard label="Total collected" value={invoicesQ.isLoading ? '…' : usd(String(totalCollected))} sub={totalInvoiced > 0 ? `${((totalCollected / totalInvoiced) * 100).toFixed(1)}% collection rate` : '—'} color="var(--accent)" />
                    <SvCard label="Outstanding" value={invoicesQ.isLoading ? '…' : usd(String(outstanding))} sub={`${clientsWithBalance} clients with balance`} color="var(--accent2)" />
                  </div>
                  <Card>
                    <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}><i className="ti ti-users" style={{ fontSize: 15, color: 'var(--text2)' }} /> Client ledger</div>
                      <button className="btn" style={{ fontSize: 12 }} onClick={() => showToast('Ledger exported')}><i className="ti ti-download" style={{ fontSize: 13 }} /> Export</button>
                    </div>
                    {clientsQ.isLoading && <div className="empty">Loading clients…</div>}
                    {clientsQ.isError && <div className="empty">Failed to load clients.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => clientsQ.refetch()}>Retry</button></div></div>}
                    {!clientsQ.isLoading && allClients.length === 0 && <div className="empty">No clients yet.</div>}
                    {!clientsQ.isLoading && allClients.length > 0 && (
                      <DataTable
                        headers={['Client', 'Type', 'Balance', 'Status']}
                        rows={allClients.map(c => {
                          const bal = parseFloat(c.balance)
                          const hasBalance = bal > 0
                          return [
                            <span style={{ fontWeight: 500 }}>{c.name}</span>,
                            <span className="badge badge-gray">{c.type}</span>,
                            <Mono bold color={hasBalance ? 'var(--accent2)' : 'var(--accent)'}>{usd(c.balance)}</Mono>,
                            hasBalance
                              ? <span className="badge badge-amber">Has balance</span>
                              : <span className="badge badge-green">Clear</span>,
                          ]
                        })}
                      />
                    )}
                  </Card>
                </>
              )
            })()}
          </div>
        )}


      </div>

      {/* EXPORT PDF MODAL */}
      {exportOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setExportOpen(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-head">
              <div className="modal-title"><i className="ti ti-download" style={{ fontSize: 14, marginRight: 6 }} />Export report</div>
              <button className="panel-close-btn" onClick={() => setExportOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Report</label>
                <select className="form-input">
                  <option>P&L — May 2026</option>
                  <option>Stock value</option>
                  <option>Variance report</option>
                  <option>Worker earnings</option>
                  <option>Client ledger</option>
                  <option>Container costs</option>
                  <option>Full report (all tabs)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Format</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['PDF', 'CSV', 'Excel'].map(f => (
                    <div key={f} style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '7px 0', borderRadius: 'var(--radius)', border: `1px solid ${f === 'PDF' ? 'var(--text)' : 'var(--border)'}`, background: f === 'PDF' ? 'var(--text)' : 'transparent', color: f === 'PDF' ? '#fff' : 'var(--text2)', fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Date range</label>
                <select className="form-input">
                  <option>May 2026</option><option>April 2026</option><option>Q1 2026</option><option>All time</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setExportOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setExportOpen(false); showToast('Report exported — pnl_may2026.pdf') }}><i className="ti ti-download" style={{ fontSize: 14 }} /> Export</button>
            </div>
          </div>
        </div>
      )}

      {/* PAY WORKER MODAL */}
      {payOpen && firstWorker && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Pay {firstWorker.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Total owed: <strong style={{ color: 'var(--accent2)' }}>{usd(firstWorker.totalOwed)}</strong></div>
              </div>
              <button className="panel-close-btn" onClick={() => setPayOpen(false)}>✕</button>
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
                  const owed = parseFloat(firstWorker.totalOwed)
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
              <button className="btn" onClick={() => setPayOpen(false)}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => {
                  if (!payAmt || parseFloat(payAmt) <= 0) return
                  logWorkerPayment.mutate(
                    { id: firstWorker.id, body: { amount: payAmt, date: payDate, notes: 'Reports payment' } },
                    { onSuccess: () => { setPayOpen(false); showToast(`Payment logged for ${firstWorker.name}`) } }
                  )
                }}
              >
                <i className="ti ti-check" style={{ fontSize: 14 }} /> Confirm payment
              </button>
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
