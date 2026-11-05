// Page-break planning for rasterised (html2canvas) PDFs. Pure — no DOM, no jsPDF.

/** A vertical span (CSS px, relative to the document top) that must not be cut. */
export interface KeepTogether {
  top: number
  bottom: number
}

/**
 * Splits a document of `totalHeight` px into page slices of at most
 * `pageHeight` px. Each cut lands on the latest "safe" y on that page — the
 * bottom of a block (`breakCandidates`) that no `keepTogether` span straddles —
 * so table rows and blocks are never sliced in half. If no safe y exists in
 * the lower half of a page (e.g. one row taller than half a page), the page is
 * cut at its full height instead, so progress is always made.
 *
 * Returns `[start, end)` pairs covering 0..totalHeight with no gaps.
 */
export function planPageSlices(
  totalHeight: number,
  pageHeight: number,
  breakCandidates: number[],
  keepTogether: KeepTogether[] = [],
): Array<[number, number]> {
  if (totalHeight <= 0 || pageHeight <= 0) return [[0, Math.max(0, totalHeight)]]
  const safe = Array.from(new Set(breakCandidates.map((y) => Math.round(y))))
    .filter((y) => y > 0 && y < totalHeight)
    .filter((y) => !keepTogether.some((k) => k.top < y - 0.5 && y + 0.5 < k.bottom))
    .sort((a, b) => a - b)

  const slices: Array<[number, number]> = []
  let start = 0
  while (totalHeight - start > pageHeight + 0.5) {
    const limit = start + pageHeight
    const minUseful = start + pageHeight / 2
    let cut = limit
    for (let i = safe.length - 1; i >= 0; i--) {
      const y = safe[i]
      if (y <= limit && y > minUseful) { cut = y; break }
      if (y <= minUseful) break
    }
    slices.push([start, cut])
    start = cut
  }
  slices.push([start, totalHeight])
  return slices
}
