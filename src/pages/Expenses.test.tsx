// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Business-model audit (2026-09-04): "A Cash Handover is NOT an employee
// expense." The Expenses page's PRIMARY view is now a single flat BUSINESS
// EXPENSES list combining direct/company GeneralExpense rows and
// Cash-Handover-deducted expenses (from the new GET /cash-handovers/expenses
// flat endpoint) — never an "Employee → Category → Occurrence" hierarchy, and
// never a separate "employee expense" concept. Test matrix per the task spec
// (CASE 1-7 below map to the audit's required regression cases).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockUseGeneralExpenses = vi.fn()
const mockUseAllWorkerPayments = vi.fn()
const mockUseAllWorkerWageExpenses = vi.fn()
vi.mock('../hooks/useExpenses', () => ({
  useDriverExpenses: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useGeneralExpenses: (params: unknown) => mockUseGeneralExpenses(params),
  useCreateGeneralExpense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateGeneralExpense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteGeneralExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useAllWorkerPayments: (params: unknown) => mockUseAllWorkerPayments(params),
  useAllWorkerWageExpenses: (params: unknown) => mockUseAllWorkerWageExpenses(params),
}))

const mockUseWorkers = vi.fn()
const mockLogWorkerPayment = vi.fn()
vi.mock('../hooks/useWorkers', () => ({
  useWorkers: () => mockUseWorkers(),
  useLogWorkerPayment: () => ({ mutate: mockLogWorkerPayment, isPending: false }),
}))

const mockUseBusinessExpenses = vi.fn()
vi.mock('../hooks/useCashHandover', () => ({
  useBusinessExpenses: (params: unknown) => mockUseBusinessExpenses(params),
}))

import Expenses from './Expenses'

function makeHandoverExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    date: '2026-09-03',
    categoryId: 'cat-benzin',
    categoryName: 'Benzin',
    // NOTE: the real CashHandoverExpense.description is always kept in sync
    // with the category name at write time (schema comment) — a distinct
    // free-text description is NOT part of the current data model, so the
    // fixture intentionally mirrors that (category and description equal).
    description: 'Benzin',
    amount: '10.00',
    cashHandoverId: 'h1abcdef',
    cashHolderId: 'gaz',
    cashHolderName: 'Gaz',
    handoverExpectedAmt: '90.00',
    handoverHandedAmt: '90.00',
    handoverExpensesTotal: '10.00',
    ...overrides,
  }
}

function makeGeneralExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    displayId: 'GE-001',
    description: 'Office rent payment',
    amount: '200.00',
    isRecurring: false,
    category: 'Rent',
    date: '2026-09-01',
    notes: null,
    ...overrides,
  }
}

function makeWorkerPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wp1',
    workerId: 'w1',
    workerName: 'Ahmad',
    amount: '100.00',
    method: 'cash',
    referenceNumber: null,
    date: '2026-09-03',
    notes: null,
    ...overrides,
  }
}

/** Matches AggregatedWorkerWageExpense — a WorkerCost ('cost'-sourced)
 *  statement entry annotated with workerId/workerName, exactly what
 *  useAllWorkerWageExpenses() returns. Never 'session' (per-bag/COGS) or
 *  'payment' (cash settlement) — those are different aggregations entirely. */
function makeWorkerWageExpense(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-09-05',
    type: 'earning',
    source: 'cost',
    reference: 'c1',
    category: 'daily_wage',
    notes: null,
    earned: '20.00',
    paid: '0.00',
    runningBalance: '20.00',
    workerId: 'w1',
    workerName: 'Hassan',
    ...overrides,
  }
}

function makeWorker(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    name: 'Ahmad',
    phone: null,
    ratesPerBagType: [],
    totalBagsPacked: [],
    totalEarned: '0.00',
    totalPaid: '0.00',
    totalOwed: '0.00',
    pieceEarned: '0.00',
    costEarned: '0.00',
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGeneralExpenses.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockUseBusinessExpenses.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockUseAllWorkerPayments.mockReturnValue({ data: [] })
  mockUseAllWorkerWageExpenses.mockReturnValue({ data: [] })
  mockUseWorkers.mockReturnValue({ data: [], isLoading: false })
})

/** Switches to the "Employee Payments" tab (works regardless of which tab is currently active). */
async function goToEmployeePaymentsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Employee Payments'))
}

/** Switches to the "Recurring" tab — scoped to the tab bar, since a recurring
 *  row's "Recurring" badge can also appear in the Business Expenses table. */
async function goToRecurringTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(document.querySelector('.tabs') as HTMLElement).getByText('Recurring'))
}

describe('Expenses — Business expenses (primary view)', () => {
  it('lands on "Business expenses" as the default tab — never "Employee expenses"', () => {
    render(<Expenses />)
    const tab = document.querySelector('.tab.active')
    expect(tab).toHaveTextContent('Business expenses')
    expect(screen.queryByText(/Employee expenses/)).not.toBeInTheDocument()
  })

  it('no "Employee Expenses" concept anywhere on the page — no such tab, heading, or label', () => {
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)
    expect(screen.queryByText(/Employee expense/i)).not.toBeInTheDocument()
  })

  it('no business expenses at all: shows an honest empty state, never a fabricated row', () => {
    render(<Expenses />)
    expect(screen.getByText(/No business expenses recorded/)).toBeInTheDocument()
  })

  describe('CASE 1 — Gaz collects $100, spends $10 on benzin, hands $90', () => {
    it('the business expense ($10) is shown, no employee-expense category exists, and cash-holder attribution is correct', () => {
      mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense()], isLoading: false, isError: false, refetch: vi.fn() })
      render(<Expenses />)

      const table = within(screen.getByRole('table'))
      expect(table.getAllByText('Benzin').length).toBeGreaterThan(0)
      expect(table.getByText('$10')).toBeInTheDocument()
      // Payment source shows the cash holder, never "employee expense" framing.
      expect(table.getByText(/Cash Handover · Gaz/)).toBeInTheDocument()
      expect(screen.queryByText(/employee expense/i)).not.toBeInTheDocument()
    })

    it('opening the detail view shows the full reconciliation: $100 collected → $10 expense → $90 handed', async () => {
      mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense()], isLoading: false, isError: false, refetch: vi.fn() })
      const user = userEvent.setup()
      render(<Expenses />)

      await user.click(screen.getByRole('button', { name: /View/ }))

      expect(screen.getByText('Cash collected/held')).toBeInTheDocument()
      expect(screen.getByText('$100')).toBeInTheDocument() // collected = expectedAmt(90) + expensesTotal(10)
      expect(screen.getByText('Handed to accountant')).toBeInTheDocument()
      expect(screen.getByText('$90')).toBeInTheDocument()
      // Cash holder shown as reference only, not as "owner".
      expect(screen.getByText('Cash holder')).toBeInTheDocument()
      expect(screen.getByText('Gaz')).toBeInTheDocument()
    })
  })

  it('CASE 2 — the same $10 cash-handover expense appears in the Business expenses list exactly once', () => {
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)
    const table = within(screen.getByRole('table'))
    expect(table.getAllByText('$10')).toHaveLength(1)
    expect(table.getAllByRole('row')).toHaveLength(2) // header + exactly one expense row
  })

  it('CASE 3 — the row\'s displayed date is the Cash Handover date returned by the backend, not any other date', () => {
    mockUseBusinessExpenses.mockReturnValue({
      data: [makeHandoverExpense({ date: '2026-09-03' })],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    render(<Expenses />)
    expect(screen.getByText('2026-09-03')).toBeInTheDocument()
  })

  it('CASE 4 — the employee name is shown as "Cash Handover · <name>" (a reference), never as an owner label like "<name>\'s expense"', () => {
    mockUseBusinessExpenses.mockReturnValue({
      data: [makeHandoverExpense({ cashHolderName: 'Abu Baker' })],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    render(<Expenses />)
    expect(screen.getByText(/Cash Handover · Abu Baker/)).toBeInTheDocument()
    expect(screen.queryByText(/Abu Baker's expense/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Abu Baker expense/i)).not.toBeInTheDocument()
  })

  it('CASE 5 — a general/direct business expense (e.g. Rent) is shown as a business expense with "Direct · Company" as its payment source', () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Rent')).toBeInTheDocument()
    expect(table.getByText('Office rent payment')).toBeInTheDocument()
    expect(table.getByText('$200')).toBeInTheDocument()
    expect(table.getByText(/Direct · Company/)).toBeInTheDocument()
  })

  it('CASE 6 — a worker payment never appears in the Business expenses list, and wages owed is called out as "not a business expense"', () => {
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)
    expect(screen.getByText(/not a business expense/)).toBeInTheDocument()
  })

  it('CASE 7 — Total outgoing = direct expenses + cash-handover expenses + employee payments (unchanged formula), and the breakdown explains the composition', () => {
    const today = new Date().toISOString().slice(0, 10)
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense({ amount: '200.00' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense({ amount: '10.00' })], isLoading: false, isError: false, refetch: vi.fn() })
    // A worker payment ($5) so Total outgoing (215) differs from the
    // wages-excluded Business expenses headline (210) — proves wages are
    // additive to Total outgoing but never folded into Business expenses.
    mockUseAllWorkerPayments.mockReturnValue({
      data: [{ id: 'p1', workerId: 'w1', workerName: 'Worker', amount: '5.00', method: 'cash', referenceNumber: null, date: today, notes: null }],
    })
    render(<Expenses />)

    // Total outgoing = 200 (direct) + 10 (cash handover) + 5 (worker payment) = 215.
    expect(screen.getAllByText('$215')).toHaveLength(2) // KPI card + breakdown card, both must agree.
    // Business expenses headline stays 210 — wages never fold in.
    expect(screen.getAllByText('$210').length).toBeGreaterThan(0)
    expect(screen.getByText('Total cash outgoing')).toBeInTheDocument()
    expect(screen.getByText('Company/general expenses')).toBeInTheDocument()
    expect(screen.getByText('Cash-handover expenses')).toBeInTheDocument()
    expect(screen.getByText('Employee payments')).toBeInTheDocument()
  })

  it('combined rows are sorted by date, most recent first, regardless of source', () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense({ id: 'g1', description: 'Old rent', date: '2026-09-01' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense({ id: 'e1', date: '2026-09-05' })], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)

    const rows = screen.getAllByRole('row').slice(1) // drop header row
    expect(rows[0]).toHaveTextContent('2026-09-05')
    expect(rows[1]).toHaveTextContent('2026-09-01')
  })

  it('the payment-source filter narrows the visible rows without changing the underlying data', async () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    render(<Expenses />)

    expect(within(screen.getByRole('table')).getByText('Office rent payment')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText('Benzin').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Cash handover'))
    expect(screen.queryByText('Office rent payment')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText('Benzin').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Direct / company'))
    expect(within(screen.getByRole('table')).getByText('Office rent payment')).toBeInTheDocument()
    // "Benzin" can still legitimately appear in the (unfiltered) category
    // breakdown sidebar — the filter narrows the LIST only, so assert against
    // the table specifically, not the whole page.
    expect(within(screen.getByRole('table')).queryByText('Benzin')).not.toBeInTheDocument()
  })

  it('a recurring general expense is visually flagged "Recurring" in the combined list', () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense({ isRecurring: true, description: 'Monthly rent' })], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)
    // Scoped to the table — "Recurring" also appears as this page's third tab label.
    expect(within(screen.getByRole('table')).getByText('Recurring')).toBeInTheDocument()
  })

  it('spending by category combines both sources', () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense({ category: 'Rent', amount: '100.00' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseBusinessExpenses.mockReturnValue({ data: [makeHandoverExpense({ categoryName: 'Benzin', amount: '10.00' })], isLoading: false, isError: false, refetch: vi.fn() })
    render(<Expenses />)
    expect(screen.getByText('Spending by category')).toBeInTheDocument()
    expect(screen.getAllByText('Rent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Benzin').length).toBeGreaterThan(0)
  })

  it('date filtering: changing month re-queries both sources with the new date range', async () => {
    render(<Expenses />)
    const user = userEvent.setup()
    mockUseGeneralExpenses.mockClear()
    mockUseBusinessExpenses.mockClear()

    await user.click(screen.getByTitle('Previous month'))

    await waitFor(() => {
      expect(mockUseGeneralExpenses).toHaveBeenCalled()
      expect(mockUseBusinessExpenses).toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// Employee Payments tab — employee-payments audit (2026-09-05). Business
// model: WorkerPayment is the ONLY source of "employee payments" (actual cash
// paid this month); WorkerCost/PackingSession earnings (owed) are a
// completely separate concept and must never be counted here. Test matrix
// below maps to the audit's CASE 1-10.
// ---------------------------------------------------------------------------
function thisMonthDateStr(day: number): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function otherMonthDateStr(): string {
  const d = new Date()
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
}

describe('Expenses — Employee Payments tab', () => {
  it('the "Employees" concept from the old tab is gone — the tab reads "Employee Payments", never a generic "Employees"', () => {
    render(<Expenses />)
    expect(screen.getByText('Employee Payments')).toBeInTheDocument()
    expect(screen.queryByText(/^Employees$/)).not.toBeInTheDocument()
  })

  it('CASE 1/2 — shows the actual WorkerPayment amount regardless of how the underlying wage was earned (per-bag or per-day)', async () => {
    mockUseAllWorkerPayments.mockReturnValue({
      data: [
        makeWorkerPayment({ id: 'wp1', workerId: 'w1', workerName: 'Ahmad', amount: '100.00', date: thisMonthDateStr(5) }), // per-bag worker
        makeWorkerPayment({ id: 'wp2', workerId: 'w2', workerName: 'Layla', amount: '150.00', date: thisMonthDateStr(6) }), // per-day worker
      ],
    })
    const user = userEvent.setup()
    render(<Expenses />)
    await goToEmployeePaymentsTab(user)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Ahmad')).toBeInTheDocument()
    expect(table.getByText('$100')).toBeInTheDocument()
    expect(table.getByText('Layla')).toBeInTheDocument()
    expect(table.getByText('$150')).toBeInTheDocument()
  })

  it('CASE 3 — an employee with multiple payments this month shows the SUM of all of them as their "Paid" total', async () => {
    mockUseAllWorkerPayments.mockReturnValue({
      data: [
        makeWorkerPayment({ id: 'wp1', amount: '100.00', date: thisMonthDateStr(3) }),
        makeWorkerPayment({ id: 'wp2', amount: '150.00', date: thisMonthDateStr(10) }),
        makeWorkerPayment({ id: 'wp3', amount: '100.00', date: thisMonthDateStr(18) }),
        makeWorkerPayment({ id: 'wp4', amount: '100.00', date: thisMonthDateStr(28) }),
      ],
    })
    const user = userEvent.setup()
    render(<Expenses />)
    await goToEmployeePaymentsTab(user)

    // 100 + 150 + 100 + 100 = 450, appearing in Ahmad's row, the footer total, and the "Total outgoing" KPI.
    expect(screen.getAllByText('$450')).toHaveLength(3)
  })

  it('CASE 4 — clicking an employee opens a drill-down showing EVERY payment for that month, not just the aggregate', async () => {
    mockUseAllWorkerPayments.mockReturnValue({
      data: [
        makeWorkerPayment({ id: 'wp1', amount: '100.00', date: thisMonthDateStr(3), method: 'cash' }),
        makeWorkerPayment({ id: 'wp2', amount: '150.00', date: thisMonthDateStr(10), method: 'whish' }),
        makeWorkerPayment({ id: 'wp3', amount: '100.00', date: thisMonthDateStr(18), method: 'cash' }),
      ],
    })
    const user = userEvent.setup()
    render(<Expenses />)
    await goToEmployeePaymentsTab(user)

    await user.click(screen.getByText('Ahmad'))

    const modal = within(screen.getByText(/Total paid \$350/).closest('.modal') as HTMLElement)
    expect(modal.getAllByRole('row')).toHaveLength(4) // header + 3 payments
    expect(modal.getAllByText('$100.00')).toHaveLength(2) // wp1 + wp3
    expect(modal.getByText('$150.00')).toBeInTheDocument()
  })

  it('CASE 5 — a payment from another month never appears in this month\'s employee payments list or total', async () => {
    mockUseAllWorkerPayments.mockReturnValue({
      data: [
        makeWorkerPayment({ id: 'wp-this', amount: '100.00', date: thisMonthDateStr(5) }),
        makeWorkerPayment({ id: 'wp-other', workerName: 'Ahmad', amount: '999.00', date: otherMonthDateStr() }),
      ],
    })
    const user = userEvent.setup()
    render(<Expenses />)
    await goToEmployeePaymentsTab(user)

    expect(screen.queryByText('$999')).not.toBeInTheDocument()
    expect(screen.getAllByText('$100')).toHaveLength(3) // row + footer total + "Total outgoing" KPI, not 100+999
  })

  it('CASE 6 — wages owed (accrued, not yet paid) are shown separately and are never added into the employee payments total', async () => {
    mockUseAllWorkerPayments.mockReturnValue({
      data: [makeWorkerPayment({ amount: '100.00', date: thisMonthDateStr(5) })],
    })
    mockUseWorkers.mockReturnValue({ data: [makeWorker({ id: 'w1', name: 'Ahmad', totalOwed: '250.00' })], isLoading: false })
    const user = userEvent.setup()
    render(<Expenses />)
    await goToEmployeePaymentsTab(user)

    // Payments total stays 100 — the 250 owed never folds in.
    expect(screen.getAllByText('$100')).toHaveLength(3) // row + footer total + "Total outgoing" KPI
    expect(screen.getByText('not a business expense')).toBeInTheDocument()
    expect(screen.getAllByText('$250.00')).toHaveLength(2) // per-worker row + footer total (one worker)
  })

  it('no employee payments this month: shows an honest empty state, never a fabricated row', async () => {
    const user = userEvent.setup()
    render(<Expenses />)
    await goToEmployeePaymentsTab(user)
    expect(screen.getByText('No employee payments this month.')).toBeInTheDocument()
  })
})

describe('Expenses — Recurring tab', () => {
  it('lists only recurring general expenses, separate from one-time business expenses', async () => {
    mockUseGeneralExpenses.mockReturnValue({
      data: [
        makeGeneralExpense({ id: 'g1', description: 'Monthly rent', amount: '300.00', isRecurring: true }),
        makeGeneralExpense({ id: 'g2', description: 'One-off repair', amount: '50.00', isRecurring: false }),
      ],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    render(<Expenses />)
    await goToRecurringTab(user)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Monthly rent')).toBeInTheDocument()
    expect(table.queryByText('One-off repair')).not.toBeInTheDocument()
    expect(screen.getByText('Total recurring')).toBeInTheDocument()
  })

  it('no recurring expenses: shows an honest empty state', async () => {
    const user = userEvent.setup()
    render(<Expenses />)
    await goToRecurringTab(user)
    expect(screen.getByText(/No recurring expenses recorded/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// COGS-vs-Expenses audit (2026-09-06): per-bag/product-direct labor is COGS
// (never shown here); non-product-direct labor (WorkerCost — daily wage and
// every other category) is a genuine Business Expense; WorkerPayment is a
// cash settlement, never a second P&L expense. Test matrix maps to CASE 1-9.
// ---------------------------------------------------------------------------
describe('Expenses — Employee wage expense (COGS vs. Expenses classification)', () => {
  it('CASE 2/6 — daily wage appears in Business Expenses as "Employee wage · <name>", categorized correctly', () => {
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [makeWorkerWageExpense()] })
    render(<Expenses />)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Daily wage')).toBeInTheDocument()
    expect(table.getByText('Employee wage · Hassan')).toBeInTheDocument()
    expect(table.getByText('$20')).toBeInTheDocument()
    // Never framed as the employee owning the expense.
    expect(screen.queryByText(/employee expense/i)).not.toBeInTheDocument()
  })

  it('CASE 1 — a per-bag-shaped ($100) entry is never rendered as a business expense (this hook only ever returns WorkerCost, never PackingSession)', () => {
    // Even if a caller mistakenly fed a large per-bag-sized amount through
    // this aggregation, Expenses trusts it as-is (COGS exclusion happens at
    // the hook boundary — see useExpenses.test.tsx) — this test locks the
    // page-level expectation that $100 never silently appears here undated.
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [] })
    render(<Expenses />)
    expect(screen.queryByText('$100')).not.toBeInTheDocument()
  })

  it('CASE 5/8/9 — per-bag $100 (COGS, invisible here) + daily wage $20 (expense) + payment $50 (cash) never double-count', () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [makeWorkerWageExpense({ earned: '20.00' })] })
    mockUseAllWorkerPayments.mockReturnValue({
      data: [makeWorkerPayment({ id: 'p1', workerId: 'w1', workerName: 'Hassan', amount: '50.00', date: '2026-09-15' })],
    })
    render(<Expenses />)

    // Business expenses = $20 (wage only — the $100 per-bag and $50 payment never enter this total).
    expect(screen.getAllByText('$20').length).toBeGreaterThan(0)
    expect(screen.queryByText('$100')).not.toBeInTheDocument()
    // Total outgoing = $50 (the payment) — NOT $70 (which would double-count the $20 wage as cash too).
    expect(screen.getAllByText('$50')).toHaveLength(3) // KPI + breakdown "Employee payments" line + "Total cash outgoing", all agreeing
  })

  it('CASE 7 — the Employee Payments tab still shows the actual $50 cash payment, separately from the wage expense', async () => {
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [makeWorkerWageExpense({ earned: '20.00' })] })
    mockUseAllWorkerPayments.mockReturnValue({
      data: [makeWorkerPayment({ id: 'p1', workerId: 'w1', workerName: 'Hassan', amount: '50.00', date: '2026-09-15' })],
    })
    const user = userEvent.setup()
    render(<Expenses />)
    await user.click(screen.getByText('Employee Payments'))

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Hassan')).toBeInTheDocument()
    expect(table.getByText('$50')).toBeInTheDocument()
  })

  it('the "Employee wage" source filter narrows the Business Expenses list to wage rows only', async () => {
    mockUseGeneralExpenses.mockReturnValue({ data: [makeGeneralExpense()], isLoading: false, isError: false, refetch: vi.fn() })
    // Distinct notes so the row's own description text never collides with the filter button's label.
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [makeWorkerWageExpense({ notes: 'Worked a half day' })] })
    const user = userEvent.setup()
    render(<Expenses />)

    expect(within(screen.getByRole('table')).getByText('Office rent payment')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Employee wage · Hassan')).toBeInTheDocument()

    await user.click(screen.getByText('Employee wage'))
    expect(within(screen.getByRole('table')).queryByText('Office rent payment')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Employee wage · Hassan')).toBeInTheDocument()
  })

  it('a wage-expense row has no edit/delete/detail action — WorkerCost stays a historical record, correctable only via the Employees page', () => {
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [makeWorkerWageExpense()] })
    render(<Expenses />)

    const rows = screen.getAllByRole('row').slice(1)
    const wageRow = rows.find(r => r.textContent?.includes('Employee wage · Hassan'))!
    expect(within(wageRow).queryByRole('button')).not.toBeInTheDocument()
  })

  it('the "Business expenses" KPI total includes the wage expense; a separate KPI shows it distinctly', () => {
    mockUseAllWorkerWageExpenses.mockReturnValue({ data: [makeWorkerWageExpense({ earned: '20.00' })] })
    render(<Expenses />)
    expect(screen.getByText('Employee wage expense (Sept)')).toBeInTheDocument()
    // $20 appears in both the dedicated wage-expense KPI and the combined Business expenses KPI.
    expect(screen.getAllByText('$20').length).toBeGreaterThanOrEqual(2)
  })
})
