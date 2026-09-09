// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Regression: Payment.tsx previously had no "received by" field at all, so
// receiverId/receiverName were always omitted — a cash payment logged here
// was invisible to Cash Handover reconciliation even when a real person
// collected it. ClientDetail.tsx/FillClientDetail.tsx already resolve a
// receiver name to a real receiverId; this page now does the same.
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockCreatePaymentMutate = vi.fn()
vi.mock('../hooks/usePayments', () => ({
  useCreatePayment: () => ({ mutate: mockCreatePaymentMutate, isPending: false }),
}))

vi.mock('../hooks/useClients', () => ({
  useClients: () => ({
    data: {
      data: [{ id: 'client-1', name: 'Acme Trading', currency: 'USD', balance: '500.00' }],
      total: 1,
    },
  }),
}))

vi.mock('../hooks/useInvoices', () => ({
  useInvoices: () => ({
    data: {
      data: [{
        id: 'inv-1',
        displayId: 'INV-0001',
        clientId: 'client-1',
        status: 'issued',
        total: '150.00',
        paidAmount: '0.00',
        dueDate: '2026-01-01',
        lines: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      total: 1,
    },
  }),
}))

vi.mock('../hooks/useReports', () => ({
  useArSummary: () => ({ data: { totalOutstanding: '500.00', totalCollected: '0.00' }, isLoading: false }),
}))

const receiverUser = { id: 'receiver-1', name: 'Marie', role: 'receiver' }
const mockUseCashReceivers = vi.fn(() => ({ data: [receiverUser] }))
vi.mock('../hooks/useUsers', () => ({
  useCashReceivers: () => mockUseCashReceivers(),
}))

import Payment from './Payment'

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPayment() {
  return render(
    <MemoryRouter>
      <Payment />
    </MemoryRouter>,
  )
}

describe('Payment page — receiver resolution', () => {
  it('selecting a client and a receiver, then saving, resolves the receiver name to a real receiverId', async () => {
    const user = userEvent.setup()
    renderPayment()

    await user.selectOptions(screen.getByDisplayValue('Select a client…'), 'client-1')
    await user.selectOptions(screen.getByDisplayValue('— select receiver —'), 'Marie')
    await user.click(screen.getByRole('button', { name: /Save payment/ }))

    await waitFor(() => expect(mockCreatePaymentMutate).toHaveBeenCalled())
    const [body] = mockCreatePaymentMutate.mock.calls[0]
    expect(body.receiverId).toBe('receiver-1')
    expect(body.receiverName).toBeUndefined()
  })

  it('leaving the receiver unselected blocks submission — a payment must not silently lose WHO RECEIVED IT (all three methods offered here — cash/whish/omt — require a receiver)', async () => {
    const user = userEvent.setup()
    renderPayment()

    await user.selectOptions(screen.getByDisplayValue('Select a client…'), 'client-1')
    await user.click(screen.getByRole('button', { name: /Save payment/ }))

    // Give any (incorrect) async submission a chance to fire before asserting absence.
    await new Promise(r => setTimeout(r, 50))
    expect(mockCreatePaymentMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Receiver is required.')).toBeInTheDocument()
  })

  // Regression (forensic audit, 2026-09): the receiver <select> used to be
  // keyed by display NAME (`value={r.name}`), resolved to an id only at
  // submit time via `allReceivers.find(r => r.name === receiverName)`. Two
  // real users sharing a name (proven live against this exact dev database —
  // 41 duplicate "Test Owner" rows from leaked test fixtures) made `.find()`
  // silently resolve to whichever same-named user happened to come first,
  // crediting a real $2,000+ cash payment to the wrong person's ledger with
  // no error. The select must now be keyed by the receiver's stable id, so
  // selecting the SECOND same-named option can never resolve to the first.
  it('two receivers sharing the same display name — selecting the second one submits ITS id, never the first', async () => {
    const sameNameA = { id: 'receiver-a', name: 'Test Owner', role: 'owner' }
    const sameNameB = { id: 'receiver-b', name: 'Test Owner', role: 'owner' }
    // mockReturnValue (not -Once): the component re-renders multiple times
    // (client selection, receiver selection) and calls useCashReceivers()
    // on every render — a -Once value would only survive the first.
    mockUseCashReceivers.mockReturnValue({ data: [sameNameA, sameNameB] })

    try {
      const user = userEvent.setup()
      renderPayment()

      await user.selectOptions(screen.getByDisplayValue('Select a client…'), 'client-1')
      // Select the SECOND "Test Owner" option by DOM element, not by matching
      // text/value — two options render identical text, so only picking the
      // actual second <option> node proves this is a real UI selection of
      // receiver B, not an artifact of how the test looks it up.
      const receiverOptions = screen.getAllByText('Test Owner')
      expect(receiverOptions).toHaveLength(2)
      await user.selectOptions(screen.getByDisplayValue('— select receiver —'), receiverOptions[1])
      await user.click(screen.getByRole('button', { name: /Save payment/ }))

      await waitFor(() => expect(mockCreatePaymentMutate).toHaveBeenCalled())
      const [body] = mockCreatePaymentMutate.mock.calls[0]
      expect(body.receiverId).toBe('receiver-b')
      expect(body.receiverId).not.toBe('receiver-a')
    } finally {
      // Restore the default single-receiver mock so later tests in this file are unaffected.
      mockUseCashReceivers.mockReturnValue({ data: [receiverUser] })
    }
  })
})

describe('Payment page — Apply-to-invoice display honesty', () => {
  // Regression: CreatePaymentDto has no per-invoice allocation — the whole
  // typed `amount` is applied to the single selected invoice, unclamped
  // (payment-allocation.service.ts's allocateDirect never caps to
  // outstanding). The readonly "Apply" column used to always show the
  // invoice's outstanding balance, which was only true by coincidence when
  // amount happened to equal it — it silently implied a cap that doesn't
  // exist whenever the two diverged.
  it('the Apply column reflects the amount that will actually be applied, not the invoice outstanding balance', async () => {
    const user = userEvent.setup()
    renderPayment()

    await user.selectOptions(screen.getByDisplayValue('Select a client…'), 'client-1')
    // Client balance (Acme Trading) is 500.00, so amount=300 stays under the
    // client-level cap while still differing from the invoice's own 150.00
    // outstanding — the case that exposed the bug.
    const amountInput = screen.getByPlaceholderText('0')
    await user.clear(amountInput)
    await user.type(amountInput, '300')

    const row = screen.getByText('INV-0001').closest('.apply-row') as HTMLElement
    fireEvent.click(row.querySelector('.check') as Element)

    const applyInput = row.querySelector('.apply-input') as HTMLInputElement
    expect(applyInput.value).toBe('300.00')
  })
})
