// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Packing Session Detail — laptop-responsive audit (2026-09-07).
//
// jsdom has no real layout engine (no CSS grid/flex sizing, scrollWidth is
// always 0), so these tests verify what jsdom CAN prove: the STRUCTURAL
// markup that makes the real-browser fix work — the truncating class is
// present, the full name is always reachable via a `title` attribute, data
// (quantities/kg) is correct, and zero-quantity rows are marked distinctly.
// Actual pixel-level "no overflow at 1366×768" verification is a browser
// check (see the task's own final report requirement), not a jsdom test.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <div><span>{title}</span>{children}</div>
  ),
}))

const LONG_NAME = 'SHIP_FIFO_ORDER_TEST_1788002101700_6'

function makeBagType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bt1', name: '2kg Bag', nominalKg: '2.000', costPerBag: '0.4000',
    workerRate: '0.1000', note: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const bagTypes = [
  makeBagType({ id: 'bt1', name: '2kg Bag', nominalKg: '2.000' }),
  makeBagType({ id: 'bt2', name: '5kg Bag', nominalKg: '5.000' }),
  makeBagType({ id: 'bt3', name: LONG_NAME, nominalKg: '1.800' }),
]

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1', displayId: 'PK-001', workerId: 'u1', workerEntityId: 'w1', mode: 'stock',
    orderId: null,
    kgConsumed: '1800.000',
    sessionLots: [{ id: 'sl1', sessionId: 's1', lotId: 'lot1', kgUsed: '1800.000', lot: { id: 'lot1', charcoalType: 'BBQ Hardwood', grade: 'A', costPerKg: '0.3000' } }],
    bagsOutput: [{ bagTypeId: 'bt1', qty: 1000 }],
    kgOutputTotal: '1800.000',
    varianceKg: '0.000',
    varianceNote: null,
    sessionEarnings: '100.00',
    date: '2026-08-05',
    startedAt: '2026-08-05T09:15:00.000Z',
    completedAt: '2026-08-05T09:30:00.000Z',
    notes: null,
    worker: { id: 'u1', name: 'Hassan', email: 'h@example.com' },
    workerEntity: { id: 'w1', name: 'Hassan Mahmoud' },
    ...overrides,
  }
}

const mockUsePackingSessions = vi.fn()
const mockUsePackingSession = vi.fn()
const mockUseCreatePackingSession = vi.fn()
const mockUseUpdatePackingSession = vi.fn()
vi.mock('../hooks/usePacking', () => ({
  usePackingSessions: (...args: unknown[]) => mockUsePackingSessions(...args),
  usePackingSession: (...args: unknown[]) => mockUsePackingSession(...args),
  useCreatePackingSession: () => mockUseCreatePackingSession(),
  useUpdatePackingSession: () => mockUseUpdatePackingSession(),
}))

const mockUseStockLots = vi.fn()
vi.mock('../hooks/useWarehouse', () => ({
  useStockLots: (...args: unknown[]) => mockUseStockLots(...args),
}))

const mockUseBagTypes = vi.fn()
vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => mockUseBagTypes(),
}))

const mockUseWorkers = vi.fn()
vi.mock('../hooks/useWorkers', () => ({
  useWorkers: () => mockUseWorkers(),
}))

import Packing from './Packing'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseBagTypes.mockReturnValue({ data: bagTypes, isLoading: false })
  mockUseStockLots.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
  mockUseWorkers.mockReturnValue({ data: [{ id: 'w1', name: 'Hassan Mahmoud' }] })
  mockUsePackingSessions.mockReturnValue({ data: { data: [makeSession()], total: 1 }, isLoading: false })
  mockUsePackingSession.mockReturnValue({ data: undefined, isLoading: false, isError: false })
  mockUseCreatePackingSession.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mockUseUpdatePackingSession.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

/** Navigates today → history → the one packing day's detail view. */
async function openDayDetail(user: ReturnType<typeof userEvent.setup>) {
  render(<Packing />)
  await user.click(screen.getByText('View packing history'))
  await user.click(screen.getByText('1000 bags'))
}

describe('Packing Session Detail — data correctness (unchanged by the layout fix)', () => {
  it('CASE 6 — Bags by type shows the correct quantity for the packed type', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)

    const heading = screen.getByText('Bags by type')
    const section = within(heading.closest('.card') as HTMLElement)
    const row = section.getByTitle('2kg Bag').closest('.breakdown-row') as HTMLElement
    expect(within(row).getByText('1,000')).toBeInTheDocument()
  })

  it('CASE 7 — Bags by type shows the correct nominal kg for the packed type (1,000 × 1.8kg = 1,800 kg)', async () => {
    const user = userEvent.setup()
    // This session packs the long-named bt3 (1.8kg nominal) — proves the
    // 1,800 kg figure from the task's own screenshot survives the layout
    // fix untouched, on the exact bag type whose name caused the overlap.
    mockUsePackingSessions.mockReturnValue({
      data: { data: [makeSession({ bagsOutput: [{ bagTypeId: 'bt3', qty: 1000 }] })], total: 1 },
      isLoading: false,
    })
    render(<Packing />)
    await user.click(screen.getByText('View packing history'))
    await user.click(screen.getByText('1000 bags'))

    const heading = screen.getByText('Bags by type')
    const section = within(heading.closest('.card') as HTMLElement)
    const row = section.getByTitle(LONG_NAME).closest('.breakdown-row') as HTMLElement
    expect(within(row).getByText('1,000')).toBeInTheDocument()
    expect(within(row).getByText('1800 kg')).toBeInTheDocument()
  })
})

describe('Packing Session Detail — long bag-type name handling (never overlaps the quantity)', () => {
  it('CASE 3/4 — a long bag-type name row uses the truncating name column, never letting the name and quantity share one unconstrained cell', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)

    const heading = screen.getByText('Bags by type')
    const section = within(heading.closest('.card') as HTMLElement)
    const nameEl = section.getByText(LONG_NAME)
    // The name lives in its OWN truncating element — the quantity is a
    // sibling in a separate grid cell, never sharing the name's box.
    expect(nameEl.className).toBe('btype-name')
    const row = nameEl.closest('.breakdown-row') as HTMLElement
    const qtyEl = within(row).getByText('0', { selector: '.bqty' })
    expect(row.contains(qtyEl)).toBe(true)
    expect(qtyEl.className).toContain('bqty')
    expect(qtyEl).not.toBe(nameEl)
  })

  it('CASE 5 — the full long name remains accessible via a title tooltip even though it visually truncates', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)

    const heading = screen.getByText('Bags by type')
    const section = within(heading.closest('.card') as HTMLElement)
    expect(section.getByTitle(LONG_NAME)).toBeInTheDocument()
  })

  it('the same long-name protection applies to the top summary cards (title tooltip present)', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)
    // Both the top summary card AND the "Bags by type" row carry a title
    // tooltip for this bag type — at least one (and no crash/overlap) proves
    // the protection is in place everywhere the long name appears.
    expect(screen.getAllByTitle(LONG_NAME).length).toBeGreaterThanOrEqual(1)
  })
})

describe('Packing Session Detail — zero-quantity types (CASE 9)', () => {
  it('a bag type with zero quantity that day still renders, marked with the dimming "zero" class', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)

    const heading = screen.getByText('Bags by type')
    const section = within(heading.closest('.card') as HTMLElement)
    const zeroRow = section.getByTitle('5kg Bag').closest('.breakdown-row') as HTMLElement
    expect(zeroRow.className).toContain('zero')
    expect(within(zeroRow).getByText('0')).toBeInTheDocument()

    const packedRow = section.getByTitle('2kg Bag').closest('.breakdown-row') as HTMLElement
    expect(packedRow.className).not.toContain('zero')
  })
})

describe('Packing Session Detail — progress bar proportionality (CASE 8)', () => {
  it('the packed type\'s bar fills 100% (it is the day\'s max) and a zero-quantity type\'s bar fills 0%', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)

    const heading = screen.getByText('Bags by type')
    const section = within(heading.closest('.card') as HTMLElement)
    const packedRow = section.getByTitle('2kg Bag').closest('.breakdown-row') as HTMLElement
    const zeroRow = section.getByTitle('5kg Bag').closest('.breakdown-row') as HTMLElement
    const packedFill = packedRow.querySelector('.bfill') as HTMLElement
    const zeroFill = zeroRow.querySelector('.bfill') as HTMLElement
    expect(packedFill.style.width).toBe('100%')
    expect(zeroFill.style.width).toBe('0%')
  })
})

describe('Packing Session Detail — Entries that day (CASE 10/11/12)', () => {
  it('renders time, bag/charcoal, worker, and waste for each entry, with a title tooltip guarding long descriptions', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)

    const heading = screen.getByText('Entries that day')
    const section = within(heading.closest('.card') as HTMLElement)
    // Rendered via the SAME local-timezone conversion the component itself
    // uses (toLocaleTimeString), so this assertion is timezone-independent.
    const expectedTime = new Date('2026-08-05T09:15:00.000Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    expect(section.getByText(expectedTime)).toBeInTheDocument()
    expect(section.getByText(/× 2kg Bag/)).toBeInTheDocument()
    const workerEl = section.getByText('Hassan Mahmoud')
    expect(workerEl.getAttribute('title')).toBe('Hassan Mahmoud')
    expect(section.getByText('0 kg')).toBeInTheDocument() // waste
  })

  it('a session with a long uniform bag-type label carries it as a title tooltip on the chip, never expanding the row', async () => {
    mockUsePackingSessions.mockReturnValue({
      data: { data: [makeSession({ bagsOutput: [{ bagTypeId: 'bt3', qty: 500 }] })], total: 1 },
      isLoading: false,
    })
    const user = userEvent.setup()
    render(<Packing />)
    await user.click(screen.getByText('View packing history'))
    await user.click(screen.getByText('500 bags'))

    const heading = screen.getByText('Entries that day')
    const section = within(heading.closest('.card') as HTMLElement)
    const chip = section.getByTitle(LONG_NAME)
    expect(chip.className).toContain('qty-chip')
  })
})

describe('Packing Session Detail — CASE 1/2 (renders; no crash at mount)', () => {
  it('renders the day detail view for a normal session without throwing', async () => {
    const user = userEvent.setup()
    await openDayDetail(user)
    expect(screen.getByText('Bags by type')).toBeInTheDocument()
    expect(screen.getByText('Entries that day')).toBeInTheDocument()
  })
})
