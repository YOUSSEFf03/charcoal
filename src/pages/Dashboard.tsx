import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useWarehouseSummary, useStockLots } from '../hooks/useWarehouse'
import { useOrders } from '../hooks/useOrders'
import { useOverdueClients } from '../hooks/useClients'
import { useContainers } from '../hooks/useContainers'
import { useProfitLoss, useActivity } from '../hooks/useReports'
import type { ActivityItem } from '../hooks/useReports'
import { useWorkers } from '../hooks/useWorkers'
import { useDriverTrips } from '../hooks/useDriverTrips'

const miniBarHeights = [40,55,70,45,80,65,90,75,85,60,95,70,88,72,92,78,84,91,96,100,88]

function fmtKg(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'
}

function fmtUsd(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ACTIVITY_META: Record<string, { bg: string; icon: string; color: string }> = {
  packing:   { bg: 'var(--accent-bg)',   icon: 'ti ti-box',           color: 'var(--accent)' },
  delivery:  { bg: 'var(--blue-bg)',     icon: 'ti ti-truck',          color: 'var(--blue)' },
  payment:   { bg: 'var(--red-bg)',      icon: 'ti ti-cash',           color: 'var(--red)' },
  invoice:   { bg: 'var(--accent2-bg)', icon: 'ti ti-file-invoice',   color: 'var(--accent2)' },
  order:     { bg: 'var(--blue-bg)',     icon: 'ti ti-trending-up',    color: 'var(--blue)' },
  fill:      { bg: 'var(--accent-bg)',   icon: 'ti ti-refresh',        color: 'var(--accent)' },
  container: { bg: 'var(--accent-bg)',   icon: 'ti ti-ship',           color: 'var(--accent)' },
  exit:      { bg: 'var(--accent2-bg)', icon: 'ti ti-door-exit',      color: 'var(--accent2)' },
}

function ActivityRow({ item, padding }: { item: ActivityItem; padding?: string }) {
  const meta = ACTIVITY_META[item.type] ?? ACTIVITY_META.exit
  return (
    <div className="activity-row" style={padding ? { padding } : undefined}>
      <div className="act-icon" style={{ background: meta.bg }}>
        <i className={meta.icon} style={{ color: meta.color }} />
      </div>
      <div className="act-body">
        <div className="act-text">{item.title}</div>
        <div className="act-time">{item.subtitle && <span style={{ marginRight: 6 }}>{item.subtitle} ·</span>}{timeAgo(item.timestamp)}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState('Cash')
  const [toast, setToast] = useState(false)

  // Live dashboard data sources.
  const summaryQ = useWarehouseSummary()
  const activeOrdersQ = useOrders({ status: 'confirmed' })
  const overdueQ = useOverdueClients()
  const portContainersQ = useContainers({ status: 'port' })
  const stockLotsQ = useStockLots({ limit: 5 })
  const workersQ = useWorkers()

  // Profit & loss for current month.
  const now = new Date()
  const dateFrom = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01'
  const dateTo = now.toISOString().slice(0, 10)
  const plQ = useProfitLoss({ dateFrom, dateTo })

  const today = new Date().toISOString().slice(0, 10)
  const todayTripsQ = useDriverTrips({ dateFrom: today, dateTo: today, limit: 10 })
  const todayTrips = todayTripsQ.data?.data ?? []

  const activityQ = useActivity(30)
  const activityItems = activityQ.data ?? []

  const loading = summaryQ.isLoading || activeOrdersQ.isLoading || overdueQ.isLoading || portContainersQ.isLoading
  const anyError = summaryQ.isError || activeOrdersQ.isError || overdueQ.isError || portContainersQ.isError

  const summary = summaryQ.data
  const overdueClients = overdueQ.data ?? []
  const activeOrderCount = activeOrdersQ.data?.total ?? 0
  const portContainers = portContainersQ.data?.data ?? []

  // Aggregate packed bag totals from the warehouse summary's per-bag-type rollup.
  const packedSummary = summary?.packedSummary ?? []
  const totalPackedBags = packedSummary.reduce((acc, p) => acc + p.totalBags, 0)

  const firstWorker = workersQ.data?.[0]

  function refetchAll() {
    summaryQ.refetch()
    activeOrdersQ.refetch()
    overdueQ.refetch()
    portContainersQ.refetch()
    stockLotsQ.refetch()
    workersQ.refetch()
    plQ.refetch()
    todayTripsQ.refetch()
    activityQ.refetch()
  }

  function showToast() {
    setPayOpen(false)
    setToast(true)
    setTimeout(() => setToast(false), 2800)
  }

  return (
    <>
      <Topbar title="Dashboard">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
          Thursday, 21 May 2026
        </span>
        <button className="btn" onClick={() => setNotifOpen(true)}><i className="ti ti-bell" style={{ fontSize: 15 }} /></button>
        <button className="btn" onClick={() => navigate('/orders')}><i className="ti ti-plus" style={{ fontSize: 15 }} /> New order</button>
        <button className="btn primary" onClick={() => navigate('/containers')}><i className="ti ti-ship" style={{ fontSize: 15 }} /> Add container</button>
      </Topbar>

      <div className="content">

        {anyError && (
          <div className="empty">
            Failed to load dashboard data.
            <div><button className="btn" style={{ marginTop: 10 }} onClick={refetchAll}>Retry</button></div>
          </div>
        )}

        {/* KPI ROW */}
        <div className="kpi-row">
          <div className="kpi" style={{ animationDelay: '0.05s' }}>
            <div className="kpi-header">
              <span className="kpi-label">Total stock</span>
              <div className="kpi-icon" style={{ background: '#EAF5EF' }}><i className="ti ti-building-warehouse" style={{ color: '#1D6B4A' }} /></div>
            </div>
            {loading
              ? <div className="skeleton" style={{ width: '70%', height: 24, marginBottom: 4 }} />
              : <div className="kpi-value">{fmtKg(summary?.totalRawKg)}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text3)' }}> kg</span></div>}
            <div className="kpi-sub">
              <span>{summary?.lotCount ?? 0} open lots</span>
            </div>
          </div>
          <div className="kpi" style={{ animationDelay: '0.10s' }}>
            <div className="kpi-header">
              <span className="kpi-label">Overdue clients</span>
              <div className="kpi-icon" style={{ background: '#FEF3C7' }}><i className="ti ti-credit-card" style={{ color: '#B45309' }} /></div>
            </div>
            {loading
              ? <div className="skeleton" style={{ width: '40%', height: 24, marginBottom: 4 }} />
              : <div className="kpi-value">{overdueClients.length}</div>}
            <div className="kpi-sub">
              <span className="kpi-delta delta-warn">CRM alert</span>
              <span>past payment terms</span>
            </div>
          </div>
          <div className="kpi" style={{ animationDelay: '0.15s' }}>
            <div className="kpi-header">
              <span className="kpi-label">Active orders</span>
              <div className="kpi-icon" style={{ background: '#EFF6FF' }}><i className="ti ti-trending-up" style={{ color: '#1D4ED8' }} /></div>
            </div>
            {loading
              ? <div className="skeleton" style={{ width: '40%', height: 24, marginBottom: 4 }} />
              : <div className="kpi-value">{activeOrderCount}</div>}
            <div className="kpi-sub">
              <span>confirmed, awaiting delivery</span>
            </div>
          </div>
          <div className="kpi" style={{ animationDelay: '0.20s' }}>
            <div className="kpi-header">
              <span className="kpi-label">Containers at port</span>
              <div className="kpi-icon" style={{ background: '#EAF5EF' }}><i className="ti ti-ship" style={{ color: '#1D6B4A' }} /></div>
            </div>
            {loading
              ? <div className="skeleton" style={{ width: '40%', height: 24, marginBottom: 4 }} />
              : <div className="kpi-value" style={{ color: 'var(--accent)' }}>{portContainers.length}</div>}
            <div className="kpi-sub">
              <span>awaiting clearance</span>
            </div>
          </div>
        </div>

        {/* ROW 2 */}
        <div className="grid-3-2">
          {/* Raw stock */}
          <div className="card" style={{ animationDelay: '0.25s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-package" /> Raw stock — open lots</div>
              <button className="card-action" onClick={() => navigate('/warehouse')}>View all</button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type / grade</th>
                  <th>Remaining</th>
                  <th>Cost/kg</th>
                </tr>
              </thead>
              <tbody>
                {stockLotsQ.isLoading && [0, 1, 2, 3, 4].map(i => (
                  <tr key={i}>
                    <td><div className="skeleton" style={{ width: '80%', height: 13 }} /></td>
                    <td><div className="skeleton" style={{ width: '60%', height: 13 }} /></td>
                    <td><div className="skeleton" style={{ width: '40%', height: 13 }} /></td>
                  </tr>
                ))}
                {!stockLotsQ.isLoading && (stockLotsQ.data?.data ?? []).slice(0, 5).map(lot => {
                  const remaining = parseFloat(lot.kgRemaining)
                  const received = parseFloat(lot.kgReceived)
                  const pct = received > 0 ? Math.round((remaining / received) * 100) : 0
                  const barCls = pct >= 60 ? 'bar-high' : pct >= 30 ? 'bar-mid' : 'bar-low'
                  return (
                    <tr key={lot.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{lot.charcoalType}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{lot.grade}</div>
                      </td>
                      <td>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>{fmtKg(lot.kgRemaining)} kg</span>
                        <div className="bar-track" style={{ marginTop: 5, width: 80 }}>
                          <div className={`bar-fill ${barCls}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{lot.costPerKg != null ? `$${parseFloat(lot.costPerKg).toFixed(2)}` : '—'}</td>
                    </tr>
                  )
                })}
                {!stockLotsQ.isLoading && (stockLotsQ.data?.data ?? []).length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: '14px 0' }}>No open lots</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Today's deliveries */}
          <div className="card" style={{ animationDelay: '0.30s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-truck" /> Today's deliveries</div>
              <button className="card-action" onClick={() => navigate('/orders')}>Manage</button>
            </div>
            {todayTripsQ.isLoading && <div className="empty">Loading…</div>}
            {!todayTripsQ.isLoading && todayTrips.length === 0 && (
              <div className="empty" style={{ padding: '20px 18px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No trips today
              </div>
            )}
            {todayTrips.map(trip => {
              const statusBadge =
                trip.status === 'completed' ? 'badge-green' :
                trip.status === 'in_progress' ? 'badge-blue' : 'badge-gray'
              const statusLabel =
                trip.status === 'completed' ? 'Completed' :
                trip.status === 'in_progress' ? 'In progress' : 'Planned'
              const driverName = (trip as any).driver?.name ?? trip.driverId.slice(0, 8)
              const initials = driverName.trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
              return (
                <div className="delivery-row" key={trip.id}>
                  <div className="driver-avatar">{initials}</div>
                  <div className="del-info">
                    <div className="del-driver">{driverName}</div>
                    <div className="del-stops">{(trip as any)._count?.shipments ?? 0} shipments · {trip.fuelCost ? `$${trip.fuelCost} fuel` : 'no expenses logged'}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className={`badge ${statusBadge}`}>{statusLabel}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ROW 3 */}
        <div className="grid-3">
          {/* Packed bags */}
          <div className="card" style={{ animationDelay: '0.35s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-box" /> Packed stock</div>
              <button className="card-action" onClick={() => navigate('/warehouse')}>View all</button>
            </div>
            <div className="bags-grid">
              {loading && [0, 1, 2].map(i => (
                <div className="bag-cell" key={i}>
                  <div className="skeleton" style={{ width: '50%', height: 11, margin: '0 auto 6px' }} />
                  <div className="skeleton" style={{ width: '40%', height: 20, margin: '0 auto' }} />
                </div>
              ))}
              {!loading && packedSummary.map(b => (
                <div className="bag-cell" key={b.bagTypeId}>
                  <div className="bag-size">{b.bagTypeName}</div>
                  <div className="bag-count">{b.totalBags.toLocaleString('en-US')}</div>
                  <div className="bag-kg">{(b.lots?.length ?? 0)} lot{(b.lots?.length ?? 0) === 1 ? '' : 's'}</div>
                </div>
              ))}
              {!loading && (
                <div className="bag-cell" style={{ background: 'var(--surface2)' }}>
                  <div className="bag-size">total</div>
                  <div className="bag-count" style={{ color: 'var(--accent)' }}>{totalPackedBags.toLocaleString('en-US')}</div>
                  <div className="bag-kg">{fmtKg(summary?.totalPackedNominalKg)} kg</div>
                </div>
              )}
            </div>
            <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Bag types</span>
                <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text2)' }}>{packedSummary.length}</span>
              </div>
            </div>
          </div>

          {/* CRM alerts */}
          <div className="card" style={{ animationDelay: '0.40s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-alert-circle" style={{ color: 'var(--accent2)' }} /> CRM alerts</div>
              <span className="badge badge-amber">{overdueClients.length} overdue</span>
            </div>
            {loading && [0, 1, 2].map(i => (
              <div className="alert-row" key={i}>
                <div className="alert-dot" style={{ background: 'var(--border)' }} />
                <div style={{ flex: 1 }}><div className="skeleton" style={{ width: '60%', height: 13, marginBottom: 4 }} /><div className="skeleton" style={{ width: '40%', height: 11 }} /></div>
              </div>
            ))}
            {!loading && overdueClients.length === 0 && (
              <div className="empty">No overdue clients</div>
            )}
            {!loading && overdueClients.map(c => (
              <div className="alert-row" key={c.id} onClick={() => navigate('/clients/' + c.id)} style={{ cursor: 'pointer' }}>
                <div className="alert-dot" style={{ background: 'var(--accent2)' }} />
                <div style={{ flex: 1 }}>
                  <div className="alert-name">{c.name}</div>
                  <div className="alert-meta">{c.type} · {fmtUsd(c.balance)} balance</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="alert-days" style={{ color: 'var(--accent2)' }}>overdue</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.avgOrderDays ? `avg ${Math.round(parseFloat(c.avgOrderDays))}d` : ''}</div>
                </div>
              </div>
            ))}
            <div style={{ padding: '11px 18px', borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => navigate('/clients')}
                style={{ width: '100%', padding: 7, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer', fontFamily: "'IBM Plex Sans', sans-serif", color: 'var(--text2)' }}
              >
                View all clients →
              </button>
            </div>
          </div>

          {/* Profit */}
          <div className="card" style={{ animationDelay: '0.45s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-chart-pie" /> Profit — {now.toLocaleString('en-US', { month: 'long' })} {now.getFullYear()}</div>
              <button className="card-action" onClick={() => navigate('/reports')}>Full report</button>
            </div>
            <div className="profit-block">
              <div className="profit-main">
                <div>
                  <div className="profit-period">gross profit</div>
                  <div className="profit-value">{plQ.isLoading ? '—' : fmtUsd(plQ.data?.grossProfit)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="profit-period">margin</div>
                  <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5, color: 'var(--accent)' }}>
                    {plQ.isLoading || !plQ.data ? '—' : (() => {
                      const rev = parseFloat(plQ.data.revenue)
                      const gp = parseFloat(plQ.data.grossProfit)
                      return rev > 0 ? `${((gp / rev) * 100).toFixed(1)}%` : '—'
                    })()}
                  </div>
                </div>
              </div>
              <div className="profit-breakdown">
                <div className="pb-item"><div className="pb-label">Revenue</div><div className="pb-value">{plQ.isLoading ? '—' : fmtUsd(plQ.data?.revenue)}</div></div>
                <div className="pb-item"><div className="pb-label">COGS</div><div className="pb-value red">{plQ.isLoading ? '—' : fmtUsd(plQ.data?.cogs)}</div></div>
                <div className="pb-item"><div className="pb-label">Bag costs</div><div className="pb-value red">{plQ.isLoading ? '—' : fmtUsd(plQ.data?.bagCost)}</div></div>
                <div className="pb-item"><div className="pb-label">Variances</div><div className="pb-value red">{plQ.isLoading ? '—' : fmtUsd(plQ.data?.varianceCost)}</div></div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", paddingBottom: 6 }}>daily revenue — {now.toLocaleString('en-US', { month: 'long' }).toLowerCase()}</div>
                <div className="mini-chart">
                  {miniBarHeights.map((h, i) => (
                    <div key={i} className="bar-col" style={{ height: `${h}%`, background: i >= 16 ? '#1D6B4A' : '#CBD5E1' }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ROW 4 */}
        <div className="grid-2">
          {/* Recent activity */}
          <div className="card" style={{ animationDelay: '0.50s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-activity" /> Recent activity</div>
              <button className="card-action" onClick={() => setLogsOpen(true)}>All logs</button>
            </div>
            {activityQ.isLoading && (
              [0, 1, 2, 3, 4].map(i => (
                <div className="activity-row" key={i}>
                  <div className="act-icon" style={{ background: 'var(--surface2)' }} />
                  <div className="act-body">
                    <div className="skeleton" style={{ width: '70%', height: 13, marginBottom: 5 }} />
                    <div className="skeleton" style={{ width: '40%', height: 11 }} />
                  </div>
                </div>
              ))
            )}
            {!activityQ.isLoading && activityItems.length === 0 && (
              <div className="empty" style={{ padding: '20px 18px', color: 'var(--text3)', fontSize: 13 }}>No activity yet</div>
            )}
            {!activityQ.isLoading && activityItems.slice(0, 5).map(item => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>

          {/* Worker earnings */}
          <div className="card" style={{ animationDelay: '0.55s' }}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-tools" /> Worker — {firstWorker?.name ?? 'No worker'}</div>
              {firstWorker && <button className="card-action" onClick={() => setPayOpen(true)}>Pay now</button>}
            </div>
            {workersQ.isLoading && (
              <div style={{ padding: '16px 18px' }}>
                <div className="skeleton" style={{ width: '50%', height: 28, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: '30%', height: 14 }} />
              </div>
            )}
            {!workersQ.isLoading && !firstWorker && (
              <div className="empty">No workers yet</div>
            )}
            {!workersQ.isLoading && firstWorker && (
              <>
                <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 3 }}>total owed</div>
                      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -1, color: 'var(--accent2)' }}>{fmtUsd(firstWorker.totalOwed)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>total earned</div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{fmtUsd(firstWorker.totalEarned)}</div>
                    </div>
                  </div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr><th>Bag type</th><th>Bags packed</th><th>Rate</th><th>Earned</th></tr>
                  </thead>
                  <tbody>
                    {firstWorker.totalBagsPacked.map((entry, i) => {
                      const rateEntry = firstWorker.ratesPerBagType.find(r => r.bagTypeId === entry.bagTypeId)
                      const rate = rateEntry?.ratePerBag ?? 0
                      const earned = entry.count * rate
                      return (
                        <tr key={i}>
                          <td><span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{entry.bagTypeId.slice(-8)}</span></td>
                          <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{entry.count.toLocaleString('en-US')}</td>
                          <td style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)' }}>${rate.toFixed(2)}</td>
                          <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>${earned.toFixed(2)}</td>
                        </tr>
                      )
                    })}
                    {firstWorker.totalBagsPacked.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text3)', padding: '12px 0' }}>No packing sessions yet</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Total earned all-time</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{fmtUsd(firstWorker.totalEarned)}</span>
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* NOTIFICATION POPOUT */}
      {notifOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setNotifOpen(false)}>
          <div className="modal" style={{ width: 420, maxHeight: '80vh', overflowY: 'auto', position: 'absolute', top: 60, right: 24, left: 'auto', transform: 'none' }}>
            <div className="modal-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <div className="modal-title"><i className="ti ti-bell" style={{ fontSize: 15, marginRight: 6 }} />Notifications</div>
              <button className="panel-close-btn" onClick={() => setNotifOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              {[
                { bg: 'var(--red-bg)', ic: 'ti ti-alert-circle', icC: 'var(--red)', title: 'Al Rawda Restaurant overdue', sub: '+14 days · $840 outstanding', time: 'Just now', unread: true },
                { bg: 'var(--accent2-bg)', ic: 'ti ti-clock', icC: 'var(--accent2)', title: 'Chez Michel overdue', sub: '+6 days · $320 outstanding', time: '2h ago', unread: true },
                { bg: 'var(--blue-bg)', ic: 'ti ti-truck', icC: 'var(--blue)', title: 'MK trip in progress', sub: 'Stop 2 of 3 — Achrafieh in transit', time: '3h ago', unread: true },
                { bg: 'var(--accent-bg)', ic: 'ti ti-box', icC: 'var(--accent)', title: 'Packing session completed', sub: '240 bags packed · session #PS-0842', time: 'Today 09:14', unread: false },
                { bg: 'var(--accent-bg)', ic: 'ti ti-ship', icC: 'var(--accent)', title: 'Container CONT-0041 at port', sub: 'Al-Amin Trading · ETA May 28', time: 'Yesterday', unread: false },
              ].map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--border)', background: n.unread ? 'var(--surface2)' : 'transparent', cursor: 'pointer' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: n.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className={n.ic} style={{ color: n.icC, fontSize: 15 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: n.unread ? 600 : 400 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{n.sub}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{n.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ALL LOGS MODAL */}
      {logsOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setLogsOpen(false)}>
          <div className="modal" style={{ width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <div>
                <div className="modal-title"><i className="ti ti-activity" style={{ fontSize: 15, marginRight: 6 }} />Activity log</div>
                <div className="modal-sub">{activityItems.length} recent events · auto-refreshes every 60 s</div>
              </div>
              <button className="panel-close-btn" onClick={() => setLogsOpen(false)}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {activityQ.isLoading && (
                <div className="empty">Loading activity…</div>
              )}
              {!activityQ.isLoading && activityItems.length === 0 && (
                <div className="empty">No activity recorded yet.</div>
              )}
              {activityItems.map(item => (
                <ActivityRow key={item.id} item={item} padding="12px 18px" />
              ))}
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
                <div className="modal-title">Pay worker — {firstWorker.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Total owed: <strong style={{ color: 'var(--accent2)' }}>{fmtUsd(firstWorker.totalOwed)}</strong></div>
              </div>
              <button className="panel-close-btn" onClick={() => setPayOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Payment date</label>
                <input className="form-input" type="date" defaultValue={dateTo} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (USD)</label>
                <input className="form-input" type="number" placeholder="0.00" value={payAmt} onChange={e => setPayAmt(e.target.value)} />
                {payAmt && (() => {
                  const owed = parseFloat(firstWorker.totalOwed)
                  const entered = parseFloat(payAmt)
                  return (
                    <div style={{ marginTop: 6, fontSize: 12, color: entered >= owed ? 'var(--accent)' : 'var(--accent2)', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {entered >= owed ? 'Fully settled ✓' : `Remaining: $${(owed - entered).toFixed(2)}`}
                    </div>
                  )
                })()}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Method</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Cash', 'Whish', 'OMT'].map(m => (
                    <div key={m} className="stop-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', background: payMethod === m ? 'var(--text)' : 'transparent', color: payMethod === m ? '#fff' : 'var(--text2)', borderColor: payMethod === m ? 'var(--text)' : 'var(--border)', padding: '6px 0', borderRadius: 'var(--radius)', border: '1px solid', fontSize: 13 }} onClick={() => setPayMethod(m)}>
                      {m}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPayOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={showToast}><i className="ti ti-check" style={{ fontSize: 14 }} /> Confirm payment</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> Payment logged for {firstWorker?.name ?? 'worker'}
        </div>
      )}
    </>
  )
}
