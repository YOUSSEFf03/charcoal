// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { canShareFiles, downloadFile, whatsappUrl } from './index'

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
})

describe('whatsappUrl', () => {
  it('normalizes a local Lebanese number and encodes the text', () => {
    expect(whatsappUrl('03 123 456', 'Hi & bye')).toBe('https://wa.me/9613123456?text=Hi%20%26%20bye')
  })
  it('omits the query when there is no text', () => {
    expect(whatsappUrl('+961 70 000003')).toBe('https://wa.me/96170000003')
  })
  it('returns null for a number with no digits', () => {
    expect(whatsappUrl('abc', 'x')).toBeNull()
  })
})

describe('canShareFiles', () => {
  const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
  it('is false when navigator.canShare is missing', () => {
    expect(canShareFiles(file)).toBe(false)
  })
  it('reflects navigator.canShare and swallows throws', () => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    expect(canShareFiles(file)).toBe(true)
    Object.defineProperty(navigator, 'canShare', {
      value: () => {
        throw new Error('x')
      },
      configurable: true,
    })
    expect(canShareFiles(file)).toBe(false)
  })
})

describe('downloadFile', () => {
  it('clicks a temporary anchor carrying the file name', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    let name = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    downloadFile(new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
    expect(name).toBe('doc.pdf')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
