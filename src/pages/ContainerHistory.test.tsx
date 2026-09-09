// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Coverage for the Container History page (Container Finalization + History
// — approved design). This page shows ONLY finalized containers, is a
// separate read-only archive from the main Containers page, and must never
// call Traqo (the mock below exports only useContainers).
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
// Deliberately exports ONLY useContainers — same regression guard as
// Containers.test.tsx: if ContainerHistory.tsx ever imported a
// tracking-refresh hook, calling the resulting `undefined` would throw.
vi.mock('../hooks/useContainers', () => ({
  useContainers: (...args: unknown[]) => mockUseContainers(...args),
}))

vi.mock('../hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: { data: [{ id: 'supplier-1', name: 'Sakher', country: 'Nigeria' }] } }),
}))

import ContainerHistory from './ContainerHistory'

function renderPage() {
  return render(
    <MemoryRouter>
      <ContainerHistory />
    </MemoryRouter>,
  )
}

function makeFinalizedContainer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ctr-1',
    number: 'GCLX-2024-001',
    supplierId: 'supplier-1',
    status: 'arrived',
    arrivalDate: '2026-08-04T00:00:00.000Z',
    notes: null,
    sealine: 'MAEU',
    sealineName: 'Maersk',
    createdById: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    finalizedAt: '2026-08-20T10:00:00.000Z',
    finalizedById: 'user-owner',
    finalizedBy: { id: 'user-owner', name: 'Farah Owner' },
    productLines: [
      { id: 'l1', containerId: 'ctr-1', charcoalType: 'BBQ', grade: 'A', supplierId: 'supplier-1', paidBags: 1000, giftBags: 0, kgPerBag: '10', pricePerTon: '800', createdAt: '', updatedAt: '' },
    ],
    expenses: [{ id: 'e1', containerId: 'ctr-1', description: 'unloading', amount: '500.00', addedById: 'user-1', addedAt: '' }],
    discount: null,
    stockLots: [{ kgReceived: '10000', kgRemaining: '9143.5' }],
    ...overrides,
  }
}

function setContainers(list: ReturnType<typeof makeFinalizedContainer>[], total?: number) {
  mockUseContainers.mockReturnValue({
    data: { data: list, total: total ?? list.length, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ContainerHistory — requests only finalized containers', () => {
  it('passes finalized: true to useContainers', () => {
    setContainers([])
    renderPage()

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.finalized).toBe(true)
  })

  it('renders successfully using only useContainers — no separate tracking hook is called', () => {
    setContainers([makeFinalizedContainer()])
    expect(() => renderPage()).not.toThrow()
  })
})

describe('ContainerHistory — real data columns', () => {
  it('shows container number, supplier, carrier, arrived date, finalized date, and finalized by', () => {
    setContainers([makeFinalizedContainer()])
    renderPage()

    expect(screen.getByText('GCLX-2024-001')).toBeInTheDocument()
    // "Sakher" also appears as a supplier-filter <option>; scope to the table cell.
    expect(screen.getByText('GCLX-2024-001').closest('tr')!.textContent).toContain('Sakher')
    expect(screen.getByText('Maersk')).toBeInTheDocument()
    expect(screen.getByText('4 Aug 2026')).toBeInTheDocument() // arrived
    expect(screen.getByText('20 Aug 2026')).toBeInTheDocument() // finalized
    expect(screen.getByText('Farah Owner')).toBeInTheDocument()
  })

  it('computes total weight, total cost, cost/kg, and remaining stock from real product lines/expenses/stock lots', () => {
    setContainers([makeFinalizedContainer()])
    renderPage()

    // weight: 1000 bags * 10kg/bag / 1000 = 10.00 t
    expect(screen.getByText('10.00 t')).toBeInTheDocument()
    // cost: 1000*10*800/1000 (product) + 500 (expense) = 8500.00
    expect(screen.getByText(/8,500\.00/)).toBeInTheDocument()
    // cost/kg: 8500 / (10 * 1000) = 0.85
    expect(screen.getByText('$0.85')).toBeInTheDocument()
    // remaining stock
    expect(screen.getByText('9,143.5 kg')).toBeInTheDocument()
  })

  it('shows "—" for carrier when the container has no sealine', () => {
    setContainers([makeFinalizedContainer({ sealine: null, sealineName: null })])
    renderPage()
    const row = screen.getByText('GCLX-2024-001').closest('tr')!
    expect(row.textContent).toContain('—')
  })

  it('shows an honest empty state when no finalized containers match', () => {
    setContainers([])
    renderPage()
    expect(screen.getByText(/No finalized containers match your search\/filter/)).toBeInTheDocument()
  })
})

describe('ContainerHistory — search, supplier filter, date filter', () => {
  it('passes the search box value through to useContainers', async () => {
    const user = userEvent.setup()
    setContainers([makeFinalizedContainer()])
    renderPage()

    await user.type(screen.getByPlaceholderText('Search container number…'), 'GCLX')

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.search).toBe('GCLX')
  })

  it('passes the selected supplier through to useContainers', async () => {
    const user = userEvent.setup()
    setContainers([makeFinalizedContainer()])
    renderPage()

    await user.selectOptions(screen.getByDisplayValue('All suppliers'), 'supplier-1')

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.supplierId).toBe('supplier-1')
  })

  it('applies a finalizedFrom/finalizedTo range when "This month" is selected', async () => {
    const user = userEvent.setup()
    setContainers([makeFinalizedContainer()])
    renderPage()

    await user.selectOptions(screen.getByDisplayValue('All time'), 'This month')

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.finalizedFrom).toBeDefined()
    expect(lastCallArgs.finalizedTo).toBeDefined()
  })

  it('shows custom date inputs and passes them through when "Custom" is selected', async () => {
    const user = userEvent.setup()
    setContainers([makeFinalizedContainer()])
    renderPage()

    await user.selectOptions(screen.getByDisplayValue('All time'), 'Custom')
    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs.length).toBe(2)

    await user.type(dateInputs[0] as HTMLInputElement, '2026-08-01')
    await user.type(dateInputs[1] as HTMLInputElement, '2026-08-31')

    const lastCallArgs = mockUseContainers.mock.calls[mockUseContainers.mock.calls.length - 1][0]
    expect(lastCallArgs.finalizedFrom).toBe('2026-08-01')
    expect(lastCallArgs.finalizedTo).toBe('2026-08-31')
  })
})

describe('ContainerHistory — pagination', () => {
  it('shows Previous/Next controls when there is more than one page', () => {
    setContainers([makeFinalizedContainer()], 45) // 45 total, page size 20 -> 3 pages
    renderPage()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled()
  })

  it('hides pagination controls when everything fits on one page', () => {
    setContainers([makeFinalizedContainer()], 1)
    renderPage()
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument()
  })
})

describe('ContainerHistory — navigation', () => {
  it('clicking a row navigates to the container detail page (same page finalized containers use)', async () => {
    const user = userEvent.setup()
    setContainers([makeFinalizedContainer({ id: 'container-xyz' })])
    renderPage()

    await user.click(screen.getByText('GCLX-2024-001'))
    expect(mockNavigate).toHaveBeenCalledWith('/containers/container-xyz')
  })
})
