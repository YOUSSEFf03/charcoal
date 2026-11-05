// Helpers for sharing/downloading generated document files (PDFs).
// Pure/browser-only helpers; no React.

import { toWhatsAppDigits } from '../phone'
import { planPageSlices, type KeepTogether } from './pdfPaging'

/** True when the browser can open its native share sheet for this file. */
export function canShareFiles(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** Triggers a browser download of `file` under its own name. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Deferred so the browser has started the download before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Builds a `https://wa.me/<digits>?text=<encoded>` chat link. The phone is
 * normalized with `toWhatsAppDigits` (Lebanon assumed for local numbers).
 * Returns null when the phone has no usable digits. WhatsApp links cannot
 * carry attachments — the text is the only thing that can be prefilled.
 */
export function whatsappUrl(phone: string, text?: string): string | null {
  const digits = toWhatsAppDigits(phone)
  if (!digits) return null
  const base = `https://wa.me/${digits}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}

/** A4 portrait size in points (jsPDF default unit). */
const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89
const PT_PER_MM = 72 / 25.4
/** Default page margin for A4 output, in points (~8.5 mm). */
const A4_MARGIN_PT = 24
/** html2canvas pixel ratio: 2 keeps text crisp when printed/zoomed. */
const RASTER_SCALE = 2

export interface HtmlPdfOptions {
  /**
   * Fixed-width paper (e.g. a delivery receipt at 80/150/180/210 mm). The PDF is
   * ONE page exactly `paperWidthMm` wide and as tall as the rendered content,
   * instead of being split over A4 pages. Omit for A4 documents.
   */
  paperWidthMm?: number
  /**
   * Page margin in points. Default 24 for A4; 0 for `paperWidthMm` pages
   * (fixed-width documents already carry their own padding).
   */
  marginPt?: number
}

/** Elements whose bottom edge is a good place to end a page. */
const BREAK_SELECTOR = 'tr, h1, h2, h3, h4, h5, h6, p, li, img, table, section, header, footer, [data-pdf-break]'
/** Elements that must never be cut across two pages. */
const KEEP_SELECTOR = 'tr, img, h1, h2, h3, h4, h5, h6, [data-pdf-keep]'

/** Break candidates and keep-together spans of `el`, in CSS px from its top. */
function measureBreaks(el: HTMLElement): { candidates: number[]; keep: KeepTogether[] } {
  const originTop = el.getBoundingClientRect().top
  const candidates: number[] = []
  const keep: KeepTogether[] = []
  el.querySelectorAll<HTMLElement>(BREAK_SELECTOR).forEach((node) => {
    const r = node.getBoundingClientRect()
    if (r.height > 0) candidates.push(r.bottom - originTop)
  })
  el.querySelectorAll<HTMLElement>(KEEP_SELECTOR).forEach((node) => {
    const r = node.getBoundingClientRect()
    if (r.height > 0) keep.push({ top: r.top - originTop, bottom: r.bottom - originTop })
  })
  return { candidates, keep }
}

/** Copies rows [sy, sy+sh) of `src` into a new canvas. */
function sliceCanvas(src: HTMLCanvasElement, sy: number, sh: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = Math.max(1, sh)
  const ctx = out.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(src, 0, sy, src.width, sh, 0, 0, src.width, sh)
  }
  return out
}

/**
 * Renders an HTML element (e.g. a document component mounted by
 * renderElementToPdfFile) into a PDF File: html2canvas rasterises the element,
 * then jsPDF places the image on pages. The PDF therefore looks exactly like
 * the on-screen/print component; text is not selectable.
 *
 * - Default: A4 portrait with margins. When the content is taller than one
 *   page it is split at row/block boundaries (never through a table row).
 * - With `options.paperWidthMm`: a single page of that width whose height fits
 *   the rendered content.
 *
 * The element may be hidden with inline `opacity: 0` (so the user never sees
 * it); html2canvas's private clone is made opaque before capture. It must be
 * laid out inside the document (not positioned off-screen), or html2canvas
 * captures an empty area — the cause of the old blank PDFs.
 *
 * jsPDF and html2canvas are dynamically imported to stay out of the main bundle.
 */
export async function htmlElementToPdfFile(
  el: HTMLElement,
  filename: string,
  options: HtmlPdfOptions = {},
): Promise<File> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const widthPx = Math.max(el.scrollWidth, el.offsetWidth, 1)
  const heightPx = Math.max(el.scrollHeight, el.offsetHeight, 1)
  const paperWidthMm = options.paperWidthMm
  const fit = paperWidthMm != null && paperWidthMm > 0

  const pageWidthPt = fit ? paperWidthMm * PT_PER_MM : A4_WIDTH_PT
  const marginPt = options.marginPt ?? (fit ? 0 : A4_MARGIN_PT)
  const contentWidthPt = pageWidthPt - 2 * marginPt
  const ptPerPx = contentWidthPt / widthPx

  const { candidates, keep } = fit ? { candidates: [], keep: [] } : measureBreaks(el)

  const canvas = await html2canvas(el, {
    scale: RASTER_SCALE,
    useCORS: true,
    backgroundColor: '#ffffff',
    width: widthPx,
    height: heightPx,
    windowWidth: Math.max(widthPx, document.documentElement.clientWidth),
    logging: false,
    onclone: (_doc, cloned) => {
      // The live element is hidden with opacity:0; show the clone only.
      for (let n: HTMLElement | null = cloned; n; n = n.parentElement) {
        if (n.style.opacity === '0') n.style.opacity = '1'
      }
    },
  })
  const pxScale = canvas.width / widthPx

  if (fit) {
    const heightPt = heightPx * ptPerPx + 2 * marginPt
    // jsPDF swaps a custom [w, h] to portrait unless the orientation matches,
    // so a page wider than tall (a short receipt) must be declared landscape.
    const doc = new jsPDF({ unit: 'pt', format: [pageWidthPt, heightPt], orientation: pageWidthPt > heightPt ? 'landscape' : 'portrait', compress: true })
    doc.addImage(canvas, 'JPEG', marginPt, marginPt, contentWidthPt, heightPx * ptPerPx, undefined, 'FAST')
    return new File([doc.output('blob')], filename, { type: 'application/pdf' })
  }

  const pageContentPx = (A4_HEIGHT_PT - 2 * marginPt) / ptPerPx
  const slices = planPageSlices(heightPx, pageContentPx, candidates, keep)
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
  slices.forEach(([start, end], i) => {
    if (i > 0) doc.addPage('a4', 'portrait')
    const sy = Math.round(start * pxScale)
    const sh = Math.max(1, Math.min(canvas.height, Math.round(end * pxScale)) - sy)
    const part = sliceCanvas(canvas, sy, sh)
    doc.addImage(part, 'JPEG', marginPt, marginPt, contentWidthPt, (sh / pxScale) * ptPerPx, undefined, 'FAST')
  })
  return new File([doc.output('blob')], filename, { type: 'application/pdf' })
}
