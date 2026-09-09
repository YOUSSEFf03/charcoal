// Client Statement of Account — PDF export.
//
// This module is a pure, testable PDF *builder* (buildStatementPdf) plus a
// thin browser-download wrapper (exportStatementPdf), mirroring the existing
// split in excelExport.ts (buildWorkbook / exportExcel). It renders EXACTLY
// the figures the caller passes in — every debit/credit/balance here must
// come from ClientDetail.tsx's existing statement state (stmtFiltered,
// stmtOpening, stmtDebit, stmtCredit, stmtClosing, the SAME numbers already
// shown on screen and in the Excel export). This module does no independent
// balance/accounting math of its own — it only formats and lays them out.
//
// Deliberately excludes the reference sample's "PID" and "Financial Number"
// fields (Lebanese MOF identifiers) — not present anywhere in this app's
// Client model, and explicitly out of scope per product decision.
import type { jsPDF as JsPDFDoc } from 'jspdf'
import type { CellInput, RowInput } from 'jspdf-autotable'
import { formatUsd } from './money'
import { formatDate } from './date'
import { COMPANY_INFO } from './companyInfo'

// ── Palette — Farah Charcoal's own identity (near-black/cream), not a
// generic green accounting-template theme. Matches src/index.css's --text /
// --text2 / --text3 / --border / --red so the PDF visually belongs to the
// same brand as the rest of the app. --accent (green) is reserved for the
// closing-balance amount only, the same semantic (not decorative) use it
// already has on screen (e.g. ClientDetail's "in credit" / "settled" colors).
const INK = [26, 25, 22] as const // --text
const INK_SOFT = [90, 87, 79] as const // slightly darker than --text2 for print legibility
const MUTED = [155, 152, 144] as const // --text3
const PANEL_BG = [247, 246, 243] as const // warm off-white, not the green EMPHASIS_FILL from excelExport.ts
const BORDER = [223, 219, 209] as const
const RULE_DARK = [26, 25, 22] as const
const OWED = [176, 58, 46] as const // --red-ish, DB (client owes)
const SETTLED = [29, 107, 74] as const // --accent, CR/zero (in credit / settled)

export interface StatementPdfRow {
  ref: string
  /** ISO date string */
  rawDate: string
  desc: string
  debit: number
  credit: number
  /** Running balance as of this row (authoritative — from the backend ledger). */
  balance: number
}

export interface StatementPdfClient {
  name: string
  address?: string | null
  phone?: string | null
  currency: string
}

export interface StatementPdfConfig {
  client: StatementPdfClient
  /**
   * What kind of party `client` is — "Client" (default, e.g. a charcoal buyer)
   * or "Supplier" (a container/charcoal supplier we pay). Drives the "Client:"/
   * "Supplier:" line under the title and the "CLIENT INFORMATION"/"SUPPLIER
   * INFORMATION" panel header — purely a label, no effect on any figure.
   */
  partyLabel?: 'Client' | 'Supplier'
  /** ISO date, or null for an unbounded start. */
  from: string | null
  /** ISO date, or null for an unbounded end. */
  to: string | null
  /** The complete filtered/chronological period rows — never a paginated slice. */
  rows: StatementPdfRow[]
  /** Running balance immediately before the first row (0 when `from` is unbounded). */
  openingBalance: number
  /** Sum of rows[].debit / rows[].credit for the selected period. */
  periodDebitTotal: number
  periodCreditTotal: number
  /** Running balance as of the last row (or openingBalance when there are no rows). */
  closingBalance: number
}

function fmtAmount(n: number): string {
  return formatUsd(n, { symbol: false })
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' }

/** Known currencies get their symbol; anything else (e.g. LBP, which has no standard ASCII symbol) falls back to its plain currency code. */
function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}

/**
 * Customer-facing amount — "$2,027.97" / "-$200.00" — used for every amount
 * in the PDF (Debit, Credit, Balance, Totals): deliberately no DB/CR
 * accounting jargon (customers shouldn't need to know what "Debit Balance"
 * means). For a balance, the sign alone conveys the same debit/credit
 * distinction the app's internal ledger logic already computes (unchanged —
 * see balanceColor, which still uses that exact determination for the
 * semantic red/green). Debit/Credit/Totals are always non-negative, so the
 * sign is simply never shown for them.
 */
function fmtCustomerAmount(n: number, currency: string): string {
  const symbol = currencySymbol(currency)
  // A real symbol ($/€) sits flush against the number; a plain currency-code
  // fallback (e.g. "LBP") reads better with a separating space.
  const sep = symbol.length > 1 ? ' ' : ''
  const sign = n < -0.005 ? '-' : ''
  return `${sign}${symbol}${sep}${fmtAmount(Math.abs(n))}`
}

/** [r,g,b] color for a balance amount — semantic only (matches the app's existing owed/settled coloring), never a new accounting rule. */
function balanceColor(n: number): readonly [number, number, number] {
  if (n > 0.005) return OWED
  if (n < -0.005) return SETTLED
  return INK
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** "17/08/2026" — local calendar-day parts, same Date-parsing basis as src/lib/date.ts's formatDate(). */
function fmtDateSlash(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** "09 Aug 2026" — human-readable, for the statement-period line. */
function fmtDateHuman(iso: string | null): string {
  if (!iso) return '—'
  return formatDate(iso, { day: '2-digit' })
}

/** Strips characters illegal in Windows/macOS/Linux filenames and trims trailing dots/spaces. */
export function sanitizeFilenamePart(name: string, fallback = 'Client'): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().replace(/\.+$/, '')
  return cleaned || fallback
}

export function statementPdfFilename(clientName: string, fallback = 'Client'): string {
  return `${sanitizeFilenamePart(clientName, fallback)}_Statement of Account.pdf`
}

interface Layout {
  doc: JsPDFDoc
  pageWidth: number
  pageHeight: number
  margin: number
  contentWidth: number
  contentRight: number
}

function drawHeader(L: Layout, logo: { base64: string; aspectRatio: number }): number {
  const { doc, margin, contentRight } = L
  let y = margin

  // Real logo (src/assets/farah-charcoal-logo.png) — Arabic calligraphy mark
  // + "CHARCOAL" wordmark — embedded as-is, landscape aspect preserved.
  const logoH = 22
  const logoW = logoH * logo.aspectRatio
  doc.addImage(logo.base64, 'PNG', margin, y, logoW, logoH)
  const textX = margin + logoW + 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.setTextColor(...INK)
  doc.text(COMPANY_INFO.name, textX, y + 9)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  doc.text(COMPANY_INFO.address, textX, y + 16)
  doc.text(COMPANY_INFO.phone, textX, y + 21.5)

  y += Math.max(logoH, 22) + 8
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.6)
  doc.line(margin, y, contentRight, y)
  return y + 12
}

function drawTitleAndPeriod(L: Layout, y: number, config: StatementPdfConfig): number {
  const { doc, pageWidth } = L

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(21)
  doc.setTextColor(...INK)
  doc.setCharSpace(0.6)
  doc.text('STATEMENT OF ACCOUNT', pageWidth / 2, y, { align: 'center' })
  doc.setCharSpace(0)
  y += 11

  const fromStr = fmtDateHuman(config.from)
  const toStr = fmtDateHuman(config.to)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  doc.setTextColor(...INK)
  doc.text(`${config.partyLabel ?? 'Client'}: ${config.client.name}`, pageWidth / 2, y, { align: 'center' })
  y += 6.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  doc.text(`Currency: ${config.client.currency}`, pageWidth / 2, y, { align: 'center' })
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text(`Statement Period: ${fromStr} — ${toStr}`, pageWidth / 2, y, { align: 'center' })
  y += 8

  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.line(L.margin, y, L.contentRight, y)
  return y + 8
}

function drawClientInfoPanel(L: Layout, y: number, config: StatementPdfConfig): number {
  const { doc, margin, contentWidth } = L
  const partyLabel = config.partyLabel ?? 'Client'
  const rows: [string, string][] = [
    ['Name', config.client.name],
    ['Address', config.client.address || '—'],
    ['Phone', config.client.phone || '—'],
    ['Currency', config.client.currency],
  ]
  const headerH = 10
  const rowH = 6.8
  const boxH = headerH + rows.length * rowH + 3

  doc.setFillColor(...PANEL_BG)
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK)
  doc.text(`${partyLabel.toUpperCase()} INFORMATION`, margin + 6, y + 8)

  let ry = y + headerH + 4
  const labelX = margin + 6
  const valueX = margin + 38
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...INK_SOFT)
    doc.text(label, labelX, ry)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...INK)
    doc.text(value, valueX, ry)
    ry += rowH
  }

  return y + boxH + 8
}

/** Builds the account-summary box (Total Debit/Credit + emphasized Closing Balance). Returns its height in mm. */
function summaryBoxHeight(): number {
  return 42
}

function drawSummaryBox(L: Layout, y: number, config: StatementPdfConfig) {
  const { doc, margin, contentWidth, contentRight } = L
  const boxH = summaryBoxHeight()

  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...INK)
  doc.text('ACCOUNT SUMMARY', margin + 6, y + 9)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK_SOFT)
  doc.text('Total Debit', margin + 6, y + 18)
  doc.text('Total Credit', margin + 6, y + 25)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...INK)
  doc.text(fmtCustomerAmount(config.periodDebitTotal, config.client.currency), contentRight - 6, y + 18, { align: 'right' })
  doc.text(fmtCustomerAmount(config.periodCreditTotal, config.client.currency), contentRight - 6, y + 25, { align: 'right' })

  // Closing balance — the emphasized figure the whole box exists to surface.
  const barY = y + 29
  const barH = boxH - 29 - 2
  doc.setFillColor(...PANEL_BG)
  doc.roundedRect(margin + 2, barY, contentWidth - 4, barH, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(...INK)
  doc.text('CLOSING BALANCE', margin + 6, barY + barH / 2 + 3.2)
  doc.setFontSize(15)
  doc.setTextColor(...balanceColor(config.closingBalance))
  doc.text(fmtCustomerAmount(config.closingBalance, config.client.currency), contentRight - 6, barY + barH / 2 + 3.2, { align: 'right' })
}

function drawFooters(doc: JsPDFDoc, clientName: string, pageHeight: number, pageWidth: number, margin: number) {
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    const fy = pageHeight - 14
    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.25)
    doc.line(margin, fy, pageWidth - margin, fy)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.3)
    doc.setTextColor(...MUTED)
    doc.text(`Statement of Account — ${clientName}`, margin, fy + 5.5)
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, fy + 5.5, { align: 'right' })
  }
}

/**
 * Builds the PDF document in memory — no browser-download side effects, so
 * it's directly testable. Returns the live jsPDF instance.
 */
export async function buildStatementPdf(config: StatementPdfConfig): Promise<JsPDFDoc> {
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')
  // Dynamic-imported alongside jsPDF/autotable — the ~95KB base64 logo stays
  // out of the main bundle and only loads when a user actually exports a PDF.
  const { FARAH_LOGO_PNG_BASE64, FARAH_LOGO_ASPECT_RATIO } = await import('./farahLogoBase64')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18
  const L: Layout = { doc, pageWidth, pageHeight, margin, contentWidth: pageWidth - margin * 2, contentRight: pageWidth - margin }

  let y = drawHeader(L, { base64: FARAH_LOGO_PNG_BASE64, aspectRatio: FARAH_LOGO_ASPECT_RATIO })
  y = drawTitleAndPeriod(L, y, config)
  y = drawClientInfoPanel(L, y, config)

  // ── Transactions ──
  // Opening balance is its own visually distinct row (merged across
  // Trans#/Date/Description, shaded + bold) — never an ordinary transaction.
  const openingRow: RowInput = [
    { content: 'OPENING BALANCE', colSpan: 3, styles: { fontStyle: 'bold', fillColor: PANEL_BG as unknown as [number, number, number] } },
    { content: '', styles: { fillColor: PANEL_BG as unknown as [number, number, number] } },
    { content: '', styles: { fillColor: PANEL_BG as unknown as [number, number, number] } },
    { content: fmtCustomerAmount(config.openingBalance, config.client.currency), styles: { fontStyle: 'bold', halign: 'right', fillColor: PANEL_BG as unknown as [number, number, number], textColor: balanceColor(config.openingBalance) as unknown as [number, number, number] } },
  ]
  const body: RowInput[] = [
    openingRow,
    ...config.rows.map((r): CellInput[] => [
      r.ref,
      fmtDateSlash(r.rawDate),
      r.desc,
      r.debit ? fmtCustomerAmount(r.debit, config.client.currency) : '',
      r.credit ? fmtCustomerAmount(r.credit, config.client.currency) : '',
      { content: fmtCustomerAmount(r.balance, config.client.currency), styles: { textColor: balanceColor(r.balance) as unknown as [number, number, number] } },
    ]),
  ]

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 24 },
    // A wrapped multi-line description must never be split mid-row across a
    // page boundary (default 'auto' allowed exactly that) — the whole row
    // moves to the next page together instead.
    rowPageBreak: 'avoid',
    head: [['Trans #', 'Date', 'Description', 'Debit', 'Credit', 'Balance']],
    body,
    styles: {
      font: 'helvetica', fontSize: 9.8, cellPadding: { top: 3.4, bottom: 3.4, left: 3.2, right: 3.2 },
      textColor: INK as unknown as [number, number, number], lineColor: BORDER as unknown as [number, number, number], lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: { fillColor: RULE_DARK as unknown as [number, number, number], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9.8 },
    alternateRowStyles: { fillColor: [252, 251, 249] },
    columnStyles: {
      // Description gets the lion's share of the width (~45mm of a 174mm
      // table) — the other complaint was a cramped, developer-report table;
      // narrow numeric/ref columns free up real room for the one column
      // that actually needs it, instead of every column being squeezed.
      0: { cellWidth: 22, halign: 'left' },
      1: { cellWidth: 25, halign: 'left' },
      2: { cellWidth: 'auto', halign: 'left' },
      3: { cellWidth: 25, halign: 'right' },
      4: { cellWidth: 25, halign: 'right' },
      5: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
  })

  // ── Account summary — placed after the final transaction page; pushed to
  // a fresh page only if it genuinely wouldn't fit inside the normal bottom
  // margin (the footer itself lives inside that same margin band, so nothing
  // beyond that needs a separate reserve). ──
  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const boxH = summaryBoxHeight()
  let summaryY = afterTableY + 10
  if (summaryY + boxH > pageHeight - margin) {
    doc.addPage()
    summaryY = margin
  }
  drawSummaryBox(L, summaryY, config)

  drawFooters(doc, config.client.name, pageHeight, pageWidth, margin)

  return doc
}

/** Builds the PDF and triggers a browser download. The only browser-dependent part. */
export async function exportStatementPdf(config: StatementPdfConfig): Promise<void> {
  const doc = await buildStatementPdf(config)
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = statementPdfFilename(config.client.name, config.partyLabel ?? 'Client')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
