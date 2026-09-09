// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Fill Client overview redesign — regression coverage for the explicit
// product requirements:
//   1. Bags & Pricing stays the first section after the KPI hero (not pushed
//      below Statement/Pickups/Payment History).
//   2. The Statement of account SUMMARY remains on the overview, with a
//      "View full statement" link to the dedicated route — the full
//      transaction table itself has moved off the overview.
//   3. Activity Log never renders a raw ISO timestamp
//      ("2026-08-20T00:00:00.000Z") — it's the exact bug this redesign fixes.
//   4. Recent Pickups / Fill Jobs / Payments sections render with "View all"
//      navigation into the dedicated pages.
// ---------------------------------------------------------------------------

// Resolves `back` the same way the real Topbar does (navigate for a route
// string) so the fix moving FillClientDetail's "All fill clients" link out
// of the Topbar's right-side action row and into the proper `back` prop
// stays covered.
vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title: string; back?: { label: string; to: string | (() => void) }; children?: ReactNode }) => {
    const navigate = useNavigate()
    return (
      <div>
        <span>{title}</span>
        {back && (
          <button onClick={() => (typeof back.to === 'function' ? back.to() : navigate(back.to))}>{back.label}</button>
        )}
        {children}
      </div>
    )
  },
}))

const mockUseClient = vi.fn()
const mockUseClientBalance = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClient: (id: string) => mockUseClient(id),
  useClientBalance: (id: string) => mockUseClientBalance(id),
  useUpdateClient: () => ({ mutateAsync: vi.fn() }),
}))

const mockUsePayments = vi.fn()
const mockCreatePaymentMutateAsync = vi.fn().mockResolvedValue({ id: 'pay-new' })
vi.mock('../hooks/usePayments', () => ({
  usePayments: (params: unknown) => mockUsePayments(params),
  useCreatePayment: () => ({ mutateAsync: mockCreatePaymentMutateAsync }),
}))

vi.mock('../hooks/useWorkers', () => ({ useWorkers: () => ({ data: [] }) }))
const mockUseCashReceivers = vi.fn()
vi.mock('../hooks/useUsers', () => ({ useCashReceivers: () => mockUseCashReceivers() }))

const mockUseFillJobs = vi.fn()
const mockUseFillJobNetStock = vi.fn()
vi.mock('../hooks/useFillJobs', () => ({
  useFillJobs: (clientId: string, params: unknown) => mockUseFillJobs(clientId, params),
  useFillJobPriceStats: () => ({ data: {} }),
  useCreateFillJob: () => ({ mutateAsync: vi.fn() }),
  useConfirmFillPickup: () => ({ mutateAsync: vi.fn() }),
  useFillJobYtdSummary: () => ({ data: { bagsYTD: 40, jobCount: 3, wasteKg: '2.0', wastePct: 5, revenueYTD: '400.00', profitYTD: '100.00', marginYTD: 25, hasData: true } }),
  useFillJobNetStock: (clientId: string) => mockUseFillJobNetStock(clientId),
}))

const mockUseStockExits = vi.fn()
vi.mock('../hooks/useWarehouse', () => ({ useStockExits: (params: unknown) => mockUseStockExits(params) }))

const mockUseClientLedger = vi.fn()
vi.mock('../hooks/useReports', () => ({ useClientLedger: (id: string, params: unknown) => mockUseClientLedger(id, params) }))

vi.mock('../lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))

import FillClientDetail from './FillClientDetail'

function renderAt(id: string) {
  // FillClientDetail makes one direct useQuery() call (stock lots for the
  // fill-job modal) rather than going through a mocked hook wrapper, so it
  // needs a real QueryClientProvider in the tree (retries disabled so a
  // rejected mock doesn't retry into a slow/flaky test).
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/fill-clients/${id}`]}>
        <Routes>
          <Route path="/fill-clients" element={<div>Fill clients list page</div>} />
          <Route path="/fill-clients/:id" element={<FillClientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: { id: 'fc-1', name: 'Cedar Fill Co', currency: 'USD', type: 'fill_client', phones: [], createdAt: '2026-01-01T00:00:00.000Z' }, isLoading: false })
  mockUseClientBalance.mockReturnValue({ data: { balance: '250.00' }, isLoading: false })
  mockUsePayments.mockReturnValue({
    data: { data: [{ id: 'p1', date: '2026-08-20T00:00:00.000Z', method: 'cash', amount: '50.00', currency: 'USD', receiverName: 'Accountant Amal' }], total: 1 },
    isLoading: false,
  })
  mockUseFillJobs.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
  mockUseFillJobNetStock.mockReturnValue({ data: {}, isLoading: false })
  mockUseStockExits.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
  mockUseClientLedger.mockReturnValue({
    data: { openingBalance: '100.00', balance: '250.00', entries: [{ date: '2026-08-15', description: 'Fill pickup', debit: '200.00', credit: '0.00', runningBalance: '300.00' }] },
    isLoading: false,
  })
  mockUseCashReceivers.mockReturnValue({ data: [{ id: 'receiver-1', name: 'Marie', role: 'receiver' }] })
})

describe('FillClientDetail — back navigation', () => {
  it('"All fill clients" (now on Topbar\'s `back` prop, not the right-side action row) returns to /fill-clients', async () => {
    const user = userEvent.setup()
    renderAt('fc-1')
    await waitFor(() => expect(screen.getAllByText('Cedar Fill Co').length).toBeGreaterThan(0))

    await user.click(screen.getByText('All fill clients'))
    expect(screen.getByText('Fill clients list page')).toBeInTheDocument()
  })
})

describe('FillClientDetail overview', () => {
  it('Bags & pricing is the first section after the KPI hero — not pushed below Statement/Pickups/Payment History', () => {
    renderAt('fc-1')
    const titles = screen.getAllByText(/Bags & pricing|Statement of account|Recent pickups|Recent fill jobs|Recent payments/)
      .map(el => el.textContent)
    const bagsIdx = titles.findIndex(t => t?.includes('Bags & pricing'))
    const statementIdx = titles.findIndex(t => t?.includes('Statement of account'))
    const pickupsIdx = titles.findIndex(t => t?.includes('Recent pickups'))
    expect(bagsIdx).toBeGreaterThanOrEqual(0)
    expect(bagsIdx).toBeLessThan(statementIdx)
    expect(bagsIdx).toBeLessThan(pickupsIdx)
  })

  it('the Statement of account summary (opening/debit/credit/closing) remains on the overview', () => {
    renderAt('fc-1')
    expect(screen.getByText('Opening balance')).toBeInTheDocument()
    expect(screen.getByText('Closing balance')).toBeInTheDocument()
    expect(screen.getAllByText('$100.00').length).toBeGreaterThanOrEqual(1)
  })

  it('"View full statement" is present and does NOT render the full per-row transaction table on the overview', () => {
    renderAt('fc-1')
    expect(screen.getByText('View full statement')).toBeInTheDocument()
    // The full statement table has a "Description" column header — that
    // column belongs to the dedicated Statement page now, not the overview.
    expect(screen.queryByText('Description')).not.toBeInTheDocument()
  })

  it('Activity Log never shows a raw ISO timestamp — it always renders through formatDateTime', () => {
    renderAt('fc-1')
    expect(screen.queryByText(/2026-08-20T00:00:00\.000Z/)).not.toBeInTheDocument()
    expect(screen.getByText('20 Aug 2026')).toBeInTheDocument()
  })

  it('Recent pickups / Recent fill jobs / Recent payments sections each expose a "View all" action into their dedicated page', () => {
    renderAt('fc-1')
    expect(screen.getByText('Recent pickups')).toBeInTheDocument()
    expect(screen.getByText('Recent fill jobs')).toBeInTheDocument()
    expect(screen.getByText('Recent payments')).toBeInTheDocument()
    expect(screen.getAllByText('View all').length).toBe(2) // pickups + fill jobs
    expect(screen.getByText('View payment history')).toBeInTheDocument()
  })

  it('fetches only a small recent slice for the overview lists, not an unbounded history', () => {
    renderAt('fc-1')
    expect(mockUsePayments.mock.calls[0][0].limit).toBeLessThanOrEqual(10)
    expect(mockUseFillJobs.mock.calls[0][1].limit).toBeLessThanOrEqual(10)
    expect(mockUseStockExits.mock.calls[0][0].limit).toBeLessThanOrEqual(10)
  })

  it('Recent payments shows the receiver (falls back to receiverName when the receiver relation is absent)', () => {
    renderAt('fc-1')
    expect(screen.getByText('Accountant Amal')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Regression: the Fill Client "Log payment" modal previously let a payment be
// submitted with no receiver selected at all — a cash payment that was
// invisible to Cash Handover reconciliation even though a real person
// collected it. See CASH_MANAGEMENT_FINAL_BLUEPRINT.md / the receiver
// architecture audit this fix is part of.
// ---------------------------------------------------------------------------
describe('FillClientDetail — Log payment modal', () => {
  // "Log payment" is the text of both the card-action button that opens the
  // modal AND the modal's own submit button — grab the submit one by taking
  // the last match (the modal renders after the card in the component tree).
  function submitButton() {
    const matches = screen.getAllByRole('button', { name: /Log payment/ })
    return matches[matches.length - 1]
  }

  async function openLogPayment(user: ReturnType<typeof userEvent.setup>) {
    renderAt('fc-1')
    // Two entry points open the same modal (hero action + Recent payments
    // card action) — either works, take the first.
    await user.click(screen.getAllByRole('button', { name: /Log payment/ })[0])
    const amountInput = screen.getByPlaceholderText('0.00')
    await user.type(amountInput, '25')
  }

  it('Log payment is disabled with no receiver selected — a cash/whish/omt payment must not lose WHO RECEIVED IT', async () => {
    const user = userEvent.setup()
    await openLogPayment(user)

    expect(screen.getByText('Receiver is required.')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    expect(mockCreatePaymentMutateAsync).not.toHaveBeenCalled()
  })

  it('selecting a receiver resolves to a real receiverId and enables submission', async () => {
    const user = userEvent.setup()
    await openLogPayment(user)

    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), 'receiver-1')
    expect(screen.queryByText('Receiver is required.')).not.toBeInTheDocument()
    await user.click(submitButton())

    await waitFor(() => expect(mockCreatePaymentMutateAsync).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutateAsync.mock.calls[0]
    expect(body.receiverId).toBe('receiver-1')
  })

  // Regression (forensic audit, 2026-09): the receiver <select> used to be
  // keyed by display NAME, resolved to an id only at submit time via
  // `receivers.find(r => r.name === payBy)` — silently ambiguous whenever
  // two cash-capable users share a name (proven live against real data: 41
  // duplicate "Test Owner" rows from leaked test fixtures credited a real
  // $2,000+ payment to the wrong person's ledger). The select is now keyed
  // by id, so picking the SECOND same-named option must submit ITS id.
  it('two receivers sharing the same display name — selecting the second one submits ITS id, never the first', async () => {
    mockUseCashReceivers.mockReturnValue({
      data: [
        { id: 'receiver-a', name: 'Test Owner', role: 'owner' },
        { id: 'receiver-b', name: 'Test Owner', role: 'owner' },
      ],
    })
    const user = userEvent.setup()
    await openLogPayment(user)

    // Options render as "{name} · {role}" — both share the identical text.
    const receiverOptions = screen.getAllByText('Test Owner · owner')
    expect(receiverOptions).toHaveLength(2)
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), receiverOptions[1])
    await user.click(submitButton())

    await waitFor(() => expect(mockCreatePaymentMutateAsync).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutateAsync.mock.calls[0]
    expect(body.receiverId).toBe('receiver-b')
    expect(body.receiverId).not.toBe('receiver-a')
  })
})
