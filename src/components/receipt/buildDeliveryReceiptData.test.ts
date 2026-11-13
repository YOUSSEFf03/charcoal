import { describe, expect, it } from 'vitest'
import type { ClientOrderDetail } from '../../lib/types'
import { buildDeliveryReceiptData } from './buildDeliveryReceiptData'

const order = (over: Partial<ClientOrderDetail> = {}) => ({
  id: 'abcdef12-0000-0000-0000-000000000000',
  displayId: 'ORD-0042',
  bagTypeId: null,
  bagType: null,
  bagLines: [],
  pricePerBag: '2',
  totalKgRequested: '100',
  charcoalType: 'Oak',
  grade: 'A',
  currency: 'USD',
  notes: null,
  shipments: [],
  client: { id: 'c1', name: 'Ahmad', nameAr: null, type: 'RESTAURANT', currency: 'USD', address: 'Zgharta' },
  location: null,
  ...over,
}) as unknown as ClientOrderDetail

describe('buildDeliveryReceiptData — location', () => {
  it('has no location for a single-location client', () => {
    expect(buildDeliveryReceiptData(order(), [], 'en').location).toBeNull()
  })

  it("shows the order's branch name and uses its address", () => {
    const data = buildDeliveryReceiptData(order({ location: { id: 'l1', name: 'Hamra Branch', address: 'Bliss St' } }), [], 'en')
    expect(data.location).toBe('Hamra Branch')
    expect(data.address).toBe('Bliss St')
  })

  it('keeps the client address when the branch has no address', () => {
    const data = buildDeliveryReceiptData(order({ location: { id: 'l1', name: 'Jounieh', address: null } }), [], 'en')
    expect(data.location).toBe('Jounieh')
    expect(data.address).toBe('Zgharta')
  })
})
