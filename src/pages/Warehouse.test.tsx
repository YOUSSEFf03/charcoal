// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the stock-adjustment audit: a non-owner (accountant/
// worker) submitting a "New adjustment" is recorded as PENDING and never
// touches kgRemaining until an owner approves it (StockAdjustmentsService.
// create()/approve() — verified live against the real backend during this
// audit). The frontend previously had no way to approve/reject a pending
// adjustment at all — this covers the fix: a "Pending approval" badge +
// Approve/Reject buttons in the Adjustments tab, and an "Adjusted" badge on
// the Raw lots table for lots with at least one APPROVED adjustment (never
// for pending/rejected ones, which never changed kgRemaining).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

function makeLot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-1',
    displayId: 'G-001',
    charcoalType: 'BBQ Hardwood',
    grade: 'A',
    supplierId: 'sup-1',
    kgReceived: '1000.000',
    kgRemaining: '900.000',
    costPerKg: '0.50',
    source: 'container',
    dateReceived: '2026-08-01',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAdjustment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'adj-1',
    adjustmentType: 'lot',
    lotId: 'lot-1',
    lot: { charcoalType: 'BBQ Hardwood', grade: 'A' },
    packedStock: null,
    qtyBefore: '1000.000',
    qtyAfter: '900.000',
    difference: '-100.000',
    reason: 'Physical count',
    status: 'approved',
    countedBy: { name: 'Test Worker' },
    date: '2026-08-10',
    ...overrides,
  }
}

const mockUseStockAdjustments = vi.fn()
const mockCreateAdjMutate = vi.fn()
const mockUpdateAdjMutate = vi.fn()
const mockDeleteAdjMutate = vi.fn()
const mockApproveAdjMutate = vi.fn()
const mockRejectAdjMutate = vi.fn()
let approveIsPending = false
let rejectIsPending = false

vi.mock('../hooks/useWarehouse', () => ({
  useStockLots: () => ({ data: { data: [makeLot()] }, isLoading: false, isError: false }),
  usePackedStockSummary: () => ({ data: [] }),
  useWarehouseSummary: () => ({ data: undefined }),
  useStockAdjustments: (...args: unknown[]) => mockUseStockAdjustments(...args),
  useCreateStockAdjustment: () => ({ mutate: mockCreateAdjMutate, isPending: false }),
  useUpdateStockAdjustment: () => ({ mutate: mockUpdateAdjMutate, isPending: false }),
  useDeleteStockAdjustment: () => ({ mutate: mockDeleteAdjMutate, isPending: false }),
  useApproveStockAdjustment: () => ({ mutate: mockApproveAdjMutate, isPending: approveIsPending }),
  useRejectStockAdjustment: () => ({ mutate: mockRejectAdjMutate, isPending: rejectIsPending }),
  useStockExits: () => ({ data: { data: [], total: 0 } }),
  useLotMaterialFlow: () => ({ data: undefined }),
  useAvailableStockLots: () => ({ data: [] }),
}))

vi.mock('../hooks/usePacking', () => ({
  usePackingSessions: () => ({ data: { data: [] } }),
}))

vi.mock('../hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: { data: [{ id: 'sup-1', name: 'Gulf Charcoal Co.' }] } }),
}))

import Warehouse from './Warehouse'

beforeEach(() => {
  vi.clearAllMocks()
  approveIsPending = false
  rejectIsPending = false
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Warehouse — "Adjusted" badge on raw lots', () => {
  it('shows the badge for a lot with an approved adjustment', () => {
    mockUseStockAdjustments.mockReturnValue({ data: { data: [makeAdjustment({ status: 'approved' })] }, isLoading: false })
    render(<Warehouse />)
    expect(screen.getByText('Adjusted')).toBeInTheDocument()
  })

  it('does NOT show the badge for a lot whose only adjustment is pending — pending never changed kgRemaining', () => {
    mockUseStockAdjustments.mockReturnValue({ data: { data: [makeAdjustment({ status: 'pending' })] }, isLoading: false })
    render(<Warehouse />)
    expect(screen.queryByText('Adjusted')).not.toBeInTheDocument()
  })

  it('does NOT show the badge for a lot whose only adjustment is rejected', () => {
    mockUseStockAdjustments.mockReturnValue({ data: { data: [makeAdjustment({ status: 'rejected' })] }, isLoading: false })
    render(<Warehouse />)
    expect(screen.queryByText('Adjusted')).not.toBeInTheDocument()
  })

  it('shows no badge when there are no adjustments at all', () => {
    mockUseStockAdjustments.mockReturnValue({ data: { data: [] }, isLoading: false })
    render(<Warehouse />)
    expect(screen.queryByText('Adjusted')).not.toBeInTheDocument()
  })
})

describe('Warehouse — Adjustments tab: pending approval workflow', () => {
  async function openAdjustmentsTab() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Adjustments/ }))
    return user
  }

  it('shows a "Pending approval" badge and submitter name for a pending adjustment', async () => {
    mockUseStockAdjustments.mockReturnValue({
      data: { data: [makeAdjustment({ status: 'pending', countedBy: { name: 'Jamal (worker)' } })] },
      isLoading: false,
    })
    render(<Warehouse />)
    await openAdjustmentsTab()

    expect(screen.getByText('Pending approval')).toBeInTheDocument()
    expect(screen.getByText(/submitted by Jamal \(worker\) — stock not yet changed/)).toBeInTheDocument()
  })

  it('shows Approve/Reject buttons only for pending adjustments, not approved ones', async () => {
    mockUseStockAdjustments.mockReturnValue({
      data: {
        data: [
          makeAdjustment({ id: 'adj-pending', status: 'pending' }),
          makeAdjustment({ id: 'adj-approved', status: 'approved' }),
        ],
      },
      isLoading: false,
    })
    render(<Warehouse />)
    await openAdjustmentsTab()

    // Approve is titled distinctly from any other check-icon button on the page.
    expect(screen.getByTitle('Approve — applies the stock change now')).toBeInTheDocument()
    expect(screen.getByTitle('Reject — discards it, no stock change')).toBeInTheDocument()
  })

  it('clicking Approve calls the approve mutation with the adjustment id', async () => {
    mockUseStockAdjustments.mockReturnValue({
      data: { data: [makeAdjustment({ id: 'adj-42', status: 'pending' })] },
      isLoading: false,
    })
    render(<Warehouse />)
    const user = await openAdjustmentsTab()

    await user.click(screen.getByTitle('Approve — applies the stock change now'))
    expect(mockApproveAdjMutate).toHaveBeenCalledTimes(1)
    expect(mockApproveAdjMutate.mock.calls[0][0]).toBe('adj-42')
  })

  it('clicking Reject asks for confirmation, then calls the reject mutation with the adjustment id', async () => {
    mockUseStockAdjustments.mockReturnValue({
      data: { data: [makeAdjustment({ id: 'adj-42', status: 'pending' })] },
      isLoading: false,
    })
    render(<Warehouse />)
    const user = await openAdjustmentsTab()

    await user.click(screen.getByTitle('Reject — discards it, no stock change'))
    expect(window.confirm).toHaveBeenCalled()
    expect(mockRejectAdjMutate).toHaveBeenCalledTimes(1)
    expect(mockRejectAdjMutate.mock.calls[0][0]).toBe('adj-42')
  })

  it('does not reject when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockUseStockAdjustments.mockReturnValue({
      data: { data: [makeAdjustment({ id: 'adj-42', status: 'pending' })] },
      isLoading: false,
    })
    render(<Warehouse />)
    const user = await openAdjustmentsTab()

    await user.click(screen.getByTitle('Reject — discards it, no stock change'))
    expect(mockRejectAdjMutate).not.toHaveBeenCalled()
  })

  it('shows a "Rejected" badge for a rejected adjustment, with no Approve/Reject buttons', async () => {
    mockUseStockAdjustments.mockReturnValue({
      data: { data: [makeAdjustment({ status: 'rejected' })] },
      isLoading: false,
    })
    render(<Warehouse />)
    await openAdjustmentsTab()

    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.queryByTitle('Approve — applies the stock change now')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Reject — discards it, no stock change')).not.toBeInTheDocument()
  })

  it('an approved adjustment shows neither the pending nor rejected badge, and no Approve/Reject buttons', async () => {
    mockUseStockAdjustments.mockReturnValue({
      data: { data: [makeAdjustment({ status: 'approved' })] },
      isLoading: false,
    })
    render(<Warehouse />)
    await openAdjustmentsTab()

    expect(screen.queryByText('Pending approval')).not.toBeInTheDocument()
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Approve — applies the stock change now')).not.toBeInTheDocument()
  })
})
