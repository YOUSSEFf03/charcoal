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
vi.mock('../hooks/useCashHandover', () => ({
  useDailyPayments: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useAllBalances: () => ({ data: [], isLoading: false }),
  useReceiverBalance: () => ({ data: undefined, isLoading: false }),
  useCreateCashHandover: () => ({ mutate: vi.fn(), isPending: false }),
  useCashHandovers: (params: unknown) => mockUseCashHandovers(params),
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
