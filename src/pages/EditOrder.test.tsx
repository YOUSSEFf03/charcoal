// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the Edit Order redesign — replaces the old generic
// modal with a dedicated /orders/:id/edit page built as the editing
// counterpart of NewOrder.tsx. Covers: existing data populates correctly,
// locked fields are respected exactly as OrdersService.update() enforces
// them (clientId/currency/bagTypeId/totalKgRequested/pricePerBag are
// draft-only), notes/supplier clearing actually clears (not silently
// dropped), double-submit protection, and backend error surfacing.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, children }: { title?: string; children?: ReactNode }) => <div><h1>{title}</h1>{children}</div>,
}))

const mockUseOrder = vi.fn()
const mockUpdateOrderMutate = vi.fn()
let updateOrderIsPending = false

vi.mock('../hooks/useOrders', () => ({
  useOrder: (id: string) => mockUseOrder(id),
  useUpdateOrder: () => ({ mutate: mockUpdateOrderMutate, isPending: updateOrderIsPending }),
}))

const mockUseClients = vi.fn()
const mockUseClient = vi.fn()
const mockUseClientLocations = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClients: (...args: unknown[]) => mockUseClients(...args),
  useClient: (id: string) => mockUseClient(id),
  // Multiple-locations audit, 2026-08-31 — controllable so the location-
  // selector describe block below can exercise it; defaults to an empty
  // list so every pre-existing test keeps showLocationSelector false.
  useClientLocations: (...args: unknown[]) => mockUseClientLocations(...args),
}))

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({
    data: [
      { id: 'bt-10', name: '10kg Bag', nominalKg: '10' },
      { id: 'bt-5', name: '5kg Bag', nominalKg: '5' },
    ],
  }),
}))

const mockUseAvailableStockLots = vi.fn()
vi.mock('../hooks/useWarehouse', () => ({
  usePackedStockSummary: () => ({ data: [{ bagTypeId: 'bt-10', totalBags: 40 }] }),
  useAvailableStockLots: () => mockUseAvailableStockLots(),
}))

vi.mock('../hooks/useUsers', () => ({
  useUsers: () => ({ data: { data: [{ id: 'driver-1', name: 'Test Driver' }] } }),
}))

import EditOrder from './EditOrder'

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    displayId: 'SO-0027',
    clientId: 'client-1',
    client: { id: 'client-1', name: 'Beirut Shisha Lounge', type: 'restaurant', currency: 'USD' },
    charcoalType: 'BBQ Hardwood',
    grade: 'A',
    totalKgRequested: '150.000',
    bagTypeId: 'bt-5',
    bagType: { id: 'bt-5', name: '5kg Bag', nominalKg: '5' },
    pricePerBag: '10.00',
    currency: 'USD',
    status: 'draft',
    createdById: 'user-1',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    notes: 'Seed order #12',
    supplierName: null,
    driverId: null,
    driver: null,
    bagLines: [],
    shipments: [],
    invoices: [],
    ...overrides,
  }
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    name: 'Beirut Shisha Lounge',
    type: 'restaurant',
    currency: 'USD',
    balance: '0',
    paymentTerms: null,
    ...overrides,
  }
}

function renderEditOrder() {
  return render(
    <MemoryRouter initialEntries={['/orders/order-1/edit']}>
      <Routes>
        <Route path="/orders/:id/edit" element={<EditOrder />} />
        <Route path="/orders/:id" element={<div>order-1 detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updateOrderIsPending = false
  mockUseOrder.mockReturnValue({ data: makeOrder(), isLoading: false, isError: false, refetch: vi.fn() })
  mockUseClient.mockReturnValue({ data: makeClient() })
  mockUseClients.mockReturnValue({ data: { data: [] }, isLoading: false })
  mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })
  // Real, in-stock lots — the authoritative source the KG-mode "Charcoal
  // lot" selector reads from (same shape/format as NewOrder's own picker).
  mockUseAvailableStockLots.mockReturnValue({
    data: [
      { id: 'lot-1', charcoalType: 'BBQ Hardwood', grade: 'A', kgRemaining: '500', supplier: { id: 'sup-1', name: 'Sakher' } },
      { id: 'lot-2', charcoalType: 'Oak', grade: 'A', kgRemaining: '300', supplier: { id: 'sup-2', name: 'Gulf Charcoal Co.' } },
      { id: 'lot-3', charcoalType: 'Olive', grade: 'B', kgRemaining: '120', supplier: { id: 'sup-1', name: 'Sakher' } },
    ],
  })
})

describe('EditOrder — existing order populates correctly', () => {
  it('populates the existing client', () => {
    renderEditOrder()
    expect(screen.getAllByText('Beirut Shisha Lounge').length).toBeGreaterThan(0)
  })

  it('shows the existing order date, read-only (createdAt has no editable backend field)', () => {
    renderEditOrder()
    const dateInput = screen.getByLabelText('Order date') as HTMLInputElement
    expect(dateInput).toHaveAttribute('readOnly')
    expect(dateInput.value).not.toBe('')
  })

  it('shows the existing currency', () => {
    renderEditOrder()
    expect(screen.getByLabelText('Currency (from client)')).toHaveValue('USD')
  })

  it('populates the existing bag type, quantity, and price', () => {
    renderEditOrder()
    expect(screen.getByRole('combobox', { name: 'Bag type' })).toHaveValue('bt-5')
    // 150kg / 5kg-per-bag = 30 bags
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(30)
    expect(screen.getByRole('spinbutton', { name: 'Price / bag' })).toHaveValue(10)
  })

  // Supplier (like Charcoal type / Grade) is not shown at all in BAG mode —
  // see 'EditOrder — KG order line' below for supplier coverage in KG mode,
  // the only mode where it's still editable in this view.

  it('populates existing notes, Arabic included', () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ notes: 'توصيل قبل الساعة 11' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByPlaceholderText('e.g. deliver before 11am')).toHaveValue('توصيل قبل الساعة 11')
  })

  it('the preview reflects the populated line (bags, kg, total)', () => {
    renderEditOrder()
    expect(screen.getAllByText('30 bags').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0) // 30 * $10
  })

  it('no bagTypeId UUID is ever rendered as visible text — only the human-readable name', () => {
    renderEditOrder()
    expect(screen.queryByText('bt-5')).not.toBeInTheDocument()
    expect(screen.getAllByText(/5kg Bag/).length).toBeGreaterThan(0)
  })
})

describe('EditOrder — locked-field behavior once the order has left draft', () => {
  it('client is shown locked, not as an editable selector', () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ status: 'confirmed' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search by name…')).not.toBeInTheDocument()
  })

  it('bag type, quantity, and price are disabled', () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ status: 'delivered' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByRole('combobox', { name: 'Bag type' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'Price / bag' })).toBeDisabled()
  })

  it('the bag/kg mode toggle is disabled', () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ status: 'invoiced' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByRole('button', { name: /^Bag$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^KG$/ })).toBeDisabled()
  })

  it('driver and notes remain editable on a paid bag order (no backend guard on these)', () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ status: 'paid' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByLabelText('Driver')).toBeEnabled()
    expect(screen.getByPlaceholderText('e.g. deliver before 11am')).toBeEnabled()
  })

  it('a locked order omits clientId/currency/bagTypeId/totalKgRequested/pricePerBag from the save payload entirely — not just unchanged', async () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ status: 'delivered' }), isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderEditOrder()

    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])
    expect(mockUpdateOrderMutate).toHaveBeenCalledTimes(1)
    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(body).not.toHaveProperty('clientId')
    expect(body).not.toHaveProperty('currency')
    expect(body).not.toHaveProperty('bagTypeId')
    expect(body).not.toHaveProperty('totalKgRequested')
    expect(body).not.toHaveProperty('pricePerBag')
  })
})

describe('EditOrder — save payload (draft order)', () => {
  it('submits the full editable payload, including recomputed totalKgRequested', async () => {
    const user = userEvent.setup()
    renderEditOrder()

    await user.clear(screen.getByRole('spinbutton', { name: 'Quantity' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Quantity' }), '40')
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])

    expect(mockUpdateOrderMutate).toHaveBeenCalledTimes(1)
    const [{ id, body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(id).toBe('order-1')
    expect(body).toMatchObject({
      clientId: 'client-1',
      currency: 'USD',
      bagTypeId: 'bt-5',
      totalKgRequested: '200.00', // 40 bags * 5kg
      pricePerBag: '10.00',
    })
  })

  it('clearing notes sends notes: null, not an omitted/empty-string field — the same class of bug fixed elsewhere in this app', async () => {
    mockUseOrder.mockReturnValue({ data: makeOrder({ notes: 'Seed order #12' }), isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderEditOrder()

    const notesField = screen.getByPlaceholderText('e.g. deliver before 11am')
    await user.clear(notesField)
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])

    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(body.notes).toBeNull()
  })

  // Supplier no longer has its own clearable input in any mode — it's a
  // read-out of whichever lot is selected in KG mode (see 'EditOrder — KG
  // order line' below), and not shown at all in BAG mode. There's no UI
  // path to clear supplierName independently of charcoalType/grade anymore.
})

describe('EditOrder — save behavior', () => {
  it('the Save button is disabled while the mutation is pending', () => {
    updateOrderIsPending = true
    renderEditOrder()
    expect(screen.getAllByRole('button', { name: /Saving…/ })[0]).toBeDisabled()
  })

  it('a click while pending does not call mutate again', async () => {
    updateOrderIsPending = true
    const user = userEvent.setup()
    renderEditOrder()
    await user.click(screen.getAllByRole('button', { name: /Saving…/ })[0])
    expect(mockUpdateOrderMutate).not.toHaveBeenCalled()
  })

  it('navigates to the order detail page on success', async () => {
    mockUpdateOrderMutate.mockImplementation((_vars, { onSuccess }: any) => onSuccess())
    const user = userEvent.setup()
    renderEditOrder()
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])
    expect(await screen.findByText('order-1 detail')).toBeInTheDocument()
  })

  it('shows the real backend validation error, never a raw crash', async () => {
    mockUpdateOrderMutate.mockImplementation((_vars, { onError }: any) => {
      onError({ error: 'Order currency (LBP) must match the client\'s currency (USD)', code: 'CONSTRAINT_VIOLATION' })
    })
    const user = userEvent.setup()
    renderEditOrder()
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])
    expect(await screen.findByText(/Order currency \(LBP\) must match/)).toBeInTheDocument()
  })

  it('Cancel navigates back to the order detail page without saving', async () => {
    const user = userEvent.setup()
    renderEditOrder()
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(await screen.findByText('order-1 detail')).toBeInTheDocument()
    expect(mockUpdateOrderMutate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Regression coverage for the BAG/KG order-line redesign (see EditOrder.tsx
// doc comment). ClientOrder has no stockLotId anywhere in the schema and a KG
// order never deducts stock from a lot on delivery (OrdersService.
// markDelivered()'s "nothing to deduct" branch), so "Charcoal lot" can't be a
// locked record of where the order came from — but it DOES mirror NewOrder's
// KG-mode lot picker: same option format ("type grade · supplier (kg)"), and
// picking one auto-fills charcoalType/grade/supplierName the same way. Grade
// and Supplier no longer have their own separate inputs anywhere — folded
// into this one selector for KG mode, and not shown at all for BAG mode.
// ---------------------------------------------------------------------------
function makeKgOrder(overrides: Record<string, unknown> = {}) {
  return makeOrder({
    bagTypeId: null,
    bagType: null,
    // Matches lot-2 exactly (Oak / A / Gulf Charcoal Co.) so the default KG
    // order in these tests starts on a real, matched lot.
    charcoalType: 'Oak',
    grade: 'A',
    supplierName: 'Gulf Charcoal Co.',
    totalKgRequested: '250.500',
    pricePerBag: '2.50',
    ...overrides,
  })
}

describe('EditOrder — charcoal/grade/supplier fields', () => {
  it('are not shown at all in BAG mode — not needed there', () => {
    renderEditOrder()
    expect(screen.queryByLabelText('Charcoal lot')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Grade')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('— No supplier —')).not.toBeInTheDocument()
  })

  it('Grade and Supplier have no separate inputs in KG mode either — folded into the lot selector', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.queryByLabelText('Grade')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('— No supplier —')).not.toBeInTheDocument()
  })
})

describe('EditOrder — KG order line', () => {
  it('shows the Bag Type selector in BAG mode', () => {
    renderEditOrder()
    expect(screen.getByRole('combobox', { name: 'Bag type' })).toBeInTheDocument()
  })

  it('does NOT show a Bag Type selector in KG mode — KG mode has no bag concept', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.queryByRole('combobox', { name: 'Bag type' })).not.toBeInTheDocument()
  })

  it('populates the existing KG quantity and price', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByLabelText('Qty (kg)')).toHaveValue(250.5)
    expect(screen.getByLabelText('Price / kg')).toHaveValue(2.5)
  })

  it('the KG line total is correct', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder({ totalKgRequested: '100.000', pricePerBag: '3.00' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)
  })

  it('renders a <select>, not a text input, for Charcoal lot', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByLabelText('Charcoal lot').tagName).toBe('SELECT')
  })

  it('pre-selects the lot matching the order\'s existing charcoal type/grade/supplier — same option format as New Order (type grade · supplier (kg))', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    const select = screen.getByLabelText('Charcoal lot') as HTMLSelectElement
    expect(select).toHaveValue('lot-2') // Oak / A / Gulf Charcoal Co. — matches makeKgOrder()'s default
    expect(screen.getByText('Oak A · Gulf Charcoal Co. (300 kg)')).toBeInTheDocument()
  })

  it('lot options are human-readable (type, grade, supplier, remaining kg) — no raw StockLot UUID ever appears as visible text', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.queryByText('lot-1')).not.toBeInTheDocument()
    expect(screen.queryByText('lot-2')).not.toBeInTheDocument()
    expect(screen.queryByText('lot-3')).not.toBeInTheDocument()
    expect(screen.getByText('BBQ Hardwood A · Sakher (500 kg)')).toBeInTheDocument()
    expect(screen.getByText('Oak A · Gulf Charcoal Co. (300 kg)')).toBeInTheDocument()
    expect(screen.getByText('Olive B · Sakher (120 kg)')).toBeInTheDocument()
  })

  it('selecting a different lot updates charcoalType/grade/supplierName together and the save payload', async () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderEditOrder()
    await user.selectOptions(screen.getByLabelText('Charcoal lot'), 'lot-3') // Olive / B / Sakher
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])

    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    // Sent as plain string values to the EXISTING charcoalType/grade/supplierName
    // fields — no invented ID, no new schema field.
    expect(body.charcoalType).toBe('Olive')
    expect(body.grade).toBe('B')
    expect(body.supplierName).toBe('Sakher')
  })

  it('a legacy charcoal type/grade/supplier combo not matching any current lot is kept and shown, never silently replaced', () => {
    mockUseOrder.mockReturnValue({
      data: makeKgOrder({ charcoalType: 'Discontinued Mangrove', grade: 'C', supplierName: 'Old Supplier' }),
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderEditOrder()
    const select = screen.getByLabelText('Charcoal lot') as HTMLSelectElement
    expect(select).toHaveValue('__legacy__')
    expect(screen.getByText('Discontinued Mangrove C · Old Supplier (not currently in stock)')).toBeInTheDocument()
    expect(screen.getAllByText(/not currently in stock/).length).toBeGreaterThan(0)
  })

  it('blocks save with a clear message when the lot selection is cleared', async () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderEditOrder()
    await user.selectOptions(screen.getByLabelText('Charcoal lot'), '')
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])
    expect(mockUpdateOrderMutate).not.toHaveBeenCalled()
    expect(await screen.findByText('Charcoal type is required')).toBeInTheDocument()
  })

  it('editing KG quantity/price updates the save payload with the recomputed totalKgRequested', async () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder(), isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderEditOrder()

    await user.clear(screen.getByLabelText('Qty (kg)'))
    await user.type(screen.getByLabelText('Qty (kg)'), '400')
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])

    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(body.totalKgRequested).toBe('400.00')
    expect(body.bagTypeId).toBeNull() // KG mode always sends bagTypeId: null while draft
  })

  it('mode toggle is locked on a non-draft KG order too, not just bag orders', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder({ status: 'delivered' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByRole('button', { name: /^Bag$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^KG$/ })).toBeDisabled()
  })

  it('KG quantity and price are disabled once the order has left draft', () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder({ status: 'invoiced' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByLabelText('Qty (kg)')).toBeDisabled()
    expect(screen.getByLabelText('Price / kg')).toBeDisabled()
  })

  it('the Charcoal lot selector remains editable on a non-draft KG order (no backend guard on charcoalType/grade/supplierName)', async () => {
    mockUseOrder.mockReturnValue({ data: makeKgOrder({ status: 'paid' }), isLoading: false, isError: false, refetch: vi.fn() })
    const user = userEvent.setup()
    renderEditOrder()
    const select = screen.getByLabelText('Charcoal lot')
    expect(select).toBeEnabled()
    await user.selectOptions(select, 'lot-3')
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])
    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(body.charcoalType).toBe('Olive')
    expect(body).not.toHaveProperty('bagTypeId') // still locked, unaffected by this fix
  })
})

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-31): "Client Multiple Locations with ONE shared
// client balance" — CASE numbers reference the task's own test matrix.
// ---------------------------------------------------------------------------
describe('EditOrder — Location selector (forensic audit, 2026-08-31)', () => {
  it('is hidden entirely for a client not enabled for multiple locations (default fixture)', () => {
    renderEditOrder()
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument()
  })

  it('is hidden for a multi-location-enabled client with zero active locations', () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })
    renderEditOrder()
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument()
  })

  it('CASE 4/5 — shown with Location A and Location B for a multi-location-enabled client', () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({
      data: [
        { id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'loc-b', clientId: 'client-1', name: 'Jounieh Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      isLoading: false,
    })
    renderEditOrder()
    const select = screen.getByLabelText('Location') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Hamra Branch')).toBeInTheDocument()
    expect(screen.getByText('Jounieh Branch')).toBeInTheDocument()
  })

  it('a deactivated location is excluded from the selector options', () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({
      data: [
        { id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'loc-old', clientId: 'client-1', name: 'Old Closed Branch', address: null, phone: null, notes: null, isActive: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      isLoading: false,
    })
    renderEditOrder()
    expect(screen.getByText('Hamra Branch')).toBeInTheDocument()
    expect(screen.queryByText('Old Closed Branch')).not.toBeInTheDocument()
  })

  it('pre-selects the order\'s existing locationId', () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({
      data: [
        { id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'loc-b', clientId: 'client-1', name: 'Jounieh Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      isLoading: false,
    })
    mockUseOrder.mockReturnValue({ data: makeOrder({ locationId: 'loc-b' }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByLabelText('Location')).toHaveValue('loc-b')
  })

  it('CASE 14 — a historical order with no locationId shows "— Not specified —", never a fabricated location', () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    mockUseOrder.mockReturnValue({ data: makeOrder({ locationId: null }), isLoading: false, isError: false, refetch: vi.fn() })
    renderEditOrder()
    expect(screen.getByLabelText('Location')).toHaveValue('')
  })

  it('selecting a location includes locationId in the save payload', async () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderEditOrder()

    await user.selectOptions(screen.getByLabelText('Location'), 'loc-a')
    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])

    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(body.locationId).toBe('loc-a')
  })

  it('leaving the selector at "— Not specified —" sends locationId: null, never omitted', async () => {
    mockUseClient.mockReturnValue({ data: makeClient({ multiLocationEnabled: true }) })
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderEditOrder()

    await user.click(screen.getAllByRole('button', { name: /Save changes/ })[0])

    const [{ body }] = mockUpdateOrderMutate.mock.calls[0]
    expect(body.locationId).toBeNull()
  })
})
