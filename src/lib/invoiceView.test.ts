import { describe, expect, it } from 'vitest'
import { invoiceLineView, invoiceStatusKey } from './invoiceView'
import { primaryPhoneForDisplay } from './phoneDisplay'

describe('invoiceLineView', () => {
  it('splits a KG line into product / quantity (trimmed, Arabic unit) / unit price / total', () => {
    expect(invoiceLineView('ar', { saleUnit: 'KG', kgQuantity: '500.000', description: 'BBQ Hardwood Grade A', pricePerKg: '1.2', lineTotal: 600 }))
      .toEqual({ product: 'BBQ Hardwood Grade A', quantity: '500 كغ', unitPrice: '1.20', total: '600.00' })
  })
  it('splits a BAG line (saleUnit absent = BAG)', () => {
    expect(invoiceLineView('ar', { bagTypeId: 'b', bagTypeName: '10kg Bag', qty: 14, pricePerBag: 11, lineTotal: 154 }))
      .toEqual({ product: '10kg Bag', quantity: '14 كيس', unitPrice: '11.00', total: '154.00' })
  })
})

it('leaves out a missing unit price instead of printing NaN', () => {
  expect(invoiceLineView('ar', { bagTypeName: '5kg bag', qty: 3, lineTotal: 30 } as never).unitPrice).toBeNull()
})

describe('invoiceStatusKey', () => {
  it('reads the server balanceDue without recomputing', () => {
    expect(invoiceStatusKey('354')).toBe('owed')
    expect(invoiceStatusKey('0')).toBe('paid')
    expect(invoiceStatusKey('0.00')).toBe('paid')
    expect(invoiceStatusKey('-5')).toBe('overpaid')
  })
})

describe('primaryPhoneForDisplay', () => {
  it('returns the first active, cleaned phone or ""', () => {
    expect(primaryPhoneForDisplay([{ number: '03 111', isActive: false }, { number: '`23123123', isActive: true }])).toBe('23123123')
    expect(primaryPhoneForDisplay([{ number: '`', isActive: true }])).toBe('')
    expect(primaryPhoneForDisplay(undefined)).toBe('')
  })
})
