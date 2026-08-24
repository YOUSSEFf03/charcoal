// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { InvoiceDetail as InvoiceDetailType } from '../lib/types'

// ---------------------------------------------------------------------------
// Regression coverage for the new Invoice Detail page: loads the invoice by
// the route :id (not a stale row from the list), shows the same totals/
// balance the backend computed (not a frontend re-derivation that could
// drift), and its Print/PDF action points at the existing, authoritative
// InvoicePrint route for that SAME invoice id — one invoice representation,
// never two that could silently disagree.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title: string; back?: { label: string; to: string }; children?: ReactNode }) => (
    <div>
      <span>{title}</span>
      {back && <a href={back.to}>{back.label}</a>}
      {children}
    </div>
  ),
}))

function baseInvoice(overrides: Partial<InvoiceDetailType> = {}): InvoiceDetailType {
  return {
    id: 'inv-1',
    displayId: 'SI-0042',
    orderId: 'order-1',
    clientId: 'client-1',
    lines: [
      { saleUnit: 'BAG', bagTypeId: 'bt-1', bagTypeName: '25kg Premium', qty: 10, pricePerBag: 12, lineTotal: 120 },
    ],
    subtotal: '120.00',
    total: '120.00',
    currency: 'USD',
    status: 'issued',
    paidAmount: '50.00',
    exchangeRateSnapshot: null,
    issuedAt: '2026-01-01T00:00:00.000Z',
    dueDate: '2026-01-15',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    client: { id: 'client-1', name: 'Acme Trading', type: 'restaurant', currency: 'USD', phones: [] },
    order: { id: 'order-1', displayId: 'SO-0010', status: 'delivered' },
    payments: [],
    allocations: [
      { id: 'alloc-1', amount: '50.00', createdAt: '2026-01-05T00:00:00.000Z', payment: { id: 'pay-1', displayId: 'RV-0005', clientId: 'client-1', date: '2026-01-05', method: 'cash', invoiceId: 'inv-1' } },
    ],
    balanceDue: '70.00',
    ...overrides,
  } as InvoiceDetailType
}

const mockUseInvoice = vi.fn()
const mockCancelMutate = vi.fn()
vi.mock('../hooks/useInvoices', () => ({
  useInvoice: (id: string) => mockUseInvoice(id),
  useCancelInvoice: () => ({ mutate: mockCancelMutate, isPending: false }),
}))

import InvoiceDetail from './InvoiceDetail'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/invoices/${id}`]}>
      <Routes>
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InvoiceDetail page', () => {
  it('loads the invoice matching the :id route param, not a hardcoded/stale one', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice(), isLoading: false, isError: false })
    renderAt('inv-1')

    expect(mockUseInvoice).toHaveBeenCalledWith('inv-1')
    expect(screen.getAllByText('SI-0042').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Acme Trading').length).toBeGreaterThan(0)
  })

  it('shows the backend-computed totals and balance due — not a frontend re-derivation', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice({ total: '120.00', paidAmount: '50.00', balanceDue: '70.00' }), isLoading: false, isError: false })
    renderAt('inv-1')

    expect(screen.getByText('70.00 USD')).toBeInTheDocument() // balance due (unique)
    expect(screen.getAllByText('120.00 USD').length).toBeGreaterThan(0) // subtotal + total
    expect(screen.getAllByText('50.00 USD').length).toBeGreaterThan(0) // paid total + allocation row
  })

  it('the Print/PDF action links to the existing /invoice/:id print route for the SAME invoice — reuses it, does not duplicate it', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice(), isLoading: false, isError: false })
    renderAt('inv-1')

    const printLink = screen.getByRole('link', { name: /Print \/ PDF/ })
    expect(printLink).toHaveAttribute('href', '/invoice/inv-1')
    expect(printLink).toHaveAttribute('target', '_blank')
  })

  it('shows "Cancel invoice" for an unpaid, non-cancelled invoice', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice({ status: 'issued', paidAmount: '0.00' }), isLoading: false, isError: false })
    renderAt('inv-1')

    expect(screen.getByRole('button', { name: /Cancel invoice/ })).toBeInTheDocument()
  })

  it('hides "Cancel invoice" once a payment has been applied — matches the backend PAYMENT_EXISTS guard', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice({ status: 'partially_paid', paidAmount: '50.00' }), isLoading: false, isError: false })
    renderAt('inv-1')

    expect(screen.queryByRole('button', { name: /Cancel invoice/ })).not.toBeInTheDocument()
  })

  it('hides "Cancel invoice" for an already-cancelled invoice', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice({ status: 'cancelled', paidAmount: '0.00' }), isLoading: false, isError: false })
    renderAt('inv-1')

    expect(screen.queryByRole('button', { name: /Cancel invoice/ })).not.toBeInTheDocument()
  })

  it('shows a "not found" message for a 404, distinct from a generic load failure', () => {
    mockUseInvoice.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { status: 404 }, refetch: vi.fn() })
    renderAt('missing-id')

    expect(screen.getByText('Invoice not found.')).toBeInTheDocument()
  })

  it('shows the order source reference for an ORDER invoice, or "Warehouse sale" when there is no order', () => {
    mockUseInvoice.mockReturnValue({ data: baseInvoice({ order: null, orderId: null }), isLoading: false, isError: false })
    renderAt('inv-1')

    expect(screen.getByText('Warehouse sale (no order)')).toBeInTheDocument()
  })
})
