// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Regression: confirmActiveDelivery() in DriverMobile.tsx previously sent
// `actualKg` inside the confirmDelivery body even though ConfirmDeliveryDto
// has no such field (actual weight has its own dedicated PATCH endpoint) —
// forbidNonWhitelisted validation rejected the request with a 400 whenever a
// driver actually weighed the load. It also never sent `paymentMethod`, so
// shipments.service.ts's `if (paymentAmount && paymentMethod)` guard never
// fired and cash collected on delivery was never credited to any ledger.
// ---------------------------------------------------------------------------

const mockConfirmDeliveryMutate = vi.fn((_vars, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.())
const mockLogActualWeightMutate = vi.fn()

vi.mock('../hooks/useShipments', () => ({
  useShipments: () => ({
    data: {
      data: [
        {
          id: 'shipment-1',
          tripId: 'trip-1',
          status: 'loaded',
          address: 'Achrafieh, Beirut',
          nominalKg: '150.000',
          bags: [{ bagTypeId: 'bag-1', quantity: 50 }],
          displayId: 'INV-0339',
        },
      ],
      total: 1,
    },
    isLoading: false,
    isError: false,
  }),
  useConfirmDelivery: () => ({ mutate: mockConfirmDeliveryMutate, isPending: false }),
  useLogActualWeight: () => ({ mutate: mockLogActualWeightMutate, isPending: false }),
}))

vi.mock('../hooks/useDriverTrips', () => ({
  useDriverTrips: () => ({
    data: { data: [{ id: 'trip-1', driverId: 'driver-abcdefgh', status: 'in_progress' }], total: 1 },
    isLoading: false,
    isError: false,
  }),
  useStartTrip: () => ({ mutate: vi.fn() }),
  useCompleteTrip: () => ({ mutate: vi.fn() }),
}))

vi.mock('../hooks/useBagTypes', () => ({
  useBagTypes: () => ({ data: [] }),
}))

vi.mock('../context/RateContext', () => ({
  useRate: () => ({ rate: '89,550', rawRate: 89550, setRate: vi.fn(), isSaving: false }),
}))

import DriverMobile from './DriverMobile'

beforeEach(() => {
  vi.clearAllMocks()
})

async function goToConfirmScreen(user: ReturnType<typeof userEvent.setup>) {
  render(<DriverMobile />)
  await user.click(screen.getByText('driver-a'))
  await user.click(screen.getByRole('button', { name: /Deliver/ }))
}

describe('DriverMobile — confirm delivery contract', () => {
  it('regression: actualKg is only sent via the dedicated actual-weight endpoint, never in the confirmDelivery body', async () => {
    const user = userEvent.setup()
    await goToConfirmScreen(user)

    // The actual-weight input and the LBP amount input share placeholder "0" —
    // weight renders first (earlier section on the confirm screen).
    const weightInput = screen.getAllByPlaceholderText('0')[0]
    await user.type(weightInput, '148')
    await user.click(screen.getByRole('button', { name: /Print & confirm/ }))

    await waitFor(() => expect(mockConfirmDeliveryMutate).toHaveBeenCalled())
    expect(mockLogActualWeightMutate).toHaveBeenCalledWith({ id: 'shipment-1', body: { actualKg: '148' } })
    const [call] = mockConfirmDeliveryMutate.mock.calls[0]
    expect(call.body).not.toHaveProperty('actualKg')
  })

  it('regression: a cash payment amount includes the selected paymentMethod so it can be credited to a ledger', async () => {
    const user = userEvent.setup()
    await goToConfirmScreen(user)

    await user.type(screen.getByPlaceholderText('0.00'), '280')
    await user.click(screen.getByText('Whish'))
    await user.click(screen.getByRole('button', { name: /Print & confirm/ }))

    await waitFor(() => expect(mockConfirmDeliveryMutate).toHaveBeenCalled())
    const [call] = mockConfirmDeliveryMutate.mock.calls[0]
    expect(call.body.paymentAmount).toBe('280.00')
    expect(call.body.paymentMethod).toBe('whish')
  })

  it('omits paymentMethod when the delivery is on account (no cash collected)', async () => {
    const user = userEvent.setup()
    await goToConfirmScreen(user)

    // The toggle switch is a plain unlabeled div (no accessible role) — its
    // click handler sits on the switch itself, not the adjacent label span.
    const toggle = screen.getByText('Goes on account (pay later)').nextElementSibling as Element
    fireEvent.click(toggle)
    await user.click(screen.getByRole('button', { name: /Print & confirm/ }))

    await waitFor(() => expect(mockConfirmDeliveryMutate).toHaveBeenCalled())
    const [call] = mockConfirmDeliveryMutate.mock.calls[0]
    expect(call.body.paymentAmount).toBeUndefined()
    expect(call.body.paymentMethod).toBeUndefined()
  })

  it('regression: confirming with no amount entered and "on account" left off does not send a $0.00 payment', async () => {
    // Final-audit finding: once paymentMethod was wired up, an empty amount +
    // onAccount=false computed paymentAmount="0.00" (truthy), so the backend's
    // `if (paymentAmount && paymentMethod)` guard fired and created a real,
    // noisy $0.00 Payment/ledger-credit row on every such confirmation.
    const user = userEvent.setup()
    await goToConfirmScreen(user)

    await user.click(screen.getByRole('button', { name: /Print & confirm/ }))

    await waitFor(() => expect(mockConfirmDeliveryMutate).toHaveBeenCalled())
    const [call] = mockConfirmDeliveryMutate.mock.calls[0]
    expect(call.body.paymentAmount).toBeUndefined()
    expect(call.body.paymentMethod).toBeUndefined()
  })
})
