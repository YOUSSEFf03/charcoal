import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useDriverExpenses, useGeneralExpenses, useCreateGeneralExpense, useUpdateGeneralExpense, useDeleteGeneralExpense, useAllWorkerPayments, useAllWorkerWageExpenses } from '../hooks/useExpenses'
import type { AggregatedWorkerPayment, AggregatedWorkerWageExpense } from '../hooks/useExpenses'
import { useBusinessExpenses } from '../hooks/useCashHandover'
import { useWorkers, useLogWorkerPayment } from '../hooks/useWorkers'
import type { DriverTrip, GeneralExpense, BusinessExpense, WorkerCostCategory } from '../types/api'
import { toDateOnlyString } from '../lib/date'
import { CATEGORY_LABEL } from '../lib/workerLabels'

// Business-model audit (2026-09-04): "A Cash Handover is NOT an employee
// expense." The employee/receiver is only the CASH HOLDER — whoever's
// custody an amount was deducted from before handover — never the owner of
// the expense. The expense itself belongs to the business.
//
// This page's PRIMARY view used to be an Employee → Category → Occurrence
// hierarchy (a "your employee spent money" framing). It is now a single flat
// BUSINESS EXPENSES list — every real expense the business incurred, however
// it was paid (a direct/company GeneralExpense row, or a CashHandoverExpense
// row deducted from someone's held cash) — answering "what did the business
// spend money on?" Both sources are read here exactly as CashHandoversService
// already stores them; no new accounting record, model, or duplicate total is
// created.
//
// Employee-payments audit (2026-09-05): "Employee payments ARE money the
// business actually paid out — they belong in Expenses. Wages OWED (earned
// but not yet paid) do not." Three tabs, matching that distinction exactly:
//   Business expenses  — GeneralExpense + CashHandoverExpense + employee WAGE
//                        expense (see the COGS-vs-Expenses audit below)
//   Employee Payments  — WorkerPayment ONLY, grouped by employee, for the
//                        SELECTED MONTH — "how much did we actually pay each
//                        employee this month", never wages earned/owed.
//   Recurring          — the subset of GeneralExpense with isRecurring=true,
//                        split out for visibility; same rows/total already
//                        counted once in Business Expenses, never a second
//                        accounting total.
// There is no "Employee Expenses" concept anywhere on this page. Full
// worker CRUD / earned / owed / history lives on the separate Employees.tsx
// page (untouched by this redesign) — this page's Employee Payments tab is
// deliberately narrow: actual cash paid this month, nothing else.
//
// COGS-vs-Expenses audit (2026-09-06): employee earnings split into TWO
// accounting buckets, matching the (unchanged) P&L exactly:
//   Per-bag / product-direct labor (PackingSession.sessionEarnings) → COGS.
//     NEVER shown here — it already feeds ReportsService.getProfitLoss()'s
//     labor cost line; adding it to Business Expenses would double-count it.
//   Non-product-direct labor (WorkerCost — daily wage, bonus, deduction, fuel,
//     food, transport, advance, correction, other) → a genuine business
//     OPERATING EXPENSE. It was already counted in the P&L's labor cost, but
//     had NO visible line item on this page — that's the gap this audit
//     closes. Shown as "Employee wage · {name}" rows, sourced from the SAME
//     WorkerCost rows via useAllWorkerWageExpenses() (which reuses
//     GET /workers/:id/statement) — no new record, no duplicate total.
// WorkerPayment (actual cash paid) stays exactly where it already was — the
// Employee Payments tab, a cash-outgoing view, never counted a second time
// as a P&L expense here (see totalOutgoing's doc comment below).
type ETab = 'business-expenses' | 'employee-payments' | 'recurring'
type SourceFilter = 'all' | 'handover' | 'direct' | 'wage'

/** One employee's WorkerPayment records for the selected month, grouped for
 *  the Employee Payments tab. Purely a display grouping of the SAME
 *  WorkerPayment rows useAllWorkerPayments() already fetched — no new
 *  records, no re-aggregation of wages earned/owed. */
interface EmployeePaymentGroup {
  workerId: string
  workerName: string
  totalPaid: number
  payments: AggregatedWorkerPayment[]
}

function groupWorkerPaymentsByEmployee(payments: AggregatedWorkerPayment[]): EmployeePaymentGroup[] {
  const byWorker = new Map<string, EmployeePaymentGroup>()
  for (const p of payments) {
    const group = byWorker.get(p.workerId) ?? { workerId: p.workerId, workerName: p.workerName, totalPaid: 0, payments: [] }
    group.totalPaid += parseFloat(p.amount)
    group.payments.push(p)
    byWorker.set(p.workerId, group)
  }
  return Array.from(byWorker.values()).sort((a, b) => b.totalPaid - a.totalPaid)
}

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

/** One row of the unified Business Expenses list — a direct GeneralExpense, a
 *  Cash-Handover-deducted expense, or an employee WAGE expense (WorkerCost —
 *  never PackingSession.sessionEarnings, which is COGS, not an operating
 *  expense — see this file's COGS-vs-Expenses doc comment), normalized to
 *  the same display shape. `source` is display-only; it never changes what
 *  the underlying record IS. */
interface CombinedExpenseRow {
  key: string
  date: string
  category: string
  description: string
  amount: number
  isRecurring: boolean
  source: 'direct' | 'handover' | 'wage'
  general?: GeneralExpense
  handover?: BusinessExpense
  wage?: AggregatedWorkerWageExpense
}

/** Formats a local calendar date as YYYY-MM-DD without going through UTC (avoids the
 * toISOString() off-by-one when the local timezone is ahead of UTC). */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export default function Expenses() {
  const [tab, setTab] = useState<ETab>('business-expenses')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

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

  // Direct/company expenses (recurring + one-time) — recurring rows are included
  // by the backend from their recorded date forward (never before); one-time
  // rows are filtered to the exact selected month. ("Option B" recurrence.)
  const {
    data: generalExpenses,
    isLoading: genLoading,
    isError: genError,
    refetch: refetchGeneral,
  } = useGeneralExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  const createExpense = useCreateGeneralExpense()
  const updateExpense = useUpdateGeneralExpense()
  const deleteExpense = useDeleteGeneralExpense()
  const logWorkerPayment = useLogWorkerPayment()

  // Live driver trips
  const {
    data: driverTripsResp,
    isLoading: drvLoading,
    isError: drvError,
    refetch: refetchDrivers,
  } = useDriverExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  // Worker data — ALL workers, not just the first (previously only workersData?.[0] was shown)
  const { data: workersData, isLoading: workersLoading } = useWorkers()

  // Aggregated employee payments (all workers, flattened), server-filtered to
  // the SELECTED MONTH — same WorkerPayment source-of-truth records, just
  // fanned out for display; no new records are created for this view.
  // Payments live ONLY on the Employee Payments tab — never folded into
  // Business Expenses (see this file's top doc comment).
  const { data: allWorkerPayments } = useAllWorkerPayments({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  // Employee WAGE expense (WorkerCost — daily wage, bonus, deduction, etc.),
  // server-filtered to the SELECTED MONTH — NEVER PackingSession.sessionEarnings
  // (per-bag/product-direct labor, which is COGS, not an operating expense —
  // see this file's COGS-vs-Expenses doc comment). This is a genuine Business
  // Expense line, distinct from Employee Payments (actual cash paid) below.
  const { data: allWorkerWageExpenses } = useAllWorkerWageExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })

  // Cash-Handover-sourced business expenses (PRIMARY tab, alongside direct
  // GeneralExpense rows above) — backend-aggregated, unbounded per month, see
  // useBusinessExpenses()'s doc comment. This is the SAME CashHandoverExpense
  // occurrence CashHandoversService.create() already persisted — read-only.
  const businessExpensesQ = useBusinessExpenses({ dateFrom: monthDateFrom, dateTo: monthDateTo })
  const handoverExpenses = businessExpensesQ.data ?? []

  // Belt-and-suspenders: allWorkerPayments is already server-filtered to this
  // month (dateFrom/dateTo above), but re-narrowing client-side guards
  // against ever showing a payment from another month (CASE 5) even if a
  // caller/cache serves a wider result.
  const monthWorkerPayments = (allWorkerPayments ?? []).filter(p => (p.date ?? '').slice(0, 10) >= monthDateFrom && (p.date ?? '').slice(0, 10) <= monthDateTo)

  // Same belt-and-suspenders re-narrowing as monthWorkerPayments above.
  const monthWorkerWageExpenses = (allWorkerWageExpenses ?? []).filter(e => (e.date ?? '').slice(0, 10) >= monthDateFrom && (e.date ?? '').slice(0, 10) <= monthDateTo)

  // One group per employee who received a payment this month — the
  // Employee Payments tab's primary view (CASE 3: totalPaid is the sum of
  // that employee's own WorkerPayment rows this month, nothing else).
  const employeePaymentGroups = groupWorkerPaymentsByEmployee(monthWorkerPayments)

  const driverGroups = groupDriverTrips(driverTripsResp?.data ?? [])

  // Derived splits (direct/company expenses only)
  const recurring = (generalExpenses ?? []).filter(e => e.isRecurring)
  const onetime   = (generalExpenses ?? []).filter(e => !e.isRecurring)
  const allGenExp = [...recurring, ...onetime]

  // ── Unified Business Expenses list — one row per real expense record, from
  // EITHER source, never merged/deduped/collapsed into a representative value.
  const combinedRows: CombinedExpenseRow[] = [
    ...allGenExp.map((e): CombinedExpenseRow => ({
      key: `g-${e.id}`,
      date: e.date,
      category: e.category || 'Other',
      description: e.description,
      amount: parseFloat(e.amount),
      isRecurring: e.isRecurring,
      source: 'direct',
      general: e,
    })),
    ...handoverExpenses.map((e): CombinedExpenseRow => ({
      key: `h-${e.id}`,
      date: e.date,
      category: e.categoryName,
      description: e.description,
      amount: parseFloat(e.amount),
      isRecurring: false,
      source: 'handover',
      handover: e,
    })),
    ...monthWorkerWageExpenses.map((e): CombinedExpenseRow => ({
      key: `w-${e.reference}`,
      date: e.date,
      category: CATEGORY_LABEL[e.category as WorkerCostCategory] ?? 'Other',
      description: e.notes || 'Employee wage',
      amount: parseFloat(e.earned),
      isRecurring: false,
      source: 'wage',
      wage: e,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const filteredRows = combinedRows.filter(r => sourceFilter === 'all' ? true : r.source === sourceFilter)

  // Add/edit expense modal — the same modal handles both; editingExpenseId set
  // means "Save" calls the update mutation instead of create. Direct/company
  // expenses only — a Cash-Handover expense is created via the Cash Handover
  // flow, never edited from here (it's a settlement record, not a standalone one).
  const [addModalType, setAddModalType] = useState<'recurring' | 'onetime' | null>(null)
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [newDesc, setNewDesc] = useState('')
  const [newAmt, setNewAmt] = useState('')
  const [newDate, setNewDate] = useState(toDateOnlyString(new Date()))
  const [newIsRecurring, setNewIsRecurring] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [newNotes, setNewNotes] = useState('')

  // Detail panel for a Cash-Handover-sourced row — audit trail / reconciliation context.
  const [detailRow, setDetailRow] = useState<BusinessExpense | null>(null)

  // Employee Payments drill-down — clicking an employee shows EVERY payment
  // they received in the selected month (CASE 4), not just the aggregate.
  const [selectedPaymentGroup, setSelectedPaymentGroup] = useState<EmployeePaymentGroup | null>(null)

  // Pay modal
  const [payTarget, setPayTarget] = useState<{ name: string; owed: number; workerId?: string } | null>(null)
  const [payDate, setPayDate] = useState(toDateOnlyString(new Date()))
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState<'Cash' | 'Whish' | 'OMT'>('Cash')
  const [payNotes, setPayNotes] = useState('')

  // ── Derived totals ──
  // Direct/company expenses (GeneralExpense only — recurring + one-time).
  const totalRecurring = recurring.reduce((s, e) => s + parseFloat(e.amount), 0)
  const totalDirectExpensesThisMonth = allGenExp.reduce((s, e) => s + parseFloat(e.amount), 0)
  // Cash-handover-deducted business expenses this month (same total
  // useExpensesSummary() would sum, read from the flat list instead).
  const totalHandoverExpensesThisMonth = handoverExpenses.reduce((s, e) => s + parseFloat(e.amount), 0)
  // Employee WAGE expense this month (WorkerCost — daily wage + every other
  // non-product-direct category) — a genuine operating expense. NEVER
  // includes per-bag/product-direct labor (PackingSession.sessionEarnings,
  // which is COGS — see this file's COGS-vs-Expenses doc comment), and never
  // the WorkerPayment cash settlement of it (see totalWorkerPaymentsThisMonth
  // below — a completely separate figure, cash-outgoing only).
  const totalWageExpensesThisMonth = monthWorkerWageExpenses.reduce((s, e) => s + parseFloat(e.earned), 0)
  // "Business expenses" — the headline figure: every real business operating
  // expense regardless of payment source, INCLUDING employee wage expense,
  // EXCLUDING per-bag/COGS labor and EXCLUDING cash payments (see top doc comment).
  const totalBusinessExpensesThisMonth = totalDirectExpensesThisMonth + totalHandoverExpensesThisMonth + totalWageExpensesThisMonth

  // "Employee wages owed" — a live outstanding-balance figure (earned minus paid,
  // all-time; WorkerPayment already netted out here, never re-added as a second
  // expense), NOT a period figure. Driver figures here are that month's trip
  // expenses, not earnings — drivers have no accrual/earnings model like workers.
  const totalWorkersOwed = (workersData ?? []).reduce((s, w) => s + parseFloat(w.totalOwed ?? '0'), 0)
  const totalDriverExpenses = driverGroups.reduce((s, g) => s + g.expensesTotal, 0)
  const totalWagesOwed = totalWorkersOwed + totalDriverExpenses

  // Cash actually paid out THIS MONTH to workers (a settlement/spend record, not an
  // accrual) — feeds "Total outgoing" below. Container expenses are deliberately NOT
  // included here (or anywhere on this page) — they're already spread into each
  // StockLot.costPerKg by recalculateContainerCosts() and feed COGS in the P&L that
  // way. Summing ContainerExpense.amount again here would double-count it.
  const totalWorkerPaymentsThisMonth = monthWorkerPayments.reduce((s, p) => s + parseFloat(p.amount), 0)

  // "Total outgoing" = actual cash outflow this month (cash-basis): direct/company
  // expenses + employee payments + cash-handover expenses. Formula UNCHANGED —
  // deliberately excludes:
  //   - totalWageExpensesThisMonth (accrued P&L cost, NOT a cash outflow itself —
  //     only the eventual WorkerPayment settling it is cash; adding both here
  //     would double-count the same wage as two cash outflows — CASE 3/8/9),
  //   - "Employee wages owed" (an accrued, all-time balance, not a period cash figure),
  //   - container expenses (already inside container cost/COGS, never a page-level
  //     cash total) — approved definitions, see the Expenses-KPI / COGS-vs-Expenses audits.
  const totalOutgoing = totalDirectExpensesThisMonth
    + totalWorkerPaymentsThisMonth
    + totalHandoverExpensesThisMonth

  // By-category summary — ALL THREE Business Expense sources combined (a
  // business expense is a business expense regardless of how it was paid or
  // which employee earned it; the category breakdown must reflect that). Never
  // includes per-bag/COGS labor or WorkerPayment cash settlements — neither is
  // ever added to combinedRows in the first place.
  const categoryTotals: Record<string, number> = {}
  combinedRows.forEach(r => {
    categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.amount
  })
  const categoryRows = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])

  function openAdd(type: 'recurring' | 'onetime') {
    setEditingExpenseId(null)
    setAddModalType(type)
    setNewIsRecurring(type === 'recurring')
    setNewDesc(''); setNewAmt(''); setNewNotes(''); setNewCategory('')
    setNewDate(toDateOnlyString(new Date()))
  }

  function openEdit(e: GeneralExpense) {
    setEditingExpenseId(e.id)
    setAddModalType(e.isRecurring ? 'recurring' : 'onetime')
    setNewIsRecurring(e.isRecurring)
    setNewDesc(e.description)
    setNewAmt(e.amount)
    setNewCategory(e.category ?? '')
    setNewNotes(e.notes ?? '')
    setNewDate(e.date?.slice(0, 10) || toDateOnlyString(new Date()))
  }

  function closeExpenseModal() {
    setAddModalType(null)
    setEditingExpenseId(null)
  }

  function deleteGeneralExpense(e: GeneralExpense) {
    if (!confirm(`Delete "${e.description}"?`)) return
    deleteExpense.mutate(e.id, {
      onError: (err: any) => window.alert(err?.error ?? 'Failed to delete expense — you may not have permission (owner only).'),
    })
  }

  async function saveExpense() {
    if (!newDesc.trim() || !newAmt) return
    const body = {
      description: newDesc.trim(),
      amount: parseFloat(newAmt).toFixed(2),
      isRecurring: newIsRecurring,
      category: newCategory.trim() || undefined,
      date: newDate,
      notes: newNotes.trim() || undefined,
    }
    try {
      if (editingExpenseId) {
        await updateExpense.mutateAsync({ id: editingExpenseId, body })
      } else {
        await createExpense.mutateAsync(body)
      }
      closeExpenseModal()
    } catch (err: any) {
      window.alert(err?.error ?? 'Failed to save expense — you may not have permission (owner only).')
    }
  }

  function openPay(name: string, owed: number, workerId?: string) {
    setPayTarget({ name, owed, workerId })
    setPayAmt('')
    setPayMethod('Cash')
    setPayNotes('')
    setPayDate(toDateOnlyString(new Date()))
  }

  const PAY_METHOD_MAP: Record<'Cash' | 'Whish' | 'OMT', 'cash' | 'whish' | 'omt'> = { Cash: 'cash', Whish: 'whish', OMT: 'omt' }

  function confirmPayment() {
    if (!payTarget || payAmtNum <= 0) return
    if (!payTarget.workerId) {
      // Driver trip expenses have no backend concept of "payment" — they're
      // recorded costs (DriverTrip.fuelCost/otherExpenses), not a WorkerPayment-
      // style payable liability. Building that is a product decision, not a
      // wiring fix, so this must say so rather than silently closing as if paid.
      window.alert('Recording a driver expense reimbursement isn\'t supported yet.')
      return
    }
    logWorkerPayment.mutate(
      {
        id: payTarget.workerId,
        body: {
          amount: payAmtNum.toFixed(2),
          method: PAY_METHOD_MAP[payMethod],
          date: payDate,
          notes: payNotes.trim() || undefined,
        },
      },
      { onSuccess: () => setPayTarget(null) },
    )
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

  // Reconciliation figures for the open detail row — collected/held is
  // DERIVED from existing fields (expectedAmt + this handover's expenses
  // total), never a separately stored/invented field.
  const detailCollected = detailRow
    ? parseFloat(detailRow.handoverExpectedAmt) + parseFloat(detailRow.handoverExpensesTotal)
    : 0

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
        <div className={`tab${tab === 'business-expenses' ? ' active' : ''}`} onClick={() => setTab('business-expenses')}>
          <i className="ti ti-receipt-2" style={{ fontSize: 14 }} /> Business expenses
          <span className="tab-count">{combinedRows.length}</span>
        </div>
        <div className={`tab${tab === 'employee-payments' ? ' active' : ''}`} onClick={() => setTab('employee-payments')}>
          <i className="ti ti-cash" style={{ fontSize: 14 }} /> Employee Payments
          <span className="tab-count">{employeePaymentGroups.length}</span>
        </div>
        <div className={`tab${tab === 'recurring' ? ' active' : ''}`} onClick={() => setTab('recurring')}>
          <i className="ti ti-repeat" style={{ fontSize: 14 }} /> Recurring
          <span className="tab-count">{recurring.length}</span>
        </div>
      </div>

      <div className="content">

        {/* KPI row */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Business expenses ({monthShort})</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${totalBusinessExpensesThisMonth.toLocaleString()}</div>
            <div className="kpi-sub">{combinedRows.length} entries · direct + cash handover + employee wage</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Cash handover expenses</div>
            <div className="kpi-value" style={{ color: 'var(--accent2)' }}>${totalHandoverExpensesThisMonth.toLocaleString()}</div>
            <div className="kpi-sub">{handoverExpenses.length} occurrence{handoverExpenses.length !== 1 ? 's' : ''} · deducted from cash held</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Employee wage expense ({monthShort})</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${totalWageExpensesThisMonth.toLocaleString()}</div>
            <div className="kpi-sub">{monthWorkerWageExpenses.length} entries · daily wage + other · not per-bag (COGS)</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Recurring (monthly)</div>
            <div className="kpi-value">${totalRecurring.toLocaleString()}</div>
            <div className="kpi-sub">rent + fixed costs · direct only</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Employee wages owed</div>
            <div className="kpi-value" style={{ color: 'var(--accent2)' }}>${totalWagesOwed.toFixed(0)}</div>
            <div className="kpi-sub">current outstanding, all-time · not a business expense</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Total outgoing ({monthShort})</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>${totalOutgoing.toFixed(0)}</div>
            <div className="kpi-sub">cash paid out this month</div>
          </div>
        </div>

        {/* ── BUSINESS EXPENSES TAB (primary) ── */}
        {tab === 'business-expenses' && (
          <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

            <div>
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-receipt-2" /> Business expenses — {monthLabel}</div>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => openAdd('onetime')}>
                    <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add business expense
                  </button>
                </div>

                {/* Payment-source filter */}
                <div style={{ display: 'flex', gap: 8, padding: '12px 18px 0' }}>
                  {(['all', 'direct', 'handover', 'wage'] as const).map(f => (
                    <div
                      key={f}
                      onClick={() => setSourceFilter(f)}
                      style={{
                        padding: '5px 12px', border: '1px solid', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                        fontSize: 12, fontWeight: 500,
                        background: sourceFilter === f ? 'var(--text)' : 'transparent',
                        color:      sourceFilter === f ? '#fff' : 'var(--text2)',
                        borderColor: sourceFilter === f ? 'var(--text)' : 'var(--border)',
                      }}
                    >
                      {f === 'all' ? 'All' : f === 'direct' ? 'Direct / company' : f === 'handover' ? 'Cash handover' : 'Employee wage'}
                    </div>
                  ))}
                </div>

                {(genLoading || businessExpensesQ.isLoading) && [0, 1, 2].map(i => (
                  <div key={`sk-${i}`} className="exp-item">
                    <div className="exp-icon" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 18, height: 18, borderRadius: 4 }} /></div>
                    <div className="exp-info">
                      <div className="skeleton" style={{ width: '60%', height: 13, marginBottom: 4 }} />
                      <div className="skeleton" style={{ width: '40%', height: 11 }} />
                    </div>
                    <div className="exp-amount"><div className="skeleton" style={{ width: 60, height: 13 }} /></div>
                  </div>
                ))}
                {(genError || businessExpensesQ.isError) && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                    Failed to load business expenses.
                    <div>
                      <button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => { refetchGeneral(); businessExpensesQ.refetch() }}>Retry</button>
                    </div>
                  </div>
                )}
                {!genLoading && !businessExpensesQ.isLoading && !genError && !businessExpensesQ.isError && filteredRows.length === 0 && (
                  <div className="empty">No business expenses recorded for {monthLabel}.</div>
                )}
                {!genLoading && !businessExpensesQ.isLoading && filteredRows.length > 0 && (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Category</th>
                          <th>Description</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th>Payment source</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map(r => (
                          <tr key={r.key}>
                            <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{r.date?.slice(0, 10)}</td>
                            <td>
                              {r.category}
                              {r.isRecurring && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>Recurring</span>}
                            </td>
                            <td style={{ color: 'var(--text2)' }}>{r.description}</td>
                            <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--red)' }}>
                              ${r.amount.toLocaleString()}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {r.source === 'direct' ? (
                                <span style={{ color: 'var(--text3)' }}>Direct · Company</span>
                              ) : r.source === 'handover' ? (
                                <span style={{ color: 'var(--accent2)' }}>Cash Handover · {r.handover!.cashHolderName}</span>
                              ) : (
                                // "Employee wage · {name}" — the employee is the
                                // beneficiary/worker, never framed as owning the
                                // expense (never "Employee expense" — see this
                                // file's COGS-vs-Expenses doc comment).
                                <span style={{ color: 'var(--blue)' }}>Employee wage · {r.wage!.workerName}</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {r.source === 'direct' ? (
                                <>
                                  <button className="exp-del" onClick={() => openEdit(r.general!)} title="Edit">
                                    <i className="ti ti-edit" style={{ fontSize: 12 }} />
                                  </button>
                                  <button className="exp-del" disabled={deleteExpense.isPending} onClick={() => deleteGeneralExpense(r.general!)} title="Delete">
                                    <i className="ti ti-x" style={{ fontSize: 12 }} />
                                  </button>
                                </>
                              ) : r.source === 'handover' ? (
                                <button className="btn" style={{ fontSize: 11 }} onClick={() => setDetailRow(r.handover!)}>
                                  View <i className="ti ti-chevron-right" style={{ fontSize: 11 }} />
                                </button>
                              ) : (
                                // No edit/delete/detail action — WorkerCost is append-only
                                // (corrections happen via the Employees page's own edit
                                // window / correction-entry workflow, never from here).
                                null
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Right: category breakdown + total-outgoing explanation */}
            <div style={{ position: 'sticky', top: 76 }}>

              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-category" /> Spending by category</div>
                </div>
                <div style={{ padding: '6px 18px 12px' }}>
                  {categoryRows.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>No expenses yet.</div>
                  )}
                  {categoryRows.map(([cat, amt]) => {
                    const pct = totalBusinessExpensesThisMonth > 0 ? Math.round((amt / totalBusinessExpensesThisMonth) * 100) : 0
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

              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-chart-bar" /> Total outgoing ({monthShort})</div>
                </div>
                <div style={{ padding: '4px 0' }}>
                  {[
                    ['Company/general expenses', totalDirectExpensesThisMonth],
                    ['Cash-handover expenses', totalHandoverExpensesThisMonth],
                    ['Employee payments', totalWorkerPaymentsThisMonth],
                  ].map(([label, amt]) => (
                    <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 18px' }}>
                      <span style={{ color: 'var(--text2)' }}>{label}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${(amt as number).toLocaleString()}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 18px 2px', color: 'var(--text3)' }}>
                    <span>Container expenses</span>
                    <span>in COGS — not cash outgoing</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 18px 6px', color: 'var(--text3)' }}>
                    <span>Employee wage expense (${totalWageExpensesThisMonth.toLocaleString()})</span>
                    <span>accrued cost — cash only when paid</span>
                  </div>
                </div>
                <div style={{ padding: '12px 18px', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Total cash outgoing</span>
                    <span style={{ fontSize: 18, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--red)' }}>${totalOutgoing.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>Wages owed (not yet paid)</span>
                    <span style={{ fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent2)' }}>${totalWagesOwed.toLocaleString()}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Driver trip expenses — delivery/fuel cost the business paid, same
              nature as the deliveryCost bucket in the P&L. Relocated here
              (2026-09-05 employee-payments audit) from the old "Employees" tab:
              a driver has no WorkerPayment/wage record, so it never belonged
              alongside actual employee payments — it's a business expense. */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Driver trip expenses
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
          </>
        )}

        {/* ── EMPLOYEE PAYMENTS TAB ── actual cash paid to employees this
            month ONLY — never wages earned/owed (see this file's top doc
            comment). Full worker CRUD/earned/owed/history lives on the
            separate Employees page, untouched by this tab. ── */}
        {tab === 'employee-payments' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-cash" /> Employee payments — {monthLabel}</div>
              </div>

              {employeePaymentGroups.length === 0 && (
                <div className="empty">No employee payments this month.</div>
              )}

              {employeePaymentGroups.length > 0 && (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th style={{ textAlign: 'right' }}>Paid</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeePaymentGroups.map(g => (
                        <tr key={g.workerId} style={{ cursor: 'pointer' }} onClick={() => setSelectedPaymentGroup(g)}>
                          <td>{g.workerName}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>
                            ${g.totalPaid.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setSelectedPaymentGroup(g) }}>
                              View <i className="ti ti-chevron-right" style={{ fontSize: 11 }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {employeePaymentGroups.length > 0 && (
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text3)' }}>Total employee payments</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalWorkerPaymentsThisMonth.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Right: wages-owed reference — an ALL-TIME outstanding balance,
                shown for context only. Never added into the payments total
                above (CASE 6: wages owed are not employee payments). Full
                per-worker earned/paid/owed detail lives on the Employees page. */}
            <div style={{ position: 'sticky', top: 76 }}>
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-scale" /> Wages owed (all-time)</div>
                </div>
                {workersLoading && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
                )}
                {!workersLoading && (workersData ?? []).filter(w => parseFloat(w.totalOwed ?? '0') > 0).length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No outstanding wages.</div>
                )}
                {!workersLoading && (workersData ?? []).filter(w => parseFloat(w.totalOwed ?? '0') > 0).map(w => (
                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 18px', borderBottom: '1px solid var(--border)' }}>
                    <span>{w.name}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: 'var(--accent2)' }}>${parseFloat(w.totalOwed ?? '0').toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ padding: '12px 18px', background: 'var(--surface2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>not a business expense</span>
                  <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent2)' }}>${totalWagesOwed.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── RECURRING TAB ── the SAME GeneralExpense rows already counted
            once in Business Expenses (isRecurring=true), split out here for
            visibility only — no second total, no accounting change. ── */}
        {tab === 'recurring' && (
          <div className="card">
            <div className="card-head">
              <div className="card-title"><i className="ti ti-repeat" /> Recurring expenses — {monthLabel}</div>
              <button className="btn" style={{ fontSize: 12 }} onClick={() => openAdd('recurring')}>
                <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add recurring expense
              </button>
            </div>

            {recurring.length === 0 && (
              <div className="empty">No recurring expenses recorded for {monthLabel}.</div>
            )}

            {recurring.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recurring.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{e.date?.slice(0, 10)}</td>
                        <td>{e.category || 'Other'}</td>
                        <td style={{ color: 'var(--text2)' }}>{e.description}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--red)' }}>
                          ${parseFloat(e.amount).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="exp-del" onClick={() => openEdit(e)} title="Edit">
                            <i className="ti ti-edit" style={{ fontSize: 12 }} />
                          </button>
                          <button className="exp-del" disabled={deleteExpense.isPending} onClick={() => deleteGeneralExpense(e)} title="Delete">
                            <i className="ti ti-x" style={{ fontSize: 12 }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {recurring.length > 0 && (
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>Total recurring</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${totalRecurring.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── EMPLOYEE PAYMENTS DRILL-DOWN — every payment for the selected
          employee in the selected month (CASE 4), not just the aggregate. ── */}
      {selectedPaymentGroup && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setSelectedPaymentGroup(null)}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">{selectedPaymentGroup.workerName}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{monthLabel} · Total paid ${selectedPaymentGroup.totalPaid.toLocaleString()}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setSelectedPaymentGroup(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Method</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...selectedPaymentGroup.payments]
                      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
                      .map(p => (
                        <tr key={p.id}>
                          <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{p.date?.slice(0, 10)}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>${parseFloat(p.amount).toFixed(2)}</td>
                          <td style={{ textTransform: 'capitalize' }}>{p.method}{p.referenceNumber ? ` · ${p.referenceNumber}` : ''}</td>
                          <td style={{ color: 'var(--text2)' }}>{p.notes || 'Payment'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setSelectedPaymentGroup(null)}>Close</button>
              <button
                className="btn green"
                onClick={() => {
                  const owed = parseFloat((workersData ?? []).find(w => w.id === selectedPaymentGroup.workerId)?.totalOwed ?? '0')
                  openPay(selectedPaymentGroup.workerName, owed, selectedPaymentGroup.workerId)
                  setSelectedPaymentGroup(null)
                }}
              >
                <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay {selectedPaymentGroup.workerName}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT EXPENSE MODAL (direct/company expenses only) ── */}
      {addModalType && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && closeExpenseModal()}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {editingExpenseId ? 'Edit business expense' : 'Add business expense'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{monthLabel} · Direct / company</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={closeExpenseModal}>✕</button>
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
              <button className="btn" onClick={closeExpenseModal}>Cancel</button>
              <button className="btn primary" onClick={saveExpense} disabled={createExpense.isPending || updateExpense.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} />
                {createExpense.isPending || updateExpense.isPending ? 'Saving…' : editingExpenseId ? 'Save changes' : 'Add expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CASH-HANDOVER EXPENSE DETAIL MODAL — audit trail / reconciliation ── */}
      {detailRow && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setDetailRow(null)}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-title">{detailRow.categoryName}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Business expense detail</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setDetailRow(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--red)', marginBottom: 14 }}>
                ${parseFloat(detailRow.amount).toLocaleString()}
              </div>
              {[
                ['Date', detailRow.date?.slice(0, 10)],
                ['Category', detailRow.categoryName],
                ['Description', detailRow.description],
                ['Payment source', 'Cash Handover'],
                ['Cash holder', detailRow.cashHolderName],
                ['Cash handover', detailRow.cashHandoverId.slice(0, 8).toUpperCase()],
              ].map(([label, val]) => (
                <div key={label} className="panel-row" style={{ padding: '7px 0' }}>
                  <span className="panel-row-label">{label}</span>
                  <span className="panel-row-value" style={{ textAlign: 'right' }}>{val}</span>
                </div>
              ))}

              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Reconciliation — this cash handover
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                  <span>Cash collected/held</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>${detailCollected.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                  <span>Business expenses (this handover)</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--red)' }}>−${parseFloat(detailRow.handoverExpensesTotal).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
                  <span style={{ fontWeight: 600 }}>Handed to accountant</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>${parseFloat(detailRow.handoverHandedAmt).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setDetailRow(null)}>Close</button>
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
              <button className="close-btn" aria-label="Close" onClick={() => setPayTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 14 }}>
                {/* No "paid by" field on WorkerPayment — the payment is already
                    attributed to the authenticated user server-side; there's
                    nothing for a separate dropdown here to persist. */}
                <label className="form-label">Payment date</label>
                <input className="form-input" type="date" style={{ margin: 0 }} value={payDate} onChange={e => setPayDate(e.target.value)} />
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
              <input className="form-input" type="text" placeholder="e.g. May wages partial" style={{ marginBottom: 0 }} value={payNotes} onChange={e => setPayNotes(e.target.value)} />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPayTarget(null)}>Cancel</button>
              <button className="btn green" onClick={confirmPayment} disabled={logWorkerPayment.isPending || payAmtNum <= 0}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {logWorkerPayment.isPending ? 'Saving…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
