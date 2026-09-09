import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import {
  useWorkers,
  useCreateWorker,
  useLogWorkerPayment,
  useUpdateWorker,
  useDeleteWorker,
  useCreateWorkerEarning,
  useLogDailyWage,
  useWorkerStatement,
  useUpdateWorkerRates,
  useWorkerPerformance,
  useWorkerPaymentsInPeriod,
} from '../hooks/useWorkers'
import { useBagTypes } from '../hooks/useBagTypes'
import { useToast } from '../context/ToastContext'
import { toDateOnlyString, formatDate, formatDateTime } from '../lib/date'
import { formatUsd } from '../lib/money'
import { CATEGORY_LABEL, CATEGORY_OPTIONS, METHOD_LABEL, PAYMENT_METHODS } from '../lib/workerLabels'
import type { Worker, WorkerCostCategory, PaymentMethod, WorkerStatementEntry, WorkerRate } from '../types/api'

type View = 'list' | 'worker'
// Statement of Account presentation (month-based audit, 2026-09-06): the
// PRIMARY view is always a single calendar month, navigated with ← / →
// (same convention as Expenses.tsx's month selector) — never "All time" by
// default. "All time" remains available as a de-emphasized, explicit opt-in
// (there was never a "Custom range" input in this page to preserve — only
// the old 'All time'/'This month'/'Last month' <select>, now replaced).
type StatementMode = 'month' | 'all-time'
// Employee Profile + Performance Analytics (2026-09-07) — the Performance
// section (bag-type breakdown, daily performance, packing history, daily
// wages, period payments) has its OWN month selector, independent of the
// Statement of Account's — same month/all-time convention, applied
// separately, so viewing September's performance doesn't force the
// Statement to September too (and vice versa).
type PerfMode = 'month' | 'all-time'

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

/** Statement description — built from the SAME authoritative fields the
 *  entry carries, using the SAME label maps this page already defines.
 *  Never invents text the underlying record doesn't support. */
function describeStatementEntry(e: WorkerStatementEntry): string {
  if (e.source === 'cost') {
    const label = CATEGORY_LABEL[e.category as WorkerCostCategory] ?? 'Earning'
    return e.notes ? `${label} — ${e.notes}` : label
  }
  if (e.source === 'session') return 'Packing session'
  // payment
  const method = e.method ? METHOD_LABEL[e.method] : 'Payment'
  return e.referenceNumber ? `Payment · ${method} · ${e.referenceNumber}` : `Payment · ${method}`
}

export default function Employees() {
  const [view, setView] = useState<View>('list')
  const { showToast } = useToast()

  const workersQ      = useWorkers()
  const createWorker   = useCreateWorker()
  const updateWorker   = useUpdateWorker()
  const deleteWorker   = useDeleteWorker()
  const logPayment     = useLogWorkerPayment()
  const createEarning  = useCreateWorkerEarning()
  const updateRates    = useUpdateWorkerRates()
  const bagTypesQ      = useBagTypes()

  const workers = workersQ.data ?? []

  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [addEmpOpen, setAddEmpOpen]     = useState(false)
  const [editEmpOpen, setEditEmpOpen]   = useState(false)
  const [editName, setEditName]         = useState('')
  const [editPhone, setEditPhone]       = useState('')
  const [editNotes, setEditNotes]       = useState('')
  const [editRates, setEditRates]       = useState<Record<string, string>>({})
  const [empName, setEmpName]           = useState('')
  const [empPhone, setEmpPhone]         = useState('')

  const [payModalOpen, setPayModalOpen]   = useState(false)
  const [payAmt, setPayAmt]               = useState('')
  const [payMethod, setPayMethod]         = useState<PaymentMethod>('cash')
  const [payReference, setPayReference]   = useState('')

  const [earnModalOpen, setEarnModalOpen] = useState(false)
  const [earnAmt, setEarnAmt]             = useState('')
  const [earnCategory, setEarnCategory]   = useState<WorkerCostCategory>('daily_wage')
  const [earnDate, setEarnDate]           = useState(() => toDateOnlyString(new Date()))
  const [earnNotes, setEarnNotes]         = useState('')

  const logDailyWage = useLogDailyWage()

  // Statement of Account presentation — defaults to the CURRENT calendar
  // month (business requirement, 2026-09-06). "All time" is an explicit,
  // de-emphasized opt-in only — never the default/primary view.
  const [statementMode, setStatementMode] = useState<StatementMode>('month')
  const [statementMonth, setStatementMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const statementMonthYear  = statementMonth.getFullYear()
  const statementMonthIdx   = statementMonth.getMonth()
  const statementMonthLabel = statementMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  function goToPrevStatementMonth() {
    setStatementMode('month')
    setStatementMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function goToNextStatementMonth() {
    setStatementMode('month')
    setStatementMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  const { dateFrom, dateTo } = statementMode === 'all-time'
    ? { dateFrom: undefined, dateTo: undefined }
    : {
        dateFrom: toDateOnlyString(new Date(statementMonthYear, statementMonthIdx, 1)),
        dateTo:   toDateOnlyString(new Date(statementMonthYear, statementMonthIdx + 1, 0)),
      }

  // Statement of Account — chronological earning/payment ledger with a
  // running balance, correctly opening-balance-adjusted for a partial period
  // (see WorkersService.getStatement()'s doc comment). Replaces the old
  // three-source merged "History" feed entirely.
  const statementQ = useWorkerStatement(selectedWorker?.id, { dateFrom, dateTo })
  const statementEntries = statementQ.data?.entries ?? []
  const statementOpening = parseFloat(statementQ.data?.openingBalance ?? '0')
  const statementClosing = parseFloat(statementQ.data?.balance ?? String(statementOpening))
  const statementEarnedTotal = statementEntries.reduce((s, e) => s + parseFloat(e.earned), 0)
  const statementPaidTotal   = statementEntries.reduce((s, e) => s + parseFloat(e.paid), 0)

  // Performance Analytics period — defaults to the CURRENT calendar month,
  // same ←/→ convention as the Statement above, but tracked independently
  // (see the PerfMode doc comment).
  const [perfMode, setPerfMode] = useState<PerfMode>('month')
  const [perfMonth, setPerfMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const perfMonthYear  = perfMonth.getFullYear()
  const perfMonthIdx   = perfMonth.getMonth()
  const perfMonthLabel = perfMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  function goToPrevPerfMonth() {
    setPerfMode('month')
    setPerfMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function goToNextPerfMonth() {
    setPerfMode('month')
    setPerfMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }
  const { dateFrom: perfDateFrom, dateTo: perfDateTo } = perfMode === 'all-time'
    ? { dateFrom: undefined, dateTo: undefined }
    : {
        dateFrom: toDateOnlyString(new Date(perfMonthYear, perfMonthIdx, 1)),
        dateTo:   toDateOnlyString(new Date(perfMonthYear, perfMonthIdx + 1, 0)),
      }

  // Performance analytics — server-side aggregated (bags/rate/earnings from
  // PackingSession.bagsOutput's per-line snapshot; see
  // WorkersService.getPerformance()'s doc comment). A bounded month also
  // returns row-level dailyPerformance/packingHistory/dailyWages; "all time"
  // returns only the safe aggregates (totals/byBagType) — never years of raw
  // rows shipped to the browser.
  const performanceQ = useWorkerPerformance(selectedWorker?.id, { dateFrom: perfDateFrom, dateTo: perfDateTo })
  const perf = performanceQ.data
  const paymentsInPeriodQ = useWorkerPaymentsInPeriod(selectedWorker?.id, { dateFrom: perfDateFrom, dateTo: perfDateTo })
  const paymentsInPeriod = paymentsInPeriodQ.data?.data ?? []

  const WORKER_OWED   = selectedWorker ? parseFloat(selectedWorker.totalOwed)   : 0
  const workerEarned  = selectedWorker ? parseFloat(selectedWorker.totalEarned) : 0
  const workerPaid    = selectedWorker ? parseFloat(selectedWorker.totalPaid)   : 0

  const payAmtNum = parseFloat(payAmt) || 0
  const diffVal   = payAmtNum - WORKER_OWED
  const diffPct   = WORKER_OWED > 0 ? Math.min(100, (payAmtNum / WORKER_OWED) * 100) : 0
  const barClass  = payAmtNum === 0 ? 'none' : payAmtNum >= WORKER_OWED ? 'ok' : 'short'

  function openWorker(w: Worker) {
    setSelectedWorker(w)
    setStatementMode('month')
    setStatementMonth(() => {
      const d = new Date()
      return new Date(d.getFullYear(), d.getMonth(), 1)
    })
    setPerfMode('month')
    setPerfMonth(() => {
      const d = new Date()
      return new Date(d.getFullYear(), d.getMonth(), 1)
    })
    setView('worker')
  }

  function refetchSelectedWorker() {
    return workersQ.refetch().then(result => {
      const updated = (result.data ?? []).find(w => w.id === selectedWorker?.id)
      if (updated) setSelectedWorker(updated)
    })
  }

  function submitNewWorker() {
    if (!empName.trim()) return
    createWorker.mutate(
      { name: empName.trim(), phone: empPhone || null },
      { onSuccess: () => { setAddEmpOpen(false); setEmpName(''); setEmpPhone('') } },
    )
  }

  /**
   * Edit Employee audit (2026-09-05): editable fields are every legitimate
   * profile/configuration field the existing model actually supports — name,
   * phone, notes (Worker.notes — existing field, previously not exposed in
   * this form), and per-bag packing rates (Worker.ratesPerBagType, via the
   * existing PATCH /workers/:id/rates endpoint — previously wired up in
   * useWorkers.ts but never surfaced in ANY page). Deliberately excludes
   * daily wage (a GLOBAL Settings figure, not per-employee — see Settings.tsx's
   * "Employee wages" section) and never touches WorkerCost/WorkerPayment
   * history — this is profile editing only.
   */
  function openEditModal(w: Worker) {
    setEditName(w.name)
    setEditPhone(w.phone ?? '')
    setEditNotes(w.notes ?? '')
    const rateByBagType = new Map(w.ratesPerBagType.map(r => [r.bagTypeId, r.ratePerBag]))
    const initial: Record<string, string> = {}
    for (const bt of bagTypesQ.data ?? []) {
      initial[bt.id] = rateByBagType.get(bt.id) ?? ''
    }
    setEditRates(initial)
    setEditEmpOpen(true)
  }

  async function saveEditEmployee() {
    if (!selectedWorker || !editName.trim()) return
    try {
      await updateWorker.mutateAsync({
        id: selectedWorker.id,
        body: { name: editName.trim(), phone: editPhone.trim() || null, notes: editNotes.trim() || null },
      })
      // Full replacement, not a merge (SetRatesDto/setRates()) — send every
      // bag type's rate, including ones left blank (defaults to '0'), so an
      // existing rate is never silently dropped by omission.
      const ratesPerBagType = (bagTypesQ.data ?? []).map(bt => ({
        bagTypeId: bt.id,
        ratePerBag: parseFloat(editRates[bt.id] || '0').toFixed(4),
      }))
      if (ratesPerBagType.length > 0) {
        await updateRates.mutateAsync({ id: selectedWorker.id, body: { ratesPerBagType } })
      }
      await refetchSelectedWorker()
      setEditEmpOpen(false)
      showToast('Employee updated')
    } catch (err: any) {
      showToast(err?.error ?? 'Failed to update employee')
    }
  }

  function submitWorkerPayment() {
    if (!selectedWorker || payAmtNum <= 0) return
    logPayment.mutate(
      {
        id: selectedWorker.id,
        body: {
          amount: payAmtNum.toFixed(2),
          method: payMethod,
          referenceNumber: payReference || null,
          date: toDateOnlyString(new Date()),
        },
      },
      {
        onSuccess: async () => {
          setPayModalOpen(false)
          setPayAmt(''); setPayMethod('cash'); setPayReference('')
          await refetchSelectedWorker()
        },
      },
    )
  }

  function submitEarning() {
    if (!selectedWorker) return
    const amt = parseFloat(earnAmt) || 0
    if (amt <= 0) return
    createEarning.mutate(
      {
        id: selectedWorker.id,
        body: { amount: amt.toFixed(2), category: earnCategory, date: earnDate, notes: earnNotes || null },
      },
      {
        onSuccess: async () => {
          setEarnModalOpen(false)
          setEarnAmt(''); setEarnCategory('daily_wage'); setEarnDate(toDateOnlyString(new Date())); setEarnNotes('')
          await refetchSelectedWorker()
        },
      },
    )
  }

  // "Add daily wage" — records TODAY using the Settings-configured amount;
  // the amount itself is never entered here (see WorkersService.logDailyWage()).
  // `date` is this browser's own local "today" (toDateOnlyString(new Date())),
  // the same convention "Add earnings"/"Pay worker" above already use.
  function submitDailyWage() {
    if (!selectedWorker) return
    logDailyWage.mutate(
      { id: selectedWorker.id, body: { date: toDateOnlyString(new Date()) } },
      {
        onSuccess: async () => {
          showToast('Daily wage recorded')
          await refetchSelectedWorker()
        },
        onError: (err: any) => showToast(err?.error ?? 'Failed to record daily wage'),
      },
    )
  }

  // ── LIST VIEW ────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <>
        <Topbar title="Employees">
          <button className="btn primary" onClick={() => setAddEmpOpen(true)}>
            <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add employee
          </button>
        </Topbar>
        <div className="content">
          {workersQ.isLoading && [0, 1, 2].map(i => (
            <div className="emp-list-card" key={i}>
              <div className="emp-big-avatar" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} /></div>
              <div style={{ flex: 1 }}><div className="skeleton" style={{ width: '40%', height: 14, marginBottom: 6 }} /><div className="skeleton" style={{ width: '60%', height: 12 }} /></div>
            </div>
          ))}
          {workersQ.isError && (
            <div className="empty">Failed to load employees.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => workersQ.refetch()}>Retry</button></div></div>
          )}
          {!workersQ.isLoading && !workersQ.isError && workers.map(w => {
            const owed = parseFloat(w.totalOwed)
            return (
              <div key={w.id} className="emp-list-card" style={{ cursor: 'pointer' }} onClick={() => openWorker(w)}>
                <div className="emp-big-avatar" style={{ background: 'var(--accent)', color: '#fff' }}>{initials(w.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{w.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Warehouse worker</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: owed > 0 ? 'var(--red)' : 'var(--accent)', fontSize: 15 }}>${owed.toFixed(2)} owed</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>earned ${parseFloat(w.totalEarned).toFixed(2)}</div>
                </div>
                <button
                  className="btn"
                  style={{ marginLeft: 8, padding: '5px 8px', background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5', flexShrink: 0 }}
                  onClick={e => {
                    e.stopPropagation()
                    if (confirm(`Remove ${w.name} permanently?`)) {
                      deleteWorker.mutate(w.id, {
                        onError: (err: any) => showToast(err?.error ?? 'Failed to remove worker'),
                      })
                    }
                  }}
                >
                  <i className="ti ti-trash" style={{ fontSize: 13 }} />
                </button>
                <i className="ti ti-chevron-right" style={{ color: 'var(--text3)', marginLeft: 4 }} />
              </div>
            )
          })}
          {!workersQ.isLoading && !workersQ.isError && workers.length === 0 && (
            <div className="empty">No employees yet. Use "Add employee" to create one.</div>
          )}
        </div>

        {addEmpOpen && (
          <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAddEmpOpen(false)}>
            <div className="modal" style={{ width: 460 }}>
              <div className="modal-head">
                <div className="modal-title">Add employee</div>
                <button className="panel-close-btn" aria-label="Close" onClick={() => setAddEmpOpen(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full name</label>
                  <input className="form-input" type="text" placeholder="e.g. Ali Karimi" value={empName} onChange={e => setEmpName(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Phone</label>
                  <input className="form-input" type="tel" placeholder="+961 3 000 000" value={empPhone} onChange={e => setEmpPhone(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setAddEmpOpen(false)}>Cancel</button>
                <button className="btn primary" onClick={submitNewWorker} disabled={createWorker.isPending}>
                  <i className="ti ti-check" style={{ fontSize: 14 }} /> {createWorker.isPending ? 'Adding…' : 'Add employee'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── WORKER DETAIL VIEW ───────────────────────────────────────────────
  return (
    <>
      <Topbar title="Employees" back={{ label: 'Back to employees', to: () => setView('list') }}>
        <button className="btn" onClick={() => setEarnModalOpen(true)}>
          <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add earnings
        </button>
        <button className="btn" onClick={submitDailyWage} disabled={logDailyWage.isPending}>
          <i className="ti ti-sun" style={{ fontSize: 14 }} /> {logDailyWage.isPending ? 'Recording…' : 'Daily wage'}
        </button>
        <button className="btn primary" onClick={() => setPayModalOpen(true)}>
          <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay worker
        </button>
      </Topbar>
      <div className="content">

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div className="emp-big-avatar" style={{ background: 'var(--accent)', color: '#fff', width: 56, height: 56, fontSize: 20 }}>{initials(selectedWorker?.name ?? '')}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{selectedWorker?.name ?? '—'}</div>
            {selectedWorker?.phone && <div style={{ fontSize: 13, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{selectedWorker.phone}</div>}
          </div>
          <button className="btn" onClick={() => selectedWorker && openEditModal(selectedWorker)}>
            <i className="ti ti-edit" style={{ fontSize: 14 }} /> Edit
          </button>
          <button
            className="btn"
            style={{ background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' }}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <i className="ti ti-trash" style={{ fontSize: 14 }} /> Remove
          </button>
        </div>

        {/* Summary strip */}
        <div className="earn-breakdown" style={{ marginBottom: 20 }}>
          <div className="eb-row" style={{ fontWeight: 700, fontSize: 16, color: WORKER_OWED > 0 ? 'var(--red)' : 'var(--accent)' }}>
            <span>Outstanding balance</span><span>${WORKER_OWED.toFixed(2)}</span>
          </div>
          <div className="eb-row"><span>Total earned</span><span>${workerEarned.toFixed(2)}</span></div>
          <div className="eb-row" style={{ borderBottom: 'none' }}><span>Total paid</span><span>-${workerPaid.toFixed(2)}</span></div>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEarnModalOpen(true)}>
            <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add earnings
          </button>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={submitDailyWage} disabled={logDailyWage.isPending}>
            <i className="ti ti-sun" style={{ fontSize: 14 }} /> {logDailyWage.isPending ? 'Recording…' : 'Daily wage'}
          </button>
          <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPayModalOpen(true)}>
            <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay ${WORKER_OWED.toFixed(2)}
          </button>
        </div>

        {/* ══════════ PERFORMANCE ANALYTICS ══════════
            Employee Profile audit, 2026-09-07 — bags packed, bag-type
            breakdown, working days, daily performance, packing history, and
            daily wages, all sourced from PackingSession.bagsOutput's
            per-line snapshotted rate (never the current BagType/Worker rate
            config — see WorkersService.getPerformance()'s doc comment).
            Month-based by default, own period selector (independent of the
            Statement's below). */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Performance</div>

        <div className="filter-row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={goToPrevPerfMonth} title="Previous performance month">
              <i className="ti ti-chevron-left" style={{ fontSize: 14 }} />
            </button>
            <div style={{ fontWeight: 600, fontSize: 14, minWidth: 140, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
              {perfMode === 'all-time' ? 'All time' : perfMonthLabel}
            </div>
            <button className="btn" onClick={goToNextPerfMonth} title="Next performance month">
              <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
            </button>
          </div>
          <button
            className="btn"
            style={{ fontSize: 12, color: 'var(--text3)' }}
            onClick={() => setPerfMode(m => m === 'all-time' ? 'month' : 'all-time')}
          >
            {perfMode === 'all-time' ? <><i className="ti ti-calendar" style={{ fontSize: 13 }} /> Return to monthly performance</> : <><i className="ti ti-infinity" style={{ fontSize: 13 }} /> View all-time performance</>}
          </button>
        </div>

        {performanceQ.isLoading && <div className="card" style={{ marginBottom: 16 }}><div className="empty">Loading performance…</div></div>}
        {performanceQ.isError && <div className="card" style={{ marginBottom: 16 }}><div className="empty">Failed to load performance data. Please try again.</div></div>}

        {perf && (
          <>
            {/* Performance Summary */}
            <div className="stmt-summary" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="stmt-cell"><div className="l">Total bags packed</div><div className="v">{perf.totals.bagsPacked.toLocaleString()}</div></div>
              <div className="stmt-cell"><div className="l">Days worked</div><div className="v">{perf.totals.workingDays}</div></div>
              <div className="stmt-cell"><div className="l">Packing sessions</div><div className="v">{perf.totals.sessions}</div></div>
              <div className="stmt-cell"><div className="l">Avg bags / working day</div><div className="v">{perf.totals.avgBagsPerWorkingDay ?? '—'}</div></div>
              <div className="stmt-cell"><div className="l">Total packing earnings</div><div className="v green">{formatUsd(parseFloat(perf.totals.packingEarnings))}</div></div>
              <div className="stmt-cell"><div className="l">Avg earnings / working day</div><div className="v">{perf.totals.avgEarningsPerWorkingDay != null ? formatUsd(parseFloat(perf.totals.avgEarningsPerWorkingDay)) : '—'}</div></div>
            </div>

            {/* Performance by Bag Type */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-package" /> Performance by bag type</div>
              </div>
              {perf.byBagType.length === 0 ? (
                <div className="empty">No bags packed {perfMode === 'all-time' ? 'yet' : `in ${perfMonthLabel}`}</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Bag type</th>
                        <th className="right">Bags</th>
                        <th className="right">Rate/bag</th>
                        <th className="right">Earned</th>
                        <th className="right">Avg/day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perf.byBagType.map(bt => (
                        <tr key={bt.bagTypeId}>
                          <td style={{ fontWeight: 500 }}>{bt.bagTypeName}</td>
                          <td className="right num">{bt.bags.toLocaleString()}</td>
                          <td className="right num">
                            {formatUsd(parseFloat(bt.ratePerBag))}
                            {bt.rateVaries && <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }} title="Rate changed during this period — effective average shown">avg</span>}
                          </td>
                          <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(parseFloat(bt.earned))}</td>
                          <td className="right num">{bt.avgBagsPerWorkingDay ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Daily Performance */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-chart-bar" /> Daily performance</div>
              </div>
              {perf.dailyPerformance === null ? (
                <div className="empty">Switch to a specific month to see day-by-day detail</div>
              ) : perf.dailyPerformance.length === 0 ? (
                <div className="empty">No packing activity in {perfMonthLabel}</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th>Date</th><th className="right">Bags</th><th className="right">Sessions</th><th className="right">Earned</th></tr>
                    </thead>
                    <tbody>
                      {perf.dailyPerformance.map(d => (
                        <tr key={d.date}>
                          <td className="mono">{formatDate(d.date, { day: '2-digit' })}</td>
                          <td className="right num">{d.bagsPacked.toLocaleString()}</td>
                          <td className="right num">{d.sessions}</td>
                          <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(parseFloat(d.earned))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Packing History */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-list-details" /> Packing history</div>
              </div>
              {perf.packingHistory === null ? (
                <div className="empty">Switch to a specific month to see packing history</div>
              ) : perf.packingHistory.length === 0 ? (
                <div className="empty">No packing sessions in {perfMonthLabel}</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th>Date</th><th>Bag type</th><th className="right">Quantity</th><th className="right">Rate</th><th className="right">Earned</th></tr>
                    </thead>
                    <tbody>
                      {perf.packingHistory.map((row, i) => (
                        <tr key={`${row.sessionId}-${row.bagTypeId}-${i}`}>
                          <td className="mono">{formatDate(row.date, { day: '2-digit' })}</td>
                          <td>{row.bagTypeName}</td>
                          <td className="right num">{row.quantity.toLocaleString()}</td>
                          <td className="right num">{formatUsd(parseFloat(row.ratePerBag))}</td>
                          <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(parseFloat(row.earned))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Daily Wages — authoritative WorkerCost(daily_wage) rows only; never inferred from working days. */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-sun" /> Daily wages</div>
              </div>
              {perf.dailyWages === null ? (
                <div className="empty">Switch to a specific month to see daily wage history</div>
              ) : perf.dailyWages.length === 0 ? (
                <div className="empty">No daily wages recorded in {perfMonthLabel}</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Description</th><th className="right">Amount</th></tr></thead>
                    <tbody>
                      {perf.dailyWages.map(w => (
                        <tr key={w.id}>
                          <td className="mono">{formatDate(w.date, { day: '2-digit' })}</td>
                          <td>Daily wage</td>
                          <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(parseFloat(w.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Payments — authoritative WorkerPayment rows for the selected period. */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-cash" /> Payments</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  Total paid {perfMode === 'all-time' ? '(all time)' : perfMonthLabel}: <strong style={{ color: 'var(--text)' }}>{formatUsd(parseFloat(perf.paymentsTotal))}</strong>
                </div>
              </div>
              {paymentsInPeriod.length === 0 ? (
                <div className="empty">No payments {perfMode === 'all-time' ? 'recorded yet' : `in ${perfMonthLabel}`}</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Method</th><th className="right">Amount</th></tr></thead>
                    <tbody>
                      {paymentsInPeriod.map(p => (
                        <tr key={p.id}>
                          <td className="mono">{formatDate(p.date, { day: '2-digit' })}</td>
                          <td>{METHOD_LABEL[p.method]}</td>
                          <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(parseFloat(p.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════ EMPLOYEE STATEMENT OF ACCOUNT ══════════
            Statement of Account — month-based by default (business
            requirement, 2026-09-06): opens on the CURRENT month, navigated
            with ← / → (same convention as Expenses.tsx). "All time" is a
            de-emphasized, explicit opt-in — never the default. */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Statement of account</div>

        <div className="filter-row" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={goToPrevStatementMonth} title="Previous month">
              <i className="ti ti-chevron-left" style={{ fontSize: 14 }} />
            </button>
            <div style={{ fontWeight: 600, fontSize: 14, minWidth: 140, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
              {statementMode === 'all-time' ? 'All time' : statementMonthLabel}
            </div>
            <button className="btn" onClick={goToNextStatementMonth} title="Next month">
              <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
            </button>
          </div>
          <button
            className="btn"
            style={{ fontSize: 12, color: 'var(--text3)' }}
            onClick={() => setStatementMode(m => m === 'all-time' ? 'month' : 'all-time')}
          >
            {statementMode === 'all-time' ? <><i className="ti ti-calendar" style={{ fontSize: 13 }} /> Return to monthly view</> : <><i className="ti ti-infinity" style={{ fontSize: 13 }} /> View all time</>}
          </button>
        </div>

        <div className="stmt-summary">
          <div className="stmt-cell"><div className="l">Opening balance</div><div className="v">{formatUsd(statementOpening)}</div></div>
          <div className="stmt-cell"><div className="l">Earned {statementMode === 'all-time' ? '(all time)' : 'this month'}</div><div className="v green">{formatUsd(statementEarnedTotal)}</div></div>
          <div className="stmt-cell"><div className="l">Paid {statementMode === 'all-time' ? '(all time)' : 'this month'}</div><div className="v amber">{formatUsd(statementPaidTotal)}</div></div>
          <div className="stmt-cell"><div className="l">Closing balance</div><div className={`v ${statementClosing > 0 ? 'amber' : statementClosing < 0 ? 'red' : 'green'}`}>{formatUsd(statementClosing)}</div></div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          {statementQ.isLoading && <div className="empty">Loading…</div>}
          {statementQ.isError && <div className="empty">Failed to load statement. Please try again.</div>}
          {!statementQ.isLoading && !statementQ.isError && (
            <table className="data-table stmt-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Earned</th>
                  <th style={{ textAlign: 'right' }}>Paid</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {statementMode !== 'all-time' && (
                  <tr className="opening">
                    <td className="mono"></td>
                    <td className="desc">Opening balance</td>
                    <td className="num"></td><td className="num"></td>
                    <td className="num">{formatUsd(statementOpening)}</td>
                  </tr>
                )}
                {statementEntries.map((e, i) => {
                  const earned = parseFloat(e.earned)
                  const paid = parseFloat(e.paid)
                  const balance = parseFloat(e.runningBalance)
                  return (
                    <tr key={`${e.source}-${e.reference}-${i}`}>
                      <td className="mono">{formatDateTime(e.date, { day: '2-digit' })}</td>
                      <td className="desc">{describeStatementEntry(e)}</td>
                      <td className="num dr">{earned ? formatUsd(earned) : ''}</td>
                      <td className="num cr">{paid ? formatUsd(paid) : ''}</td>
                      <td className={`num ${balance < 0 ? 'bal-neg' : 'bal-pos'}`} style={{ fontWeight: 600 }}>{formatUsd(balance)}</td>
                    </tr>
                  )
                })}
                {statementEntries.length === 0 && (
                  <tr><td colSpan={5} className="empty">No earnings or payments {statementMode !== 'all-time' ? `in ${statementMonthLabel}` : 'recorded yet'}</td></tr>
                )}
              </tbody>
              {statementEntries.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right' }}>Totals</td>
                    <td className="num dr">{formatUsd(statementEarnedTotal)}</td>
                    <td className="num cr">{formatUsd(statementPaidTotal)}</td>
                    <td className="num">{formatUsd(statementClosing)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* Confirm delete modal */}
      {confirmDeleteOpen && selectedWorker && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setConfirmDeleteOpen(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-head">
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)' }}>
                <i className="ti ti-alert-triangle" style={{ marginRight: 8 }} />Remove employee
              </div>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                Are you sure you want to permanently remove <strong>{selectedWorker.name}</strong>?
                Their earnings and payment history will also be deleted. This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDeleteOpen(false)}>Cancel</button>
              <button
                className="btn"
                style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}
                disabled={deleteWorker.isPending}
                onClick={() => {
                  deleteWorker.mutate(selectedWorker.id, {
                    onSuccess: () => {
                      setConfirmDeleteOpen(false)
                      setView('list')
                      setSelectedWorker(null)
                    },
                    onError: (err: any) => showToast(err?.error ?? 'Failed to remove worker'),
                  })
                }}
              >
                <i className="ti ti-trash" style={{ fontSize: 14 }} />
                {deleteWorker.isPending ? 'Removing…' : 'Remove permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit employee modal — every legitimate profile/configuration field
          the model supports (name, phone, notes, per-bag rates). Never
          touches WorkerCost/WorkerPayment history — see openEditModal()'s
          doc comment. */}
      {editEmpOpen && selectedWorker && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditEmpOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div className="modal-title">Edit — {selectedWorker.name}</div>
              <button className="panel-close-btn" aria-label="Close" onClick={() => setEditEmpOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input
                  className="form-input"
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Worker name"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  className="form-input"
                  type="tel"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  placeholder="+961 3 000 000"
                />
              </div>
              <div className="form-group" style={{ marginBottom: (bagTypesQ.data ?? []).length > 0 ? 14 : 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input
                  className="form-input"
                  type="text"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Any notes about this employee"
                />
              </div>
              {(bagTypesQ.data ?? []).length > 0 && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Per-bag packing rates ($/bag)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(bagTypesQ.data ?? []).map(bt => (
                      <div key={bt.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text2)' }}>{bt.name}</span>
                        <input
                          className="form-input"
                          style={{ width: 100, margin: 0 }}
                          type="number"
                          step="0.01"
                          min="0"
                          value={editRates[bt.id] ?? ''}
                          onChange={e => setEditRates(p => ({ ...p, [bt.id]: e.target.value }))}
                          placeholder="0.00"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditEmpOpen(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={updateWorker.isPending || updateRates.isPending || !editName.trim()}
                onClick={saveEditEmployee}
              >
                <i className="ti ti-check" style={{ fontSize: 14 }} />
                {updateWorker.isPending || updateRates.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay modal */}
      {payModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayModalOpen(false)}>
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <div className="modal-title">Pay {selectedWorker?.name ?? 'worker'}</div>
              <button className="panel-close-btn" aria-label="Close" onClick={() => setPayModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Amount owed</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>${WORKER_OWED.toFixed(2)}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Amount to pay (USD)</label>
                <input
                  type="number"
                  className="pay-big-input"
                  placeholder="0.00"
                  value={payAmt}
                  onChange={e => setPayAmt(e.target.value)}
                />
              </div>
              <div className={`diff-bar ${barClass}`} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span>{barClass === 'ok' ? 'Full payment' : barClass === 'short' ? 'Partial payment' : 'Enter amount'}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    {diffVal >= 0 ? `+$${diffVal.toFixed(2)} over` : `-$${Math.abs(diffVal).toFixed(2)} short`}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${diffPct}%`, height: '100%', background: barClass === 'ok' ? 'var(--green)' : barClass === 'short' ? 'var(--amber)' : 'var(--bg3)', borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Method</label>
                <div className="method-pills">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m} className={`method-pill${payMethod === m ? ' sel' : ''}`} onClick={() => setPayMethod(m)}>
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
              {payMethod !== 'cash' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Reference # (receipt, transfer, cheque)</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="e.g. CHQ-00214"
                    value={payReference}
                    onChange={e => setPayReference(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPayModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitWorkerPayment} disabled={logPayment.isPending || payAmtNum <= 0}>
                {logPayment.isPending ? 'Saving…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add earnings modal */}
      {earnModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEarnModalOpen(false)}>
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <div className="modal-title">Add earnings — {selectedWorker?.name ?? 'worker'}</div>
              <button className="panel-close-btn" aria-label="Close" onClick={() => setEarnModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Amount (USD)</label>
                <input
                  type="number"
                  className="pay-big-input"
                  placeholder="0.00"
                  value={earnAmt}
                  onChange={e => setEarnAmt(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-input"
                  value={earnCategory}
                  onChange={e => setEarnCategory(e.target.value as WorkerCostCategory)}
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={earnDate}
                  onChange={e => setEarnDate(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. half day, left early"
                  value={earnNotes}
                  onChange={e => setEarnNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEarnModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitEarning} disabled={createEarning.isPending || (parseFloat(earnAmt) || 0) <= 0}>
                {createEarning.isPending ? 'Saving…' : 'Save earnings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
