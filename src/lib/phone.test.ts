import { describe, it, expect } from 'vitest'
import { toWhatsAppDigits } from './phone'

// ---------------------------------------------------------------------------
// Regression coverage for the WhatsApp-share phone audit: the previous
// approach (`.replace(/\D/g, '')`) got real, currently-stored client phone
// formats wrong — see phone.ts's doc comment for the exact live-DB values
// that motivated this ("0312331", "+961 03454385").
// ---------------------------------------------------------------------------
describe('toWhatsAppDigits', () => {
  it('local Lebanese format with leading 0 (no country code) gets 961 prepended, 0 dropped', () => {
    expect(toWhatsAppDigits('0312331')).toBe('961312331')
  })

  it('already-correct international format is unchanged', () => {
    expect(toWhatsAppDigits('+961 70 000003')).toBe('96170000003')
    expect(toWhatsAppDigits('+9613000002')).toBe('9613000002')
  })

  it('961-prefixed with no leading + is unchanged (already digits-only equivalent)', () => {
    expect(toWhatsAppDigits('9613000002')).toBe('9613000002')
  })

  it('malformed "+961 0…" (redundant local leading 0 after the country code) has the 0 stripped — real data in this DB has exactly this shape', () => {
    expect(toWhatsAppDigits('+961 03454385')).toBe('9613454385')
  })

  it('handles spaces/dashes/parens anywhere in the number', () => {
    expect(toWhatsAppDigits('+961 (3) 000-002')).toBe('9613000002')
    expect(toWhatsAppDigits('03-123-31')).toBe('961312331')
  })

  it('a bare number with no leading 0 and no country code still gets 961 prepended', () => {
    expect(toWhatsAppDigits('3123456')).toBe('9613123456')
  })

  it('trusts an explicit non-961 country code as-is, does not force Lebanon onto it', () => {
    expect(toWhatsAppDigits('+971 50 1234567')).toBe('971501234567')
  })

  it('missing/empty/whitespace-only number returns "" — never opens a share targeting nobody', () => {
    expect(toWhatsAppDigits('')).toBe('')
    expect(toWhatsAppDigits(null)).toBe('')
    expect(toWhatsAppDigits(undefined)).toBe('')
    expect(toWhatsAppDigits('   ')).toBe('')
  })

  it('a number with no digits at all (garbage input) returns ""', () => {
    expect(toWhatsAppDigits('n/a')).toBe('')
  })
})
