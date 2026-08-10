import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useAllExpenses, useDriverExpenses, useGeneralExpenses, useCreateGeneralExpense, useAllWorkerPayments } from '../hooks/useExpenses'
import { useAllCashHandoverExpenses } from '../hooks/useCashHandover'
import { useWorkers } from '../hooks/useWorkers'
import type { DriverTrip } from '../types/api'

type ETab = 'expenses' | 'employees'

const DRIVER_AVATAR_PALETTE = [
  { avatarBg: 'var(--blue-bg,#EFF6FF)', avatarColor: 'var(--blue)' },
  { avatarBg: 'var(--accent2-bg)', avatarColor: 'var(--accent2)' },
  { avatarBg: '#F3F4F6', avatarColor: '#374151' },
]

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

const CATEGORY_COLORS: Record<string, string> = {
  Rent:       'var(--blue)',
  Utilities:  'var(--accent2)',
  Services:   'var(--accent)',
  Equipment:  'var(--red)',
  Supplies:   '#6d28d9',
  Transport:  '#0891b2',
}

/** Formats a local calendar date as YYYY-MM-DD without going through UTC (avoids the
 * toISOString() off-by-one when the local timezone is ahead of UTC). */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export default function Expenses() {
  const [tab, setTab] = useState<ETab>('expenses')

  // Selected month for the expenses filter — the 1st of the month, local time.
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const monthYear = selectedMonth.getFullYear()
  const monthIdx  = selectedMonth.getMonth()
  const monthDateFrom = ymd(monthYear, monthIdx, 1)
  const monthDateTo   = ymd(monthYear, monthIdx, new Date(monthYear, monthIdx + 1, 0).getDate())
  const monthLabel = selectedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const monthShort = selectedMonth.toLocaleDateString('en-GB', { month: 'short' })

  function goToPrevMonth() {
    setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function goToNextMonth() {
    setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  // Live general expenses (recurring + one-time) — recurring rows are included
  // by the backend from their recorded date forward (never before); one-time
  // rows are filtered to the exact selected month. ("Option B" recurrence.)
  const {
    data: generalExpenses,
    isLoading: genLoading,
    isError: genError,
    refetch: refetchGeneral,
  } = useGeneralExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  const createExpense = useCreateGeneralExpense()

  // Live container expenses
  const {
    data: containerExpenses,
    isLoading: contLoading,
    isError: contError,
    refetch: refetchContainers,
  } = useAllExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  // Live driver trips
  const {
    data: driverTripsResp,
    isLoading: drvLoading,
    isError: drvError,
    refetch: refetchDrivers,
  } = useDriverExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  // Worker data — ALL workers, not just the first (previously only workersData?.[0] was shown)
  const { data: workersData, isLoading: workersLoading } = useWorkers()

  // Aggregated employee payments (all workers, flattened) and cash-handover expenses
  // (all handovers, flattened) — same WorkerPayment / CashHandoverExpense source-of-truth
  // records, just fanned out for display; no new records are created for this view.
  const { data: allWorkerPayments } = useAllWorkerPayments()
  const { data: allHandoverExpenses } = useAllCashHandoverExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })
  const monthWorkerPayments = (allWorkerPayments ?? []).filter(p => (p.date ?? '').slice(0, 10) >= monthDateFrom && (p.date ?? '').slice(0, 10) <= monthDateTo)

  const driverGroups = groupDriverTrips(driverTripsResp?.data ?? [])

  // Derived splits
  const recurring = (generalExpenses ?? []).filter(e => e.isRecurring)
  const onetime   = (generalExpenses ?? []).filter(e => !e.isRecurring)

  // Add expense modal
  const [addModalType, setAddModalType] = useState<'recurring' | 'onetime' | null>(null)
  const [newDesc, setNewDesc] = useState('')
  const [newAmt, setNewAmt] = useState('')
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10))
  const [newIsRecurring, setNewIsRecurring] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [newNotes, setNewNotes] = useState('')

  // Pay modal
  const [payTarget, setPayTarget] = useState<{ name: string; owed: number } | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState<'Cash' | 'Whish' | 'OMT'>('Cash')

  // Derived totals
  // "General expenses" — GeneralExpense table only (recurring + one-time).
  const totalRecurring = recurring.reduce((s, e) => s + parseFloat(e.amount), 0)
  const totalOnetime   = onetime.reduce((s, e) => s + parseFloat(e.amount), 0)
  const totalExpenses  = totalRecurring + totalOnetime

  // "Employee wages owed" — a live outstanding-balance figure (earned minus paid,
  // all-time; WorkerPayment already netted out here, never re-added as a second
  // expense), NOT a period figure. Driver figures here are that month's trip
  // expenses, not earnings — drivers have no accrual/earnings model like workers.
  const totalWorkersOwed = (workersData ?? []).reduce((s, w) => s + parseFloat(w.totalOwed ?? '0'), 0)
  const totalDriverExpenses = driverGroups.reduce((s, g) => s + g.expensesTotal, 0)
  const totalWagesOwed = totalWorkersOwed + totalDriverExpenses

  // Cash actually paid out THIS MONTH, per category (each a settlement/spend record,
  // not an accrual) — feeds "Total outgoing" below.
  const totalContainerExpensesThisMonth = (containerExpenses ?? []).reduce((s, e) => s + parseFloat(e.amount), 0)
  const totalWorkerPaymentsThisMonth = monthWorkerPayments.reduce((s, p) => s + parseFloat(p.amount), 0)
  const totalHandoverExpensesThisMonth = (allHandoverExpenses ?? []).reduce((s, e) => s + parseFloat(e.amount), 0)

  // "Total outgoing" = actual cash outflow this month (cash-basis): general expenses +
  // employee payments + container expenses + cash-handover expenses. Deliberately
  // excludes "Employee wages owed" (an accrued, all-time balance, not a period cash
  // figure) — approved definition, see the Expenses-KPI audit.
  const totalOutgoing = totalExpenses
    + totalContainerExpensesThisMonth
    + totalWorkerPaymentsThisMonth
    + totalHandoverExpensesThisMonth

  // By-category summary (recurring + one-time general expenses only)
  const allGenExp = [...recurring, ...onetime]
  const categoryTotals: Record<string, number> = {}
  allGenExp.forEach(e => {
    const cat = e.category || 'Other'
    categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(e.amount)
  })
  const categoryRows = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])

  function openAdd(type: 'recurring' | 'onetime') {
    setAddModalType(type)
    setNewIsRecurring(type === 'recurring')
    setNewDesc(''); setNewAmt(''); setNewNotes(''); setNewCategory('')
    setNewDate(new Date().toISOString().slice(0, 10))
  }

  async function saveExpense() {
    if (!newDesc.trim() || !newAmt) return
    await createExpense.mutateAsync({
      description: newDesc.trim(),
      amount: parseFloat(newAmt).toFixed(2),
      isRecurring: newIsRecurring,
      category: newCategory.trim() || undefined,
      date: newDate,
      notes: newNotes.trim() || undefined,
    })
    setAddModalType(null)
  }

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

  return (
    <>
      <Topbar title="Expenses & Employees">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
          {monthLabel}
        </span>
        <button className="btn" onClick={goToPrevMonth} title="Previous month"><i className="ti ti-chevron-left" style={{ fontSize: 14 }} /></button>
        <button className="btn" onClick={goToNextMonth} title="Next month"><i className="ti ti-chevron-right" style={{ fontSize: 14 }} /></button>
      </Topbar>

      {/* Tabs */}
      <div className="tabs">
        <div className={`tab${tab === 'expenses' ? ' active' : ''}`} onClick={() => setTab('expenses')}>
          <i className="ti ti-receipt-2" style={{ fontSize: 14 }} /> Expenses
          <span className="tab-count">{(generalExpenses?.length ?? 0) + (containerExpenses?.length ?? 0)}</span>
        </div>
        <div className={`tab${tab === 'employees' ? ' active' : ''}`} onClick={() => setTab('employees')}>
          <i className="ti ti-users" style={{ fontSize: 14 }} /> Employees
          <span className="tab-count">{(workersData?.length ?? 0) + driverGroups.length}</span>
        </div>
      </div>

      <div className="content">

        {/* KPI row */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">General expenses ({monthShort})</div>
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
            <div className="kpi-sub">current outstanding · worker + {driverGroups.length} drivers</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Total outgoing ({monthShort})</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${totalOutgoing.toFixed(0)}</div>
            <div className="kpi-sub">cash paid out this month</div>
          </div>
        </div>

        {/* ── EXPENSES TAB ── */}
        {tab === 'expenses' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

            <div>

              {/* Recurring */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-repeat" /> Recurring — monthly</div>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => openAdd('recurring')}>
                    <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add
                  </button>
                </div>
                {genLoading && [0, 1, 2].map(i => (
                  <div key={`rec-sk-${i}`} className="exp-item">
                    <div className="exp-icon" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 18, height: 18, borderRadius: 4 }} /></div>
                    <div className="exp-info">
                      <div className="skeleton" style={{ width: '60%', height: 13, marginBottom: 4 }} />
                      <div className="skeleton" style={{ width: '40%', height: 11 }} />
                    </div>
                    <div className="exp-amount"><div className="skeleton" style={{ width: 60, height: 13 }} /></div>
                  </div>
                ))}
                {genError && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                    Failed to load expenses.
                    <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetchGeneral()}>Retry</button></div>
                  </div>
                )}
                {!genLoading && !genError && recurring.map(e => (
                  <div key={e.id} className="exp-item">
                    <div className="exp-icon" style={{ background: '#EFF6FF' }}>
                      <i className="ti ti-repeat" style={{ color: 'var(--blue)' }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">{e.description}</div>
                      <div className="exp-meta">{e.category ? `${e.category} · ` : ''}Monthly · recurring</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${parseFloat(e.amount).toLocaleString()}</div>
                      <div className="exp-amount-lbl">per month</div>
                    </div>
                    <button className="exp-del"><i className="ti ti-edit" style={{ fontSize: 12 }} /></button>
                  </div>
                ))}
                {!genLoading && !genError && recurring.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No recurring expenses.</div>
                )}
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text3)' }}>Total recurring</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalRecurring.toLocaleString()} / month</span>
                </div>
              </div>

              {/* One-time */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-plus-circle" /> One-time — {monthLabel}</div>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => openAdd('onetime')}>
                    <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add expense
                  </button>
                </div>
                {!genLoading && !genError && onetime.map(e => (
                  <div key={e.id} className="exp-item">
                    <div className="exp-icon" style={{ background: 'var(--surface2)' }}>
                      <i className="ti ti-receipt-2" style={{ color: 'var(--text2)' }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">{e.description}</div>
                      <div className="exp-meta">{e.date?.slice(0, 10)} · {e.notes || 'one-time'}</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${parseFloat(e.amount).toLocaleString()}</div>
                    </div>
                    <button className="exp-del"><i className="ti ti-x" style={{ fontSize: 12 }} /></button>
                  </div>
                ))}
                {!genLoading && !genError && onetime.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No one-time expenses this month.</div>
                )}
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
                      ${totalContainerExpensesThisMonth.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Employee payments (live, all workers) — WorkerPayment remains the source
                  of truth; this is a read-only aggregated view, no new records created. */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-users" /> Employee payments</div>
                </div>
                {monthWorkerPayments.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No employee payments this month.</div>
                )}
                {monthWorkerPayments.map(p => (
                  <div key={p.id} className="exp-item">
                    <div className="exp-icon" style={{ background: '#EAF5EF' }}>
                      <i className="ti ti-cash" style={{ color: 'var(--accent)' }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">Employee payment — {p.workerName}</div>
                      <div className="exp-meta">{p.date?.slice(0, 10)} · {p.method}{p.referenceNumber ? ` · ${p.referenceNumber}` : ''}</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${parseFloat(p.amount).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
                {monthWorkerPayments.length > 0 && (
                  <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text3)' }}>Total employee payments</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalWorkerPaymentsThisMonth.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Cash handover expenses (live) — CashHandoverExpense remains the source of
                  truth (created atomically with its CashHandover); this is a read-only
                  aggregated view, no new records created. */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-wallet" /> Cash handover expenses</div>
                </div>
                {(allHandoverExpenses ?? []).length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No cash-handover expenses this month.</div>
                )}
                {(allHandoverExpenses ?? []).map(e => (
                  <div key={e.id} className="exp-item">
                    <div className="exp-icon" style={{ background: 'var(--surface2)' }}>
                      <i className="ti ti-wallet" style={{ color: 'var(--text2)' }} />
                    </div>
                    <div className="exp-info">
                      <div className="exp-name">Cash handover expense — {e.description}</div>
                      <div className="exp-meta">{e.handoverDate?.slice(0, 10)} · {e.receiverName}</div>
                    </div>
                    <div className="exp-amount">
                      <div className="exp-amount-val">${parseFloat(e.amount).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
                {(allHandoverExpenses ?? []).length > 0 && (
                  <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text3)' }}>Total cash handover expenses</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalHandoverExpensesThisMonth.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: summary + by category */}
            <div style={{ position: 'sticky', top: 76 }}>

              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-chart-bar" /> {monthLabel} summary</div>
                </div>
                <div style={{ padding: '4px 0 0' }}>
                  {allGenExp.map(e => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 18px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text2)' }}>{e.description}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--red)' }}>${parseFloat(e.amount).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '14px 18px', background: 'var(--surface2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>General expenses</span>
                    <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--red)' }}>${totalExpenses.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>General expenses only — see Employee wages owed, payments, container and handover cards for the rest</div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-category" /> Spending by category</div>
                </div>
                <div style={{ padding: '6px 18px 12px' }}>
                  {categoryRows.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>No expenses yet.</div>
                  )}
                  {categoryRows.map(([cat, amt]) => {
                    const pct = totalExpenses > 0 ? Math.round((amt / totalExpenses) * 100) : 0
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

            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Packing workers
            </div>

            {workersLoading && (
              <div className="emp-card" style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                Loading worker data…
              </div>
            )}

            {!workersLoading && (workersData ?? []).map(worker => {
              const payments = (allWorkerPayments ?? []).filter(p => p.workerId === worker.id)
              const owed = parseFloat(worker.totalOwed ?? '0')
              return (
                <div className="emp-card" key={worker.id} style={{ marginBottom: 14 }}>
                  <div className="emp-head">
                    <div className="emp-avatar" style={{ background: '#EAF5EF', color: 'var(--accent)' }}>
                      {worker.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="emp-name">{worker.name}</div>
                      <div className="emp-role-lbl">packing worker · daily rate + per bag</div>
                    </div>
                    <div className="emp-owed">
                      <div className="emp-owed-val" style={{ color: 'var(--accent2)' }}>${owed.toFixed(2)}</div>
                      <div className="emp-owed-lbl">total owed</div>
                    </div>
                  </div>

                  <div className="emp-body">
                    <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 14 }}>
                      <div className="earn-row">
                        <span className="earn-label">Total earned this month</span>
                        <span className="earn-val" style={{ color: 'var(--text)', fontSize: 14 }}>${parseFloat(worker.totalEarned ?? '0').toFixed(2)}</span>
                      </div>
                      <div className="earn-row">
                        <span className="earn-label">Paid this month</span>
                        <span className="earn-val green">−${parseFloat(worker.totalPaid ?? '0').toFixed(2)}</span>
                      </div>
                      <div className="earn-total">
                        <span>Owed now</span>
                        <span className="earn-total-mono">${owed.toFixed(2)}</span>
                      </div>
                    </div>

                    <button className="pay-btn green" onClick={() => openPay(worker.name, owed)}>
                      <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay {worker.name} — ${owed.toFixed(2)} owed
                    </button>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px 4px' }}>
                    <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      Payment history
                    </div>
                    <div className="pay-hist">
                      {payments.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text3)', padding: '4px 0' }}>No payments recorded.</div>
                      )}
                      {payments.map(p => (
                        <div key={p.id} className="pay-hist-row">
                          <div className="pay-hist-info">
                            <strong style={{ fontWeight: 500, display: 'block' }}>{p.notes || 'Payment'}</strong>
                            <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>{p.date?.slice(0, 10)}</span>
                          </div>
                          <div className="pay-hist-amount">${parseFloat(p.amount).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}

            {!workersLoading && (workersData ?? []).length === 0 && (
              <div className="emp-card" style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                No workers found.
              </div>
            )}

            {/* Drivers */}
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 10px' }}>
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
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{monthLabel}</div>
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

              <label className="form-label">Category (optional)</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Rent, Utilities, Equipment…"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
              />

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
              <button className="btn primary" onClick={saveExpense} disabled={createExpense.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} />
                {createExpense.isPending ? 'Saving…' : 'Add expense'}
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
