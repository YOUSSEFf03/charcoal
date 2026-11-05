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
import type { DocLang } from './i18n/docLang'
import { t } from './i18n/docLabels'
import { fmtDocDate, fmtDocMoney, pickName, unitLabel } from './i18n/docFormat'
import { parseStatementDescription, trimQuantity } from './statementDescription'
import { useRtlTextEngine, wrapRtl } from './pdfRtl'
import { cleanPhoneForDisplay } from './phoneDisplay'

// Arabic PDF font family (Amiri, SIL OFL — see src/assets/fonts/OFL.txt).
// jsPDF's built-in Helvetica has no Arabic glyphs, so a TTF must be embedded.
// It is loaded by dynamic import only when an Arabic statement is built, so
// the English bundle is unaffected.
const ARABIC_FONT = 'Amiri'

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
  /** Arabic display name — used only when lang === 'ar'; falls back to `name` when absent/blank. */
  nameAr?: string | null
  address?: string | null
  phone?: string | null
  currency: string
}

export interface StatementPdfConfig {
  client: StatementPdfClient
  /** Document language. Optional — 'en' (the historical output) when omitted. 'ar' renders a mirrored right-to-left Arabic statement. */
  lang?: DocLang
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
  /**
   * The client's real location (branch) names. Lets the Arabic statement split
   * the " - <location>" suffix off a sale description into its own "Branch"
   * line — only on an exact match (see statementDescription.ts).
   */
  locationNames?: string[]
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

/** Per-language amount: English keeps the historical "$1,234.50"; Arabic puts the symbol after the number ("1,234.50 $"). Western digits in both. */
function fmtAmountFor(lang: DocLang, n: number, currency: string): string {
  if (lang === 'en') return fmtCustomerAmount(n, currency)
  const sign = n < -0.005 ? '-' : ''
  return `${sign}${fmtDocMoney(lang, Math.abs(n), currency)}`
}

/** Statement-period date: "09 Aug 2026" in English (unchanged), "09/08/2026" in Arabic. */
function fmtPeriodDate(lang: DocLang, iso: string | null): string {
  return lang === 'en' ? fmtDateHuman(iso) : fmtDocDate(lang, iso)
}

// Re-exported so existing imports from this module keep working; the helper
// lives in ./phoneDisplay so HTML documents can use it without pulling jsPDF.
export { cleanPhoneForDisplay }

/** Period line: Arabic reads "من {from} إلى {to}" (and handles open-ended periods); English keeps its historical wording. */
function periodLine(lang: DocLang, from: string | null, to: string | null): string {
  if (lang === 'en') return t(lang, 'statement.periodLine', { from: fmtPeriodDate(lang, from), to: fmtPeriodDate(lang, to) })
  const f = from ? fmtPeriodDate(lang, from) : null
  const tt = to ? fmtPeriodDate(lang, to) : null
  if (f && tt) return t(lang, 'statement.periodFromTo', { from: f, to: tt })
  if (f) return t(lang, 'statement.periodFromOnly', { from: f })
  if (tt) return t(lang, 'statement.periodToOnly', { to: tt })
  return t(lang, 'statement.periodAll')
}

/**
 * Labelled description lines for the Arabic statement ("نوع الحركة: مبيع",
 * "المنتج: …", "الكمية: 500 kg", "الفرع: …"), built only from the parsed
 * original description. null when the description is not in a known format —
 * the caller then prints it unchanged.
 */
export function describeRowLines(lang: DocLang, desc: string, locationNames: string[] = []): string[] | null {
  const parsed = parseStatementDescription(desc, locationNames)
  if (!parsed) return null
  const label = (key: Parameters<typeof t>[1], value: string) => `${t(lang, key)}: ${value}`
  if (parsed.kind === 'payment') {
    return [label('statement.desc.type', t(lang, `statement.desc.pay.${parsed.method}`))]
  }
  if (parsed.kind === 'carried_forward') {
    const lines = [label('statement.desc.type', t(lang, 'statement.desc.carriedForward'))]
    if (parsed.notes) lines.push(label('statement.desc.notes', parsed.notes))
    return lines
  }
  const lines = [label('statement.desc.type', t(lang, parsed.source === 'warehouse' ? 'statement.desc.warehouseSale' : 'statement.desc.sale'))]
  for (const item of parsed.items) {
    if (item.product) lines.push(label('statement.desc.product', item.product))
    const qty = trimQuantity(item.quantity)
    lines.push(label('statement.desc.quantity', `${qty} ${unitLabel(lang, item.unit)}`))
  }
  if (parsed.location) lines.push(label('statement.desc.branch', parsed.location))
  return lines
}

function displayName(config: StatementPdfConfig): string {
  return pickName(config.lang ?? 'en', config.client.name, config.client.nameAr)
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

export function statementPdfFilename(clientName: string, fallback = 'Client', lang: DocLang = 'en'): string {
  const title = lang === 'ar' ? t('ar', 'statement.title') : 'Statement of Account'
  return `${sanitizeFilenamePart(clientName, fallback)}_${title}.pdf`
}

interface Layout {
  lang: DocLang
  /** true for Arabic: mirrored layout, strings shaped + bidi-reordered for jsPDF. */
  rtl: boolean
  /** PDF font family: 'helvetica' for English, the embedded Arabic TTF for 'ar'. */
  font: string
  doc: JsPDFDoc
  pageWidth: number
  pageHeight: number
  margin: number
  contentWidth: number
  contentRight: number
}

/**
 * Text to hand to jsPDF. Always the logical string: for Arabic documents
 * useRtlTextEngine() shapes and reorders it inside doc.text(). Kept as one
 * choke point so every drawn string goes through the same path.
 */
function rtlText(_L: Layout, s: string): string {
  return s
}

/** x coordinate `offset` mm in from the document's start edge (left for English, right for Arabic). */
function startX(L: Layout, offset: number): number {
  return L.rtl ? L.contentRight - offset : L.margin + offset
}

/** x coordinate `offset` mm in from the document's end edge (right for English, left for Arabic). */
function endX(L: Layout, offset: number): number {
  return L.rtl ? L.margin + offset : L.contentRight - offset
}

/** Text anchored at the start edge (English: left-aligned exactly as before; Arabic: right-aligned). */
function textStart(L: Layout, s: string, x: number, y: number) {
  if (L.rtl) L.doc.text(rtlText(L, s), x, y, { align: 'right' })
  else L.doc.text(s, x, y)
}

/** Text anchored at the end edge (English: right-aligned exactly as before; Arabic: left-aligned). */
function textEnd(L: Layout, s: string, x: number, y: number) {
  L.doc.text(rtlText(L, s), x, y, { align: L.rtl ? 'left' : 'right' })
}

function drawHeader(L: Layout, logo: { base64: string; aspectRatio: number }): number {
  const { doc, margin, contentRight } = L
  let y = margin

  // Real logo (src/assets/farah-charcoal-logo.png) — Arabic calligraphy mark
  // + "CHARCOAL" wordmark — embedded as-is, landscape aspect preserved.
  const logoH = 22
  const logoW = logoH * logo.aspectRatio
  doc.addImage(logo.base64, 'PNG', L.rtl ? contentRight - logoW : margin, y, logoW, logoH)
  const textX = startX(L, logoW + 10)

  doc.setFont(L.font, 'bold')
  doc.setFontSize(19)
  doc.setTextColor(...INK)
  textStart(L, L.rtl ? COMPANY_INFO.nameAr : COMPANY_INFO.name, textX, y + 9)

  doc.setFont(L.font, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  textStart(L, L.rtl ? COMPANY_INFO.addressAr : COMPANY_INFO.address, textX, y + 16)
  textStart(L, COMPANY_INFO.phone, textX, y + 21.5)

  y += Math.max(logoH, 22) + 8
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.6)
  doc.line(margin, y, contentRight, y)
  return y + 12
}

function drawTitleAndPeriod(L: Layout, y: number, config: StatementPdfConfig): number {
  const { doc, pageWidth, lang } = L
  const center = (s: string) => doc.text(rtlText(L, s), pageWidth / 2, y, { align: 'center' })

  doc.setFont(L.font, 'bold')
  doc.setFontSize(21)
  doc.setTextColor(...INK)
  // Letter-spacing would pull Arabic's joined letters apart — English only.
  if (!L.rtl) doc.setCharSpace(0.6)
  center(t(lang, 'statement.title'))
  doc.setCharSpace(0)
  y += 11

  doc.setFont(L.font, 'bold')
  doc.setFontSize(11.5)
  doc.setTextColor(...INK)
  center(t(lang, config.partyLabel === 'Supplier' ? 'statement.supplierLine' : 'statement.clientLine', { name: displayName(config) }))
  y += 6.5

  doc.setFont(L.font, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  center(t(lang, 'statement.currencyLine', { currency: config.client.currency }))
  y += 6

  doc.setFont(L.font, 'bold')
  center(periodLine(lang, config.from, config.to))
  y += 8

  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.line(L.margin, y, L.contentRight, y)
  return y + 8
}

function drawClientInfoPanel(L: Layout, y: number, config: StatementPdfConfig): number {
  const { doc, margin, contentWidth, lang } = L
  // Missing details are left out entirely rather than printed as "—".
  const address = (config.client.address ?? '').trim()
  const phone = cleanPhoneForDisplay(config.client.phone)
  const rows: [string, string][] = [
    [t(lang, 'common.name'), displayName(config)],
    ...(address ? [[t(lang, 'common.address'), address] as [string, string]] : []),
    ...(phone ? [[t(lang, 'common.phone'), phone] as [string, string]] : []),
    [t(lang, 'common.currency'), config.client.currency],
  ]
  const headerH = 10
  const rowH = L.rtl ? 7.4 : 6.8
  const lineH = L.rtl ? 5.6 : 5
  const valueX = startX(L, 38)
  // A value may span several lines (a multi-location client's addresses, or
  // one long address): split on "\n", then wrap to the value column width.
  doc.setFont(L.font, 'bold')
  doc.setFontSize(L.rtl ? 11 : 10)
  const valueWidth = contentWidth - 38 - 6
  const rowLines = rows.map(([, value]) =>
    value.split('\n').flatMap((part) => doc.splitTextToSize(part, valueWidth) as string[]),
  )
  const rowHeight = (lines: string[]) => rowH + (lines.length - 1) * lineH
  const boxH = headerH + rowLines.reduce((s, lines) => s + rowHeight(lines), 0) + 3

  doc.setFillColor(...PANEL_BG)
  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'FD')

  doc.setFont(L.font, 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK)
  textStart(L, t(lang, config.partyLabel === 'Supplier' ? 'statement.supplierInfo' : 'statement.clientInfo'), startX(L, 6), y + 8)

  let ry = y + headerH + 4
  const labelX = startX(L, 6)
  rows.forEach(([label], i) => {
    doc.setFont(L.font, 'normal')
    doc.setFontSize(L.rtl ? 11 : 10)
    doc.setTextColor(...INK_SOFT)
    textStart(L, label, labelX, ry)
    doc.setFont(L.font, 'bold')
    doc.setTextColor(...INK)
    rowLines[i].forEach((line, j) => textStart(L, line, valueX, ry + j * lineH))
    ry += rowHeight(rowLines[i])
  })

  return y + boxH + 8
}

/**
 * Account-summary geometry (mm, relative to the box top). English is the
 * historical box: Total Debit / Total Credit + Closing Balance bar (42mm).
 * Arabic also lists the Opening Balance first and, for a client statement,
 * states under the bar whether the closing balance is owed by the client, in
 * the client's favour, or settled — the same sign rule as balanceColor().
 */
function summaryLayout(L: Layout, config: StatementPdfConfig) {
  const withOpening = L.rtl
  const withStatus = L.rtl && config.partyLabel !== 'Supplier'
  const firstRowY = 18
  const rowGap = 7
  const rowCount = withOpening ? 3 : 2
  const barY = firstRowY + (rowCount - 1) * rowGap + 4
  const barH = 11
  const boxH = barY + barH + (withStatus ? 9 : 2)
  return { withOpening, withStatus, firstRowY, rowGap, barY, barH, boxH }
}

function statusKey(balance: number) {
  if (balance > 0.005) return 'statement.status.owed' as const
  if (balance < -0.005) return 'statement.status.credit' as const
  return 'statement.status.settled' as const
}

function drawSummaryBox(L: Layout, y: number, config: StatementPdfConfig) {
  const { doc, margin, contentWidth, lang } = L
  const S = summaryLayout(L, config)
  const currency = config.client.currency

  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(margin, y, contentWidth, S.boxH, 2, 2, 'S')

  doc.setFont(L.font, 'bold')
  doc.setFontSize(L.rtl ? 12 : 11)
  doc.setTextColor(...INK)
  textStart(L, t(lang, 'statement.accountSummary'), startX(L, 6), y + 9)

  const figures: Array<[string, number, readonly [number, number, number]]> = [
    ...(S.withOpening ? [[t(lang, 'statement.summary.opening'), config.openingBalance, balanceColor(config.openingBalance)] as [string, number, readonly [number, number, number]]] : []),
    [t(lang, 'statement.totalDebit'), config.periodDebitTotal, INK],
    [t(lang, 'statement.totalCredit'), config.periodCreditTotal, INK],
  ]
  figures.forEach(([label, amount, color], i) => {
    const ry = y + S.firstRowY + i * S.rowGap
    doc.setFont(L.font, 'normal')
    doc.setFontSize(L.rtl ? 11 : 10.5)
    doc.setTextColor(...INK_SOFT)
    textStart(L, label, startX(L, 6), ry)
    doc.setFont(L.font, 'bold')
    doc.setTextColor(...color)
    textEnd(L, fmtAmountFor(lang, amount, currency), endX(L, 6), ry)
  })

  // Closing balance — the emphasized figure the whole box exists to surface.
  const barY = y + S.barY
  const barH = S.barH
  doc.setFillColor(...PANEL_BG)
  doc.roundedRect(margin + 2, barY, contentWidth - 4, barH, 1.5, 1.5, 'F')
  doc.setFont(L.font, 'bold')
  doc.setFontSize(L.rtl ? 13.5 : 12.5)
  doc.setTextColor(...INK)
  textStart(L, t(lang, 'statement.closingBalance'), startX(L, 6), barY + barH / 2 + 3.2)
  doc.setFontSize(15)
  doc.setTextColor(...balanceColor(config.closingBalance))
  textEnd(L, fmtAmountFor(lang, config.closingBalance, currency), endX(L, 6), barY + barH / 2 + 3.2)

  if (S.withStatus) {
    doc.setFont(L.font, 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...balanceColor(config.closingBalance))
    textEnd(L, t(lang, statusKey(config.closingBalance)), endX(L, 6), barY + barH + 6)
  }
}

function drawFooters(L: Layout, clientName: string) {
  const { doc, pageHeight, pageWidth, margin, lang } = L
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    const fy = pageHeight - 14
    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.25)
    doc.line(margin, fy, pageWidth - margin, fy)
    doc.setFont(L.font, 'normal')
    doc.setFontSize(8.3)
    doc.setTextColor(...MUTED)
    const label = L.rtl ? t(lang, 'statement.title') : 'Statement of Account'
    textStart(L, `${label} — ${clientName}`, startX(L, 0), fy + 5.5)
    textEnd(L, t(lang, 'statement.pageFooter', { page: p, total: pageCount }), endX(L, 0), fy + 5.5)
  }
}
type ColKey = 'ref' | 'date' | 'desc' | 'debit' | 'credit' | 'balance'

/**
 * Transaction-table column order. English reads left-to-right
 * (Trans # … Balance); Arabic is the exact mirror image, so the first column
 * (Trans #) sits at the right edge and Balance at the left.
 */
export function statementColumnOrder(lang: DocLang = 'en'): ColKey[] {
  const ltr: ColKey[] = ['ref', 'date', 'desc', 'debit', 'credit', 'balance']
  return lang === 'ar' ? ltr.reverse() : ltr
}

const COLUMN_HEAD_KEYS = {
  ref: 'statement.col.transNo',
  date: 'statement.col.date',
  desc: 'statement.col.description',
  debit: 'statement.col.debit',
  credit: 'statement.col.credit',
  balance: 'statement.col.balance',
} as const

// Fixed column widths in mm; the description column takes the remainder.
const COLUMN_WIDTHS: Record<Exclude<ColKey, 'desc'>, number> = { ref: 22, date: 25, debit: 25, credit: 25, balance: 32 }
/** Arabic: amounts/dates are narrow at Amiri sizes, so the labelled multi-line description gets ~51mm instead of ~45mm. */
const COLUMN_WIDTHS_AR: Record<Exclude<ColKey, 'desc'>, number> = { ref: 24, date: 25, debit: 24, credit: 24, balance: 26 }
const CELL_PADDING_X = 3.2
const TABLE_FONT_SIZE = 9.8
/** Amiri sits visibly smaller than Helvetica at the same point size. */
const TABLE_FONT_SIZE_AR = 10.6

/** Registers the embedded Arabic TTF (regular + bold) with this document. Lazy: the ~1MB font module is only fetched for Arabic. */
async function registerArabicFont(doc: JsPDFDoc): Promise<void> {
  const { AMIRI_REGULAR_BASE64, AMIRI_BOLD_BASE64 } = await import('../assets/fonts/amiriBase64')
  doc.addFileToVFS('Amiri-Regular.ttf', AMIRI_REGULAR_BASE64)
  doc.addFont('Amiri-Regular.ttf', ARABIC_FONT, 'normal')
  doc.addFileToVFS('Amiri-Bold.ttf', AMIRI_BOLD_BASE64)
  doc.addFont('Amiri-Bold.ttf', ARABIC_FONT, 'bold')
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
  const lang: DocLang = config.lang ?? 'en'
  const rtl = lang === 'ar'
  // The Arabic font file is large, so Arabic documents are compressed (the
  // English path keeps compress:false so its content stays inspectable).
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: rtl })
  if (rtl) {
    await registerArabicFont(doc)
    // Arabic strings are passed in logical order; jsPDF shapes them once and
    // reorders each line for right-to-left (see pdfRtl.ts).
    useRtlTextEngine(doc)
    // Amiri's tall ascenders/descenders need more leading than Helvetica so
    // multi-line cells (descriptions, addresses) don't touch.
    doc.setLineHeightFactor(1.45)
  }
  const font = rtl ? ARABIC_FONT : 'helvetica'
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18
  const L: Layout = { lang, rtl, font, doc, pageWidth, pageHeight, margin, contentWidth: pageWidth - margin * 2, contentRight: pageWidth - margin }

  let y = drawHeader(L, { base64: FARAH_LOGO_PNG_BASE64, aspectRatio: FARAH_LOGO_ASPECT_RATIO })
  y = drawTitleAndPeriod(L, y, config)
  y = drawClientInfoPanel(L, y, config)

  // ── Transactions ──
  // Opening balance is its own visually distinct row (merged across
  // Trans#/Date/Description, shaded + bold) — never an ordinary transaction.
  const currency = config.client.currency
  const tableFontSize = rtl ? TABLE_FONT_SIZE_AR : TABLE_FONT_SIZE
  const order = statementColumnOrder(lang)
  const fill = PANEL_BG as unknown as [number, number, number]
  const openingLabel: CellInput = { content: rtlText(L, t(lang, 'statement.openingBalance')), colSpan: 3, styles: { fontStyle: 'bold', fillColor: fill } }
  const openingBalanceCell: CellInput = { content: fmtAmountFor(lang, config.openingBalance, currency), styles: { fontStyle: 'bold', halign: 'right', fillColor: fill, textColor: balanceColor(config.openingBalance) as unknown as [number, number, number] } }
  const emptyFilled: CellInput = { content: '', styles: { fillColor: fill } }
  // LTR: [label ×3 cols][debit][credit][balance]; RTL mirror: [balance][credit][debit][label ×3 cols].
  const openingRow: RowInput = rtl
    ? [openingBalanceCell, emptyFilled, emptyFilled, openingLabel]
    : [openingLabel, emptyFilled, emptyFilled, openingBalanceCell]

  // Wrap width for an Arabic description cell: table width minus the fixed columns, minus cell padding.
  const widths = rtl ? COLUMN_WIDTHS_AR : COLUMN_WIDTHS
  const descWidth = L.contentWidth - Object.values(widths).reduce((a, b) => a + b, 0)
  if (rtl) {
    doc.setFont(font, 'normal')
    doc.setFontSize(tableFontSize)
  }
  const cellFor = (key: ColKey, r: StatementPdfRow): CellInput => {
    switch (key) {
      case 'ref': return r.ref
      case 'date': return rtl ? fmtDocDate(lang, r.rawDate) : fmtDateSlash(r.rawDate)
      case 'desc': {
        if (!rtl) return r.desc
        // Arabic: labelled lines (type / product / quantity / branch) when the
        // description is in a known format, else the original text unchanged.
        const lines = describeRowLines(lang, r.desc, config.locationNames) ?? [r.desc]
        return lines.map((line) => wrapRtl(doc, line, descWidth - CELL_PADDING_X * 2)).join('\n')
      }
      case 'debit': return r.debit ? fmtAmountFor(lang, r.debit, currency) : ''
      case 'credit': return r.credit ? fmtAmountFor(lang, r.credit, currency) : ''
      case 'balance': return { content: fmtAmountFor(lang, r.balance, currency), styles: { textColor: balanceColor(r.balance) as unknown as [number, number, number] } }
    }
  }
  const body: RowInput[] = [
    openingRow,
    ...config.rows.map((r): CellInput[] => order.map((key) => cellFor(key, r))),
  ]

  const textAlign = rtl ? 'right' : 'left'
  const columnStyleFor = (key: ColKey) => {
    switch (key) {
      // Description gets the lion's share of the width (~45mm of a 174mm
      // table) — the other complaint was a cramped, developer-report table;
      // narrow numeric/ref columns free up real room for the one column
      // that actually needs it, instead of every column being squeezed.
      case 'ref': return { cellWidth: widths.ref, halign: textAlign } as const
      case 'date': return { cellWidth: widths.date, halign: textAlign } as const
      case 'desc': return { cellWidth: 'auto', halign: textAlign } as const
      case 'debit': return { cellWidth: widths.debit, halign: 'right' } as const
      case 'credit': return { cellWidth: widths.credit, halign: 'right' } as const
      case 'balance': return { cellWidth: widths.balance, halign: 'right', fontStyle: 'bold' } as const
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 24 },
    // A wrapped multi-line description must never be split mid-row across a
    // page boundary (default 'auto' allowed exactly that) — the whole row
    // moves to the next page together instead.
    rowPageBreak: 'avoid',
    head: [order.map((key) => rtlText(L, t(lang, COLUMN_HEAD_KEYS[key])))],
    body,
    styles: {
      font, fontSize: tableFontSize, cellPadding: { top: rtl ? 2.6 : 3.4, bottom: rtl ? 2.6 : 3.4, left: CELL_PADDING_X, right: CELL_PADDING_X },
      textColor: INK as unknown as [number, number, number], lineColor: BORDER as unknown as [number, number, number], lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: { fillColor: RULE_DARK as unknown as [number, number, number], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: tableFontSize },
    alternateRowStyles: { fillColor: [252, 251, 249] },
    columnStyles: Object.fromEntries(order.map((key, i) => [i, columnStyleFor(key)])),
  })

  // ── Account summary — placed after the final transaction page; pushed to
  // a fresh page only if it genuinely wouldn't fit inside the normal bottom
  // margin (the footer itself lives inside that same margin band, so nothing
  // beyond that needs a separate reserve). ──
  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const boxH = summaryLayout(L, config).boxH
  let summaryY = afterTableY + 10
  if (summaryY + boxH > pageHeight - margin) {
    doc.addPage()
    summaryY = margin
  }
  drawSummaryBox(L, summaryY, config)

  drawFooters(L, displayName(config))

  return doc
}

function pdfFilenameFor(config: StatementPdfConfig): string {
  return statementPdfFilename(displayName(config), config.partyLabel ?? 'Client', config.lang ?? 'en')
}

/**
 * Builds the PDF and returns it as a File (named like the download) — for
 * the Web Share API / attaching to a message, with no browser-download side effect.
 */
export async function buildStatementPdfFile(config: StatementPdfConfig): Promise<File> {
  const doc = await buildStatementPdf(config)
  return new File([doc.output('blob')], pdfFilenameFor(config), { type: 'application/pdf' })
}

/** Builds the PDF and triggers a browser download. The only browser-dependent part. */
export async function exportStatementPdf(config: StatementPdfConfig): Promise<void> {
  const doc = await buildStatementPdf(config)
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = pdfFilenameFor(config)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
