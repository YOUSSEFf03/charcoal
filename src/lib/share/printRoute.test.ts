// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { openPrintRoute, openPdfInNewTab, printCurrentPage, printRouteUrl } from './printRoute'
import { clientPhoneContacts, supplierContacts } from './contacts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('printRouteUrl / openPrintRoute', () => {
  it('appends the chosen language as ?lang=', () => {
    expect(printRouteUrl('/invoice/inv-1', 'ar')).toBe('/invoice/inv-1?lang=ar')
    expect(printRouteUrl('/orders/o1/delivery-receipt', 'bilingual')).toBe('/orders/o1/delivery-receipt?lang=bilingual')
  })

  it('opens the print route in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    openPrintRoute('/reports/daily/2026-08-01', 'ar')
    expect(open).toHaveBeenCalledWith('/reports/daily/2026-08-01?lang=ar', '_blank')
  })

  it('falls back to same-tab navigation when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } })
    openPrintRoute('/invoice/inv-1', 'en')
    expect(assign).toHaveBeenCalledWith('/invoice/inv-1?lang=en')
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })
})

describe('printCurrentPage', () => {
  it('prints on a later tick so a closing dialog is not part of the printout', () => {
    vi.useFakeTimers()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    printCurrentPage()
    expect(print).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(print).toHaveBeenCalledTimes(1)
  })
})

describe('openPdfInNewTab', () => {
  const file = new File(['pdf'], 'a.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })

  it('opens the tab synchronously (inside the click) and points it at the PDF when ready', async () => {
    const win = { location: { href: '' }, close: vi.fn() } as unknown as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(win)
    const p = openPdfInNewTab(async () => file)
    expect(open).toHaveBeenCalledTimes(1)
    await p
    expect(win.location.href).toBe('blob:x')
  })

  it('closes the blank tab and rethrows when the build fails', async () => {
    const win = { location: { href: '' }, close: vi.fn() } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(win)
    await expect(openPdfInNewTab(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(win.close).toHaveBeenCalled()
  })

  it('downloads the file when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await openPdfInNewTab(async () => file)
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe('contact helpers', () => {
  it('clientPhoneContacts labels by type, puts active numbers first, marks inactive ones, and drops blanks/duplicates', () => {
    const out = clientPhoneContacts([
      { number: '03 111 222', label: 'office', isActive: false },
      { number: '+961 70 000003', label: 'mobile', isActive: true },
      { number: '+961 70 000003', label: 'whatsapp', isActive: true },
      { number: '  ', label: 'mobile', isActive: true },
    ])
    expect(out).toEqual([
      { label: 'Mobile', phone: '+961 70 000003' },
      { label: 'Office (inactive)', phone: '03 111 222' },
    ])
  })

  it('handles missing phones', () => {
    expect(clientPhoneContacts(undefined)).toEqual([])
    expect(supplierContacts(null)).toEqual([])
  })

  it('clientPhoneContacts labels each number with the client name when given', () => {
    expect(clientPhoneContacts([
      { number: '+961 70 000003', label: 'mobile', isActive: true },
      { number: '03 111 222', label: 'office', isActive: false },
    ], ' Ahmad ')).toEqual([
      { label: 'Ahmad', phone: '+961 70 000003' },
      { label: 'Ahmad (inactive)', phone: '03 111 222' },
    ])
  })

  it('supplierContacts labels by person and role and skips contacts without a phone', () => {
    expect(supplierContacts([
      { name: 'Omar', role: 'sales', phone: ' 03 555 111 ' },
      { name: 'Lina', role: 'logistics', phone: '' },
    ])).toEqual([{ label: 'Omar · sales', phone: '03 555 111' }])
  })
})
