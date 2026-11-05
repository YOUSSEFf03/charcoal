// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

const mockHtmlToPdf = vi.fn()
vi.mock('./index', () => ({
  htmlElementToPdfFile: (el: HTMLElement, name: string) => mockHtmlToPdf(el, name),
}))

import { renderElementToPdfFile } from './renderDocument'

describe('renderElementToPdfFile', () => {
  it('renders the element off-screen at the requested width, hands it to the PDF builder, then cleans up', async () => {
    let seenHtml = ''
    let seenWidth = ''
    mockHtmlToPdf.mockImplementationOnce(async (el: HTMLElement, name: string) => {
      seenHtml = el.innerHTML
      seenWidth = el.style.width
      expect(document.body.contains(el)).toBe(true)
      return new File(['x'], name, { type: 'application/pdf' })
    })
    const file = await renderElementToPdfFile(<p dir="rtl">مرحبا 123</p>, 'doc.pdf', { widthPx: 600 })
    expect(file.name).toBe('doc.pdf')
    expect(seenHtml).toContain('مرحبا 123')
    expect(seenWidth).toBe('600px')
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('removes the container even when PDF generation fails', async () => {
    mockHtmlToPdf.mockRejectedValueOnce(new Error('canvas failed'))
    await expect(renderElementToPdfFile(<p>hi</p>, 'x.pdf')).rejects.toThrow('canvas failed')
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
