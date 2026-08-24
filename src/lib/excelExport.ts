// Shared Excel export infrastructure — the ONE place that builds .xlsx
// workbooks for the whole app. Every page-level export (Client Statement,
// Supplier Statement, and their sibling record-list exports, Reports' Client
// Ledger export) goes through `exportExcel()` so header styling, column
// sizing, number/date/currency formats, and totals are defined once instead
// of copy-pasted per page.
//
// Uses ExcelJS, not the `xlsx` (SheetJS) package: SheetJS's free Community
// Edition cannot write cell styling at all (no bold, no fill, no borders, no
// wrap, no alignment — verified by round-tripping a styled workbook through
// it and inspecting the raw XML; only column widths/row heights/number
// formats/merges survive). ExcelJS supports all of that natively. It's
// dynamic-imported inside exportExcel() (not a top-level import) so its
// ~1MB isn't part of the main bundle — it only loads when a user actually
// clicks an Export button.

import { toDateOnlyString } from './date'

const BRAND_FILL = 'FF1D6B4A' // matches --accent in src/index.css
const BRAND_TEXT = 'FFFFFFFF'
const EMPHASIS_FILL = 'FFF3F4F6'
const BORDER_COLOR = 'FFD1D5DB'

export type ExcelColumnType = 'text' | 'number' | 'currency' | 'date' | 'percent'

export interface ExcelColumn<Row> {
  /** Stable key, used only for the total-row lookup — not written to the sheet. */
  key: string
  header: string
  type?: ExcelColumnType
  /** Column width in characters. Omit for a sensible type-based default. */
  width?: number
  /** Decimal places for 'number'/'currency'. Default 2 for currency, 0 for number. */
  decimals?: 0 | 2 | 3
  align?: 'left' | 'center' | 'right'
  /** Wrap long text within the cell instead of overflowing/truncating. Default true for 'text'. */
  wrap?: boolean
  /** Extracts the raw value for this column from a row. Return null/undefined for a blank cell. */
  value: (row: Row) => string | number | Date | null | undefined
  /**
   * Totals-row behavior for this column:
   *  - 'sum'  — a native Excel SUM() formula over the data range (additive
   *             columns like Debit/Credit/Amount).
   *  - 'last' — a formula referencing the LAST data row's own cell in this
   *             column, unchanged (NOT summed). For a running-balance column,
   *             every row already holds the authoritative balance as of that
   *             row (from the backend ledger's runningBalance), so the
   *             correct "total" is simply the final row's value, not
   *             Σ(all balances) — which would double/triple-count every
   *             prior balance and produce a meaningless number.
   */
  total?: 'sum' | 'last'
  /**
   * Whether this column starts checked in the column-selection modal
   * (src/components/ui/ExportColumnsModal.tsx). Default true when omitted —
   * every existing column definition needs no change to keep its current
   * "export everything" behavior. Purely a UI default; has no effect on
   * buildWorkbook()/exportExcel(), which only ever sees whatever column
   * array they're actually called with.
   */
  defaultSelected?: boolean
}

export interface ExcelExportConfig<Row> {
  /** Base filename (no extension) — the sheet is saved as `${filename}-YYYY-MM-DD.xlsx`. */
  filename: string
  sheetName: string
  /** Optional big title merged across all columns above the header row. */
  title?: string
  /** Optional context line under the title (e.g. period, client name, applied filters). */
  subtitle?: string
  columns: ExcelColumn<Row>[]
  rows: Row[]
  /**
   * Row indexes (into `rows`, 0-based) to render in the same bold/shaded
   * style as the totals row — e.g. a statement's "Opening balance" row.
   */
  emphasizeRowIndexes?: number[]
  /** Label for the totals row, shown in the first column. Default 'Total'. Only rendered if any column has total:'sum'. */
  totalsLabel?: string
}

function numberFormat<Row>(col: ExcelColumn<Row>): string | undefined {
  switch (col.type) {
    case 'currency': {
      const dp = col.decimals ?? 2
      const zeros = dp > 0 ? '.' + '0'.repeat(dp) : ''
      return `"$"#,##0${zeros};-"$"#,##0${zeros}`
    }
    case 'number': {
      const dp = col.decimals ?? 0
      const zeros = dp > 0 ? '.' + '0'.repeat(dp) : ''
      return `#,##0${zeros}`
    }
    case 'percent':
      return '0.0%'
    case 'date':
      return 'd mmm yyyy' // matches formatDate()'s "3 Aug 2026" house style (src/lib/date.ts)
    default:
      return undefined
  }
}

function defaultAlign<Row>(col: ExcelColumn<Row>): 'left' | 'center' | 'right' {
  if (col.align) return col.align
  return col.type === 'number' || col.type === 'currency' || col.type === 'percent' ? 'right' : 'left'
}

function defaultWidth<Row>(col: ExcelColumn<Row>, rows: Row[]): number {
  if (col.width) return col.width
  switch (col.type) {
    case 'date':
      return 13
    case 'currency':
      return Math.max(col.header.length + 2, 13)
    case 'number':
      return Math.max(col.header.length + 2, 11)
    case 'percent':
      return Math.max(col.header.length + 2, 10)
    default: {
      // Bounded content-aware width for text: wide enough to read most
      // values without wrapping, but capped so one long outlier (an address,
      // a note) can't blow the column out — long text wraps instead (see
      // wrap default below and the row-height estimate in exportExcel()).
      let maxLen = col.header.length
      for (const row of rows) {
        const v = col.value(row)
        if (v == null) continue
        maxLen = Math.max(maxLen, String(v).length)
      }
      return Math.min(Math.max(maxLen + 2, 10), 40)
    }
  }
}

/** Approximate wrapped-line count for a text value in a column of the given character width. */
function estimateLines(text: string, columnWidth: number): number {
  if (!text) return 1
  const charsPerLine = Math.max(Math.floor(columnWidth * 1.8), 8)
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

/**
 * Builds the workbook in memory — pure, no browser APIs, so it's directly
 * testable (and reusable if a non-browser caller ever needs one). Returns
 * the live ExcelJS workbook/worksheet plus the resolved column widths, so
 * tests and exportExcel() can both inspect exactly what was written.
 */
export async function buildWorkbook<Row>(config: ExcelExportConfig<Row>) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ember'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(config.sheetName)

  const { columns, rows } = config
  const widths = columns.map((c) => defaultWidth(c, rows))
  worksheet.columns = columns.map((c, i) => ({ key: c.key, width: widths[i] }))

  let headerRowNumber = 1

  if (config.title) {
    const titleRow = worksheet.addRow([config.title])
    worksheet.mergeCells(titleRow.number, 1, titleRow.number, columns.length)
    titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1A1916' } }
    titleRow.height = 22
    headerRowNumber++
  }
  if (config.subtitle) {
    const subtitleRow = worksheet.addRow([config.subtitle])
    worksheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, columns.length)
    subtitleRow.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF6B6459' } }
    headerRowNumber++
  }
  if (config.title || config.subtitle) {
    worksheet.addRow([]) // blank spacer before the header row
    headerRowNumber++
  }

  const headerRow = worksheet.addRow(columns.map((c) => c.header))
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BRAND_TEXT } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_FILL } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    }
  })
  worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber }]
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: columns.length },
  }

  const emphasizeSet = new Set(config.emphasizeRowIndexes ?? [])
  const firstDataRow = headerRowNumber + 1

  rows.forEach((row, rowIndex) => {
    const values = columns.map((c) => {
      const v = c.value(row)
      return v ?? null
    })
    const excelRow = worksheet.addRow(values)

    let maxLines = 1
    columns.forEach((col, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1)
      const colType = col.type ?? 'text'
      const wrap = col.wrap ?? colType === 'text'
      const fmt = numberFormat(col)
      if (fmt) cell.numFmt = fmt
      cell.alignment = { vertical: 'middle', horizontal: defaultAlign(col), wrapText: wrap }
      cell.border = {
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      }
      if (wrap && colType === 'text') {
        const raw = values[colIndex]
        if (typeof raw === 'string') {
          maxLines = Math.max(maxLines, estimateLines(raw, widths[colIndex]))
        }
      }
    })
    if (maxLines > 1) excelRow.height = Math.max(18, maxLines * 15)

    if (emphasizeSet.has(rowIndex)) {
      // includeEmpty: eachCell skips cells with no value by default (e.g. a
      // null Debit cell on an "Opening balance" row) — without it, exactly
      // the blank cells in an emphasized row would silently keep the normal
      // (unbolded, unshaded) style.
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { ...(cell.font ?? {}), bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPHASIS_FILL } }
      })
    }
  })

  const totalCols = columns.filter((c) => c.total === 'sum' || c.total === 'last')
  if (totalCols.length > 0 && rows.length > 0) {
    const lastDataRow = firstDataRow + rows.length - 1
    const totalsRow = worksheet.addRow(columns.map(() => null))
    totalsRow.getCell(1).value = config.totalsLabel ?? 'Total'
    // includeEmpty: the row is built from an all-null placeholder array
    // (only cell 1 has a value so far), so every totaled column's cell would
    // otherwise be skipped and never receive its formula.
    totalsRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = columns[colNumber - 1]
      cell.font = { bold: true }
      cell.border = { top: { style: 'double', color: { argb: 'FF1A1916' } } }
      if (col?.total === 'sum') {
        const colLetter = worksheet.getColumn(colNumber).letter
        cell.value = { formula: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` }
        const fmt = numberFormat(col)
        if (fmt) cell.numFmt = fmt
        cell.alignment = { horizontal: defaultAlign(col) }
      } else if (col?.total === 'last') {
        // A plain cell reference to the final data row — NOT a sum. Correct
        // for a running-balance-style column, where every row already holds
        // the cumulative value as of that row.
        const colLetter = worksheet.getColumn(colNumber).letter
        cell.value = { formula: `${colLetter}${lastDataRow}` }
        const fmt = numberFormat(col)
        if (fmt) cell.numFmt = fmt
        cell.alignment = { horizontal: defaultAlign(col) }
      }
    })
  }

  return { workbook, worksheet, columnWidths: widths, headerRowNumber }
}

/** Builds the workbook and triggers a browser download. The only browser-dependent part. */
export async function exportExcel<Row>(config: ExcelExportConfig<Row>): Promise<void> {
  const { workbook } = await buildWorkbook(config)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${config.filename}-${toDateOnlyString(new Date())}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
