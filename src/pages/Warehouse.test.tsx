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
    // Nested relation from GET /stock-lots itself (scoped to {id, name} only —
    // see stock-lots.service.ts's SAFE_SUPPLIER_SELECT) — never a separate
    // GET /suppliers call, which is owner/accountant-only.
    supplier: { id: 'sup-1', name: 'Gulf Charcoal Co.' },
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

// Dynamic mocks — default to the same empty/loaded state the original test
// suite relied on (reset in beforeEach below), overridden per-test for the
// packed-goods detail-view / pagination coverage.
const mockUsePackedStockSummary = vi.fn()
const mockUsePackedStock = vi.fn()
const mockUseBagTypes = vi.fn()
const mockUsePackingSessions = vi.fn()
const mockUseStockLots = vi.fn()

function defaultPackedStockPage() {
  return { data: { data: [], total: 0, page: 1, limit: 20 }, isLoading: false, isError: false, refetch: vi.fn() }
}

vi.mock('../hooks/useWarehouse', () => ({
  useStockLots: (...args: unknown[]) => mockUseStockLots(...args),
  usePackedStockSummary: () => mockUsePackedStockSummary(),
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
  usePackedStock: (...args: unknown[]) => mockUsePackedStock(...args),
  useWasteSummary: () => ({ data: undefined, isLoading: false }),
  useWasteLedger: () => ({ data: { data: [], total: 0, page: 1, limit: 50 }, isLoading: false, isError: false, refetch: vi.fn() }),
}))

vi.mock('../hooks/usePacking', () => ({
  usePackingSessions: (...args: unknown[]) => mockUsePackingSessions(...args),
}))

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => mockUseBagTypes(),
}))

import Warehouse from './Warehouse'

beforeEach(() => {
  vi.clearAllMocks()
  approveIsPending = false
  rejectIsPending = false
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mockUsePackedStockSummary.mockReturnValue({ data: [], isLoading: false })
  mockUsePackedStock.mockReturnValue(defaultPackedStockPage())
  mockUseBagTypes.mockReturnValue({ data: [] })
  mockUsePackingSessions.mockReturnValue({ data: { data: [] }, isLoading: false })
  mockUseStockAdjustments.mockReturnValue({ data: { data: [] }, isLoading: false })
  mockUseStockLots.mockReturnValue({ data: { data: [makeLot()] }, isLoading: false, isError: false })
})

// ---------------------------------------------------------------------------
// Regression coverage for a real authorization/correctness gap found during
// the full Warehouse forensic audit: the Raw Lots "Supplier" column used to
// come from a SEPARATE GET /suppliers call (owner/accountant-only per
// SuppliersController), which 403s for sales_rep/worker — every lot's
// Supplier cell silently fell back to a raw supplierId UUID for those roles.
// Fixed by reading the name from StockLot's OWN nested `supplier` relation
// (now scoped server-side to {id, name} only — see stock-lots.service.ts's
// SAFE_SUPPLIER_SELECT, which also closes the real leak this replaced: that
// relation previously returned the FULL Supplier record, including bank
// IBAN/SWIFT/account number, to every role that could reach /stock-lots).
// ---------------------------------------------------------------------------
describe('Warehouse — Raw lots: supplier name sourced from StockLot itself', () => {
  it('shows the supplier name from the lot\'s own nested relation, not a separate suppliers call', () => {
    render(<Warehouse />)
    expect(screen.getByText('Gulf Charcoal Co.')).toBeInTheDocument()
  })

  it('falls back to the raw supplierId when the nested relation is absent, without crashing', () => {
    mockUseStockLots.mockReturnValue({
      data: { data: [makeLot({ supplier: undefined, supplierId: 'sup-99' })] },
      isLoading: false,
      isError: false,
    })
    render(<Warehouse />)
    expect(screen.getByText('sup-99')).toBeInTheDocument()
    expect(screen.queryByText('Gulf Charcoal Co.')).not.toBeInTheDocument()
  })
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

  // Regression coverage: GET /stock-adjustments is owner-only server-side —
  // a worker/accountant (both of whom CAN create an adjustment per the same
  // controller) get a 403 here. Before this fix, the tab silently rendered
  // "No adjustments logged yet." on ANY fetch failure, indistinguishable
  // from a genuinely empty, permitted list. It now shows a real error state
  // with Retry, matching the Raw Lots / Packed Goods tables' own convention.
  it('shows a distinct error state (not the empty state) when the adjustments fetch fails, with a working retry', async () => {
    const refetch = vi.fn()
    mockUseStockAdjustments.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    render(<Warehouse />)
    const user = await openAdjustmentsTab()

    expect(screen.getByText('Failed to load adjustments.')).toBeInTheDocument()
    expect(screen.queryByText('No adjustments logged yet.')).not.toBeInTheDocument()
    await user.click(screen.getByText('Retry'))
    expect(refetch).toHaveBeenCalled()
  })

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

// ---------------------------------------------------------------------------
// Warehouse → Packed goods: card detail view + source-lot table pagination.
// ---------------------------------------------------------------------------

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    bagTypeId: 'bt-1',
    bagTypeName: '2kg Bag',
    totalBags: 1180,
    reservedBags: 20,
    availableBags: 1160,
    totalNominalKg: '2360.000',
    lotCount: 9,
    ...overrides,
  }
}

function makePackedStockRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ps-${i}`,
    lotId: `lot-${i}`,
    bagTypeId: 'bt-1',
    quantity: 10,
    reservedQuantity: 0,
    sessionId: `sess-${i}`,
    createdAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    lot: { id: `lot-${i}`, displayId: `LOT-${String(i).padStart(3, '0')}`, charcoalType: 'BBQ Hardwood', grade: 'A', costPerKg: '0.50', dateReceived: '2026-08-01' },
    bagType: { id: 'bt-1', name: '2kg Bag', nominalKg: '2.000', costPerBag: '0.30', workerRate: '0.10', note: null },
    session: { date: '2026-08-15' },
    ...overrides,
  }
}

async function openPackedGoodsTab() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Packed goods/ }))
  return user
}

describe('Warehouse — Packed goods: card click → detail view', () => {
  it('renders a packed-good card with bag type, stock, nominal kg and lot count', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    render(<Warehouse />)
    await openPackedGoodsTab()

    expect(screen.getByText('2kg Bag')).toBeInTheDocument()
    expect(screen.getAllByText('1,180').length).toBeGreaterThan(0)
    expect(screen.getByText('9 lots')).toBeInTheDocument()
  })

  it('clicking a packed-good card opens the detail view', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByText('2kg Bag'))

    expect(screen.getByText('Back to warehouse')).toBeInTheDocument()
    expect(screen.getByText('Current stock')).toBeInTheDocument()
    expect(screen.getAllByText('1,180 bags').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2,360 kg').length).toBeGreaterThan(0)
  })

  it('queries source lots using the exact clicked card\'s bagTypeId, not its display name', async () => {
    mockUsePackedStockSummary.mockReturnValue({
      data: [makeCard({ bagTypeId: 'bt-42', bagTypeName: '5kg Bag' })],
      isLoading: false,
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('5kg Bag'))

    const detailCalls = mockUsePackedStock.mock.calls.filter(([params]) => params?.bagTypeId)
    expect(detailCalls.length).toBeGreaterThan(0)
    expect(detailCalls[detailCalls.length - 1][0]).toMatchObject({ bagTypeId: 'bt-42' })
  })

  it('displays the correct source-lot data for the selected bag type', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    mockUsePackedStock.mockImplementation((params: { bagTypeId?: string } = {}) => {
      if (params.bagTypeId) {
        return { data: { data: [makePackedStockRow(1)], total: 1, page: 1, limit: 100 }, isLoading: false, isError: false, refetch: vi.fn() }
      }
      return defaultPackedStockPage()
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('2kg Bag'))

    expect(screen.getByText('LOT-001')).toBeInTheDocument()
    expect(screen.getByText('BBQ Hardwood · Grade A')).toBeInTheDocument()
  })

  it('switching from bag type A to bag type B shows B\'s data, not a stale copy of A\'s', async () => {
    mockUsePackedStockSummary.mockReturnValue({
      data: [makeCard({ bagTypeId: 'bt-a', bagTypeName: 'Bag A' }), makeCard({ bagTypeId: 'bt-b', bagTypeName: 'Bag B' })],
      isLoading: false,
    })
    mockUsePackedStock.mockImplementation((params: { bagTypeId?: string } = {}) => {
      if (params.bagTypeId === 'bt-a') {
        return { data: { data: [makePackedStockRow(1, { lot: { ...makePackedStockRow(1).lot, displayId: 'LOT-A' } })], total: 1, page: 1, limit: 100 }, isLoading: false, isError: false, refetch: vi.fn() }
      }
      if (params.bagTypeId === 'bt-b') {
        return { data: { data: [makePackedStockRow(2, { lot: { ...makePackedStockRow(2).lot, displayId: 'LOT-B' } })], total: 1, page: 1, limit: 100 }, isLoading: false, isError: false, refetch: vi.fn() }
      }
      return defaultPackedStockPage()
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByText('Bag A'))
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.queryByText('LOT-B')).not.toBeInTheDocument()

    await user.click(screen.getByText('Back to warehouse'))
    await user.click(screen.getByText('Bag B'))
    expect(screen.getByText('LOT-B')).toBeInTheDocument()
    expect(screen.queryByText('LOT-A')).not.toBeInTheDocument()
  })

  it('detail view shows the empty state when the bag type has no source lots', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    render(<Warehouse />) // default mock already returns an empty packed-stock page
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('2kg Bag'))

    expect(screen.getByText('No source lots for this bag type.')).toBeInTheDocument()
  })

  it('detail view shows a loading state for source lots', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    mockUsePackedStock.mockImplementation((params: { bagTypeId?: string } = {}) => {
      if (params.bagTypeId) return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
      return defaultPackedStockPage()
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('2kg Bag'))

    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0)
  })

  it('detail view shows an error state with a working retry for source lots', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    const refetch = vi.fn()
    mockUsePackedStock.mockImplementation((params: { bagTypeId?: string } = {}) => {
      if (params.bagTypeId) return { data: undefined, isLoading: false, isError: true, refetch }
      return defaultPackedStockPage()
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('2kg Bag'))

    expect(screen.getByText('Failed to load source lots.')).toBeInTheDocument()
    await user.click(screen.getByText('Retry'))
    expect(refetch).toHaveBeenCalled()
  })

  it('a long bag type name and long source-lot IDs render fully without throwing', async () => {
    const longName = 'A'.repeat(120) + ' Extra Large Custom Bag Type'
    mockUsePackedStockSummary.mockReturnValue({
      data: [makeCard({ bagTypeName: longName })],
      isLoading: false,
    })
    mockUsePackedStock.mockImplementation((params: { bagTypeId?: string } = {}) => {
      if (params.bagTypeId) {
        return {
          data: {
            data: [makePackedStockRow(1, { lot: { ...makePackedStockRow(1).lot, displayId: 'X'.repeat(80), charcoalType: 'Y'.repeat(80) } })],
            total: 1, page: 1, limit: 100,
          },
          isLoading: false, isError: false, refetch: vi.fn(),
        }
      }
      return defaultPackedStockPage()
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByText(longName))
    expect(screen.getAllByText((_, el) => el?.textContent === longName).length).toBeGreaterThan(0)
    expect(screen.getByText('X'.repeat(80))).toBeInTheDocument()
  })

  it('mixed source lots: shows EVERY distinct type/grade combination as its own row — never collapses multiple lots into one representative type/grade (real "2kg Bag" data shape)', async () => {
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    const rows = [
      makePackedStockRow(1, { lotId: 'lot-6517f36c', quantity: 360, lot: { id: 'lot-6517f36c', displayId: 'LOT-6517', charcoalType: 'BBQ hardwood', grade: 'B', costPerKg: '0.50', dateReceived: '2026-08-01' } }),
      makePackedStockRow(2, { lotId: 'lot-00000000', quantity: 320, lot: { id: 'lot-00000000', displayId: 'LOT-0000', charcoalType: 'BBQ hardwood', grade: 'A', costPerKg: '0.50', dateReceived: '2026-08-01' } }),
      makePackedStockRow(3, { lotId: 'lot-85e6a61a', quantity: 320, lot: { id: 'lot-85e6a61a', displayId: 'LOT-85E6', charcoalType: 'BBQ Hardwood', grade: 'A', costPerKg: '0.50', dateReceived: '2026-08-01' } }),
      // Same lot as row 1, a later packing date — must stay a SEPARATE row, not merged.
      makePackedStockRow(4, { lotId: 'lot-6517f36c', quantity: 51, lot: { id: 'lot-6517f36c', displayId: 'LOT-6517', charcoalType: 'BBQ hardwood', grade: 'B', costPerKg: '0.50', dateReceived: '2026-08-01' } }),
    ]
    mockUsePackedStock.mockImplementation((params: { bagTypeId?: string } = {}) => {
      if (params.bagTypeId) {
        return { data: { data: rows, total: rows.length, page: 1, limit: 100 }, isLoading: false, isError: false, refetch: vi.fn() }
      }
      return defaultPackedStockPage()
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('2kg Bag'))

    // 4 real packing records → 4 rows, not deduped by lotId.
    expect(screen.getByText('4 batches')).toBeInTheDocument()
    // Both type/grade combinations that appear on the repeated lot's own rows are visible...
    expect(screen.getAllByText('BBQ hardwood · Grade B').length).toBe(2)
    // ...alongside the OTHER lots' distinct type/grade, none hidden behind a single representative value.
    expect(screen.getByText('BBQ hardwood · Grade A')).toBeInTheDocument()
    expect(screen.getByText('BBQ Hardwood · Grade A')).toBeInTheDocument()
    expect(screen.getAllByText('LOT-6517').length).toBe(2)
  })

  it('a zero-quantity bag type still opens a valid, non-crashing detail view', async () => {
    mockUsePackedStockSummary.mockReturnValue({
      data: [makeCard({ totalBags: 0, availableBags: 0, reservedBags: 0, totalNominalKg: '0.000', lotCount: 0 })],
      isLoading: false,
    })
    render(<Warehouse />)
    const user = await openPackedGoodsTab()
    await user.click(screen.getByText('2kg Bag'))

    expect(screen.getAllByText('0 bags').length).toBeGreaterThan(0)
    expect(screen.getByText('No source lots for this bag type.')).toBeInTheDocument()
  })
})

describe('Warehouse — Packed stock by source lot: pagination', () => {
  function makeFullDataset(total: number) {
    return Array.from({ length: total }, (_, i) => makePackedStockRow(i + 1))
  }

  function paginatedMock(total: number) {
    const all = makeFullDataset(total)
    return (params: { page?: number; limit?: number; bagTypeId?: string } = {}) => {
      if (params.bagTypeId) return defaultPackedStockPage()
      const page = params.page ?? 1
      const limit = params.limit ?? 20
      const start = (page - 1) * limit
      return {
        data: { data: all.slice(start, start + limit), total, page, limit },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      }
    }
  }

  it('shows exactly 20 rows on page 1 when more than 20 exist', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    await openPackedGoodsTab()

    expect(screen.getByText('LOT-001')).toBeInTheDocument()
    expect(screen.getByText('LOT-020')).toBeInTheDocument()
    expect(screen.queryByText('LOT-021')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1–20 of 47')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('Previous is disabled on page 1', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    await openPackedGoodsTab()

    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
  })

  it('Next advances to page 2, showing the next 20 rows', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByRole('button', { name: /Next/ }))

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('LOT-021')).toBeInTheDocument()
    expect(screen.getByText('LOT-040')).toBeInTheDocument()
    expect(screen.queryByText('LOT-001')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 21–40 of 47')).toBeInTheDocument()
  })

  it('the final page shows only the remaining rows, and Next is disabled', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByRole('button', { name: /Next/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))

    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByText('LOT-041')).toBeInTheDocument()
    expect(screen.getByText('LOT-047')).toBeInTheDocument()
    expect(screen.queryByText('LOT-048')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 41–47 of 47')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('Previous moves back a page and both controls are enabled again on the middle page', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByRole('button', { name: /Next/ })) // page 2
    await user.click(screen.getByRole('button', { name: /Next/ })) // page 3 (final)
    await user.click(screen.getByRole('button', { name: /Previous/ })) // back to page 2

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('LOT-021')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled()
  })

  it('exactly 20 rows produces exactly one page, with both controls disabled', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(20))
    render(<Warehouse />)
    await openPackedGoodsTab()

    expect(screen.getByText('Showing 1–20 of 20')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('0 rows keeps the existing empty state and shows no pagination controls', async () => {
    // A packed-good card with real stock but the *table* still returns 0 rows
    // (an edge case, but keeps "No packed stock." unambiguous to just the table).
    mockUsePackedStockSummary.mockReturnValue({ data: [makeCard()], isLoading: false })
    mockUsePackedStock.mockImplementation(paginatedMock(0))
    render(<Warehouse />)
    await openPackedGoodsTab()

    const table = screen.getByRole('table')
    expect(table.textContent).toContain('No packed stock.')
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Previous/ })).not.toBeInTheDocument()
  })

  it('the Export button is present and unchanged (still no wired export behavior, none broken by pagination)', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    await openPackedGoodsTab()

    const exportButtons = screen.getAllByRole('button', { name: 'Export' })
    expect(exportButtons.length).toBeGreaterThan(0)
    // No onClick wired — clicking it must not throw and must not affect pagination.
    const user = userEvent.setup()
    await user.click(exportButtons[exportButtons.length - 1])
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('switching to the Adjustments tab and back resets the table to page 1', async () => {
    mockUsePackedStock.mockImplementation(paginatedMock(47))
    render(<Warehouse />)
    const user = await openPackedGoodsTab()

    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Adjustments/ }))
    await user.click(screen.getByRole('button', { name: /Packed goods/ }))

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('LOT-001')).toBeInTheDocument()
  })
})
