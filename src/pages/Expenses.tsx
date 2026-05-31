import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useAllExpenses, useDriverExpenses } from '../hooks/useExpenses'
import type { DriverTrip } from '../types/api'

type ETab = 'expenses' | 'employees'

interface ExpItem {
  id: number
  desc: string
  icon: string
  iconBg: string
  iconColor: string
  amount: number
  category: string
  date?: string
  meta?: string
}

// ── Seed data ─────────────────────────────────────────────
const SEED_RECURRING: ExpItem[] = [
  { id: 1, desc: 'Warehouse rent',  icon: 'ti-building',    iconBg: '#EFF6FF', iconColor: 'var(--blue)',    amount: 1500, category: 'Rent' },
  { id: 2, desc: 'Electricity',     icon: 'ti-bolt',        iconBg: '#FEF3C7', iconColor: 'var(--accent2)', amount: 320,  category: 'Utilities' },
  { id: 3, desc: 'Accountant',      icon: 'ti-calculator',  iconBg: '#EAF5EF', iconColor: 'var(--accent)',  amount: 580,  category: 'Services' },
]

const SEED_ONETIME: ExpItem[] = [
  { id: 4, desc: 'Warehouse generator fuel', icon: 'ti-gas-station', iconBg: '#EFF6FF', iconColor: 'var(--blue)',    amount: 180, category: 'Utilities', date: '3 May 2026' },
  { id: 5, desc: 'Scale repair',             icon: 'ti-tools',       iconBg: '#FEF2F2', iconColor: 'var(--red)',     amount: 240, category: 'Equipment', date: '8 May 2026' },
  { id: 6, desc: 'Bag purchase — 2kg bags',  icon: 'ti-package',     iconBg: '#EAF5EF', iconColor: 'var(--accent)',  amount: 200, category: 'Supplies',  date: '12 May 2026', meta: '5,000 bags × $0.04' },
  { id: 7, desc: 'Vehicle maintenance',      icon: 'ti-truck',       iconBg: '#FEF3C7', iconColor: 'var(--accent2)', amount: 320, category: 'Transport', date: '15 May 2026' },
]

const WORKER_WORKED_DAYS = new Set([1,2,4,5,6,7,8,11,12,13,14,15,18,19,20,21,22,23])
const MAY_DAYS = 31
const TODAY_DAY = 21

const BAG_BREAKDOWN = [
  { size: '2 kg',  bags: 1180, rate: 0.050, earn: 59.00 },
  { size: '5 kg',  bags:  320, rate: 0.080, earn: 25.60 },
  { size: '10 kg', bags:  140, rate: 0.120, earn: 16.80 },
  { size: '20 kg', bags:   42, rate: 0.180, earn:  7.56 },
]

// Short driver label/avatar derived from a driverId (no driver name on the API).
const DRIVER_AVATAR_PALETTE = [
  { avatarBg: 'var(--blue-bg,#EFF6FF)', avatarColor: 'var(--blue)' },
  { avatarBg: 'var(--accent2-bg)', avatarColor: 'var(--accent2)' },
  { avatarBg: '#F3F4F6', avatarColor: '#374151' },
]

/** Sum a driver trip's expenses (fuel + other) as a number of USD. */
function tripExpenseTotal(t: DriverTrip): number {
  const fuel = t.fuelCost != null ? parseFloat(t.fuelCost) : 0
  const other = (t.otherExpenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return (Number.isFinite(fuel) ? fuel : 0) + other
}

interface DriverGroup {
  driverId: string
  label: string
  trips: DriverTrip[]
  daysWorked: number
  expensesTotal: number
}

/** Group driver trips by driverId into per-driver cards. */
function groupDriverTrips(trips: DriverTrip[]): DriverGroup[] {
  const byDriver = new Map<string, DriverTrip[]>()
  for (const t of trips) {
    const arr = byDriver.get(t.driverId) ?? []
    arr.push(t)
    byDriver.set(t.driverId, arr)
  }
  return Array.from(byDriver.entries()).map(([driverId, ts]) => {
    const days = new Set(
      ts.map(t => (t.startedAt ?? t.createdAt ?? '').slice(0, 10)).filter(Boolean),
    )
    return {
      driverId,
      label: driverId.slice(0, 2).toUpperCase(),
      trips: ts,
      daysWorked: days.size,
      expensesTotal: ts.reduce((s, t) => s + tripExpenseTotal(t), 0),
    }
  })
}

export default function Expenses() {
  const [tab, setTab] = useState<ETab>('expenses')
  const [recurring, setRecurring] = useState<ExpItem[]>(SEED_RECURRING)
  const [onetime, setOnetime] = useState<ExpItem[]>(SEED_ONETIME)

  // Live data: container expense rows + driver-trip expense rows.
  const {
    data: containerExpenses,
    isLoading: contLoading,
    isError: contError,
    refetch: refetchContainers,
  } = useAllExpenses()
  const {
    data: driverTripsResp,
    isLoading: drvLoading,
    isError: drvError,
    refetch: refetchDrivers,
  } = useDriverExpenses()

  const driverGroups = groupDriverTrips(driverTripsResp?.data ?? [])

  // Add expense modal
  const [addModalType, setAddModalType] = useState<'recurring' | 'onetime' | null>(null)
  const [newDesc, setNewDesc] = useState('')
  const [newAmt, setNewAmt] = useState('')
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10))
  const [newIsRecurring, setNewIsRecurring] = useState(false)
  const [newNotes, setNewNotes] = useState('')

  // Pay modal
  const [payTarget, setPayTarget] = useState<{ name: string; owed: number } | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState<'Cash' | 'Whish' | 'OMT'>('Cash')

  // ── Derived totals ─────────────────────────────────────
  const totalRecurring = recurring.reduce((s, e) => s + e.amount, 0)
  const totalOnetime   = onetime.reduce((s, e) => s + e.amount, 0)
  const totalExpenses  = totalRecurring + totalOnetime

  const workerBagEarn  = BAG_BREAKDOWN.reduce((s, r) => s + r.earn, 0)   // 108.96
  const workerDailyEarn = 15 * 18  // $15/day × 18 days = $270
  const workerTotalEarned = workerDailyEarn + workerBagEarn                // $410.96
  const workerPaid     = 126.76
  const workerOwed     = workerTotalEarned - workerPaid                    // $284.20

  // Driver trip expenses (fuel + other) replace the old hardcoded wage figures.
  const totalDriverExpenses = driverGroups.reduce((s, g) => s + g.expensesTotal, 0)
  const totalWagesOwed = workerOwed + totalDriverExpenses
  const totalOutgoing  = totalExpenses + totalWagesOwed

  // ── Expenses by category (my addition) ────────────────
  const allExp = [...recurring, ...onetime]
  const categoryTotals: Record<string, number> = {}
  allExp.forEach(e => { categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount })
  const CATEGORY_COLORS: Record<string, string> = {
    Rent:       'var(--blue)',
    Utilities:  'var(--accent2)',
    Services:   'var(--accent)',
    Equipment:  'var(--red)',
    Supplies:   '#6d28d9',
    Transport:  '#0891b2',
  }
  const categoryRows = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])

  // ── Add expense ───────────────────────────────────────
  function openAdd(type: 'recurring' | 'onetime') {
    setAddModalType(type)
    setNewIsRecurring(type === 'recurring')
    setNewDesc(''); setNewAmt(''); setNewNotes('')
    setNewDate(new Date().toISOString().slice(0, 10))
  }
  function saveExpense() {
    if (!newDesc.trim() || !newAmt) return
    const item: ExpItem = {
      id: Date.now(),
      desc: newDesc.trim(),
      icon: 'ti-receipt-2',
      iconBg: 'var(--surface2)',
      iconColor: 'var(--text2)',
      amount: parseFloat(newAmt),
      category: 'Other',
      date: newDate,
    }
    if (newIsRecurring) setRecurring(prev => [...prev, item])
    else setOnetime(prev => [...prev, item])
    setAddModalType(null)
  }

  // ── Pay modal ─────────────────────────────────────────
  function openPay(name: string, owed: number) {
    setPayTarget({ name, owed })
    setPayAmt('')
    setPayMethod('Cash')
    setPayDate(new Date().toISOString().slice(0, 10))
  }

  const payAmtNum  = parseFloat(payAmt) || 0
  const payOwed    = payTarget?.owed ?? 0
  const payDiff    = payAmtNum - payOwed
  let   payBarCls  = 'diff-bar none'
  let   payBarLbl  = 'Enter amount above'
  let   payBarVal  = '—'
  if (payAmtNum > 0) {
    if (Math.abs(payDiff) < 0.01) {
      payBarCls = 'diff-bar ok';   payBarLbl = 'Pays full amount ✓';             payBarVal = '$0 remaining'
    } else if (payDiff < 0) {
      payBarCls = 'diff-bar short'; payBarLbl = `Partial — $${Math.abs(payDiff).toFixed(2)} still owed`; payBarVal = `$${Math.abs(payDiff).toFixed(2)} left`
    } else {
      payBarCls = 'diff-bar ok';   payBarLbl = `Over by $${payDiff.toFixed(2)} — noted`; payBarVal = `+$${payDiff.toFixed(2)}`
    }
  }

  // ── Calendar renderer ─────────────────────────────────
  function DaysGrid({ worked }: { worked: Set<number> }) {
    const cells = []
    for (let d = 1; d <= MAY_DAYS; d++) {
      let cls = 'day-cell'
      if (d > TODAY_DAY)    cls += ' future'
      else if (worked.has(d)) cls += ' worked'
      if (d === TODAY_DAY)  cls += ' today'
      cells.push(<div key={d} className={cls}>{d}</div>)
    }
    return <div className="days-grid">{cells}</div>
  }

  // ── Render ────────────────────────────────────────────
  return (
    <>
      <Topbar title="Expenses & Employees">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
          May 2026
        </span>
        <button className="btn"><i className="ti ti-chevron-left" style={{ fontSize: 14 }} /></button>
        <button className="btn"><i className="ti ti-chevron-right" style={{ fontSize: 14 }} /></button>
      </Topbar>

      {/* Tabs */}
      <div className="tabs">
        <div className={`tab${tab === 'expenses' ? ' active' : ''}`} onClick={() => setTab('expenses')}>
          <i className="ti ti-receipt-2" style={{ fontSize: 14 }} /> Expenses
          <span className="tab-count">12</span>
        </div>
        <div className={`tab${tab === 'employees' ? ' active' : ''}`} onClick={() => setTab('employees')}>
          <i className="ti ti-users" style={{ fontSize: 14 }} /> Employees
          <span className="tab-count">4</span>
        </div>
      </div>

      <div className="content">

        {/* KPI row */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Total expenses (May)</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${totalExpenses.toLocaleString()}</div>
            <div className="kpi-sub">{recurring.length + onetime.length} expense entries</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Recurring (monthly)</div>
            <div className="kpi-value">${totalRecurring.toLocaleString()}</div>
            <div className="kpi-sub">rent + fixed costs</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Employee wages owed</div>
            <div className="kpi-value" style={{ color: 'var(--accent2)' }}>${totalWagesOwed.toFixed(0)}</div>
            <div className="kpi-sub">worker + 3 drivers</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Total outgoing (May)</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${totalOutgoing.toFixed(0)}</div>
            <div className="kpi-sub">expenses + wages</div>
          </div>
        </div>

        {/* ── EXPENSES TAB ── */}
        {tab === 'expenses' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

            {/* Left: expense lists */}
            <div>

              {/* Recurring */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-repeat" /> Recurring — monthly</div>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => openAdd('recurring')}>
                    <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add
                  </button>
                </div>
                {recurring.map(e => (
                  <div key={e.id} className="exp-item">
                    <div className="exp-icon" style={{ background: e.iconBg }}>
                      <i className={`ti ${e.icon}`} style={{ color: e.iconColor }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">{e.desc}</div>
                      <div className="exp-meta">Monthly · recurring</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${e.amount.toLocaleString()}</div>
                      <div className="exp-amount-lbl">per month</div>
                    </div>
                    <button className="exp-del"><i className="ti ti-edit" style={{ fontSize: 12 }} /></button>
                  </div>
                ))}
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text3)' }}>Total recurring</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalRecurring.toLocaleString()} / month</span>
                </div>
              </div>

              {/* One-time */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-plus-circle" /> One-time — May 2026</div>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => openAdd('onetime')}>
                    <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add expense
                  </button>
                </div>
                {onetime.map(e => (
                  <div key={e.id} className="exp-item">
                    <div className="exp-icon" style={{ background: e.iconBg }}>
                      <i className={`ti ${e.icon}`} style={{ color: e.iconColor }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">{e.desc}</div>
                      <div className="exp-meta">{e.meta ? `${e.date} · ${e.meta}` : `${e.date} · one-time`}</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${e.amount.toLocaleString()}</div>
                    </div>
                    <button className="exp-del" onClick={() => setOnetime(prev => prev.filter(x => x.id !== e.id))}>
                      <i className="ti ti-x" style={{ fontSize: 12 }} />
                    </button>
                  </div>
                ))}
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text3)' }}>Total one-time this month</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalOnetime.toLocaleString()}</span>
                </div>
              </div>

              {/* Container expenses (live) */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-package" /> Container expenses</div>
                </div>
                {contLoading && [0, 1, 2].map(i => (
                  <div key={`cont-sk-${i}`} className="exp-item">
                    <div className="exp-icon" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 18, height: 18, borderRadius: 4 }} /></div>
                    <div className="exp-info">
                      <div className="skeleton" style={{ width: '60%', height: 13, marginBottom: 4 }} />
                      <div className="skeleton" style={{ width: '40%', height: 11 }} />
                    </div>
                    <div className="exp-amount"><div className="skeleton" style={{ width: 60, height: 13 }} /></div>
                  </div>
                ))}
                {contError && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                    Failed to load container expenses.
                    <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetchContainers()}>Retry</button></div>
                  </div>
                )}
                {!contLoading && !contError && (containerExpenses?.length ?? 0) === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No container expenses recorded.</div>
                )}
                {!contLoading && !contError && (containerExpenses ?? []).map(e => (
                  <div key={e.id} className="exp-item">
                    <div className="exp-icon" style={{ background: 'var(--surface2)' }}>
                      <i className="ti ti-package" style={{ color: 'var(--text2)' }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">{e.description}</div>
                      <div className="exp-meta">Container {e.containerNumber} · {e.addedAt?.slice(0, 10)}</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${parseFloat(e.amount).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
                {!contLoading && !contError && (containerExpenses?.length ?? 0) > 0 && (
                  <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text3)' }}>Total container expenses</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
                      ${(containerExpenses ?? []).reduce((s, e) => s + parseFloat(e.amount), 0).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: summary + by type */}
            <div style={{ position: 'sticky', top: 76 }}>

              {/* Monthly summary */}
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-chart-bar" /> May 2026 summary</div>
                </div>
                <div style={{ padding: '4px 0 0' }}>
                  {[...recurring, ...onetime].map(e => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 18px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text2)' }}>{e.desc}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--red)' }}>${e.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '14px 18px', background: 'var(--surface2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Total expenses</span>
                    <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--red)' }}>${totalExpenses.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Excluding employee wages</div>
                </div>
              </div>

              {/* Expenses by category (added) */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-category" /> Spending by category</div>
                </div>
                <div style={{ padding: '6px 18px 12px' }}>
                  {categoryRows.map(([cat, amt]) => {
                    const pct = Math.round((amt / totalExpenses) * 100)
                    const color = CATEGORY_COLORS[cat] || 'var(--text3)'
                    return (
                      <div key={cat} className="cat-row">
                        <div className="cat-dot" style={{ background: color }} />
                        <span className="cat-label">{cat}</span>
                        <div className="cat-bar-wrap">
                          <div className="cat-bar" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                        <span className="cat-val">${amt.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── EMPLOYEES TAB ── */}
        {tab === 'employees' && (
          <div>

            {/* Packing worker */}
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Packing worker
            </div>
            <div className="emp-card">
              <div className="emp-head">
                <div className="emp-avatar" style={{ background: '#EAF5EF', color: 'var(--accent)' }}>HM</div>
                <div>
                  <div className="emp-name">Hasan Moussa</div>
                  <div className="emp-role-lbl">packing worker · daily rate + per bag</div>
                </div>
                <div className="emp-owed">
                  <div className="emp-owed-val" style={{ color: 'var(--accent2)' }}>${workerOwed.toFixed(2)}</div>
                  <div className="emp-owed-lbl">total owed</div>
                </div>
              </div>

              <div className="emp-body">
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 8 }}>
                  Days worked — May 2026
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent)', marginLeft: 8 }}>
                    {WORKER_WORKED_DAYS.size} days
                  </span>
                </div>
                <DaysGrid worked={WORKER_WORKED_DAYS} />

                {/* Earnings breakdown */}
                <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 14 }}>
                  <div className="earn-row">
                    <span className="earn-label">Daily rate × 18 days worked</span>
                    <span className="earn-val">$15.00 × 18 = <strong style={{ color: 'var(--text)' }}>${workerDailyEarn.toFixed(2)}</strong></span>
                  </div>
                  <div className="earn-row">
                    <span className="earn-label">Per-bag earnings (from sessions)</span>
                    <span className="earn-val green">+${workerBagEarn.toFixed(2)}</span>
                  </div>
                  <div className="earn-row">
                    <span className="earn-label">Total earned this month</span>
                    <span className="earn-val" style={{ color: 'var(--text)', fontSize: 14 }}>${workerTotalEarned.toFixed(2)}</span>
                  </div>
                  <div className="earn-row">
                    <span className="earn-label">Paid this month</span>
                    <span className="earn-val green">−${workerPaid.toFixed(2)}</span>
                  </div>
                  <div className="earn-total">
                    <span>Owed now</span>
                    <span className="earn-total-mono">${workerOwed.toFixed(2)}</span>
                  </div>
                </div>

                {/* Per-bag breakdown */}
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Bags packed this month — per-bag earnings</div>
                <table className="data-table" style={{ marginBottom: 14 }}>
                  <thead>
                    <tr><th>Bag type</th><th>Qty packed</th><th>Rate</th><th>Earned</th></tr>
                  </thead>
                  <tbody>
                    {BAG_BREAKDOWN.map(r => (
                      <tr key={r.size}>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.size}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.bags.toLocaleString()}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)' }}>${r.rate.toFixed(3)}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent)' }}>${r.earn.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button className="pay-btn green" onClick={() => openPay('Hasan Moussa', workerOwed)}>
                  <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay Hasan Moussa — ${workerOwed.toFixed(2)} owed
                </button>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px 4px' }}>
                <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Payment history
                </div>
                <div className="pay-hist">
                  <div className="pay-hist-row">
                    <div className="pay-hist-info">
                      <strong style={{ fontWeight: 500, display: 'block' }}>Cash payment</strong>
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>10 May 2026 · by Khalil</span>
                    </div>
                    <div className="pay-hist-amount">${workerPaid.toFixed(2)}</div>
                  </div>
                  <div className="pay-hist-row">
                    <div className="pay-hist-info">
                      <strong style={{ fontWeight: 500, display: 'block' }}>Cash payment</strong>
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>1 May 2026 · by Khalil · April wages</span>
                    </div>
                    <div className="pay-hist-amount">$140.00</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Drivers */}
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Drivers
            </div>
            <div className="three-col">
              {drvLoading && [0, 1, 2].map(i => (
                <div key={`drv-sk-${i}`} className="emp-card">
                  <div className="emp-head">
                    <div className="emp-avatar" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 24, height: 24, borderRadius: 6 }} /></div>
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ width: 90, height: 13, marginBottom: 5 }} />
                      <div className="skeleton" style={{ width: 60, height: 11 }} />
                    </div>
                  </div>
                  <div className="emp-body">
                    <div className="skeleton" style={{ width: '100%', height: 60, marginBottom: 12 }} />
                    <div className="skeleton" style={{ width: '100%', height: 34 }} />
                  </div>
                </div>
              ))}

              {drvError && (
                <div className="emp-card" style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                  Failed to load driver expenses.
                  <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetchDrivers()}>Retry</button></div>
                </div>
              )}

              {!drvLoading && !drvError && driverGroups.length === 0 && (
                <div className="emp-card" style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                  No driver trips recorded.
                </div>
              )}

              {!drvLoading && !drvError && driverGroups.map((g, idx) => {
                const palette = DRIVER_AVATAR_PALETTE[idx % DRIVER_AVATAR_PALETTE.length]
                const owed = g.expensesTotal
                return (
                  <div key={g.driverId} className="emp-card">
                    <div className="emp-head">
                      <div className="emp-avatar" style={{ background: palette.avatarBg, color: palette.avatarColor }}>{g.label}</div>
                      <div>
                        <div className="emp-name">Driver {g.label}</div>
                        <div className="emp-role-lbl">driver · {g.trips.length} trips</div>
                      </div>
                      <div className="emp-owed">
                        <div className="emp-owed-val" style={{ color: 'var(--accent2)' }}>${owed.toFixed(0)}</div>
                        <div className="emp-owed-lbl">expenses</div>
                      </div>
                    </div>
                    <div className="emp-body">
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }}>
                        Trip days
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent)', marginLeft: 6 }}>{g.daysWorked} days</span>
                      </div>
                      <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', margin: '12px 0', fontSize: 12 }}>
                        <div className="earn-row">
                          <span className="earn-label">{g.trips.length} trips</span>
                          <span className="earn-val">${owed.toFixed(2)}</span>
                        </div>
                        <div className="earn-total">
                          <span>Trip expenses</span>
                          <span className="earn-total-mono">${owed.toFixed(2)}</span>
                        </div>
                      </div>
                      <button className="pay-btn" onClick={() => openPay(`Driver ${g.label}`, owed)}>
                        <i className="ti ti-cash" style={{ fontSize: 13 }} /> Pay — ${owed.toFixed(0)} expenses
                      </button>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {g.trips.length} trip{g.trips.length === 1 ? '' : 's'} this period
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        )}
      </div>

      {/* ── ADD EXPENSE MODAL ── */}
      {addModalType && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAddModalType(null)}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {addModalType === 'recurring' ? 'Add recurring expense' : 'Add one-time expense'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>May 2026</div>
              </div>
              <button className="close-btn" onClick={() => setAddModalType(null)}>✕</button>
            </div>
            <div className="modal-body">
              <label className="form-label">Description</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Electricity bill, Equipment repair…"
                autoFocus
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
              />

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div>
                  <label className="form-label">Amount ($)</label>
                  <input className="form-input" type="number" placeholder="0.00" style={{ margin: 0 }} value={newAmt} onChange={e => setNewAmt(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Date</label>
                  <input className="form-input" type="date" style={{ margin: 0 }} value={newDate} onChange={e => setNewDate(e.target.value)} />
                </div>
              </div>

              <div className="toggle-wrap">
                <div className={`toggle-switch${newIsRecurring ? ' on' : ''}`} onClick={() => setNewIsRecurring(r => !r)}>
                  <div className="toggle-knob" />
                </div>
                <span className="toggle-label">Recurring — repeats every month automatically</span>
              </div>

              <label className="form-label">Notes (optional)</label>
              <input
                className="form-input"
                type="text"
                placeholder="Any notes…"
                style={{ marginBottom: 0 }}
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAddModalType(null)}>Cancel</button>
              <button className="btn primary" onClick={saveExpense}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> Add expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PAY EMPLOYEE MODAL ── */}
      {payTarget && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayTarget(null)}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">Pay {payTarget.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  Total owed: ${payOwed.toFixed(2)}
                </div>
              </div>
              <button className="close-btn" onClick={() => setPayTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div>
                  <label className="form-label">Payment date</label>
                  <input className="form-input" type="date" style={{ margin: 0 }} value={payDate} onChange={e => setPayDate(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Paid by</label>
                  <select className="form-input" style={{ margin: 0 }}>
                    <option>Khalil (owner)</option>
                    <option>Accountant</option>
                  </select>
                </div>
              </div>

              <label className="form-label">Amount paid</label>
              <div className="pay-input-wrap">
                <span className="pay-curr">$</span>
                <input
                  className="pay-big-input"
                  type="number"
                  placeholder="0.00"
                  value={payAmt}
                  onChange={e => setPayAmt(e.target.value)}
                />
              </div>

              <div className={payBarCls}>
                <span>{payBarLbl}</span>
                <span className="diff-mono">{payBarVal}</span>
              </div>

              <label className="form-label">Payment method</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {(['Cash', 'Whish', 'OMT'] as const).map(m => (
                  <div
                    key={m}
                    onClick={() => setPayMethod(m)}
                    style={{
                      flex: 1, padding: '8px', border: '1px solid', textAlign: 'center', cursor: 'pointer',
                      fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius)', transition: 'all 0.1s',
                      background: payMethod === m ? 'var(--text)' : 'transparent',
                      color:      payMethod === m ? '#fff' : 'var(--text2)',
                      borderColor: payMethod === m ? 'var(--text)' : 'var(--border)',
                    }}
                  >
                    {m}
                  </div>
                ))}
              </div>

              <label className="form-label">Notes (optional)</label>
              <input className="form-input" type="text" placeholder="e.g. May wages partial" style={{ marginBottom: 0 }} />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPayTarget(null)}>Cancel</button>
              <button className="btn green" onClick={() => setPayTarget(null)}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> Confirm payment
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
