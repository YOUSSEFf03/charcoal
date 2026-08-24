// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Fill Client Payment History — dedicated, accounting-sensitive page.
// Highest-risk items (break/prove): amount/currency shown per-row is exactly
// what the backend returned (no client-side conversion), and "Total paid"
// comes from the authoritative ledger credit total for the SAME date
// window — never a client-side sum of the paginated rows (which would
// silently undercount past page 1).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title: string; back?: { label: string; to: string }; children?: ReactNode }) => (
    <div><span>{title}</span>{back && <a href={back.to}>{back.label}</a>}{children}</div>
  ),
}))

const mockUseClient = vi.fn()
const mockUseClientBalance = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClient: (id: string) => mockUseClient(id),
  useClientBalance: (id: string) => mockUseClientBalance(id),
}))

const mockUsePayments = vi.fn()
vi.mock('../hooks/usePayments', () => ({ usePayments: (params: unknown) => mockUsePayments(params) }))

const mockUseClientLedger = vi.fn()
vi.mock('../hooks/useReports', () => ({ useClientLedger: (id: string, params: unknown) => mockUseClientLedger(id, params) }))

import FillClientPayments from './FillClientPayments'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/fill-clients/${id}/payments`]}>
      <Routes><Route path="/fill-clients/:id/payments" element={<FillClientPayments />} /></Routes>
    </MemoryRouter>,
  )
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return { id: 'p1', date: '2026-08-10', method: 'cash', amount: '150.50', currency: 'LBP', notes: 'ref-1', displayId: 'RV-01', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: { id: 'fc-1', name: 'Cedar Fill Co' }, isLoading: false })
  mockUseClientBalance.mockReturnValue({ data: { balance: '75.00' }, isLoading: false })
  mockUsePayments.mockReturnValue({ data: { data: [makePayment()], total: 1, page: 1, limit: 20 }, isLoading: false, isError: false })
  mockUseClientLedger.mockReturnValue({ data: { entries: [{ debit: '0', credit: '150.50' }] }, isLoading: false })
})

describe('FillClientPayments', () => {
  it('scopes the query to this client\'s id', () => {
    renderAt('fc-1')
    expect(mockUsePayments.mock.calls[0][0].clientId).toBe('fc-1')
  })

  it('shows the exact amount AND currency the backend returned for a non-USD payment — no silent conversion', () => {
    renderAt('fc-1')
    expect(screen.getByText('+$150.50')).toBeInTheDocument()
    expect(screen.getByText('LBP')).toBeInTheDocument()
  })

  it('"Total paid" comes from the ledger credit total, not a sum of the (possibly single-page) payments list', () => {
    mockUseClientLedger.mockReturnValue({ data: { entries: [{ debit: '0', credit: '999.00' }] }, isLoading: false })
    renderAt('fc-1')
    expect(screen.getByText('$999.00')).toBeInTheDocument()
  })

  it('"Outstanding" comes from the client balance endpoint, independent of the date filter', () => {
    renderAt('fc-1')
    expect(screen.getByText('$75.00')).toBeInTheDocument()
  })

  it('pagination requests the next page from the backend', async () => {
    mockUsePayments.mockReturnValue({ data: { data: [makePayment()], total: 45, page: 1, limit: 20 }, isLoading: false, isError: false })
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')

    await user.click(screen.getByRole('button', { name: /Next/ }))

    const lastCall = mockUsePayments.mock.calls[mockUsePayments.mock.calls.length - 1]![0]
    expect(lastCall.page).toBe(2)
  })

  it('shows the receiver from the authoritative relation, preferring it over the denormalized receiverName string', () => {
    mockUsePayments.mockReturnValue({
      data: { data: [makePayment({ receiver: { id: 'u1', name: 'Abo Baker' }, receiverName: 'stale name' })], total: 1, page: 1, limit: 20 },
      isLoading: false, isError: false,
    })
    renderAt('fc-1')
    expect(screen.getByText('Abo Baker')).toBeInTheDocument()
    expect(screen.queryByText('stale name')).not.toBeInTheDocument()
  })

  it('falls back to receiverName when the receiver relation is absent, and to "—" when neither is set', () => {
    mockUsePayments.mockReturnValue({
      data: {
        data: [
          makePayment({ id: 'p1', receiverName: 'Legacy Cashier' }),
          makePayment({ id: 'p2', receiverName: null }),
        ],
        total: 2, page: 1, limit: 20,
      },
      isLoading: false, isError: false,
    })
    renderAt('fc-1')
    expect(screen.getByText('Legacy Cashier')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('empty state when there are no payments', () => {
    mockUsePayments.mockReturnValue({ data: { data: [], total: 0, page: 1, limit: 20 }, isLoading: false, isError: false })
    renderAt('fc-1')
    expect(screen.getByText(/No payments/)).toBeInTheDocument()
  })
})
