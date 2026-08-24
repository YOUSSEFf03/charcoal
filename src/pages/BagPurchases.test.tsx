// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression coverage for the Bag Purchases pricing audit: the price a
// purchase is logged at must come from BagType.costPerBag (Settings → Bag
// types → "Cost/bag ($)") — never a value typed into this page, and never a
// value this page calculates from bag type × quantity. Settings is the only
// source of truth for unitCost; this page only supplies quantity and picks
// which bag type.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockUseBagTypes = vi.fn()
vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => mockUseBagTypes(),
}))

const mockUseBagPurchases = vi.fn()
const mockCreateMutate = vi.fn()
vi.mock('../hooks/useBagPurchases', () => ({
  useBagPurchases: () => mockUseBagPurchases(),
  useCreateBagPurchase: () => ({ mutate: mockCreateMutate, isPending: false }),
}))

import BagPurchases from './BagPurchases'

function makeBagType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bt-5', name: '5kg Bag', nominalKg: '5.000', costPerBag: '0.4000',
    workerRate: '0.1000', note: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseBagTypes.mockReturnValue({ data: [makeBagType()] })
  mockUseBagPurchases.mockReturnValue({ data: { data: [], total: 0 }, isLoading: false })
})

describe('BagPurchases — price comes from Settings, never typed or calculated here', () => {
  it('shows no free-text "unit price" input anywhere on the page', () => {
    render(<BagPurchases />)
    // Every other numeric input on the page (Quantity) is a spinbutton; the
    // price field must be a readOnly textbox, never an editable number input.
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(1) // Quantity only
  })

  it("displays the selected bag type's Settings costPerBag automatically once selected", async () => {
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bag type' }), 'bt-5')
    expect(screen.getByDisplayValue('$0.4000')).toBeInTheDocument()
  })

  it('the price field is read-only — cannot be typed into', async () => {
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bag type' }), 'bt-5')
    const priceField = screen.getByDisplayValue('$0.4000')
    expect(priceField).toHaveAttribute('readOnly')
  })

  it('changing quantity does NOT change the displayed price — only the computed total changes', async () => {
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bag type' }), 'bt-5')
    await user.type(screen.getByRole('spinbutton'), '100')

    // Price stays exactly the Settings value regardless of quantity typed.
    expect(screen.getByDisplayValue('$0.4000')).toBeInTheDocument()
    // The total is the legitimate qty × Settings-price display (mirrors the
    // backend's own totalCost calc) — not a second price. Text is split
    // across nodes (the total is wrapped in <strong>), so match on the
    // container's full textContent rather than a single text node.
    expect(screen.getByText((_, el) => el?.textContent === '100 × $0.4000 = $40.00')).toBeInTheDocument()
  })

  it('submits the Settings-derived unitCost to the backend, not a typed value — quantity alone does not invent a new price', async () => {
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bag type' }), 'bt-5')
    await user.type(screen.getByRole('spinbutton'), '250')
    await user.click(screen.getByRole('button', { name: /Add/ }))

    expect(mockCreateMutate).toHaveBeenCalledTimes(1)
    const [body] = mockCreateMutate.mock.calls[0]
    expect(body.bagTypeId).toBe('bt-5')
    expect(body.quantity).toBe(250)
    expect(body.unitCost).toBe('0.4000') // exactly Settings' costPerBag, unaffected by quantity
  })

  it('a different bag type submits ITS OWN Settings price, not a shared/hardcoded one', async () => {
    mockUseBagTypes.mockReturnValue({
      data: [makeBagType(), makeBagType({ id: 'bt-10', name: '10kg Bag', costPerBag: '0.7500' })],
    })
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bag type' }), 'bt-10')
    await user.type(screen.getByRole('spinbutton'), '10')
    await user.click(screen.getByRole('button', { name: /Add/ }))

    const [body] = mockCreateMutate.mock.calls[0]
    expect(body.unitCost).toBe('0.7500')
  })

  it('blocks submission and shows a clear message when the selected bag type has no Settings price configured — never invents one', async () => {
    mockUseBagTypes.mockReturnValue({ data: [makeBagType({ costPerBag: null })] })
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bag type' }), 'bt-5')
    expect(screen.getByDisplayValue('Not set in Settings')).toBeInTheDocument()

    await user.type(screen.getByRole('spinbutton'), '100')
    await user.click(screen.getByRole('button', { name: /Add/ }))

    expect(mockCreateMutate).not.toHaveBeenCalled()
    expect(await screen.findByText('This bag type has no price configured in Settings — set it there first')).toBeInTheDocument()
  })

  it('requires a bag type to be selected before submitting — the backend requires bagTypeId', async () => {
    const user = userEvent.setup()
    render(<BagPurchases />)
    await user.type(screen.getByRole('spinbutton'), '100')
    await user.click(screen.getByRole('button', { name: /Add/ }))

    expect(mockCreateMutate).not.toHaveBeenCalled()
    expect(await screen.findByText('Select a bag type')).toBeInTheDocument()
  })

  it('only one add-purchase form exists on the page (no duplicate "brand purchase" entry path)', () => {
    render(<BagPurchases />)
    expect(screen.getAllByRole('combobox', { name: 'Bag type' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Add$/ })).toHaveLength(1)
  })

  it('the purchase history table shows the real bag type name for each row — one unified history, not split by type', () => {
    mockUseBagPurchases.mockReturnValue({
      data: {
        data: [
          { id: 'p1', bagTypeId: 'bt-5', bagType: { name: '5kg Bag' }, quantity: 500, unitCost: '0.4000', totalCost: '200.00', currency: 'USD', date: '2026-08-01', addedById: 'u1', notes: 'Al Amin Packaging' },
        ],
        total: 1,
      },
      isLoading: false,
    })
    render(<BagPurchases />)
    expect(screen.getByText('5kg Bag')).toBeInTheDocument()
    expect(screen.getByText('Al Amin Packaging')).toBeInTheDocument()
  })
})
