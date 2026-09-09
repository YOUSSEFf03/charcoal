// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Coverage for the "Shipment tracking" card added to Container Detail
// (Traqo Ocean integration). Tracking is informational only and lives
// entirely behind useContainerTracking/useRefreshTracking/useCarriers — these
// tests mock those hooks directly rather than hitting any network layer, so
// they never depend on Traqo being reachable.
//
// The Topbar mock resolves `back` the same way the real component does
// (navigate for a route string) so the frontend-wide navigation-consolidation
// fix — ContainerDetail's "All containers" link now goes through Topbar's
// `back` prop instead of a hand-rolled duplicate — stays covered.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title?: string; back?: { label: string; to: string | (() => void) }; children?: ReactNode }) => {
    const navigate = useNavigate()
    return (
      <div>
        {title}
        {back && (
          <button onClick={() => (typeof back.to === 'function' ? back.to() : navigate(back.to))}>{back.label}</button>
        )}
        {children}
      </div>
    )
  },
}))

const baseContainer = {
  id: 'container-1',
  number: 'MRSU6859427',
  supplierId: 'supplier-1',
  status: 'transit' as const,
  arrivalDate: null,
  notes: null,
  sealine: null as string | null,
  sealineName: null as string | null,
  createdById: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  supplier: { id: 'supplier-1', name: 'Congo Charcoal Co', country: 'CD' },
  productLines: [],
  expenses: [],
  discount: null,
  stockLots: [],
  finalizedAt: null as string | null,
  finalizedById: null as string | null,
  finalizedBy: null as { id: string; name: string } | null,
}

const mockUseContainer = vi.fn()
const mockUseContainerTracking = vi.fn()
const mockRefreshMutate = vi.fn()
const mockUseRefreshTracking = vi.fn(() => ({ mutate: mockRefreshMutate, isPending: false }))
const mockFinalizeMutate = vi.fn()
const mockUseFinalizeContainer = vi.fn(() => ({ mutate: mockFinalizeMutate, isPending: false }))

vi.mock('../hooks/useContainers', () => ({
  useContainer: (...args: unknown[]) => mockUseContainer(...args),
  useAddExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertDiscount: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateContainer: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteContainer: () => ({ mutate: vi.fn(), isPending: false }),
  useAddProductLine: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProductLine: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProductLine: () => ({ mutate: vi.fn(), isPending: false }),
  useContainerTracking: (...args: unknown[]) => mockUseContainerTracking(...args),
  useRefreshTracking: () => mockUseRefreshTracking(),
  useCarriers: () => ({ data: [], isLoading: false }),
  useFinalizeContainer: () => mockUseFinalizeContainer(),
}))

vi.mock('../hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: { data: [] }, isLoading: false }),
}))

import ContainerDetail from './ContainerDetail'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/containers/${id}`]}>
      <Routes>
        <Route path="/containers" element={<div>Containers list page</div>} />
        <Route path="/containers/:id" element={<ContainerDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseRefreshTracking.mockReturnValue({ mutate: mockRefreshMutate, isPending: false })
  mockUseFinalizeContainer.mockReturnValue({ mutate: mockFinalizeMutate, isPending: false })
  mockUseContainer.mockReturnValue({ data: baseContainer, isLoading: false, isError: false })
})

describe('ContainerDetail — back navigation', () => {
  it('the "All containers" back link (now on Topbar, not a hand-rolled duplicate) returns to /containers', async () => {
    const user = userEvent.setup()
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByText('All containers'))
    expect(screen.getByText('Containers list page')).toBeInTheDocument()
  })
})

describe('ContainerDetail — Shipment tracking card', () => {
  it('prompts to set a carrier when the container has none, and hides the refresh button', () => {
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    expect(screen.getByText('Carrier not set')).toBeInTheDocument()
    expect(screen.getByText(/Select a carrier to enable live shipment tracking/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Refresh tracking/ })).not.toBeInTheDocument()
  })

  it('clicking "Set carrier" opens the existing edit-container modal (carrier picker)', async () => {
    const user = userEvent.setup()
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /Set carrier/ }))

    expect(screen.getByText('Edit container')).toBeInTheDocument()
    expect(screen.getByText('Carrier (for shipment tracking)')).toBeInTheDocument()
  })

  it('renders the Shipment tracking card near the top of the page, before Product lines', () => {
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    const { container } = renderAt('container-1')

    const cardTitles = Array.from(container.querySelectorAll('.card-title')).map(el => el.textContent)
    const trackingIdx = cardTitles.findIndex(t => t?.includes('Shipment tracking'))
    const productLinesIdx = cardTitles.findIndex(t => t?.includes('Product lines'))
    expect(trackingIdx).toBeGreaterThanOrEqual(0)
    expect(productLinesIdx).toBeGreaterThanOrEqual(0)
    expect(trackingIdx).toBeLessThan(productLinesIdx)
  })

  it('shows the empty "not tracked yet" state when a carrier is set but tracking has never run', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    expect(screen.getByText(/Not tracked yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh tracking/ })).toBeInTheDocument()
  })

  it('renders stored tracking data: carrier, container, status, ETA, and last updated', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1',
        containerId: 'container-1',
        provider: 'traqo',
        referenceNumber: 'MRSU6859427',
        sealine: 'MAEU',
        sealineName: 'Maersk',
        status: 'IN_TRANSIT',
        origin: 'Shanghai, CN',
        destination: 'Beirut, LB',
        vessel: 'MAERSK ESSEX',
        voyage: '412W',
        currentLocation: 'Port Said, EG',
        eta: '2026-09-01T00:00:00.000Z',
        isDelayed: false,
        shipmentUid: null,
        shipmentPublicUrl: null,
        providerUpdatedAt: '2026-08-24T18:42:00.000Z',
        lastFetchedAt: '2026-08-24T18:45:00.000Z',
        lastError: null,
        createdAt: '2026-08-24T18:45:00.000Z',
        updatedAt: '2026-08-24T18:45:00.000Z',
        events: [],
      },
      isLoading: false,
    })
    renderAt('container-1')

    expect(screen.getByText('Maersk')).toBeInTheDocument()
    // Appears twice: the page header (h1) and the tracking card's "Container" field.
    expect(screen.getAllByText('MRSU6859427').length).toBeGreaterThan(0)
    expect(screen.getByText('IN_TRANSIT')).toBeInTheDocument()
    expect(screen.getByText('Shanghai, CN')).toBeInTheDocument()
    expect(screen.getByText('Beirut, LB')).toBeInTheDocument()
    expect(screen.getByText('MAERSK ESSEX')).toBeInTheDocument()
    expect(screen.getByText('412W')).toBeInTheDocument()
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
  })

  it('shows "still tracking" when arrived and Traqo has not confirmed removal (isActive true, closedAt null)', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, status: 'arrived', sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1', containerId: 'container-1', provider: 'traqo', referenceNumber: 'MRSU6859427',
        sealine: 'MAEU', sealineName: 'Maersk', status: 'IN_TRANSIT', origin: null, destination: null,
        vessel: null, voyage: null, currentLocation: null, eta: null, isDelayed: null,
        shipmentUid: null, shipmentPublicUrl: null, isActive: true, closedAt: null,
        providerUpdatedAt: null, lastFetchedAt: '2026-08-24T18:45:00.000Z', lastError: null,
        createdAt: '2026-08-24T18:45:00.000Z', updatedAt: '2026-08-24T18:45:00.000Z', events: [],
      },
      isLoading: false,
    })
    renderAt('container-1')

    expect(screen.getByText(/Container arrived — Traqo is still tracking this shipment/)).toBeInTheDocument()
    expect(screen.queryByText(/Tracking ended/)).not.toBeInTheDocument()
  })

  it('shows "tracking ended" when arrived and Traqo confirmed removal (isActive false)', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, status: 'arrived', sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1', containerId: 'container-1', provider: 'traqo', referenceNumber: 'MRSU6859427',
        sealine: 'MAEU', sealineName: 'Maersk', status: 'DELIVERED', origin: null, destination: null,
        vessel: null, voyage: null, currentLocation: null, eta: null, isDelayed: null,
        shipmentUid: null, shipmentPublicUrl: null, isActive: false, closedAt: '2026-09-20T00:00:00.000Z',
        providerUpdatedAt: null, lastFetchedAt: '2026-08-24T18:45:00.000Z', lastError: null,
        createdAt: '2026-08-24T18:45:00.000Z', updatedAt: '2026-08-24T18:45:00.000Z', events: [],
      },
      isLoading: false,
    })
    renderAt('container-1')

    expect(screen.getByText(/Tracking ended — Traqo has released this shipment/)).toBeInTheDocument()
    expect(screen.queryByText(/still tracking this shipment/)).not.toBeInTheDocument()
  })

  it('shows neither dual-status message while the container is not yet arrived', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, status: 'transit', sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1', containerId: 'container-1', provider: 'traqo', referenceNumber: 'MRSU6859427',
        sealine: 'MAEU', sealineName: 'Maersk', status: 'IN_TRANSIT', origin: null, destination: null,
        vessel: null, voyage: null, currentLocation: null, eta: null, isDelayed: null,
        shipmentUid: null, shipmentPublicUrl: null, isActive: true, closedAt: null,
        providerUpdatedAt: null, lastFetchedAt: '2026-08-24T18:45:00.000Z', lastError: null,
        createdAt: '2026-08-24T18:45:00.000Z', updatedAt: '2026-08-24T18:45:00.000Z', events: [],
      },
      isLoading: false,
    })
    renderAt('container-1')

    expect(screen.queryByText(/Container arrived/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tracking ended/)).not.toBeInTheDocument()
  })

  it('renders the tracking timeline when events are present', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1',
        containerId: 'container-1',
        provider: 'traqo',
        referenceNumber: 'MRSU6859427',
        sealine: 'MAEU',
        sealineName: 'Maersk',
        status: null,
        origin: null,
        destination: null,
        vessel: null,
        voyage: null,
        currentLocation: null,
        eta: null,
        isDelayed: null,
        shipmentUid: null,
        shipmentPublicUrl: null,
        providerUpdatedAt: null,
        lastFetchedAt: '2026-08-24T18:45:00.000Z',
        lastError: null,
        createdAt: '2026-08-24T18:45:00.000Z',
        updatedAt: '2026-08-24T18:45:00.000Z',
        events: [
          { id: 'ev-1', trackingId: 'trk-1', description: 'Gate out', location: 'Shanghai, CN', occurredAt: '2026-08-01T00:00:00.000Z', createdAt: '2026-08-24T18:45:00.000Z' },
          { id: 'ev-2', trackingId: 'trk-1', description: 'Loaded on vessel', location: 'Shanghai, CN', occurredAt: '2026-08-03T00:00:00.000Z', createdAt: '2026-08-24T18:45:00.000Z' },
        ],
      },
      isLoading: false,
    })
    Element.prototype.scrollIntoView = vi.fn()
    renderAt('container-1')

    expect(screen.getByText('Tracking timeline')).toBeInTheDocument()
    expect(screen.getByText('Gate out')).toBeInTheDocument()
    expect(screen.getByText('Loaded on vessel')).toBeInTheDocument()
  })

  it('the top summary card links to the timeline card lower on the page (no duplicated content)', async () => {
    const user = userEvent.setup()
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1', containerId: 'container-1', provider: 'traqo', referenceNumber: 'MRSU6859427',
        sealine: 'MAEU', sealineName: 'Maersk', status: 'IN_TRANSIT', origin: null, destination: null,
        vessel: null, voyage: null, currentLocation: null, eta: null, isDelayed: null,
        shipmentUid: null, shipmentPublicUrl: null, providerUpdatedAt: null,
        lastFetchedAt: '2026-08-24T18:45:00.000Z', lastError: null,
        createdAt: '2026-08-24T18:45:00.000Z', updatedAt: '2026-08-24T18:45:00.000Z',
        events: [{ id: 'ev-1', trackingId: 'trk-1', description: 'Gate out', location: 'Shanghai, CN', occurredAt: '2026-08-01T00:00:00.000Z', createdAt: '2026-08-24T18:45:00.000Z' }],
      },
      isLoading: false,
    })
    renderAt('container-1')

    // Only ONE "Gate out" occurrence — event details are not duplicated between cards.
    expect(screen.getAllByText('Gate out')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /View full timeline/ }))
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('shows a loading skeleton while the stored tracking snapshot is being fetched', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({ data: undefined, isLoading: true })
    const { container } = renderAt('container-1')

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Not tracked yet/)).not.toBeInTheDocument()
  })

  it('shows "Updating tracking…" on the refresh button while a refresh is in flight', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    mockUseRefreshTracking.mockReturnValue({ mutate: mockRefreshMutate, isPending: true })
    renderAt('container-1')

    expect(screen.getByRole('button', { name: /Updating tracking…/ })).toBeInTheDocument()
  })

  it('clicking "Refresh tracking" calls the refresh mutation with the container id', async () => {
    const user = userEvent.setup()
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /Refresh tracking/ }))

    expect(mockRefreshMutate).toHaveBeenCalledWith('container-1', expect.anything())
  })

  it('shows a business-friendly error message when the refresh mutation fails', async () => {
    const user = userEvent.setup()
    mockRefreshMutate.mockImplementation((_id: string, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.({ error: 'Tracking service rate limit reached. Please try again later.' })
    })
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /Refresh tracking/ }))

    expect(screen.getByText('Tracking service rate limit reached. Please try again later.')).toBeInTheDocument()
  })

  it('shows the preserved last-known data plus a non-blocking error banner when lastError is set', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({
      data: {
        id: 'trk-1',
        containerId: 'container-1',
        provider: 'traqo',
        referenceNumber: 'MRSU6859427',
        sealine: 'MAEU',
        sealineName: 'Maersk',
        status: 'IN_TRANSIT',
        origin: null,
        destination: null,
        vessel: null,
        voyage: null,
        currentLocation: null,
        eta: null,
        isDelayed: null,
        shipmentUid: null,
        shipmentPublicUrl: null,
        providerUpdatedAt: null,
        lastFetchedAt: '2026-08-24T18:45:00.000Z',
        lastError: 'No tracking information was found for this container.',
        createdAt: '2026-08-24T18:45:00.000Z',
        updatedAt: '2026-08-24T18:45:00.000Z',
        events: [],
      },
      isLoading: false,
    })
    renderAt('container-1')

    expect(screen.getByText(/Last refresh failed/)).toBeInTheDocument()
    // Previously-stored data must still render, not be blanked out by the error.
    expect(screen.getByText('IN_TRANSIT')).toBeInTheDocument()
  })

  it('never renders a Traqo API key or bearer token anywhere on the page', () => {
    mockUseContainer.mockReturnValue({
      data: { ...baseContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    const { container } = renderAt('container-1')

    expect(container.innerHTML).not.toMatch(/bearer/i)
    expect(container.innerHTML).not.toMatch(/TRAQO_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// Container Finalization + History — approved design. Locked-state coverage
// here focuses on what's rendered/enabled; the actual write rejection is
// enforced server-side (containers.service.spec.ts) and must never be
// re-implemented as a frontend-only check.
// ---------------------------------------------------------------------------

const arrivedContainer = {
  ...baseContainer,
  status: 'arrived' as const,
  arrivalDate: '2026-08-09T00:00:00.000Z',
  productLines: [
    { id: 'line-1', containerId: 'container-1', charcoalType: 'BBQ Hardwood', grade: 'A', supplierId: 'supplier-1', paidBags: 1000, giftBags: 0, kgPerBag: '20', pricePerTon: '800', createdAt: '', updatedAt: '' },
  ],
  expenses: [
    { id: 'exp-1', containerId: 'container-1', description: 'unloading', amount: '200.00', addedById: 'user-1', addedAt: '2026-08-09T00:00:00.000Z' },
  ],
  stockLots: [{ kgReceived: '20000', kgRemaining: '13000' }],
}

const finalizedContainer = {
  ...arrivedContainer,
  finalizedAt: '2026-08-20T10:00:00.000Z',
  finalizedById: 'user-owner',
  finalizedBy: { id: 'user-owner', name: 'Farah Owner' },
}

describe('ContainerDetail — Finalize Container', () => {
  it('shows "Finalize Container" only when arrived and not yet finalized', () => {
    mockUseContainer.mockReturnValue({ data: arrivedContainer, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    expect(screen.getByRole('button', { name: /Finalize Container/ })).toBeInTheDocument()
  })

  it('does NOT show "Finalize Container" for a non-arrived container', () => {
    mockUseContainer.mockReturnValue({ data: { ...baseContainer, status: 'transit' }, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    expect(screen.queryByRole('button', { name: /Finalize Container/ })).not.toBeInTheDocument()
  })

  it('does NOT show "Finalize Container" once already finalized', () => {
    mockUseContainer.mockReturnValue({ data: finalizedContainer, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    expect(screen.queryByRole('button', { name: /Finalize Container/ })).not.toBeInTheDocument()
  })

  it('opens a confirmation dialog with the real cost/stock summary — no fabricated fields', async () => {
    const user = userEvent.setup()
    mockUseContainer.mockReturnValue({ data: arrivedContainer, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /Finalize Container/ }))

    expect(screen.getByText('Finalize container')).toBeInTheDocument()
    // Product cost: 1000 bags * 20kg/bag * $800/ton / 1000 = $16,000.00.
    // The page behind the modal overlay also shows this in its own Cost
    // summary card, so it legitimately appears more than once.
    expect(screen.getAllByText('$16,000.00').length).toBeGreaterThan(0)
    // Expenses: $200.00
    expect(screen.getAllByText('+ $200.00').length).toBeGreaterThan(0)
    // Stock received/remaining, from the real stockLots fixture
    expect(screen.getByText('20,000 kg')).toBeInTheDocument()
    expect(screen.getByText('13,000 kg')).toBeInTheDocument()
    expect(screen.getByText(/Finalizing locks this container's financial information/)).toBeInTheDocument()
  })

  it('confirming finalize calls the finalize mutation and shows the success notice with date/by', async () => {
    const user = userEvent.setup()
    mockFinalizeMutate.mockImplementation((_id: string, opts?: { onSuccess?: (d: unknown) => void }) => {
      opts?.onSuccess?.(finalizedContainer)
    })
    mockUseContainer.mockReturnValue({ data: arrivedContainer, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /Finalize Container/ }))
    // Two buttons now share the name "Finalize Container": the header
    // action (still in the DOM behind the modal) and the modal's confirm
    // button — [1] is the modal's, matching the sibling error-path test below.
    await user.click(screen.getAllByRole('button', { name: /Finalize Container/ })[1])

    expect(mockFinalizeMutate).toHaveBeenCalledWith('container-1', expect.anything())
    expect(screen.getByText('Container finalized')).toBeInTheDocument()
  })

  it('shows a business-friendly error in the confirmation dialog when finalize fails', async () => {
    const user = userEvent.setup()
    mockFinalizeMutate.mockImplementation((_id: string, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.({ error: 'This container has already been finalized.' })
    })
    mockUseContainer.mockReturnValue({ data: arrivedContainer, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /Finalize Container/ }))
    await user.click(screen.getAllByRole('button', { name: /Finalize Container/ })[1])

    expect(screen.getByText('This container has already been finalized.')).toBeInTheDocument()
  })
})

describe('ContainerDetail — locked UI once finalized', () => {
  beforeEach(() => {
    mockUseContainer.mockReturnValue({ data: finalizedContainer, isLoading: false, isError: false })
    mockUseContainerTracking.mockReturnValue({ data: null, isLoading: false })
  })

  it('shows the "Finalized — Financial information locked" banner with date and finalizer name', () => {
    renderAt('container-1')
    expect(screen.getByText('Finalized — Financial information locked')).toBeInTheDocument()
    expect(screen.getByText(/Finalized on 20 Aug 2026 by Farah Owner/)).toBeInTheDocument()
  })

  it('hides the add-expense form and per-row edit/delete actions', () => {
    renderAt('container-1')
    expect(screen.queryByPlaceholderText('Expense description…')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Edit expense')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete expense')).not.toBeInTheDocument()
    // The expense is still VIEWABLE, just not editable.
    expect(screen.getByText('unloading')).toBeInTheDocument()
  })

  it('disables the discount input and hides "Save discount"', () => {
    renderAt('container-1')
    const discountInputs = document.querySelectorAll('.input-prefix input')
    expect((discountInputs[0] as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Save discount/ })).not.toBeInTheDocument()
  })

  it('disables container number/supplier/carrier fields in the Edit modal, but leaves Notes editable', async () => {
    const user = userEvent.setup()
    renderAt('container-1')

    await user.click(screen.getByRole('button', { name: /^Edit$/ }))

    const numberInput = screen.getByDisplayValue('MRSU6859427')
    expect((numberInput as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Finalized — locked\. This container's status can no longer be changed\./)).toBeInTheDocument()
    // Notes textarea has no disabled attribute — still editable.
    const notesField = document.querySelector('textarea.textarea')
    expect((notesField as HTMLTextAreaElement)?.disabled).toBeFalsy()
  })

  it('hides Mark arrived and Delete (already covered by status=arrived) and never shows Finalize again', () => {
    renderAt('container-1')
    expect(screen.queryByRole('button', { name: /Mark arrived/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Finalize Container/ })).not.toBeInTheDocument()
  })

  it('tracking refresh remains available on a finalized container', () => {
    mockUseContainer.mockReturnValue({
      data: { ...finalizedContainer, sealine: 'MAEU', sealineName: 'Maersk' },
      isLoading: false,
      isError: false,
    })
    renderAt('container-1')
    expect(screen.getByRole('button', { name: /Refresh tracking/ })).toBeInTheDocument()
  })
})
