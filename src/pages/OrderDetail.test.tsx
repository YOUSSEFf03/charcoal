// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the "Mark as delivered" button — a production bug
// report found that pressing it repeatedly/quickly could surface "Internal
// Server Error". The backend fix (OrdersService.markDelivered() now locks
// the order row and re-checks status inside the transaction — see
// apps/backend/src/orders/orders.service.ts and
// apps/backend/test/order-delivery-concurrency.integration-spec.ts) makes a
// racing/repeated request resolve as an ordinary success, never a 500. These
// tests cover the frontend half: the button must not be double-clickable,
// and whatever the mutation resolves/rejects with must render through the
// page's existing toast/error conventions, never a raw crash.
// ---------------------------------------------------------------------------

// The mock resolves `back` the same way the real Topbar does (navigate for a
// route string) so the navigation-consolidation fix — OrderDetail's "Orders"
// link now goes through Topbar's `back` prop instead of a hand-rolled
// duplicate inside the page header — stays covered.
vi.mock('../components/layout/Topbar', () => ({
  default: ({ back, children }: { title?: string; back?: { label: string; to: string | (() => void) }; children?: ReactNode }) => {
    const navigate = useNavigate()
    return (
      <div>
        {back && (
          <button onClick={() => (typeof back.to === 'function' ? back.to() : navigate(back.to))}>{back.label}</button>
        )}
        {children}
      </div>
    )
  },
}))

const mockUseOrder = vi.fn()
const mockUpdateOrderMutate = vi.fn()
const mockDeleteOrderMutate = vi.fn()
const mockMarkDeliveredMutate = vi.fn()
const mockGenerateInvoiceMutate = vi.fn()
let markDeliveredIsPending = false

vi.mock('../hooks/useOrders', () => ({
  useOrder: (id: string) => mockUseOrder(id),
  useUpdateOrder: () => ({ mutate: mockUpdateOrderMutate, isPending: false }),
  useDeleteOrder: () => ({ mutate: mockDeleteOrderMutate, isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: mockMarkDeliveredMutate, isPending: markDeliveredIsPending }),
  useGenerateOrderInvoice: () => ({ mutate: mockGenerateInvoiceMutate, isPending: false }),
}))

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [] }),
}))

import OrderDetail from './OrderDetail'

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    displayId: 'SO-0099',
    clientId: 'client-1',
    client: { id: 'client-1', name: 'Acme Trading', type: 'restaurant', currency: 'USD' },
    charcoalType: 'BBQ Hardwood',
    grade: 'A',
    totalKgRequested: '100.000',
    bagTypeId: 'bt-1',
    bagType: { id: 'bt-1', name: '10 kg Bag', nominalKg: '10' },
    pricePerBag: '10.00',
    currency: 'USD',
    status: 'draft',
    createdById: 'user-1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    notes: null,
    supplierName: null,
    driverId: null,
    driver: null,
    bagLines: [],
    shipments: [],
    invoices: [],
    ...overrides,
  }
}

function renderOrderDetail() {
  return render(
    <MemoryRouter initialEntries={['/orders/order-1']}>
      <Routes>
        <Route path="/orders" element={<div>Orders list page</div>} />
        <Route path="/orders/:id" element={<OrderDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  markDeliveredIsPending = false
  mockUseOrder.mockReturnValue({ data: makeOrder(), isLoading: false, isError: false, refetch: vi.fn() })
  vi.stubGlobal('confirm', vi.fn(() => true))
})

describe('OrderDetail — back navigation', () => {
  it('the "Orders" back link (now on Topbar, not a hand-rolled duplicate) returns to /orders', async () => {
    const user = userEvent.setup()
    renderOrderDetail()
    await user.click(screen.getByText('Orders'))
    expect(screen.getByText('Orders list page')).toBeInTheDocument()
  })
})

describe('OrderDetail — "Mark as delivered" double-click protection', () => {
  it('is enabled and labeled normally when no mutation is in flight', () => {
    renderOrderDetail()
    const btn = screen.getByRole('button', { name: /Mark as delivered/ })
    expect(btn).toBeEnabled()
  })

  it('disables the button and shows "Marking…" while the mutation is pending — the mutation lifecycle is the guard, not a timer', () => {
    markDeliveredIsPending = true
    renderOrderDetail()
    const btn = screen.getByRole('button', { name: /Marking…/ })
    expect(btn).toBeDisabled()
  })

  it('a click while pending does not call mutate again — the disabled attribute itself blocks the second submission', async () => {
    markDeliveredIsPending = true
    const user = userEvent.setup()
    renderOrderDetail()

    await user.click(screen.getByRole('button', { name: /Marking…/ }))
    expect(mockMarkDeliveredMutate).not.toHaveBeenCalled()
  })

  it('confirming once calls the mutation exactly once with the order id', async () => {
    const user = userEvent.setup()
    renderOrderDetail()

    await user.click(screen.getByRole('button', { name: /Mark as delivered/ }))
    expect(mockMarkDeliveredMutate).toHaveBeenCalledTimes(1)
    expect(mockMarkDeliveredMutate).toHaveBeenCalledWith('order-1', expect.anything())
  })

  it('declining the confirm dialog does not call the mutation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const user = userEvent.setup()
    renderOrderDetail()

    await user.click(screen.getByRole('button', { name: /Mark as delivered/ }))
    expect(mockMarkDeliveredMutate).not.toHaveBeenCalled()
  })

  it('the button is not rendered at all once the order is already delivered — nothing left to double-click', () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ status: 'delivered' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderOrderDetail()
    expect(screen.queryByRole('button', { name: /Mark as delivered/ })).not.toBeInTheDocument()
  })
})

describe('OrderDetail — "Mark as delivered" error handling', () => {
  it('an unexpected server error shows the backend-provided message via the normal toast, never a raw crash', async () => {
    mockMarkDeliveredMutate.mockImplementation((_id, { onError }: any) => {
      onError({ error: 'Internal server error', code: 'INTERNAL_ERROR' })
    })
    const user = userEvent.setup()
    renderOrderDetail()

    await user.click(screen.getByRole('button', { name: /Mark as delivered/ }))
    expect(await screen.findByText('Internal server error')).toBeInTheDocument()
  })

  it('falls back to a generic message when the error payload carries none', async () => {
    mockMarkDeliveredMutate.mockImplementation((_id, { onError }: any) => {
      onError({})
    })
    const user = userEvent.setup()
    renderOrderDetail()

    await user.click(screen.getByRole('button', { name: /Mark as delivered/ }))
    expect(await screen.findByText('Failed to mark order as delivered')).toBeInTheDocument()
  })
})
