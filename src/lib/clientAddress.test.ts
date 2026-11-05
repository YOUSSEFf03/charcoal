import { describe, expect, it } from 'vitest'
import { clientDocumentAddress, firstAddress, formatLocationAddress } from './clientAddress'

describe('firstAddress', () => {
  it('skips null, undefined and blank values', () => {
    expect(firstAddress(null, '  ', undefined, 'Zgharta')).toBe('Zgharta')
  })
  it('returns null when nothing usable', () => {
    expect(firstAddress(null, '', '   ')).toBeNull()
  })
})

describe('formatLocationAddress', () => {
  it('joins name and address', () => {
    expect(formatLocationAddress({ name: 'Hamra', address: 'Bliss St' })).toBe('Hamra – Bliss St')
  })
  it('falls back to whichever part exists', () => {
    expect(formatLocationAddress({ name: 'Hamra', address: null })).toBe('Hamra')
    expect(formatLocationAddress({ name: ' ', address: 'Bliss St' })).toBe('Bliss St')
  })
})

describe('clientDocumentAddress', () => {
  const locations = [
    { name: 'Hamra', address: 'Bliss St', isActive: true },
    { name: 'Jounieh', address: 'Main Rd', isActive: true },
    { name: 'Old', address: 'Closed Rd', isActive: false },
    { name: 'NoAddr', address: null, isActive: true },
  ]

  it('single-location client uses its own address only', () => {
    expect(clientDocumentAddress('Zgharta', locations, false)).toBe('Zgharta')
    expect(clientDocumentAddress('', locations, false)).toBeNull()
  })

  it('multi-location client lists every active location address', () => {
    expect(clientDocumentAddress(null, locations, true)).toBe('Hamra – Bliss St\nJounieh – Main Rd')
  })

  it('keeps the client address first when present', () => {
    expect(clientDocumentAddress('Zgharta', locations, true)).toBe('Zgharta\nHamra – Bliss St\nJounieh – Main Rd')
  })

  it('returns null when no location has an address', () => {
    expect(clientDocumentAddress(null, [{ name: 'X', address: '' }], true)).toBeNull()
  })
})
