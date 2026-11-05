// Renders a React document component off-screen and turns it into a PDF File.
// Used by the Print / Download / Share dialog for HTML documents (invoice,
// delivery receipt, daily report) so the PDF shows the SAME component the
// print route renders. Browser-only.

import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { htmlElementToPdfFile, type HtmlPdfOptions } from './index'

export interface RenderToPdfOptions {
  /** Layout width (CSS px) of the off-screen container. Default 794 (A4 at 96dpi). */
  widthPx?: number
  /** Max ms to wait for images/fonts before rendering anyway. Default 4000. */
  settleTimeoutMs?: number
  /**
   * Paper width in mm for fixed-width documents (delivery receipt): the PDF is
   * then one page of this width and the content's rendered height.
   * Omit for A4 documents (multi-page only on real overflow).
   */
  paperWidthMm?: HtmlPdfOptions['paperWidthMm']
}

/** Resolves when every <img> under `el` has loaded/failed, or after `timeoutMs`. */
async function waitForAssets(el: HTMLElement, timeoutMs: number): Promise<void> {
  const pending: Promise<unknown>[] = Array.from(el.querySelectorAll('img'))
    .filter((img) => !img.complete)
    .map((img) => new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    }))
  const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
  if (fonts?.ready) pending.push(fonts.ready)
  if (pending.length === 0) return
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))])
}

/**
 * Mounts `element` in a hidden, fixed-width container, waits for images and
 * fonts, rasterises it into a PDF (A4, or one fixed-width page) via {@link htmlElementToPdfFile}, and
 * always cleans up the container. The element must be self-contained (no
 * router/query context unless you wrap it yourself).
 */
export async function renderElementToPdfFile(
  element: ReactElement,
  filename: string,
  { widthPx = 794, settleTimeoutMs = 4000, paperWidthMm }: RenderToPdfOptions = {},
): Promise<File> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // Laid out at the document origin but invisible and behind the app. It must
  // NOT be positioned off-screen: html2canvas then captures an empty area
  // (blank PDFs). htmlElementToPdfFile makes only its private clone opaque.
  host.style.cssText = `position:absolute;left:0;top:0;width:${widthPx}px;background:#fff;opacity:0;z-index:-2147483647;pointer-events:none;`
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(element))
    await waitForAssets(host, settleTimeoutMs)
    return await htmlElementToPdfFile(host, filename, { paperWidthMm })
  } finally {
    root.unmount()
    host.remove()
  }
}
