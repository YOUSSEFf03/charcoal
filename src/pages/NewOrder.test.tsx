// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Forensic audit (2026-08-31): "Client Multiple Locations with ONE shared
// client balance" — coverage for the Location selector on the New Order page
// (CASE 4/5 of the task's own test matrix: creating an order for Location A
// / Location B). NewOrder.tsx has no pre-existing test file, so this one is
// scoped narrowly to client selection + the location selector + the create
// payload, rather than re-covering bag/kg-line behavior end-to-end.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, children }: { title?: string; children?: ReactNode }) => <div><h1>{title}</h1>{children}</div>,
}))

const mockUseClients = vi.fn()
const mockUseClient = vi.fn()
const mockUseClientLocations = vi.fn()
vi.mock('../hooks/useClients', () => ({
  useClients: (...args: unknown[]) => mockUseClients(...args),
  useClient: (...args: unknown[]) => mockUseClient(...args),
  useClientLocations: (...args: unknown[]) => mockUseClientLocations(...args),
}))

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [{ id: 'bt-5', name: '5kg Bag', nominalKg: '5' }] }),
}))

vi.mock('../hooks/useWarehouse', () => ({
  usePackedStockSummary: () => ({ data: [{ bagTypeId: 'bt-5', totalBags: 40 }] }),
  useStockLots: () => ({ data: { data: [] } }),
}))

const mockCreateOrderMutate = vi.fn()
vi.mock('../hooks/useOrders', () => ({
  useCreateOrder: () => ({ mutate: mockCreateOrderMutate, isPending: false }),
}))

vi.mock('../hooks/useUsers', () => ({
  useUsers: () => ({ data: { data: [] } }),
}))

import NewOrder from './NewOrder'

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    name: 'Beirut Shisha Lounge',
    type: 'restaurant',
    currency: 'USD',
    balance: '0',
    paymentTerms: null,
    multiLocationEnabled: false,
    ...overrides,
  }
}

function renderNewOrder() {
  return render(
    <MemoryRouter initialEntries={['/orders/new']}>
      <Routes>
        <Route path="/orders/new" element={<NewOrder />} />
        <Route path="/orders/:id" element={<div>order detail</div>} />
        <Route path="/orders" element={<div>orders list</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function pickClient(user: ReturnType<typeof userEvent.setup>, client: ReturnType<typeof makeClient>) {
  mockUseClients.mockReturnValue({ data: { data: [client] }, isLoading: false })
  await user.click(screen.getByPlaceholderText('Search by name…'))
  await user.click(await screen.findByText(client.name))
}

function locationSelect() {
  return within(screen.getByText(/^Location/).closest('.field') as HTMLElement).getByRole('combobox')
}

function quantityInput() {
  return within(screen.getByText('Quantity').closest('div') as HTMLElement).getByRole('spinbutton')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: undefined, isLoading: false })
  mockUseClients.mockReturnValue({ data: { data: [] }, isLoading: false })
  mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })
})

describe('NewOrder — Location selector (forensic audit, 2026-08-31)', () => {
  it('is hidden before any client is selected', () => {
    renderNewOrder()
    expect(screen.queryByText(/^Location/)).not.toBeInTheDocument()
  })

  it('is hidden for a client not enabled for multiple locations', async () => {
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: false }))
    expect(screen.queryByText(/^Location/)).not.toBeInTheDocument()
  })

  it('is hidden for a multi-location-enabled client with zero active locations', async () => {
    mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))
    expect(screen.queryByText(/^Location/)).not.toBeInTheDocument()
  })

  it('CASE 4/5 — shows Location A and Location B for a multi-location-enabled client', async () => {
    mockUseClientLocations.mockReturnValue({
      data: [
        { id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'loc-b', clientId: 'client-1', name: 'Jounieh Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))

    expect(screen.getByText(/^Location/)).toBeInTheDocument()
    expect(screen.getByText('Hamra Branch')).toBeInTheDocument()
    expect(screen.getByText('Jounieh Branch')).toBeInTheDocument()
  })

  it('a deactivated location is excluded from the options', async () => {
    mockUseClientLocations.mockReturnValue({
      data: [
        { id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'loc-old', clientId: 'client-1', name: 'Old Closed Branch', address: null, phone: null, notes: null, isActive: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))

    expect(screen.getByText('Hamra Branch')).toBeInTheDocument()
    expect(screen.queryByText('Old Closed Branch')).not.toBeInTheDocument()
  })

  it('switching clients resets the picked location (a location belongs to ONE specific client)', async () => {
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))
    await user.selectOptions(locationSelect(), 'loc-a')
    expect(locationSelect()).toHaveValue('loc-a')

    await user.click(screen.getByRole('button', { name: 'Change' }))
    mockUseClientLocations.mockReturnValue({ data: [], isLoading: false })
    await pickClient(user, makeClient({ id: 'client-2', name: 'Another Client', multiLocationEnabled: false }))

    expect(screen.queryByText(/^Location/)).not.toBeInTheDocument()
  })

  it('selecting a location includes locationId in the create-order payload (bag mode)', async () => {
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))
    await user.selectOptions(locationSelect(), 'loc-a')

    const [bagTypeSelect] = screen.getAllByRole('combobox').filter(el => within(el).queryByText('Select bag type…'))
    await user.selectOptions(bagTypeSelect, 'bt-5')
    await user.type(quantityInput(), '10')

    await user.click(screen.getByRole('button', { name: /Save as draft/ }))

    expect(mockCreateOrderMutate).toHaveBeenCalled()
    const [body] = mockCreateOrderMutate.mock.calls[0]
    expect(body.locationId).toBe('loc-a')
  })

  // ---------------------------------------------------------------------------
  // Required-location audit, 2026-09 — backend now REJECTS a normal order for
  // a multi-location client with no locationId (OrdersService.create()); this
  // is the UX-side mirror that stops the request from ever being sent.
  // ---------------------------------------------------------------------------
  it('multi-location client + no location selected → cannot submit (Save/Confirm stay disabled, no mutate call, no toast bypass)', async () => {
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))

    const [bagTypeSelect] = screen.getAllByRole('combobox').filter(el => within(el).queryByText('Select bag type…'))
    await user.selectOptions(bagTypeSelect, 'bt-5')
    await user.type(quantityInput(), '10')

    const saveDraftBtn = screen.getByRole('button', { name: /Save as draft/ })
    expect(saveDraftBtn).toBeDisabled()
    expect(saveDraftBtn).toHaveAttribute('title', 'Select a location for this client')

    // The button is disabled, so a click is a no-op at the DOM level — that
    // disabled state (asserted above) is itself the guard; mutate must never
    // fire regardless.
    await user.click(saveDraftBtn)
    expect(mockCreateOrderMutate).not.toHaveBeenCalled()
  })

  it('multi-location client + a valid active location selected → submits, with locationId in the payload', async () => {
    mockUseClientLocations.mockReturnValue({
      data: [{ id: 'loc-a', clientId: 'client-1', name: 'Hamra Branch', address: null, phone: null, notes: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: true }))

    const [bagTypeSelect] = screen.getAllByRole('combobox').filter(el => within(el).queryByText('Select bag type…'))
    await user.selectOptions(bagTypeSelect, 'bt-5')
    await user.type(quantityInput(), '10')
    await user.selectOptions(locationSelect(), 'loc-a')

    const saveDraftBtn = screen.getByRole('button', { name: /Save as draft/ })
    expect(saveDraftBtn).toBeEnabled()
    await user.click(saveDraftBtn)

    expect(mockCreateOrderMutate).toHaveBeenCalled()
    const [body] = mockCreateOrderMutate.mock.calls[0]
    expect(body.locationId).toBe('loc-a')
  })

  it('single-location client (multiLocationEnabled: false) → location stays fully optional, create succeeds with no location field at all', async () => {
    const user = userEvent.setup()
    renderNewOrder()
    await pickClient(user, makeClient({ multiLocationEnabled: false }))

    const [bagTypeSelect] = screen.getAllByRole('combobox').filter(el => within(el).queryByText('Select bag type…'))
    await user.selectOptions(bagTypeSelect, 'bt-5')
    await user.type(quantityInput(), '10')
    await user.click(screen.getByRole('button', { name: /Save as draft/ }))

    expect(mockCreateOrderMutate).toHaveBeenCalled()
    const [body] = mockCreateOrderMutate.mock.calls[0]
    expect(body).not.toHaveProperty('locationId')
    expect(screen.queryByText(/^Location/)).not.toBeInTheDocument()
  })
})
