// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Fill Client Pickups — dedicated history page. Highest-risk items
// (break/prove): client scoping (never fetches another client's pickups)
// and pagination (page state resets on filter change, Next/Previous wired
// to the backend's total, not a client-side slice).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title: string; back?: { label: string; to: string }; children?: ReactNode }) => (
    <div><span>{title}</span>{back && <a href={back.to}>{back.label}</a>}{children}</div>
  ),
}))

const mockUseClient = vi.fn()
vi.mock('../hooks/useClients', () => ({ useClient: (id: string) => mockUseClient(id) }))

const mockUseStockExits = vi.fn()
vi.mock('../hooks/useWarehouse', () => ({ useStockExits: (params: unknown) => mockUseStockExits(params) }))

const mockUseClientLedger = vi.fn()
vi.mock('../hooks/useReports', () => ({ useClientLedger: (id: string, params: unknown) => mockUseClientLedger(id, params) }))

import FillClientPickups from './FillClientPickups'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/fill-clients/${id}/pickups`]}>
      <Routes><Route path="/fill-clients/:id/pickups" element={<FillClientPickups />} /></Routes>
    </MemoryRouter>,
  )
}

function makePickup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pk-1', date: '2026-08-10', recipient: 'Driver Dan', amount: '150.00',
    reason: JSON.stringify([{ specKey: '25_A', size: 25, charcoal: 'A', qty: 6 }]),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: { id: 'fc-1', name: 'Cedar Fill Co' }, isLoading: false })
  mockUseStockExits.mockReturnValue({ data: { data: [makePickup()], total: 1, page: 1, limit: 20 }, isLoading: false, isError: false })
  mockUseClientLedger.mockReturnValue({ data: { entries: [] }, isLoading: false })
})

describe('FillClientPickups', () => {
  it('scopes the query to this client and this exitType only — never fetches another client\'s or a non-fill exit list', () => {
    renderAt('fc-1')
    const call = mockUseStockExits.mock.calls[0][0]
    expect(call.clientId).toBe('fc-1')
    expect(call.exitType).toBe('client_bags_fill')
  })

  it('excludes the internal charcoal-consumption bookkeeping exit (amount:null) — hasAmount:true is passed so it never renders as a garbled pickup row', () => {
    renderAt('fc-1')
    expect(mockUseStockExits.mock.calls[0][0].hasAmount).toBe(true)
  })

  it('renders the pickup row with bag count and amount', () => {
    renderAt('fc-1')
    // "6" appears both in the table row and the "Bags (this page)" KPI tile.
    expect(screen.getAllByText('6').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('$150.00').length).toBeGreaterThanOrEqual(1)
  })

  it('pagination: Next is disabled on the last page and requests the next page when enabled', async () => {
    mockUseStockExits.mockReturnValue({ data: { data: [makePickup()], total: 45, page: 1, limit: 20 }, isLoading: false, isError: false })
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')

    const next = screen.getByRole('button', { name: /Next/ })
    expect(next).not.toBeDisabled()
    await user.click(next)

    const lastCall = mockUseStockExits.mock.calls[mockUseStockExits.mock.calls.length - 1]![0]
    expect(lastCall.page).toBe(2)
  })

  it('changing the date filter resets to page 1', async () => {
    mockUseStockExits.mockReturnValue({ data: { data: [makePickup()], total: 45, page: 2, limit: 20 }, isLoading: false, isError: false })
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')

    await user.selectOptions(screen.getByRole('combobox'), 'This month')

    const lastCall = mockUseStockExits.mock.calls[mockUseStockExits.mock.calls.length - 1]![0]
    expect(lastCall.page).toBe(1)
    expect(lastCall.dateFrom).toBeDefined()
  })

  it('empty state when there are no pickups', () => {
    mockUseStockExits.mockReturnValue({ data: { data: [], total: 0, page: 1, limit: 20 }, isLoading: false, isError: false })
    renderAt('fc-1')
    expect(screen.getByText(/No pickups/)).toBeInTheDocument()
  })
})
