import { describe, expect, it } from 'vitest'
import { parseStatementDescription, trimQuantity } from './statementDescription'
import { cleanPhoneForDisplay, describeRowLines } from './statementPdf'

describe('parseStatementDescription', () => {
  it('reads a KG order sale with a known location suffix', () => {
    expect(parseStatementDescription('Order Sale · 500.000 kg BBQ Hardwood Grade A - hanmra', ['hanmra'])).toEqual({
      kind: 'sale', source: 'order', location: 'hanmra',
      items: [{ unit: 'KG', quantity: '500.000', product: 'BBQ Hardwood Grade A' }],
    })
  })

  it('keeps " - x" inside the product when x is not a known location (never guesses)', () => {
    const p = parseStatementDescription('Order Sale · 20.000 kg Oak - Grade B', ['hanmra'])
    expect(p).toEqual({ kind: 'sale', source: 'order', location: null, items: [{ unit: 'KG', quantity: '20.000', product: 'Oak - Grade B' }] })
  })

  it('reads multi-line and BAG sales, and warehouse sales', () => {
    expect(parseStatementDescription('Order Sale · 12.500 kg Lemon wood · 10 × 10kg Bag')).toEqual({
      kind: 'sale', source: 'order', location: null,
      items: [{ unit: 'KG', quantity: '12.500', product: 'Lemon wood' }, { unit: 'BAG', quantity: '10', product: '10kg Bag' }],
    })
    expect(parseStatementDescription('Warehouse Sale · 3 × 2kg Bag')).toMatchObject({ kind: 'sale', source: 'warehouse' })
    expect(parseStatementDescription('Order Sale')).toEqual({ kind: 'sale', source: 'order', location: null, items: [] })
  })

  it('maps every backend payment label', () => {
    expect(parseStatementDescription('Cash Payment')).toEqual({ kind: 'payment', method: 'cash' })
    expect(parseStatementDescription('Whish')).toEqual({ kind: 'payment', method: 'whish' })
    expect(parseStatementDescription('OMT')).toEqual({ kind: 'payment', method: 'omt' })
    expect(parseStatementDescription('Bank Transfer')).toEqual({ kind: 'payment', method: 'bank_transfer' })
    expect(parseStatementDescription('Cheque Payment')).toEqual({ kind: 'payment', method: 'cheque' })
    expect(parseStatementDescription('Payment')).toEqual({ kind: 'payment', method: 'other' })
  })

  it('reads carried-forward balances with and without notes', () => {
    expect(parseStatementDescription('Opening balance (carried forward)')).toEqual({ kind: 'carried_forward', notes: null })
    expect(parseStatementDescription('Opening balance (carried forward) · old system')).toEqual({ kind: 'carried_forward', notes: 'old system' })
  })

  it('returns null for anything not in a known format', () => {
    expect(parseStatementDescription('Filled bags pickup — 4 bags (4× 10kg)')).toBeNull()
    expect(parseStatementDescription('Order Sale · something odd')).toBeNull()
    expect(parseStatementDescription('Sales Invoice')).toBeNull()
  })
})

describe('trimQuantity', () => {
  it('drops trailing zeros only', () => {
    expect(trimQuantity('500.000')).toBe('500')
    expect(trimQuantity('12.500')).toBe('12.5')
    expect(trimQuantity('10')).toBe('10')
  })
})

describe('describeRowLines (Arabic labelled description)', () => {
  it('lays out type / product / quantity / branch from the original data', () => {
    expect(describeRowLines('ar', 'Order Sale · 500.000 kg BBQ Hardwood Grade A - hanmra', ['hanmra'])).toEqual([
      'نوع الحركة: مبيع',
      'المنتج: BBQ Hardwood Grade A',
      'الكمية: 500 كغ',
      'الفرع: hanmra',
    ])
    expect(describeRowLines('ar', 'Order Sale · 10 × 10kg Bag')).toEqual(['نوع الحركة: مبيع', 'المنتج: 10kg Bag', 'الكمية: 10 كيس'])
    expect(describeRowLines('ar', 'Cash Payment')).toEqual(['نوع الحركة: دفعة نقدية'])
  })

  it('returns null for unknown formats so the original text is shown', () => {
    expect(describeRowLines('ar', 'Filled bags pickup — 4 bags (4× 10kg)')).toBeNull()
  })
})

describe('cleanPhoneForDisplay', () => {
  it('removes stray characters but keeps a valid number intact', () => {
    expect(cleanPhoneForDisplay('`23123123')).toBe('23123123')
    expect(cleanPhoneForDisplay('+961 70 123 456')).toBe('+961 70 123 456')
    expect(cleanPhoneForDisplay(' (03) 454-385 ')).toBe('(03) 454-385')
  })
  it('returns "" for missing or junk-only values', () => {
    expect(cleanPhoneForDisplay(null)).toBe('')
    expect(cleanPhoneForDisplay('`')).toBe('')
  })
})
