// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Coverage for the Containers-list "control center" redesign: NOT ARRIVED /
// IN TRANSIT vs ARRIVED sections, real tracking-field display, and the ETA
// countdown. Tests that assert on countdown text fake "now" via
// vi.setSystemTime() so they never depend on the actual current date; tests
// that use userEvent run on real timers instead (see the beforeEach note
// below). Internal container `status` is the sole authority for section
// placement — never Traqo's tracking status.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, children }: { title?: string; children?: ReactNode }) => (
    <div>{title}{children}</div>
  ),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockUseContainers = vi.fn()
// Deliberately exports ONLY useContainers — if Containers.tsx ever imported
// useContainerTracking/useRefreshTracking (the hooks that call the live
// Traqo endpoint), calling the resulting `undefined` would throw here,
// failing every test. This is the regression guard for "opening /containers
// must NOT call Traqo" at the hook-usage level.
vi.mock('../hooks/useContainers', () => ({
  useContainers: (...args: unknown[]) => mockUseContainers(...args),
}))

vi.mock('../hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: { data: [{ id: 'supplier-1', name: 'Sakher', country: 'Nigeria' }] } }),
}))

import Containers from './Containers'

function renderPage() {
  return render(
    <MemoryRouter>
      <Containers />
    </MemoryRouter>,
  )
}

function makeContainer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ctr-1',
    number: 'TCNU7200897',
    supplierId: 'supplier-1',
    status: 'transit',
    arrivalDate: null,
    notes: null,
    sealine: null,
    sealineName: null,
    createdById: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    productLines: [],
    tracking: null,
    ...overrides,
  }
}

function setContainers(list: ReturnType<typeof makeContainer>[]) {
  mockUseContainers.mockReturnValue({
    data: { data: list, total: list.length, page: 1, limit: 100 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

// "Now" is faked per-test (not globally) so tests that use userEvent — which
// relies on real timers internally in this @testing-library/user-event
// version — never hang. Tests that assert on ETA-countdown text call
// vi.useFakeTimers()/vi.setSystemTime() themselves; afterEach always restores
// real timers regardless.
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Containers — NOT ARRIVED vs ARRIVED separation', () => {
  it('places a transit container under NOT ARRIVED / IN TRANSIT and an arrived one under ARRIVED, using internal status only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 10, 0))
    setContainers([
      makeContainer({ id: 'a', number: 'TRANSIT-1', status: 'transit' }),
      makeContainer({ id: 'b', number: 'PORT-1', status: 'port' }),
      makeContainer({
        id: 'c', number: 'ARRIVED-1', status: 'arrived', arrivalDate: '2026-08-10T00:00:00.000Z',
        // Stale cached tracking still says IN_TRANSIT — must NOT move this
        // container out of ARRIVED; internal status wins.
        tracking: { status: 'IN_TRANSIT', vessel: null, voyage: null, origin: null, destination: null, currentLocation: null, eta: '2026-08-05T00:00:00.000Z', lastFetchedAt: '2026-08-09T00:00:00.000Z' },
      }),
    ])
    renderPage()

    // Each section is <div class="section-title">…</div> followed by its
    // sibling results <div>; walk from the heading text to that sibling
    // rather than matching "Arrived" by text (which also appears as the
    // per-card status badge).
    const notArrivedSection = screen.getByText('Not arrived / in transit').closest('.section-title')!.nextElementSibling as HTMLElement
    const arrivedSection = screen.getByText('Arrived', { selector: '.section-title' }).closest('.section-title')!.nextElementSibling as HTMLElement

    expect(within(notArrivedSection).queryByText('TRANSIT-1')).toBeTruthy()
    expect(within(notArrivedSection).queryByText('PORT-1')).toBeTruthy()
    expect(within(notArrivedSection).queryByText('ARRIVED-1')).toBeFalsy()

    expect(within(arrivedSection).queryByText('ARRIVED-1')).toBeTruthy()
    expect(within(arrivedSection).queryByText('TRANSIT-1')).toBeFalsy()

    // The arrived card must never show a countdown, even though its stale
    // tracking snapshot has a (long-past) ETA.
    expect(within(arrivedSection).queryByText(/overdue|to arrival|Arrives today/)).toBeFalsy()
  })

  it('shows an honest per-section empty state when a section has zero results', () => {
    setContainers([makeContainer({ id: 'a', number: 'ONLY-ARRIVED', status: 'arrived', arrivalDate: '2026-08-01T00:00:00.000Z' })])
    renderPage()

    expect(screen.getByText(/No containers currently in transit match/)).toBeInTheDocument()
  })
})

describe('Containers — real tracking fields on NOT ARRIVED cards', () => {
  it('displays carrier, status, vessel, voyage, route, and latest location from real tracking data only', () => {
    setContainers([
      makeContainer({
        id: 'a', number: 'TCNU7200897', status: 'transit', sealine: 'MAEU', sealineName: 'Maersk',
        tracking: {
          status: 'IN_TRANSIT', vessel: 'MAERSK UTAH', voyage: '638N',
          origin: 'Tin Can Island Container Terminal, Nigeria', destination: 'Beirut, Lebanon',
          currentLocation: 'Tin Can Island Container Terminal', eta: '2026-09-06T00:00:00.000Z',
          lastFetchedAt: '2026-08-25T09:00:00.000Z',
        },
      }),
    ])
    renderPage()

    expect(screen.getByText('TCNU7200897')).toBeInTheDocument()
    expect(screen.getByText('Maersk')).toBeInTheDocument()
    expect(screen.getByText('IN_TRANSIT')).toBeInTheDocument()
    expect(screen.getByText('MAERSK UTAH · 638N')).toBeInTheDocument()
    expect(screen.getByText('Tin Can Island Container Terminal, Nigeria → Beirut, Lebanon')).toBeInTheDocument()
    expect(screen.getByText(/Latest location: Tin Can Island Container Terminal/)).toBeInTheDocument()
    expect(screen.getByText(/Tracking updated/)).toBeInTheDocument()
  })

  it('never fabricates a field: only renders what real tracking data provides', () => {
    setContainers([
      makeContainer({
        id: 'a', number: 'PARTIAL-1', status: 'transit', sealine: 'MAEU', sealineName: 'Maersk',
        tracking: { status: null, vessel: null, voyage: null, origin: null, destination: null, currentLocation: null, eta: null, lastFetchedAt: '2026-08-25T09:00:00.000Z' },
      }),
    ])
    renderPage()

    expect(screen.queryByText(/·/)).toBeFalsy() // no vessel/voyage line
    expect(screen.getByText('ETA unavailable')).toBeInTheDocument()
  })

  it('shows "Carrier not set" when the container has no sealine', () => {
    setContainers([makeContainer({ id: 'a', number: 'NO-CARRIER', status: 'port', sealine: null, tracking: null })])
    renderPage()
    expect(screen.getByText('Carrier not set')).toBeInTheDocument()
  })

  it('shows "Tracking not available" when a carrier is set but never refreshed', () => {
    setContainers([makeContainer({ id: 'a', number: 'NEVER-REFRESHED', status: 'port', sealine: 'MAEU', sealineName: 'Maersk', tracking: null })])
    renderPage()
    expect(screen.getByText(/Tracking not available/)).toBeInTheDocument()
  })
})

describe('Containers — ETA countdown', () => {
  it('shows a future countdown, e.g. "12 days to arrival"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 10, 0)) // 25 Aug 2026
    setContainers([makeContainer({ id: 'a', number: 'FUTURE-1', status: 'transit', tracking: { status: null, vessel: null, voyage: null, origin: null, destination: null, currentLocation: null, eta: '2026-09-06T00:00:00.000Z', lastFetchedAt: '2026-08-25T00:00:00.000Z' } })])
    renderPage()
    expect(screen.getByText('12 days to arrival')).toBeInTheDocument()
  })

  it('shows "Arrives today" when the ETA is today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 10, 0))
    setContainers([makeContainer({ id: 'a', number: 'TODAY-1', status: 'transit', tracking: { status: null, vessel: null, voyage: null, origin: null, destination: null, currentLocation: null, eta: '2026-08-25T18:00:00.000Z', lastFetchedAt: '2026-08-25T00:00:00.000Z' } })])
    renderPage()
    expect(screen.getByText('Arrives today')).toBeInTheDocument()
  })

  it('shows a positive "N days overdue" for a past ETA — never a negative number', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 10, 0))
    setContainers([makeContainer({ id: 'a', number: 'OVERDUE-1', status: 'transit', tracking: { status: null, vessel: null, voyage: null, origin: null, destination: null, currentLocation: null, eta: '2026-08-22T00:00:00.000Z', lastFetchedAt: '2026-08-25T00:00:00.000Z' } })])
    renderPage()
    expect(screen.getByText('3 days overdue')).toBeInTheDocument()
    expect(screen.queryByText(/-3/)).toBeFalsy()
  })

  it('shows "ETA unavailable" when tracking has never run', () => {
    setContainers([makeContainer({ id: 'a', number: 'NO-TRACKING-1', status: 'transit', sealine: 'MAEU', tracking: null })])
    renderPage()
    expect(screen.getByText('ETA unavailable')).toBeInTheDocument()
  })
})

describe('Containers — search and filters still work', () => {
  it('passes the search box value through to useContainers', async () => {
    const user = userEvent.setup()
    setContainers([makeContainer({ id: 'a', number: 'TCNU7200897', status: 'transit' })])
    renderPage()

    await user.type(screen.getByPlaceholderText('Search container number…'), 'TCNU')

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.search).toBe('TCNU')
  })

  it('passes the selected status tab through to useContainers', async () => {
    const user = userEvent.setup()
    setContainers([makeContainer({ id: 'a', number: 'TCNU7200897', status: 'arrived' })])
    renderPage()

    await user.click(screen.getByRole('button', { name: /Arrived/ }))

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.status).toBe('arrived')
  })
})

describe('Containers — finalized containers excluded (Container Finalization + History)', () => {
  it('passes finalized: false to useContainers — the main page represents ACTIVE work only', () => {
    setContainers([makeContainer({ id: 'a', number: 'TCNU7200897', status: 'transit' })])
    renderPage()

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.finalized).toBe(false)
  })
})

describe('Containers — no Traqo request from the list page', () => {
  it('renders successfully using only useContainers (cached data) — no separate tracking hook is called', () => {
    // If Containers.tsx imported useContainerTracking/useRefreshTracking,
    // the mock above (which exports neither) would make them `undefined`,
    // and invoking `undefined()` would throw during render.
    setContainers([makeContainer({ id: 'a', number: 'TCNU7200897', status: 'transit' })])
    expect(() => renderPage()).not.toThrow()
  })
})

describe('Containers — navigation', () => {
  it('clicking a NOT ARRIVED card navigates to its detail page', async () => {
    const user = userEvent.setup()
    setContainers([makeContainer({ id: 'container-xyz', number: 'TCNU7200897', status: 'transit' })])
    renderPage()

    await user.click(screen.getByText('TCNU7200897'))
    expect(mockNavigate).toHaveBeenCalledWith('/containers/container-xyz')
  })

  it('clicking an ARRIVED card navigates to its detail page', async () => {
    const user = userEvent.setup()
    setContainers([makeContainer({ id: 'container-abc', number: 'ARRIVED-9', status: 'arrived', arrivalDate: '2026-08-01T00:00:00.000Z' })])
    renderPage()

    await user.click(screen.getByText('ARRIVED-9'))
    expect(mockNavigate).toHaveBeenCalledWith('/containers/container-abc')
  })
})

describe('Containers — arrived card content', () => {
  it('shows arrival date and total weight, not a countdown', () => {
    setContainers([
      makeContainer({
        id: 'a', number: 'ARRIVED-1', status: 'arrived', arrivalDate: '2026-08-10T00:00:00.000Z',
        productLines: [{ id: 'l1', containerId: 'a', charcoalType: 'BBQ', grade: 'A', supplierId: 's1', paidBags: 1000, giftBags: 0, kgPerBag: '20', pricePerTon: '800', createdAt: '', updatedAt: '' }],
      }),
    ])
    renderPage()

    expect(screen.getByText(/Arrived 10 Aug 2026/)).toBeInTheDocument()
    expect(screen.getByText('20.00 t')).toBeInTheDocument()
  })
})
