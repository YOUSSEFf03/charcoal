// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression: the "New Supplier" modal collected Lead Time, Payment Terms,
// Contact Person (name/role/phone), Bank Details, and Notes into visible
// form fields that were never wired to state — submitNewSupplier() only ever
// sent { name, country, charcoalTypes }, silently discarding everything else
// the user typed. This covers that every field with a real backend home
// (CreateSupplierDto) now actually reaches the payload.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockCreateSupplierMutate = vi.fn()
vi.mock('../hooks/useSuppliers', () => ({
  useSuppliers: () => ({ data: { data: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateSupplier: () => ({ mutate: mockCreateSupplierMutate, isPending: false }),
  useUpdateSupplier: () => ({ mutate: vi.fn(), isPending: false }),
}))

let mockRole = 'owner'
vi.mock('../hooks/useMe', () => ({
  useMe: () => ({ data: { role: mockRole } }),
}))

import Suppliers from './Suppliers'

beforeEach(() => {
  vi.clearAllMocks()
  mockRole = 'owner'
})

describe('Suppliers page — New Supplier modal contract', () => {
  it('sends leadTimeDays, paymentTerms, contactPersons, bankDetails, and notes — not just name/country/charcoalTypes', async () => {
    // delay: null skips user-event's real per-keystroke timer (its default
    // under real timers) — this test types across 10 fields, which under
    // full-suite CPU contention can exceed vitest's 5000ms default test
    // timeout even though the interaction itself is correct.
    const user = userEvent.setup({ delay: null })
    render(<MemoryRouter><Suppliers /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /New Supplier/ }))
    await user.type(screen.getByPlaceholderText('Company name'), 'Cedar Charcoal Co')
    await user.type(screen.getByPlaceholderText('14'), '21')
    await user.selectOptions(screen.getByDisplayValue('Net 30'), 'Net 60')
    await user.type(screen.getByPlaceholderText('Full name'), 'Ali Hassan')
    await user.type(screen.getByPlaceholderText('e.g. Owner'), 'Sales manager')
    await user.type(screen.getByPlaceholderText('+963 …'), '+963-11-555')
    await user.type(screen.getByPlaceholderText('Bank of Syria'), 'BankOne')
    await user.type(screen.getByPlaceholderText('Damascus Main'), 'Main Branch')
    await user.type(screen.getByPlaceholderText('SY12 0000 0000 0000 …'), 'SY999')
    await user.type(screen.getByPlaceholderText('BKSYSYDA'), 'BONESYXX')
    await user.type(screen.getByPlaceholderText('Any additional notes…'), 'Preferred coconut supplier')
    await user.click(screen.getByRole('button', { name: /Add Supplier/ }))

    await waitFor(() => expect(mockCreateSupplierMutate).toHaveBeenCalled())
    const [body] = mockCreateSupplierMutate.mock.calls[0]
    expect(body.leadTimeDays).toBe(21)
    expect(body.paymentTerms).toBe('Net 60')
    expect(body.contactPersons).toEqual([{ name: 'Ali Hassan', role: 'Sales manager', phone: '+963-11-555' }])
    expect(body.bankDetails).toMatchObject({ bank_name: 'BankOne', branch: 'Main Branch', account_number: 'SY999', swift: 'BONESYXX' })
    expect(body.notes).toBe('Preferred coconut supplier')
  })

  it('omits optional sections entirely when left blank (no empty contactPersons/bankDetails noise)', async () => {
    const user = userEvent.setup({ delay: null })
    render(<MemoryRouter><Suppliers /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /New Supplier/ }))
    await user.type(screen.getByPlaceholderText('Company name'), 'Minimal Supplier')
    await user.click(screen.getByRole('button', { name: /Add Supplier/ }))

    await waitFor(() => expect(mockCreateSupplierMutate).toHaveBeenCalled())
    const [body] = mockCreateSupplierMutate.mock.calls[0]
    expect(body.contactPersons).toBeUndefined()
    expect(body.bankDetails).toBeUndefined()
    expect(body.notes).toBeUndefined()
    expect(body.openingBalance).toBeUndefined()
  })
})

describe('Suppliers page — opening balance on create', () => {
  it('sends a positive amount when "We owe supplier" (default)', async () => {
    const user = userEvent.setup({ delay: null })
    render(<MemoryRouter><Suppliers /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /New Supplier/ }))
    await user.type(screen.getByPlaceholderText('Company name'), 'Cedar Charcoal Co')
    await user.type(screen.getByLabelText(/Opening balance amount/), '1250')
    await user.click(screen.getByRole('button', { name: /Add Supplier/ }))

    await waitFor(() => expect(mockCreateSupplierMutate).toHaveBeenCalled())
    const [body] = mockCreateSupplierMutate.mock.calls[0]
    expect(body.openingBalance).toMatchObject({ amount: '1250.00' })
    expect(body.openingBalance.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('sends a negative amount when "Supplier owes us (advance)" is picked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<MemoryRouter><Suppliers /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /New Supplier/ }))
    await user.type(screen.getByPlaceholderText('Company name'), 'Prepaid Supplier')
    await user.type(screen.getByLabelText(/Opening balance amount/), '300.5')
    await user.click(screen.getByRole('radio', { name: 'Supplier owes us (advance)' }))
    await user.click(screen.getByRole('button', { name: /Add Supplier/ }))

    await waitFor(() => expect(mockCreateSupplierMutate).toHaveBeenCalled())
    expect(mockCreateSupplierMutate.mock.calls[0][0].openingBalance).toMatchObject({ amount: '-300.50' })
  })

  it('hides the opening balance from non-owners', async () => {
    mockRole = 'accountant'
    const user = userEvent.setup({ delay: null })
    render(<MemoryRouter><Suppliers /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /New Supplier/ }))
    expect(screen.queryByLabelText(/Opening balance amount/)).toBeNull()
  })
})
