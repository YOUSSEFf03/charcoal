// Helpers for the "Print" action of the document dialog. Browser-only.

import { downloadFile } from './index'

/** Builds `<path>?lang=<lang>` for a print route (path must not already have a query). */
export function printRouteUrl(path: string, lang: string): string {
  return `${path}?lang=${encodeURIComponent(lang)}`
}

/**
 * Opens a print route in a new tab. When the browser blocks the popup
 * (window.open returns null) it falls back to navigating the current tab, so
 * the action never silently does nothing. Call it synchronously from a click
 * handler so popup blockers treat it as user-initiated.
 */
export function openPrintRoute(path: string, lang: string): void {
  const url = printRouteUrl(path, lang)
  const win = window.open(url, '_blank')
  if (win) {
    try { win.opener = null } catch { /* cross-origin guard; harmless */ }
    return
  }
  window.location.assign(url)
}

/**
 * Prints the CURRENT page after the dialog has unmounted (so the modal is not
 * part of the printout). Deferred one tick; returns immediately.
 */
export function printCurrentPage(): void {
  setTimeout(() => window.print(), 80)
}

/**
 * Opens a generated PDF in a new tab so the browser's PDF viewer can print it
 * (used for Arabic statements, which only exist as a PDF). When the popup is
 * blocked it downloads the file instead.
 */
export function openFileInNewTab(file: File): void {
  const url = URL.createObjectURL(file)
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    downloadFile(file)
    return
  }
  // Keep the object URL alive long enough for the viewer to load it.
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)
}

/**
 * Like {@link openFileInNewTab} but for a file that takes time to build: the
 * tab is opened synchronously (inside the click gesture, so popup blockers
 * allow it) and pointed at the PDF once ready. If the tab could not be opened
 * the file is downloaded instead; if the build fails the blank tab is closed
 * and the error is rethrown.
 */
export async function openPdfInNewTab(build: () => Promise<File>): Promise<void> {
  const win = window.open('', '_blank')
  let file: File
  try {
    file = await build()
  } catch (e) {
    win?.close()
    throw e
  }
  if (!win) {
    downloadFile(file)
    return
  }
  const url = URL.createObjectURL(file)
  win.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)
}
