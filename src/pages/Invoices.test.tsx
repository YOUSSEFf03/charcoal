// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the Log Payment modal's frontend payload -> backend
// contract (Payment.method enum, notes, receiverId). Mocking style follows
// Clients.test.tsx.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockCreatePaymentMutate = vi.fn()
vi.mock('../hooks/usePayments', () => ({
  usePayments: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false }),
  useCreatePayment: () => ({ mutate: mockCreatePaymentMutate, isPending: false }),
}))

const mockUseInvoicesCalls = vi.fn()
vi.mock('../hooks/useInvoices', () => ({
  // The 'outstanding' tab's own useInvoices({status:'overdue', ...}) call
  // needs one row so its "Pay" button renders; the main tab gets its own,
  // distinct row (for the row-click-navigates-to-detail regression below).
  useInvoices: (params?: { status?: string; dateFrom?: string; dateTo?: string }) => {
    mockUseInvoicesCalls(params)
    return params?.status === 'overdue'
      ? {
          data: {
            data: [{
              id: 'inv-1',
              displayId: 'INV-0001',
              clientId: 'client-1',
              status: 'overdue',
              total: '150.00',
              paidAmount: '0.00',
              dueDate: '2026-01-01',
              lines: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }],
            total: 1,
          },
          isLoading: false,
          isError: false,
        }
      : {
          data: {
            data: [{
              id: 'inv-main-1',
              displayId: 'SI-0099',
              clientId: 'client-1',
              status: 'issued',
              total: '200.00',
              paidAmount: '0.00',
              dueDate: '2026-02-01',
              lines: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }],
            total: 1,
          },
          isLoading: false,
          isError: false,
        }
  },
  useIssueInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useClients', () => ({
  useClients: () => ({ data: { data: [], total: 0 } }),
}))

vi.mock('../hooks/useReports', () => ({
  useArSummary: () => ({ data: { totalOutstanding: '0', totalCollected: '0' }, isLoading: false }),
}))

const receiverUser = { id: 'receiver-1', name: 'Marie', role: 'receiver' }
vi.mock('../hooks/useUsers', () => ({
  useCashReceivers: () => ({ data: [receiverUser] }),
}))

vi.mock('../context/RateContext', () => ({
  useRate: () => ({ rate: '89,550', rawRate: 89550, setRate: vi.fn(), isSaving: false }),
}))

import Invoices from './Invoices'

beforeEach(() => {
  vi.clearAllMocks()
})

async function openPayModal(user: ReturnType<typeof userEvent.setup>) {
  render(<MemoryRouter><Invoices /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: /Outstanding/ }))
  await user.click(await screen.findByRole('button', { name: 'Pay' }))
  await user.type(screen.getByPlaceholderText('0.00'), '100')
}

describe('Invoices page — Log Payment modal contract', () => {
  it('regression: selecting "Bank" sends the Prisma enum value bank_transfer, not the invalid "bank"', async () => {
    const user = userEvent.setup()
    await openPayModal(user)
    await user.click(screen.getByRole('button', { name: 'Bank' }))
    await user.click(screen.getByRole('button', { name: /Confirm Payment/ }))

    await waitFor(() => expect(mockCreatePaymentMutate).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.method).toBe('bank_transfer')
    expect(body.method).not.toBe('bank')
  })

  it('the Notes field is wired to state and reaches the payload (previously a dead, uncontrolled input)', async () => {
    const user = userEvent.setup()
    await openPayModal(user)
    await user.type(screen.getByPlaceholderText(/partial payment/), 'cheque #4521')
    // Method defaults to Cash, which requires a receiver — select one so this
    // (notes-focused) test can actually submit.
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), 'Marie')
    await user.click(screen.getByRole('button', { name: /Confirm Payment/ }))

    await waitFor(() => expect(mockCreatePaymentMutate).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.notes).toBe('cheque #4521')
  })

  it('selecting a receiver resolves to receiverId, not just a display-only name', async () => {
    const user = userEvent.setup()
    await openPayModal(user)
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), 'Marie')
    await user.click(screen.getByRole('button', { name: /Confirm Payment/ }))

    await waitFor(() => expect(mockCreatePaymentMutate).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.receiverId).toBe('receiver-1')
  })

  it('Cash (the default method) with no receiver selected blocks submission — Confirm Payment is disabled', async () => {
    const user = userEvent.setup()
    await openPayModal(user)

    expect(screen.getByRole('button', { name: /Confirm Payment/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Confirm Payment/ }))
    expect(mockCreatePaymentMutate).not.toHaveBeenCalled()
  })

  it('Bank transfer does NOT require a receiver — Confirm Payment stays enabled with none selected', async () => {
    const user = userEvent.setup()
    await openPayModal(user)
    await user.click(screen.getByRole('button', { name: 'Bank' }))

    expect(screen.getByRole('button', { name: /Confirm Payment/ })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Confirm Payment/ }))

    await waitFor(() => expect(mockCreatePaymentMutate).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.receiverId).toBeUndefined()
  })
})

describe('Invoices page — row click navigates to the Invoice Detail page', () => {
  it('clicking an invoice row navigates to /invoices/:id (a real routed page, not the old expand-in-place panel/modal)', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/invoices']}>
        <Routes>
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/:id" element={<div>INVOICE DETAIL PAGE — SI-0099</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(await screen.findByText('SI-0099'))

    expect(await screen.findByText('INVOICE DETAIL PAGE — SI-0099')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Timezone-only-date audit regression — the date-range presets used to build
// dateFrom/dateTo via new Date(y, m, d).toISOString().slice(0, 10), which
// converts to UTC first and rolls the date back a day in a timezone ahead of
// UTC (Beirut, UTC+3) — e.g. "This month" opening on 31 July instead of
// 1 August, exactly as first caught on the Money Handover History page.
// Fixed to reuse toDateOnlyString()/currentMonthToDateRange() (local
// calendar-day parts, never toISOString()). These tests fix the clock to
// just after local midnight, the exact window the bug only showed up in.
// ---------------------------------------------------------------------------
describe('Invoices page — date-range preset timezone regression', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('"This month" opens on the 1st of the CURRENT month even just after local midnight — not the last day of the previous month', async () => {
    // 1 Aug 2026, 00:30 local time.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 1, 0, 30))

    render(<MemoryRouter><Invoices /></MemoryRouter>)
    fireEvent.change(screen.getByDisplayValue('All time'), { target: { value: 'This month' } })

    const mainTabCalls = mockUseInvoicesCalls.mock.calls.filter(([p]) => p?.status !== 'overdue')
    const params = mainTabCalls[mainTabCalls.length - 1][0]
    expect(params.dateFrom).toBe('2026-08-01')
    expect(params.dateTo).toBe('2026-08-01')
  })

  it('"Last month" resolves to the correct prior calendar month just after local midnight, spanning a year boundary', async () => {
    // 1 Jan 2026, 00:30 local time — "last month" is December 2025.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 0, 30))

    render(<MemoryRouter><Invoices /></MemoryRouter>)
    fireEvent.change(screen.getByDisplayValue('All time'), { target: { value: 'Last month' } })

    const mainTabCalls = mockUseInvoicesCalls.mock.calls.filter(([p]) => p?.status !== 'overdue')
    const params = mainTabCalls[mainTabCalls.length - 1][0]
    expect(params.dateFrom).toBe('2025-12-01')
    expect(params.dateTo).toBe('2025-12-31')
  })
})
