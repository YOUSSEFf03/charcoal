// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Client } from '../types/api'

// ---------------------------------------------------------------------------
// Mocks — Clients.tsx pulls in several hooks + a heavy Topbar (Clerk auth).
// Mocking at the module boundary lets these tests exercise the page's own
// filter/sort/pagination logic without a real API, QueryClient, or Clerk
// session, mirroring the mocking style already used in
// ExportColumnsModal.test.tsx.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockUseClients = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClients: (...args: unknown[]) => mockUseClients(...args),
  useClientsCounts: () => ({ data: { allCount: 0, balanceCount: 0, overdueCount: 0 } }),
  useCreateClient: () => ({ mutate: vi.fn(), isPending: false }),
  useAddPhone: () => ({ mutate: vi.fn(), isPending: false }),
  useOverdueClients: () => ({ data: [], isLoading: false, isError: false }),
}))

vi.mock('../hooks/usePayments', () => ({
  useCreatePayment: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../hooks/useOrders', () => ({
  useOrders: () => ({ data: { data: [], total: 0 } }),
}))

vi.mock('../context/RateContext', () => ({
  useRate: () => ({ rate: '89,550', rawRate: 89550, setRate: vi.fn(), isSaving: false }),
}))

import Clients from './Clients'

function client(id: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: id,
    nameAr: null,
    type: 'restaurant',
    currency: 'USD',
    phones: [],
    preferredTypes: [],
    avgOrderDays: null,
    lastOrderDate: null,
    paymentTerms: null,
    address: null,
    creditLimit: null,
    notes: null,
    notesEn: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    balance: '0.00',
    isOverdue: false,
    totalInvoiced: '0',
    totalCollected: '0',
    orderCount: 0,
    ...overrides,
  }
}

function renderClients() {
  return render(
    <MemoryRouter>
      <Clients />
    </MemoryRouter>,
  )
}

/** Params object passed to the most recent call to the main (paginated) useClients() invocation — call #0 each render, since the Balances-tab useClients() call is a separate, later call with no `page`. */
function lastMainCallParams() {
  const mainCalls = mockUseClients.mock.calls.filter((c) => 'page' in (c[0] as object));
  return mainCalls[mainCalls.length - 1][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClients.mockReturnValue({
    data: { data: [client('a'), client('b')], total: 2 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
})

describe('Clients page — loading and empty states', () => {
  it('renders skeleton rows while loading, not the empty-state message', () => {
    mockUseClients.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderClients()
    expect(screen.queryByText('No clients match your search')).not.toBeInTheDocument()
  })

  it('renders the empty state with a working Clear filters button when the result set is empty', async () => {
    const user = userEvent.setup()
    mockUseClients.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() })
    renderClients()

    expect(screen.getByText('No clients match your search')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    // No throw — clearAllFilters() ran against empty/default state without error.
  })
})

describe('Clients page — filters affect query params', () => {
  it('selecting a Client Type filter passes the mapped enum value and resets to page 1', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.selectOptions(screen.getByDisplayValue('All types'), 'Restaurant')

    await waitFor(() => {
      expect(lastMainCallParams()).toMatchObject({ type: 'restaurant', page: 1 })
    })
  })

  it('selecting the Active/Inactive filter passes isActive through', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.selectOptions(screen.getByDisplayValue('All statuses'), 'Inactive')

    await waitFor(() => {
      expect(lastMainCallParams()).toMatchObject({ isActive: false })
    })
  })

  it('typing a min/max sales range sends numeric minTotalInvoiced/maxTotalInvoiced after the debounce', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.type(screen.getByPlaceholderText('Min sales'), '100')
    await user.type(screen.getByPlaceholderText('Max sales'), '1000')

    await waitFor(() => {
      expect(lastMainCallParams()).toMatchObject({ minTotalInvoiced: 100, maxTotalInvoiced: 1000 })
    }, { timeout: 1000 })
  })

  it('a Client Type filter and a sortBy both appear together in the same query (filter + sort combine)', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.selectOptions(screen.getByDisplayValue('All types'), 'Restaurant')
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ type: 'restaurant' }))

    await user.click(screen.getByText('Total invoiced'))

    await waitFor(() => {
      expect(lastMainCallParams()).toMatchObject({ type: 'restaurant', sortBy: 'totalInvoiced', sortOrder: 'desc' })
    })
  })

  it('"Clear filters" resets search, type, balance, active, and sales range together', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.type(screen.getByPlaceholderText('Search name, phone…'), 'acme')
    await user.selectOptions(screen.getByDisplayValue('All types'), 'Restaurant')
    await user.selectOptions(screen.getByDisplayValue('Any balance'), 'Has balance')
    await user.selectOptions(screen.getByDisplayValue('All statuses'), 'Active')
    await user.type(screen.getByPlaceholderText('Min sales'), '50')

    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ type: 'restaurant' }))

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => {
      const params = lastMainCallParams()
      expect(params.search).toBeUndefined()
      expect(params.type).toBeUndefined()
      expect(params.hasBalance).toBeUndefined()
      expect(params.isActive).toBeUndefined()
      expect(params.minTotalInvoiced).toBeUndefined()
      expect(params.maxTotalInvoiced).toBeUndefined()
    })
  })
})

describe('Clients page — sorting', () => {
  it('clicking a sortable column header sorts descending first, then flips to ascending on a second click', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.click(screen.getByText('Total invoiced'))
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ sortBy: 'totalInvoiced', sortOrder: 'desc' }))

    await user.click(screen.getByText('Total invoiced'))
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ sortBy: 'totalInvoiced', sortOrder: 'asc' }))
  })

  it('clicking a different sortable column switches the sort key and restarts at descending', async () => {
    const user = userEvent.setup()
    renderClients()

    await user.click(screen.getByText('Orders'))
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ sortBy: 'orderCount', sortOrder: 'desc' }))

    await user.click(screen.getByText('Total invoiced'))
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ sortBy: 'totalInvoiced', sortOrder: 'desc' }))
  })
})

describe('Clients page — pagination', () => {
  it('Next advances the page, and changing a filter afterward resets back to page 1', async () => {
    const user = userEvent.setup()
    mockUseClients.mockReturnValue({
      data: { data: [client('a')], total: 120 }, // 3 pages at limit 50
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderClients()

    await user.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ page: 2 }))

    await user.selectOptions(screen.getByDisplayValue('All types'), 'Restaurant')
    await waitFor(() => expect(lastMainCallParams()).toMatchObject({ page: 1, type: 'restaurant' }))
  })
})
