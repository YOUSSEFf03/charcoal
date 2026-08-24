// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Fill Client Statement — dedicated route regression coverage.
//
// Highest-risk items (break/prove):
//   1. Date-filter behavior (This month / This week / Clear) drives
//      useClientLedger's dateFrom/dateTo params — server-side, not a
//      client-side re-filter of an unbounded fetch.
//   2. Print PDF passes exactly what's on screen to the SAME
//      exportStatementPdf() the normal Client Statement uses — no separate
//      accounting calculation, no invented address, no PID/Financial Number.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title: string; back?: { label: string; to: string }; children?: ReactNode }) => (
    <div><span>{title}</span>{back && <a href={back.to}>{back.label}</a>}{children}</div>
  ),
}))

const mockUseClient = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClient: (id: string) => mockUseClient(id),
}))

const mockUseClientLedger = vi.fn()
vi.mock('../hooks/useReports', () => ({
  useClientLedger: (clientId: string, params: unknown) => mockUseClientLedger(clientId, params),
}))

const mockExportStatementPdf = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/statementPdf', () => ({
  exportStatementPdf: (config: unknown) => mockExportStatementPdf(config),
}))

import FillClientStatement from './FillClientStatement'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/fill-clients/${id}/statement`]}>
      <Routes><Route path="/fill-clients/:id/statement" element={<FillClientStatement />} /></Routes>
    </MemoryRouter>,
  )
}

function baseLedger() {
  return {
    clientId: 'fc-1',
    currency: 'USD',
    openingBalance: '100.00',
    balance: '250.00',
    entries: [
      { date: '2026-08-05', type: 'fill_pickup', reference: 'r1', displayId: null, description: 'Fill pickup', debit: '200.00', credit: '0.00', runningBalance: '300.00' },
      { date: '2026-08-10', type: 'payment', reference: 'r2', displayId: 'RV-01', description: 'Payment', debit: '0.00', credit: '50.00', runningBalance: '250.00' },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({
    data: { id: 'fc-1', name: 'Cedar Fill Co', currency: 'USD', phones: [{ number: '+961-1-234567', isActive: true }] },
    isLoading: false,
  })
  mockUseClientLedger.mockReturnValue({ data: baseLedger(), isLoading: false, isError: false })
})

describe('FillClientStatement', () => {
  it('loads the ledger scoped to the :id route param', () => {
    renderAt('fc-1')
    expect(mockUseClientLedger).toHaveBeenCalledWith('fc-1', { dateFrom: undefined, dateTo: undefined })
  })

  it('renders the backend-computed opening/closing balance and totals — no client-side recompute', () => {
    renderAt('fc-1')
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0) // opening
    expect(screen.getAllByText('$250.00').length).toBeGreaterThan(0) // closing
  })

  it('"This month" selects the current-month preset and passes dateFrom/dateTo to useClientLedger', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')
    await user.selectOptions(screen.getByRole('combobox'), 'This month')

    const lastCall = mockUseClientLedger.mock.calls[mockUseClientLedger.mock.calls.length - 1]
    expect(lastCall![1].dateFrom).toBeDefined()
    expect(lastCall![1].dateTo).toBeDefined()
  })

  it('Clear resets the filter back to unbounded (dateFrom/dateTo undefined)', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')
    await user.selectOptions(screen.getByRole('combobox'), 'This week')
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    const lastCall = mockUseClientLedger.mock.calls[mockUseClientLedger.mock.calls.length - 1]
    expect(lastCall![1]).toEqual({ dateFrom: undefined, dateTo: undefined })
  })

  it('Print PDF calls the SAME exportStatementPdf used by the normal Client Statement, with the on-screen figures, no invented address, and the client\'s active phone', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')
    await user.click(screen.getByRole('button', { name: /Print PDF/ }))

    expect(mockExportStatementPdf).toHaveBeenCalledTimes(1)
    const config = mockExportStatementPdf.mock.calls[0][0]
    expect(config.client).toEqual({ name: 'Cedar Fill Co', address: null, phone: '+961-1-234567', currency: 'USD' })
    expect(config.openingBalance).toBe(100)
    expect(config.closingBalance).toBe(250)
    expect(config.rows).toHaveLength(2)
  })

  it('empty state when the ledger has no entries', () => {
    mockUseClientLedger.mockReturnValue({ data: { ...baseLedger(), entries: [] }, isLoading: false, isError: false })
    renderAt('fc-1')
    expect(screen.getByText(/No fill pickups or payments/)).toBeInTheDocument()
  })

  it('error state when the ledger request fails', () => {
    mockUseClientLedger.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderAt('fc-1')
    expect(screen.getByText(/Failed to load statement/)).toBeInTheDocument()
  })
})
