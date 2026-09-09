// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Employee Detail audit (2026-09-05): "History" is replaced by a Statement of
// Account ledger (date/description/earned/paid/running balance), backed by
// WorkersService.getStatement() — the SAME authoritative WorkerCost/
// PackingSession/WorkerPayment records, never a second accounting
// calculation.
//
// Month-based audit (2026-09-06): the statement now defaults to, and is
// primarily navigated by, calendar MONTH — never "All time" by default.
// Test matrix below maps to both audits' required CASEs.
// ---------------------------------------------------------------------------

/** Same date-only formatting as src/lib/date.ts's toDateOnlyString — local
 *  calendar parts, never toISOString() (which can roll back a day). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** The exact {dateFrom, dateTo} the component computes for the calendar
 *  month `monthsFromNow` away from today (0 = this month, -1 = last month). */
function monthRange(monthsFromNow: number): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + monthsFromNow
  return {
    dateFrom: ymd(new Date(y, m, 1)),
    dateTo: ymd(new Date(y, m + 1, 0)),
  }
}

// The worker-detail view's back control now goes through Topbar's `back`
// prop (a callback here, not a route, since it's an in-page view toggle back
// to the employee list) instead of the old inline `.back-btn` — this mock
// renders it the same way the real Topbar does so "Back to employees" stays
// covered.
vi.mock('../components/layout/Topbar', () => ({
  default: ({ back, children }: { title?: string; back?: { label: string; to: string | (() => void) }; children?: ReactNode }) => (
    <div>
      {back && (
        <button onClick={() => (typeof back.to === 'function' ? back.to() : undefined)}>{back.label}</button>
      )}
      {children}
    </div>
  ),
}))

const mockShowToast = vi.fn()
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const mockUseWorkers = vi.fn()
const mockCreateWorkerMutate = vi.fn()
const mockUpdateWorkerMutateAsync = vi.fn()
const mockDeleteWorkerMutate = vi.fn()
const mockLogPaymentMutate = vi.fn()
const mockCreateEarningMutate = vi.fn()
const mockLogDailyWageMutate = vi.fn()
const mockUpdateRatesMutateAsync = vi.fn()
const mockUseWorkerStatement = vi.fn()
const mockUseWorkerPerformance = vi.fn()
const mockUseWorkerPaymentsInPeriod = vi.fn()

vi.mock('../hooks/useWorkers', () => ({
  useWorkers: () => mockUseWorkers(),
  useCreateWorker: () => ({ mutate: mockCreateWorkerMutate, isPending: false }),
  useLogWorkerPayment: () => ({ mutate: mockLogPaymentMutate, isPending: false }),
  useUpdateWorker: () => ({ mutateAsync: mockUpdateWorkerMutateAsync, isPending: false }),
  useDeleteWorker: () => ({ mutate: mockDeleteWorkerMutate, isPending: false }),
  useCreateWorkerEarning: () => ({ mutate: mockCreateEarningMutate, isPending: false }),
  useLogDailyWage: () => ({ mutate: mockLogDailyWageMutate, isPending: false }),
  useWorkerStatement: (id: string | undefined, params: unknown) => mockUseWorkerStatement(id, params),
  useUpdateWorkerRates: () => ({ mutateAsync: mockUpdateRatesMutateAsync, isPending: false }),
  useWorkerPerformance: (id: string | undefined, params: unknown) => mockUseWorkerPerformance(id, params),
  useWorkerPaymentsInPeriod: (id: string | undefined, params: unknown) => mockUseWorkerPaymentsInPeriod(id, params),
}))

const mockUseBagTypes = vi.fn()
vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => mockUseBagTypes(),
}))

import Employees from './Employees'

function makeWorker(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    name: 'Ahmad',
    phone: null,
    ratesPerBagType: [{ bagTypeId: 'bt1', ratePerBag: '0.1000' }],
    totalBagsPacked: [],
    totalEarned: '62.00',
    totalPaid: '30.00',
    totalOwed: '32.00',
    pieceEarned: '22.00',
    costEarned: '40.00',
    notes: 'Reliable packer',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeBagType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bt1', name: '10kg Bag', nominalKg: '10.000', costPerBag: '0.4000',
    workerRate: '0.1000', note: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** The task's own worked example: daily wage, two packing sessions, one payment. */
function makeStatement(overrides: Record<string, unknown> = {}) {
  return {
    workerId: 'w1',
    openingBalance: '0.00',
    entries: [
      { date: '2026-09-05', type: 'earning', source: 'cost', reference: 'c1', category: 'daily_wage', notes: null, earned: '20.00', paid: '0.00', runningBalance: '20.00' },
      { date: '2026-09-08', type: 'earning', source: 'session', reference: 's1', earned: '12.00', paid: '0.00', runningBalance: '32.00' },
      { date: '2026-09-08', type: 'earning', source: 'session', reference: 's2', earned: '10.00', paid: '0.00', runningBalance: '42.00' },
      { date: '2026-09-10', type: 'payment', source: 'payment', reference: 'p1', method: 'cash', referenceNumber: null, notes: null, earned: '0.00', paid: '30.00', runningBalance: '12.00' },
    ],
    balance: '12.00',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseWorkers.mockReturnValue({ data: [makeWorker()], isLoading: false, isError: false })
  mockUseBagTypes.mockReturnValue({ data: [makeBagType()], isLoading: false })
  mockUseWorkerStatement.mockReturnValue({ data: makeStatement(), isLoading: false, isError: false })
  // Default: no performance data loaded — the Performance section's period
  // nav/toggle still render (see the tests below that exercise it), but its
  // data cards stay hidden (`{perf && (...)}`), so pre-existing Statement-
  // only tests are unaffected.
  mockUseWorkerPerformance.mockReturnValue({ data: undefined, isLoading: false, isError: false })
  mockUseWorkerPaymentsInPeriod.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false, isError: false })
})

async function openAhmad(user: ReturnType<typeof userEvent.setup>) {
  render(<Employees />)
  await user.click(screen.getByText('Ahmad'))
}

describe('Employee Detail — Statement of Account', () => {
  it('CASE 1 — shows earned, paid, and running balance for existing earnings and payments', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    const rows = screen.getAllByRole('row').slice(1) // drop header
    const dailyWageRow = rows.find(r => r.textContent?.includes('Daily wage'))!
    const paymentRow   = rows.find(r => r.textContent?.includes('Payment'))!
    expect(dailyWageRow.querySelector('.dr')?.textContent).toBe('$20.00') // daily wage earned
    expect(dailyWageRow.querySelector('.bal-pos')?.textContent).toBe('$20.00') // running balance after it
    expect(paymentRow.querySelector('.cr')?.textContent).toBe('$30.00') // payment paid
    expect(paymentRow.querySelector('.bal-pos')?.textContent).toBe('$12.00') // closing running balance
  })

  it('CASE 2 — packing (per-bag), daily wage, and payment entries all appear with correct descriptions', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Daily wage')).toBeInTheDocument()
    expect(table.getAllByText('Packing session')).toHaveLength(2)
    expect(table.getByText('Payment · Cash')).toBeInTheDocument()
  })

  it('CASE 3 — every payment appears as its own row, none merged', async () => {
    mockUseWorkerStatement.mockReturnValue({
      data: makeStatement({
        entries: [
          { date: '2026-09-10', type: 'payment', source: 'payment', reference: 'p1', method: 'cash', referenceNumber: null, notes: null, earned: '0.00', paid: '10.00', runningBalance: '-10.00' },
          { date: '2026-09-24', type: 'payment', source: 'payment', reference: 'p2', method: 'whish', referenceNumber: null, notes: null, earned: '0.00', paid: '42.00', runningBalance: '-52.00' },
        ],
        balance: '-52.00',
      }),
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openAhmad(user)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Payment · Cash')).toBeInTheDocument()
    expect(table.getByText('Payment · Whish')).toBeInTheDocument()
  })

  it('CASE 4 — running balance equals cumulative earned minus cumulative paid, never silently clamped when negative', async () => {
    mockUseWorkerStatement.mockReturnValue({
      data: makeStatement({
        entries: [
          { date: '2026-09-01', type: 'payment', source: 'payment', reference: 'p1', method: 'cash', referenceNumber: null, notes: null, earned: '0.00', paid: '150.00', runningBalance: '-150.00' },
        ],
        balance: '-150.00',
      }),
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openAhmad(user)

    // formatUsd is sign-aware — a negative balance renders as "-$150.00", never clamped to $0.
    expect(screen.getAllByText('-$150.00').length).toBeGreaterThan(0)
  })

  it('CASE 5 — the default (current-month) view shows a real (non-zero) opening balance row, never a fake $0 start', async () => {
    mockUseWorkerStatement.mockReturnValue({
      data: { workerId: 'w1', openingBalance: '50.00', entries: makeStatement().entries, balance: '50.00' },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openAhmad(user)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Opening balance')).toBeInTheDocument()
    // $50.00 appears in the opening-balance row AND the stmt-summary card.
    expect(screen.getAllByText('$50.00').length).toBeGreaterThanOrEqual(2)
  })

  it('"View all time" hides the opening-balance ROW in the ledger table (the always-shown summary card is a separate element) and returns via "Return to monthly view"', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    expect(within(screen.getByRole('table')).getByText('Opening balance')).toBeInTheDocument() // present by default (month mode)

    await user.click(screen.getByText('View all time'))
    expect(within(screen.getByRole('table')).queryByText('Opening balance')).not.toBeInTheDocument()
    expect(mockUseWorkerStatement).toHaveBeenLastCalledWith('w1', { dateFrom: undefined, dateTo: undefined })

    await user.click(screen.getByText('Return to monthly view'))
    expect(within(screen.getByRole('table')).getByText('Opening balance')).toBeInTheDocument()
    expect(mockUseWorkerStatement).toHaveBeenLastCalledWith('w1', monthRange(0))
  })

  it('CASE 13 — an earning row never has a paid amount, and a payment row never has an earned amount', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    const rows = screen.getAllByRole('row').slice(1) // drop header
    const dailyWageRow = rows.find(r => r.textContent?.includes('Daily wage'))!
    const paymentRow = rows.find(r => r.textContent?.includes('Payment'))!
    // Daily wage row: earned cell is populated, paid ("cr") cell renders blank (amount is '0.00').
    expect(dailyWageRow.querySelector('.dr')?.textContent).toBe('$20.00')
    expect(dailyWageRow.querySelector('.cr')?.textContent).toBe('')
    // Payment row: paid cell is populated, earned ("dr") cell renders blank.
    expect(paymentRow.querySelector('.cr')?.textContent).toBe('$30.00')
    expect(paymentRow.querySelector('.dr')?.textContent).toBe('')
  })

  it('no transactions this month: shows an honest empty state naming the month, never a generic message', async () => {
    mockUseWorkerStatement.mockReturnValue({ data: makeStatement({ entries: [], balance: '0.00' }), isLoading: false, isError: false })
    const user = userEvent.setup()
    await openAhmad(user)
    const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    expect(screen.getByText(new RegExp(`No earnings or payments in ${monthLabel}`))).toBeInTheDocument()
  })

  it('no transactions at all: "All time" shows the generic empty state', async () => {
    mockUseWorkerStatement.mockReturnValue({ data: makeStatement({ entries: [], balance: '0.00' }), isLoading: false, isError: false })
    const user = userEvent.setup()
    await openAhmad(user)
    await user.click(screen.getByText('View all time'))
    expect(screen.getByText(/No earnings or payments recorded yet/)).toBeInTheDocument()
  })
})

describe('Employee Detail — month-based Statement of Account (business requirement, 2026-09-06)', () => {
  it('CASE 1 — defaults to the CURRENT month, never "All time"', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    expect(screen.getAllByText(monthLabel).length).toBeGreaterThan(0)
    expect(mockUseWorkerStatement).toHaveBeenCalledWith('w1', monthRange(0))
  })

  it('CASE 2 — clicking "Previous month" reloads the statement for the previous calendar month', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    mockUseWorkerStatement.mockClear()

    await user.click(screen.getByTitle('Previous month'))

    expect(mockUseWorkerStatement).toHaveBeenLastCalledWith('w1', monthRange(-1))
  })

  it('CASE 3 — navigating back then forward returns to the current month\'s statement', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    await user.click(screen.getByTitle('Previous month'))
    await user.click(screen.getByTitle('Previous month'))
    expect(mockUseWorkerStatement).toHaveBeenLastCalledWith('w1', monthRange(-2))

    await user.click(screen.getByTitle('Next month'))
    expect(mockUseWorkerStatement).toHaveBeenLastCalledWith('w1', monthRange(-1))
  })

  it('CASE 4/5 — a month with no transactions still shows the correct (non-zero) opening AND closing balance, never a misleading $0', async () => {
    mockUseWorkerStatement.mockReturnValue({
      data: { workerId: 'w1', openingBalance: '60.00', entries: [], balance: '60.00' },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openAhmad(user)
    await user.click(screen.getByTitle('Next month')) // e.g. Sep → Oct, no transactions yet

    expect(screen.getAllByText('$60.00').length).toBeGreaterThanOrEqual(2) // opening row + closing summary cell
  })

  it('CASE 6/7 — monthly earned/paid totals reflect only the SELECTED month\'s entries', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    // makeStatement(): 20 + 12 + 10 earned = 42.00; 30.00 paid.
    const summary = screen.getByText('Earned this month').parentElement!
    expect(within(summary).getByText('$42.00')).toBeInTheDocument()
    const paidSummary = screen.getByText('Paid this month').parentElement!
    expect(within(paidSummary).getByText('$30.00')).toBeInTheDocument()
  })

  it('the top-level lifetime totals (Outstanding balance / Total earned / Total paid) never change when navigating statement months', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    // Ahmad fixture: totalOwed 32.00, totalEarned 62.00, totalPaid 30.00 (all-time).
    const lifetimeSummary = () => document.querySelector('.earn-breakdown') as HTMLElement
    expect(within(lifetimeSummary()).getByText('$32.00')).toBeInTheDocument()
    expect(within(lifetimeSummary()).getByText('$62.00')).toBeInTheDocument()

    await user.click(screen.getByTitle('Previous month'))

    expect(within(lifetimeSummary()).getByText('$32.00')).toBeInTheDocument()
    expect(within(lifetimeSummary()).getByText('$62.00')).toBeInTheDocument()
  })

  it('CASE 9 — "Daily wage" always logs TODAY\'S real date, even while viewing a previous month', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    await user.click(screen.getByTitle('Previous month')) // now viewing last month

    await user.click(screen.getAllByText('Daily wage')[0])

    const todayStr = ymd(new Date())
    expect(mockLogDailyWageMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w1', body: { date: todayStr } }),
      expect.any(Object),
    )
  })
})

describe('Employee Detail — Daily wage button', () => {
  it('CASE 6/7 — pressing "Daily wage" logs it via the authoritative mutation, using today\'s local date', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    await user.click(screen.getAllByText('Daily wage')[0])

    expect(mockLogDailyWageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'w1',
        body: expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      }),
      expect.any(Object),
    )
  })

  it('CASE 8 — a duplicate-day rejection shows the backend\'s own message via toast, not a generic error', async () => {
    mockLogDailyWageMutate.mockImplementation((_vars, opts) => {
      opts.onError({ error: 'Daily wage already recorded for today.', code: 'DAILY_WAGE_ALREADY_RECORDED' })
    })
    const user = userEvent.setup()
    await openAhmad(user)

    await user.click(screen.getAllByText('Daily wage')[0])

    expect(mockShowToast).toHaveBeenCalledWith('Daily wage already recorded for today.')
  })
})

describe('Employee Detail — Edit employee', () => {
  it('CASE 10 — opening Edit pre-fills name, phone, notes, and every bag type\'s current rate', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    await user.click(screen.getByText('Edit'))

    expect(screen.getByDisplayValue('Ahmad')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Reliable packer')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.1000')).toBeInTheDocument() // bt1's existing rate
    expect(screen.getByText('10kg Bag')).toBeInTheDocument()
  })

  it('CASE 10 — saving calls both the profile update and the full rate replacement', async () => {
    mockUpdateWorkerMutateAsync.mockResolvedValue(makeWorker())
    mockUpdateRatesMutateAsync.mockResolvedValue(makeWorker())
    const user = userEvent.setup()
    await openAhmad(user)

    await user.click(screen.getByText('Edit'))
    const notesInput = screen.getByDisplayValue('Reliable packer')
    await user.clear(notesInput)
    await user.type(notesInput, 'Updated notes')
    await user.click(screen.getByText('Save changes'))

    expect(mockUpdateWorkerMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w1', body: expect.objectContaining({ name: 'Ahmad', notes: 'Updated notes' }) }),
    )
    expect(mockUpdateRatesMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'w1',
        body: { ratesPerBagType: [{ bagTypeId: 'bt1', ratePerBag: '0.1000' }] },
      }),
    )
  })

  it('does not expose any control to edit or delete a historical statement entry', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    const table = within(screen.getByRole('table'))
    expect(table.queryByRole('button')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Employee Profile + Performance Analytics (2026-09-07). Authoritative
// source for every number below is WorkersService.getPerformance() (backend
// unit-tested exhaustively in workers.service.spec.ts) — these tests only
// verify the PROFILE renders exactly what that endpoint returns, and that
// the period selector drives it correctly. CASE numbers reference the
// task's own test matrix.
// ---------------------------------------------------------------------------

function makePerformance(overrides: Record<string, unknown> = {}) {
  return {
    workerId: 'w1',
    from: '2026-08-01',
    to: '2026-08-31',
    totals: {
      bagsPacked: 1270, sessions: 5, workingDays: 3,
      packingEarnings: '80.40',
      avgBagsPerWorkingDay: '423.33', avgBagsPerSession: '254.00',
      avgEarningsPerWorkingDay: '26.80', avgEarningsPerSession: '16.08',
    },
    byBagType: [
      { bagTypeId: 'bt2', bagTypeName: '2kg Bag', bags: 1100, ratePerBag: '0.0545', rateVaries: true, earned: '60.00', workingDays: 2, avgBagsPerWorkingDay: '550.00' },
      { bagTypeId: 'bt1', bagTypeName: '10kg Bag', bags: 170, ratePerBag: '0.1200', rateVaries: false, earned: '20.40', workingDays: 3, avgBagsPerWorkingDay: '56.67' },
    ],
    dailyPerformance: [
      { date: '2026-08-09', bagsPacked: 1050, sessions: 2, earned: '56.00' },
      { date: '2026-08-16', bagsPacked: 100, sessions: 1, earned: '10.00' },
    ],
    packingHistory: [
      { date: '2026-08-09', sessionId: 's1', bagTypeId: 'bt2', bagTypeName: '2kg Bag', quantity: 1000, ratePerBag: '0.0500', earned: '50.00' },
    ],
    dailyWages: [{ id: 'c1', date: '2026-08-09', amount: '20.00' }],
    paymentsTotal: '100.40',
    ...overrides,
  }
}

describe('Employee List & Profile navigation', () => {
  it('CASE 1 — employee list renders name, amount owed, and earned', () => {
    render(<Employees />)
    expect(screen.getByText('Ahmad')).toBeInTheDocument()
    expect(screen.getByText('$32.00 owed')).toBeInTheDocument()
    expect(screen.getByText('earned $62.00')).toBeInTheDocument()
  })

  it('CASE 2 — clicking an employee opens the employee profile', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    expect(screen.getByText('Back to employees')).toBeInTheDocument()
  })

  it('CASE 3 — profile shows the employee\'s name, phone, and notes (no invented fields)', async () => {
    mockUseWorkers.mockReturnValue({ data: [makeWorker({ phone: '+961 3 000 111' })], isLoading: false, isError: false })
    const user = userEvent.setup()
    await openAhmad(user)
    expect(screen.getByText('+961 3 000 111')).toBeInTheDocument()
  })
})

describe('Employee Profile — Performance Analytics', () => {
  beforeEach(() => {
    mockUseWorkerPerformance.mockReturnValue({ data: makePerformance(), isLoading: false, isError: false })
  })

  it('CASE 4/8 — performance summary shows authoritative total bags packed, working days, and sessions', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    expect(screen.getByText('1,270')).toBeInTheDocument() // bagsPacked
    expect(screen.getByText('Days worked').nextSibling?.textContent).toBe('3')
    expect(screen.getByText('Packing sessions').nextSibling?.textContent).toBe('5')
  })

  it('CASE 10/12 — average bags/working day and average earnings/working day come straight from the backend, never recomputed client-side', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    expect(screen.getByText('423.33')).toBeInTheDocument()
    expect(screen.getByText('$26.80')).toBeInTheDocument()
  })

  it('CASE 5/6/7/11 — bag-type breakdown table shows bags, rate/bag, earned, and avg/day per type, with a rate-varies indicator', async () => {
    const user = userEvent.setup()
    await openAhmad(user)

    const heading = screen.getByText('Performance by bag type')
    const section = heading.closest('.card') as HTMLElement
    const table = within(section)
    const rows = table.getAllByRole('row').slice(1)
    const twoKgRow = rows.find(r => r.textContent?.includes('2kg Bag'))!
    expect(twoKgRow.textContent).toContain('1,100')
    expect(twoKgRow.textContent).toContain('$0.05')
    expect(twoKgRow.textContent).toContain('$60.00')
    expect(twoKgRow.textContent).toContain('550')
    expect(twoKgRow.querySelector('[title*="Rate changed"]')).toBeInTheDocument() // rateVaries indicator
    const tenKgRow = rows.find(r => r.textContent?.includes('10kg Bag'))!
    expect(tenKgRow.querySelector('[title*="Rate changed"]')).not.toBeInTheDocument()
  })

  it('CASE 13 — daily performance table shows one combined row per date', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    const heading = screen.getByText('Daily performance')
    const table = within(heading.closest('.card') as HTMLElement)
    const rows = table.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('1,050')
    expect(rows[0].textContent).toContain('$56.00')
  })

  it('CASE 13 (packing history) — packing history table shows bag type name and the HISTORICAL rate, not the current one', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    const heading = screen.getByText('Packing history')
    const table = within(heading.closest('.card') as HTMLElement)
    expect(table.getByText('2kg Bag')).toBeInTheDocument()
    expect(table.getByText('$0.05')).toBeInTheDocument() // the session's snapshot, not bt1's current 0.10
  })

  it('CASE 14/15 — daily wages list shows authoritative WorkerCost(daily_wage) rows, separate from packing performance', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    const heading = screen.getByText('Daily wages')
    const table = within(heading.closest('.card') as HTMLElement)
    expect(table.getByText('Daily wage')).toBeInTheDocument()
    expect(table.getByText('$20.00')).toBeInTheDocument()
  })

  it('CASE 16 — payments section shows the period total and the WorkerPayment rows for that period', async () => {
    mockUseWorkerPaymentsInPeriod.mockReturnValue({
      data: { data: [{ id: 'p1', workerId: 'w1', amount: '100.40', method: 'cash', referenceNumber: null, date: '2026-08-09', notes: null, createdAt: '2026-08-09T00:00:00.000Z' }], total: 1 },
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openAhmad(user)
    const heading = screen.getByText('Payments')
    const section = within(heading.closest('.card') as HTMLElement)
    expect(section.getAllByText('$100.40').length).toBeGreaterThanOrEqual(1) // paymentsTotal header + row amount
    expect(section.getByText('Cash')).toBeInTheDocument()
  })

  it('CASE 24 — a period with no packing activity shows zero performance without breaking the account balance', async () => {
    mockUseWorkerPerformance.mockReturnValue({
      data: makePerformance({
        totals: { bagsPacked: 0, sessions: 0, workingDays: 0, packingEarnings: '0.00', avgBagsPerWorkingDay: null, avgBagsPerSession: null, avgEarningsPerWorkingDay: null, avgEarningsPerSession: null },
        byBagType: [], dailyPerformance: [], packingHistory: [], dailyWages: [], paymentsTotal: '0.00',
      }),
      isLoading: false, isError: false,
    })
    const user = userEvent.setup()
    await openAhmad(user)

    // Account summary (lifetime, unaffected by the empty performance period) — unchanged.
    const summary = within(screen.getByText('Outstanding balance').closest('.earn-breakdown') as HTMLElement)
    expect(summary.getByText('$32.00')).toBeInTheDocument()
    // Performance defaults to the CURRENT month (independent of the mocked
    // data's own from/to fields, which only describe what the backend was
    // asked for) — see the PerfMode default in Employees.tsx.
    const now = new Date()
    const currentMonthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    expect(screen.getByText(`No bags packed in ${currentMonthLabel}`)).toBeInTheDocument()
  })

  it('CASE 22/23 — "Previous performance month" requests the prior month, independent of the Statement\'s own period', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    mockUseWorkerPerformance.mockClear()

    await user.click(screen.getByTitle('Previous performance month'))

    const lastCall = mockUseWorkerPerformance.mock.calls[mockUseWorkerPerformance.mock.calls.length - 1]
    expect(lastCall[0]).toBe('w1')
    expect(lastCall[1].dateFrom).toBe(monthRange(-1).dateFrom)
    expect(lastCall[1].dateTo).toBe(monthRange(-1).dateTo)
    // The Statement's own period query must be untouched by this click.
    const statementCalls = mockUseWorkerStatement.mock.calls
    expect(statementCalls[statementCalls.length - 1][1]).toEqual(monthRange(0))
  })

  it('"View all-time performance" requests an unbounded range and switching back restores the current month', async () => {
    const user = userEvent.setup()
    await openAhmad(user)
    mockUseWorkerPerformance.mockClear()

    await user.click(screen.getByText('View all-time performance'))
    let lastCall = mockUseWorkerPerformance.mock.calls[mockUseWorkerPerformance.mock.calls.length - 1]
    expect(lastCall[1]).toEqual({ dateFrom: undefined, dateTo: undefined })

    await user.click(screen.getByText('Return to monthly performance'))
    lastCall = mockUseWorkerPerformance.mock.calls[mockUseWorkerPerformance.mock.calls.length - 1]
    expect(lastCall[1]).toEqual(monthRange(0))
  })
})
