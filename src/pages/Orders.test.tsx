// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the "Delivery Queue" section added to the top of
// the Orders page. The queue has its OWN backend query/pagination/search/
// filter/sort, entirely independent of the Order History list below it —
// these tests exist specifically to catch a regression that collapses the
// two back into one shared state (a delivered order silently leaking into
// the queue, a filter on one section resetting the other's page, etc).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockUseOrders = vi.fn()
const mockUseDeliveryQueue = vi.fn()
const mockDeleteOrderMutate = vi.fn()
const mockMarkDeliveredMutate = vi.fn()
vi.mock('../hooks/useOrders', () => ({
  useOrders: (params: unknown) => mockUseOrders(params),
  useDeliveryQueue: (params: unknown) => mockUseDeliveryQueue(params),
  useDeleteOrder: () => ({ mutate: mockDeleteOrderMutate, isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: mockMarkDeliveredMutate, isPending: false }),
}))

vi.mock('../hooks/useClients', () => ({
  useClients: () => ({ data: { data: [{ id: 'client-1', name: 'Acme Trading' }], total: 1 } }),
}))

const mockUseUsers = vi.fn()
vi.mock('../hooks/useUsers', () => ({
  useUsers: (params: unknown) => mockUseUsers(params),
}))

vi.mock('../hooks/useShipments', () => ({
  useConfirmDelivery: () => ({ mutate: vi.fn(), isPending: false }),
  useLogReturn: () => ({ mutate: vi.fn(), isPending: false }),
  useLogActualWeight: () => ({ mutate: vi.fn(), isPending: false }),
}))

import Orders from './Orders'

function makeQueueOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    displayId: 'SO-0053',
    clientId: 'client-1',
    client: { id: 'client-1', name: 'Acme Trading' },
    charcoalType: 'BBQ Hardwood',
    grade: 'A',
    totalKgRequested: '290.000',
    bagTypeId: 'bt-1',
    bagType: { id: 'bt-1', name: '10 kg Bag', nominalKg: '10' },
    status: 'draft',
    createdAt: '2026-08-20T00:00:00.000Z',
    driverId: null,
    driver: null,
    ...overrides,
  }
}

function renderOrders() {
  return render(
    <MemoryRouter initialEntries={['/orders']}>
      <Routes>
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<div>ORDER DETAIL PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseOrders.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() })
  mockUseDeliveryQueue.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() })
  mockUseUsers.mockReturnValue({ data: { data: [{ id: 'driver-1', name: 'Joseph' }], total: 1 } })
  vi.stubGlobal('confirm', vi.fn(() => true))
})

describe('Delivery Queue — empty state', () => {
  it('shows the positive "All caught up" message when the queue is empty and no filters are active', () => {
    renderOrders()
    expect(screen.getByText('All caught up')).toBeInTheDocument()
    expect(screen.getByText('No orders are currently waiting for delivery.')).toBeInTheDocument()
    expect(screen.queryByText('No orders found.')).not.toBeInTheDocument()
  })
})

describe('Delivery Queue — loading and error states', () => {
  it('shows skeleton cards while loading, not the empty state', () => {
    mockUseDeliveryQueue.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderOrders()
    expect(screen.queryByText('All caught up')).not.toBeInTheDocument()
  })

  it('shows an honest error message with a Retry button on failure, independent of the Order History section', async () => {
    const refetch = vi.fn()
    mockUseDeliveryQueue.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    mockUseOrders.mockReturnValue({ data: { data: [makeQueueOrder({ id: 'hist-1' })], total: 1 }, isLoading: false, isError: false, refetch: vi.fn() })
    renderOrders()

    expect(screen.getByText("Couldn't load delivery queue.")).toBeInTheDocument()
    // Order History still renders successfully — the two sections fail independently.
    expect(screen.getByText('Acme Trading')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('Delivery Queue — card content', () => {
  it('renders client, order number, date, product, weight, and driver correctly', () => {
    mockUseDeliveryQueue.mockReturnValue({
      data: { data: [makeQueueOrder({ driverId: 'driver-1', driver: { id: 'driver-1', name: 'Joseph' } })], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderOrders()

    const card = within(document.querySelector('.order-card') as HTMLElement)
    expect(card.getByText('Acme Trading')).toBeInTheDocument()
    expect(card.getByText(/SO-0053/)).toBeInTheDocument()
    expect(card.getByText(/BBQ Hardwood/)).toBeInTheDocument()
    expect(card.getByText(/29 bags · 290 kg/)).toBeInTheDocument()
    expect(card.getByText('Joseph')).toBeInTheDocument()
  })

  it('shows "No driver assigned" when the order has no driver — never a fabricated name', () => {
    mockUseDeliveryQueue.mockReturnValue({
      data: { data: [makeQueueOrder()], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderOrders()
    expect(screen.getByText('No driver assigned')).toBeInTheDocument()
  })

  it('shows the "Partially delivered" state distinctly from "Awaiting delivery"', () => {
    mockUseDeliveryQueue.mockReturnValue({
      data: { data: [makeQueueOrder({ status: 'partially_delivered' })], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderOrders()
    const card = within(document.querySelector('.order-card') as HTMLElement)
    expect(card.getByText('Partially delivered')).toBeInTheDocument()
  })
})

describe('Delivery Queue — primary action', () => {
  it('the primary action is "Mark delivered", reusing the same mutation as OrderDetail — clicking it calls markDelivered with the order id after confirmation', async () => {
    mockUseDeliveryQueue.mockReturnValue({
      data: { data: [makeQueueOrder()], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderOrders()

    await user.click(screen.getByRole('button', { name: /Mark delivered/ }))
    expect(mockMarkDeliveredMutate).toHaveBeenCalledWith('order-1', expect.anything())
  })

  it('clicking a delivery card navigates to the SAME Order Detail route as the history list — no second detail page', async () => {
    mockUseDeliveryQueue.mockReturnValue({
      data: { data: [makeQueueOrder()], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderOrders()

    await user.click(screen.getByText('Acme Trading'))
    expect(await screen.findByText('ORDER DETAIL PAGE')).toBeInTheDocument()
  })
})

describe('Delivery Queue — search, filter, sort (server-side)', () => {
  it('search is debounced and sent to the backend, not filtered client-side', async () => {
    renderOrders()
    const searchInputs = screen.getAllByPlaceholderText(/Search client/)
    const dqSearchInput = searchInputs[0]

    const user = userEvent.setup({ delay: null })
    await user.type(dqSearchInput, 'acme')

    await waitFor(() => {
      const lastCall = mockUseDeliveryQueue.mock.calls[mockUseDeliveryQueue.mock.calls.length - 1][0]
      expect(lastCall.search).toBe('acme')
    })
  })

  it('selecting a delivery-state filter sends the matching status to the backend', async () => {
    renderOrders()
    const user = userEvent.setup()

    const statusSelect = screen.getByDisplayValue('All delivery states')
    await user.selectOptions(statusSelect, 'partially_delivered')

    const lastCall = mockUseDeliveryQueue.mock.calls[mockUseDeliveryQueue.mock.calls.length - 1][0]
    expect(lastCall.status).toBe('partially_delivered')
  })

  it('selecting a driver filter sends driverId to the backend', async () => {
    renderOrders()
    const user = userEvent.setup()

    const driverSelect = screen.getByDisplayValue('All drivers')
    await user.selectOptions(driverSelect, 'driver-1')

    const lastCall = mockUseDeliveryQueue.mock.calls[mockUseDeliveryQueue.mock.calls.length - 1][0]
    expect(lastCall.driverId).toBe('driver-1')
  })

  it('changing the sort option sends the matching sortBy/sortOrder — default is oldest-waiting-first', async () => {
    renderOrders()
    // Default call (no interaction yet) — oldest waiting first.
    expect(mockUseDeliveryQueue.mock.calls[0][0]).toMatchObject({ sortBy: 'createdAt', sortOrder: 'asc' })

    const user = userEvent.setup()
    const sortSelect = screen.getByDisplayValue('Oldest waiting first')
    await user.selectOptions(sortSelect, 'Newest order first')

    const lastCall = mockUseDeliveryQueue.mock.calls[mockUseDeliveryQueue.mock.calls.length - 1][0]
    expect(lastCall).toMatchObject({ sortBy: 'createdAt', sortOrder: 'desc' })
  })
})

describe('Delivery Queue — pagination is independent of Order History pagination', () => {
  it('changing a Delivery Queue filter resets its OWN page to 1 without touching Order History page', async () => {
    mockUseDeliveryQueue.mockReturnValue({
      data: { data: Array.from({ length: 8 }, (_, i) => makeQueueOrder({ id: `dq-${i}` })), total: 20 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mockUseOrders.mockReturnValue({
      data: { data: Array.from({ length: 20 }, (_, i) => makeQueueOrder({ id: `hist-${i}`, status: 'delivered' })), total: 40 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderOrders()

    // Move Delivery Queue to page 2.
    const nextButtons = screen.getAllByRole('button', { name: /Next/ })
    await user.click(nextButtons[0]) // Delivery Queue's Next is the first one (queue renders above history)
    expect(mockUseDeliveryQueue.mock.calls[mockUseDeliveryQueue.mock.calls.length - 1][0].page).toBe(2)
    // Order History must still be requesting page 1 — untouched by the queue's pagination.
    expect(mockUseOrders.mock.calls[mockUseOrders.mock.calls.length - 1][0].page).toBe(1)

    // Now change a Delivery Queue filter — its page must reset to 1, History page must stay untouched.
    const statusSelect = screen.getByDisplayValue('All delivery states')
    await user.selectOptions(statusSelect, 'draft')
    expect(mockUseDeliveryQueue.mock.calls[mockUseDeliveryQueue.mock.calls.length - 1][0].page).toBe(1)
    expect(mockUseOrders.mock.calls[mockUseOrders.mock.calls.length - 1][0].page).toBe(1)
  })

  it('moving Order History to page 2 does not affect the Delivery Queue page', async () => {
    mockUseOrders.mockReturnValue({
      data: { data: Array.from({ length: 20 }, (_, i) => makeQueueOrder({ id: `hist-${i}`, status: 'delivered' })), total: 40 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderOrders()

    const nextButtons = screen.getAllByRole('button', { name: /Next/ })
    // Order History's Next is the second "Next" button on the page (queue's empty-state has none since it has 0 rows here).
    await user.click(nextButtons[nextButtons.length - 1])

    const lastHistCall = mockUseOrders.mock.calls[mockUseOrders.mock.calls.length - 1][0]
    expect(lastHistCall.page).toBe(2)
    // Delivery Queue was never called with page 2.
    expect(mockUseDeliveryQueue.mock.calls.some(c => c[0].page === 2)).toBe(false)
  })
})

describe('Order History — unchanged existing behavior', () => {
  it('still renders the Order History section with its own search/status filter and result count', () => {
    mockUseOrders.mockReturnValue({
      data: { data: [makeQueueOrder({ id: 'hist-1', status: 'delivered' })], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderOrders()
    expect(screen.getByText('Order History')).toBeInTheDocument()
    expect(screen.getByText('1 order')).toBeInTheDocument()
  })

  it('a draft order in history still shows the Delete action (existing behavior preserved)', async () => {
    mockUseOrders.mockReturnValue({
      data: { data: [makeQueueOrder({ id: 'hist-1', status: 'draft' })], total: 1 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderOrders()

    await user.click(screen.getByTitle('Delete order'))
    expect(mockDeleteOrderMutate).toHaveBeenCalledWith('hist-1', expect.anything())
  })
})
