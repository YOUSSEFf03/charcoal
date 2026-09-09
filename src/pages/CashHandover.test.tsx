// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { toDateOnlyString } from '../lib/date'

// ---------------------------------------------------------------------------
// Money Handover History redesign — the previous history section had no
// search, no pagination UI at all (hardcoded limit:50, dateFrom silently
// derived from the reconciliation day-picker's month), no error state, and
// only showed the receiverName snapshot (never the live receiver/loggedBy
// relations the backend already returns). This covers the rebuilt history
// table's search/date-filter/pagination/loading/error/empty behavior,
// matching the same architecture already proven on the Invoices page.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, children }: { title?: string; children?: ReactNode }) => (
    <div><span>{title}</span>{children}</div>
  ),
}))

vi.mock('../hooks/useWarehouse', () => ({
  useStockExits: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
}))

const mockUseCashHandovers = vi.fn()
const mockUseAllBalances = vi.fn()
const mockUseReceiverBalance = vi.fn()
const mockCreateHandoverMutate = vi.fn()
vi.mock('../hooks/useCashHandover', () => ({
  useDailyPayments: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useAllBalances: () => mockUseAllBalances(),
  useReceiverBalance: (id: string) => mockUseReceiverBalance(id),
  useCreateCashHandover: () => ({ mutate: mockCreateHandoverMutate, isPending: false }),
  useCashHandovers: (params: unknown) => mockUseCashHandovers(params),
}))

const FUEL_CATEGORY = { id: 'cat-fuel', name: 'Fuel' }
// Mutable so a simulated create-category call can extend the list, mirroring
// what the real query-invalidation-triggered refetch would return — a plain
// static mock would leave a newly "created" category permanently absent from
// its own dropdown's <option> list.
let mockCategoriesList: { id: string; name: string }[] = [FUEL_CATEGORY]
const mockCreateCategoryMutateAsync = vi.fn()
vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({ data: mockCategoriesList, isLoading: false }),
  useCreateExpenseCategory: () => ({ mutateAsync: mockCreateCategoryMutateAsync, isPending: false }),
}))

import CashHandover from './CashHandover'

function makeHandover(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    date: '2026-08-10',
    receiverName: 'Snapshot Name',
    receiverId: 'user-1',
    receiver: { id: 'user-1', name: 'Real Receiver' },
    expectedAmt: '500.00',
    handedAmt: '480.00',
    difference: '-20.00',
    notes: 'End of day',
    loggedById: 'logger-1',
    loggedBy: { id: 'logger-1', name: 'Accountant Amal' },
    createdAt: '2026-08-10T18:00:00.000Z',
    expenses: [],
    ...overrides,
  }
}

async function openHistory() {
  const user = userEvent.setup()
  render(<CashHandover />)
  await user.click(screen.getByRole('button', { name: /^History$/ }))
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseCashHandovers.mockReturnValue({ data: { data: [], total: 0, page: 1, limit: 20 }, isLoading: false, isError: false, refetch: vi.fn() })
  mockUseAllBalances.mockReturnValue({ data: [], isLoading: false })
  mockUseReceiverBalance.mockReturnValue({ data: undefined, isLoading: false })
  mockCategoriesList = [FUEL_CATEGORY]
})

describe('CashHandover — History', () => {
  it('loads history through useCashHandovers with server-side pagination params (page, limit) — not an unbounded fetch', async () => {
    await openHistory()

    expect(mockUseCashHandovers).toHaveBeenCalled()
    const params = mockUseCashHandovers.mock.calls[mockUseCashHandovers.mock.calls.length - 1][0]
    expect(params).toMatchObject({ page: 1, limit: 20 })
  })

  it('defaults to a "This month" date range, independent of the reconciliation day picker', async () => {
    await openHistory()

    const params = mockUseCashHandovers.mock.calls[mockUseCashHandovers.mock.calls.length - 1][0]
    // toDateOnlyString (local calendar-day parts) is the correct basis here —
    // NOT toISOString().slice(0,10), which rolls the date back a day in a
    // timezone ahead of UTC (e.g. Beirut, UTC+3) and would make this
    // assertion silently agree with the exact bug it's meant to catch.
    const now = new Date()
    const expectedFrom = toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1))
    expect(params.dateFrom).toBe(expectedFrom)
  })

  it('search box debounces into a server-side search param', async () => {
    const user = await openHistory()

    await user.type(screen.getByPlaceholderText('Search receiver or notes…'), 'walid')

    await waitFor(() => {
      const params = mockUseCashHandovers.mock.calls[mockUseCashHandovers.mock.calls.length - 1][0]
      expect(params.search).toBe('walid')
    })
  })

  it('changing the date range to "All time" clears both date bounds and resets to page 1', async () => {
    const user = await openHistory()

    await user.selectOptions(screen.getByDisplayValue('This month'), 'All time')

    await waitFor(() => {
      const params = mockUseCashHandovers.mock.calls[mockUseCashHandovers.mock.calls.length - 1][0]
      expect(params.dateFrom).toBeUndefined()
      expect(params.dateTo).toBeUndefined()
      expect(params.page).toBe(1)
    })
  })

  it('Previous/Next pagination controls move pages and respect the bounds', async () => {
    mockUseCashHandovers.mockReturnValue({
      data: { data: [makeHandover()], total: 45, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = await openHistory()

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Next/ }))

    await waitFor(() => {
      const params = mockUseCashHandovers.mock.calls[mockUseCashHandovers.mock.calls.length - 1][0]
      expect(params.page).toBe(2)
    })
  })

  it('shows the live receiver relation, not the historical snapshot, when both are present', async () => {
    mockUseCashHandovers.mockReturnValue({
      data: { data: [makeHandover()], total: 1, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    await openHistory()

    expect(screen.getByText('Real Receiver')).toBeInTheDocument()
    expect(screen.queryByText('Snapshot Name')).not.toBeInTheDocument()
  })

  it('falls back to the receiverName snapshot for legacy rows with no live receiver relation', async () => {
    mockUseCashHandovers.mockReturnValue({
      data: { data: [makeHandover({ receiver: null, receiverId: null })], total: 1, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    await openHistory()

    expect(screen.getByText('Snapshot Name')).toBeInTheDocument()
  })

  it('shows who logged the handover (loggedBy), a column the previous history table never had', async () => {
    mockUseCashHandovers.mockReturnValue({
      data: { data: [makeHandover()], total: 1, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    await openHistory()

    expect(screen.getByText('Accountant Amal')).toBeInTheDocument()
  })

  it('shows amounts with a currency symbol — cash handovers are USD-only throughout this app (no currency field on the model)', async () => {
    mockUseCashHandovers.mockReturnValue({
      data: { data: [makeHandover()], total: 1, page: 1, limit: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    await openHistory()

    expect(screen.getByText('$480.00')).toBeInTheDocument()
    expect(screen.getByText('$500.00')).toBeInTheDocument()
  })

  it('shows a skeleton while loading, not an empty table flash', async () => {
    mockUseCashHandovers.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    await openHistory()

    expect(screen.queryByText(/No handovers/)).not.toBeInTheDocument()
  })

  it('distinguishes "no records at all" from "no results for the current filters"', async () => {
    mockUseCashHandovers.mockReturnValue({ data: { data: [], total: 0, page: 1, limit: 20 }, isLoading: false, isError: false, refetch: vi.fn() })
    const user = await openHistory()

    // The default view ("This month") is itself a real date filter — an
    // empty result there honestly means "no results for this filter", since
    // older handovers could still exist. Only with every filter cleared
    // ("All time", no search) does an empty result mean no records ever.
    await user.selectOptions(screen.getByDisplayValue('This month'), 'All time')
    await waitFor(() => expect(screen.getByText('No handovers recorded yet.')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('Search receiver or notes…'), 'nomatch')
    await waitFor(() => expect(screen.getByText('No handovers match this filter.')).toBeInTheDocument())
  })

  it('shows an honest error state with a retry action — never a silently empty table on failure', async () => {
    const refetch = vi.fn()
    mockUseCashHandovers.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    const user = await openHistory()

    expect(screen.getByText('Failed to load handover history.')).toBeInTheDocument()
    expect(screen.queryByText(/No handovers/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Retry/ }))
    expect(refetch).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-30): "$40 expense reduces the day's EXPECTED
// HANDOVER on screen but the receiver's underlying cash balance shows $40
// left over the next day." The root cause was backend-only (the ledger debit
// at handover time never included itemized expenses — fixed in
// CashHandoversService.create()); these tests prove the FRONTEND side of the
// contract was already correct and stays correct: the "Expected handover"
// display already subtracts expenses from the receiver's balance (CASE 6,
// pre-handover), and the receiver balance card already renders whatever
// balance the backend reports — including the correct $0 post-fix (CASE 8).
// ---------------------------------------------------------------------------
describe('CashHandover — Reconciliation panel (forensic audit, 2026-08-30)', () => {
  async function selectReceiver(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByText(name))
  }

  it('CASE 6 — no physical handover yet: $500 held, $40 expense logged → "Expected handover" shows $460', async () => {
    mockUseAllBalances.mockReturnValue({
      data: [{ userId: 'user-1', name: 'youssef', role: 'sales_rep', balance: '500.00' }],
      isLoading: false,
    })
    mockUseReceiverBalance.mockReturnValue({
      data: { receiverId: 'user-1', receiverName: 'youssef', balance: '500.00', total: '500.00', payments: [], exits: [], lastHandover: null },
      isLoading: false,
    })

    const user = userEvent.setup()
    render(<CashHandover />)
    await selectReceiver(user, 'youssef')

    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.selectOptions(screen.getByRole('combobox'), FUEL_CATEGORY.id)
    const amountInputs = screen.getAllByRole('spinbutton')
    const expenseAmountInput = amountInputs.find(el => (el as HTMLInputElement).placeholder !== '0.00') ?? amountInputs[0]
    await user.type(expenseAmountInput, '40')

    await waitFor(() => {
      // Reconciliation total reflects held(500) − expense(40) — the exact
      // value the receiver's ledger must also settle to $0 against once the
      // handover is confirmed (proven server-side in
      // cash-handovers.service.spec.ts / cash-handover-expenses.integration-spec.ts).
      // (The KPI row above shows the same figure rounded to whole dollars —
      // "$460" — so "$460.00" uniquely identifies the reconciliation total.)
      expect(screen.getByText('$460.00')).toBeInTheDocument()
    })
  })

  it('CASE 8 — after a settled handover, reselecting the receiver shows a $0 balance and the "no uncollected cash" empty state', async () => {
    mockUseAllBalances.mockReturnValue({ data: [], isLoading: false }) // fixed: $0 balance no longer appears in pending balances
    mockUseReceiverBalance.mockReturnValue({
      data: { receiverId: 'user-1', receiverName: 'youssef', balance: '0.00', total: '0.00', payments: [], exits: [], lastHandover: '2026-08-29T18:00:00.000Z' },
      isLoading: false,
    })

    render(<CashHandover />)

    // Pending-balances card is empty — youssef is no longer listed as holding cash.
    expect(screen.getByText(/no one is holding unaccounted cash/i)).toBeInTheDocument()
  })

  it('confirming a handover sends the itemized expenses alongside expectedAmt/handedAmt — same payload the backend now settles against the ledger', async () => {
    mockUseAllBalances.mockReturnValue({
      data: [{ userId: 'user-1', name: 'youssef', role: 'sales_rep', balance: '500.00' }],
      isLoading: false,
    })
    mockUseReceiverBalance.mockReturnValue({
      data: { receiverId: 'user-1', receiverName: 'youssef', balance: '500.00', total: '500.00', payments: [], exits: [], lastHandover: null },
      isLoading: false,
    })

    const user = userEvent.setup()
    render(<CashHandover />)
    await selectReceiver(user, 'youssef')

    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.selectOptions(screen.getByRole('combobox'), FUEL_CATEGORY.id)
    const amountInputs = screen.getAllByRole('spinbutton')
    const expenseAmountInput = amountInputs.find(el => (el as HTMLInputElement).placeholder !== '0.00') ?? amountInputs[0]
    await user.type(expenseAmountInput, '40')

    const handoverInput = screen.getByPlaceholderText('0.00')
    await user.type(handoverInput, '460')

    await user.click(screen.getByRole('button', { name: /Confirm handover/ }))
    await user.click(screen.getByRole('button', { name: /Confirm & log handover/ }))

    expect(mockCreateHandoverMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverId: 'user-1',
        expectedAmt: '460.00',
        handedAmt: '460.00',
        expenses: [{ categoryId: FUEL_CATEGORY.id, amount: '40.00' }],
      }),
      expect.anything(),
    )
  })

  // ---------------------------------------------------------------------------
  // Forensic audit (2026-08-31): "Expenses + Cash Handover expense selection
  // redesign" — the expense field now selects an existing reusable category
  // (or creates one via "+ Add new expense") instead of free text.
  // ---------------------------------------------------------------------------
  it('CASE 9 — "+ Add new expense" creates a category and selects it on the row', async () => {
    mockCreateCategoryMutateAsync.mockImplementation(async (name: string) => {
      const cat = { id: 'cat-new', name }
      mockCategoriesList = [...mockCategoriesList, cat]
      return cat
    })
    mockUseAllBalances.mockReturnValue({
      data: [{ userId: 'user-1', name: 'youssef', role: 'sales_rep', balance: '500.00' }],
      isLoading: false,
    })
    mockUseReceiverBalance.mockReturnValue({
      data: { receiverId: 'user-1', receiverName: 'youssef', balance: '500.00', total: '500.00', payments: [], exits: [], lastHandover: null },
      isLoading: false,
    })

    const user = userEvent.setup()
    render(<CashHandover />)
    await selectReceiver(user, 'youssef')
    await user.click(screen.getByRole('button', { name: /Add/ }))

    await user.selectOptions(screen.getByRole('combobox'), '__new__')
    await user.type(screen.getByPlaceholderText('e.g. Vehicle Repair'), 'Vehicle Repair')
    await user.click(screen.getByRole('button', { name: /Add category/ }))

    await waitFor(() => {
      expect(mockCreateCategoryMutateAsync).toHaveBeenCalledWith('Vehicle Repair')
    })
    // The row now shows the newly-created category selected.
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('cat-new')
    })
  })

  it('CASE 10 — selecting an existing category twice creates two occurrences of it, not two categories', async () => {
    mockUseAllBalances.mockReturnValue({
      data: [{ userId: 'user-1', name: 'youssef', role: 'sales_rep', balance: '500.00' }],
      isLoading: false,
    })
    mockUseReceiverBalance.mockReturnValue({
      data: { receiverId: 'user-1', receiverName: 'youssef', balance: '500.00', total: '500.00', payments: [], exits: [], lastHandover: null },
      isLoading: false,
    })

    const user = userEvent.setup()
    render(<CashHandover />)
    await selectReceiver(user, 'youssef')

    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.click(screen.getByRole('button', { name: /Add/ }))
    const [row1, row2] = screen.getAllByRole('combobox')
    await user.selectOptions(row1, FUEL_CATEGORY.id)
    await user.selectOptions(row2, FUEL_CATEGORY.id)
    const amountInputs = screen.getAllByRole('spinbutton').filter(el => (el as HTMLInputElement).placeholder !== '0.00')
    await user.type(amountInputs[0], '20')
    await user.type(amountInputs[1], '15')

    const handoverInput = screen.getByPlaceholderText('0.00')
    await user.type(handoverInput, '465')
    await user.click(screen.getByRole('button', { name: /Confirm handover/ }))
    await user.click(screen.getByRole('button', { name: /Confirm & log handover/ }))

    expect(mockCreateHandoverMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        expenses: [
          { categoryId: FUEL_CATEGORY.id, amount: '20.00' },
          { categoryId: FUEL_CATEGORY.id, amount: '15.00' },
        ],
      }),
      expect.anything(),
    )
    // Never created a new category — both rows reused the existing one.
    expect(mockCreateCategoryMutateAsync).not.toHaveBeenCalled()
  })
})
