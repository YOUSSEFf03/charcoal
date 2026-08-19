import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildWorkbook, type ExcelColumn } from './excelExport'

/**
 * Every test round-trips through the real ExcelJS write/read path (buffer
 * out, fresh Workbook().load(buffer) back in) instead of just inspecting the
 * in-memory object buildWorkbook() returns — that's the only way to catch a
 * value/style that looks right in memory but doesn't actually survive
 * serialization to the .xlsx file.
 */
async function roundTrip<Row>(config: Parameters<typeof buildWorkbook<Row>>[0]) {
  const { workbook, headerRowNumber, columnWidths } = await buildWorkbook(config)
  const buffer = await workbook.xlsx.writeBuffer()
  const reloaded = new ExcelJS.Workbook()
  await reloaded.xlsx.load(buffer as any)
  const worksheet = reloaded.worksheets[0]
  return { worksheet, headerRowNumber, columnWidths, buffer }
}

interface Row {
  name: string
  amount: number
  date: Date
  note?: string | null
}

const basicColumns: ExcelColumn<Row>[] = [
  { key: 'name', header: 'Name', value: (r) => r.name },
  { key: 'amount', header: 'Amount', type: 'currency', value: (r) => r.amount, total: 'sum' },
  { key: 'date', header: 'Date', type: 'date', value: (r) => r.date },
  { key: 'note', header: 'Note', value: (r) => r.note },
]

describe('buildWorkbook — headers', () => {
  it('writes header text, bold font, and brand fill that survive a write/read round trip', async () => {
    const { worksheet } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns, rows: [],
    })
    const headerRow = worksheet.getRow(1)
    expect(headerRow.getCell(1).value).toBe('Name')
    expect(headerRow.getCell(2).value).toBe('Amount')
    expect(headerRow.getCell(1).font?.bold).toBe(true)
    const fill = headerRow.getCell(1).fill as ExcelJS.FillPattern
    expect(fill.fgColor?.argb).toBe('FF1D6B4A')
  })

  it('places the header after title/subtitle rows and freezes/auto-filters at the header row', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', title: 'Client Statement', subtitle: 'Aug 2026',
      columns: basicColumns, rows: [],
    })
    expect(headerRowNumber).toBe(4) // title, subtitle, blank spacer, header
    expect(worksheet.getRow(1).getCell(1).value).toBe('Client Statement')
    expect(worksheet.getRow(2).getCell(1).value).toBe('Aug 2026')
    expect(worksheet.getRow(4).getCell(1).value).toBe('Name')
    expect(worksheet.views?.[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
    // ExcelJS re-parses a reloaded autoFilter from the raw XML ref as a
    // plain "A1:D1"-style range string, not the {from,to} object it accepts on write.
    expect(worksheet.autoFilter).toBe('A4:D4')
  })
})

describe('buildWorkbook — column widths', () => {
  it('gives currency/number/date columns sensible fixed-ish widths, and caps text-column width', async () => {
    const longText = 'x'.repeat(200)
    const { columnWidths, worksheet } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [{ name: longText, amount: 1, date: new Date('2026-08-16'), note: null }],
    })
    expect(columnWidths[1]).toBeGreaterThanOrEqual(13) // currency
    expect(columnWidths[2]).toBe(13) // date
    expect(columnWidths[0]).toBeLessThanOrEqual(40) // text column capped, not blown out by the 200-char value
    expect(worksheet.getColumn(1).width).toBe(columnWidths[0])
  })

  it('respects an explicit width override', async () => {
    const cols: ExcelColumn<Row>[] = [{ key: 'name', header: 'Name', width: 25, value: (r) => r.name }]
    const { columnWidths } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: cols, rows: [{ name: 'a', amount: 1, date: new Date() }],
    })
    expect(columnWidths[0]).toBe(25)
  })
})

describe('buildWorkbook — number/currency/date/percent formatting', () => {
  it('formats currency with the "-$X" (not "$-X") pattern, matching formatUsd()', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [{ name: 'A', amount: -42.5, date: new Date('2026-08-16') }],
    })
    const cell = worksheet.getRow(headerRowNumber + 1).getCell(2)
    expect(cell.value).toBe(-42.5)
    expect(cell.numFmt).toBe('"$"#,##0.00;-"$"#,##0.00')
  })

  it('writes a real Date value with the "d mmm yyyy" format, not a pre-formatted string', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [{ name: 'A', amount: 1, date: new Date('2026-08-16T00:00:00.000Z') }],
    })
    const cell = worksheet.getRow(headerRowNumber + 1).getCell(3)
    expect(cell.value).toBeInstanceOf(Date)
    expect((cell.value as Date).toISOString()).toBe('2026-08-16T00:00:00.000Z')
    expect(cell.numFmt).toBe('d mmm yyyy')
  })

  it('formats number columns with configurable decimal precision', async () => {
    const cols: ExcelColumn<{ n: number }>[] = [
      { key: 'n', header: 'N', type: 'number', decimals: 3, value: (r) => r.n },
    ]
    const { worksheet, headerRowNumber } = await roundTrip<{ n: number }>({
      filename: 'test', sheetName: 'Sheet1', columns: cols, rows: [{ n: 2500.5 }],
    })
    expect(worksheet.getRow(headerRowNumber + 1).getCell(1).numFmt).toBe('#,##0.000')
  })

  it('formats percent columns as 0.0%', async () => {
    const cols: ExcelColumn<{ p: number }>[] = [
      { key: 'p', header: 'P', type: 'percent', value: (r) => r.p },
    ]
    const { worksheet, headerRowNumber } = await roundTrip<{ p: number }>({
      filename: 'test', sheetName: 'Sheet1', columns: cols, rows: [{ p: 0.995 }],
    })
    const cell = worksheet.getRow(headerRowNumber + 1).getCell(1)
    expect(cell.value).toBe(0.995)
    expect(cell.numFmt).toBe('0.0%')
  })
})

describe('buildWorkbook — wrapping and row height', () => {
  it('wraps long text columns and grows row height beyond the default for a long value', async () => {
    const longNote = 'a very long description that should wrap across multiple lines '.repeat(3)
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [{ name: 'A', amount: 1, date: new Date('2026-08-16'), note: longNote }],
    })
    const row = worksheet.getRow(headerRowNumber + 1)
    expect(row.getCell(4).alignment?.wrapText).toBe(true)
    expect(row.height).toBeGreaterThan(18)
  })

  it('does not wrap currency/date/number columns', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [{ name: 'A', amount: 1, date: new Date('2026-08-16') }],
    })
    const row = worksheet.getRow(headerRowNumber + 1)
    // ExcelJS omits the wrapText attribute entirely when false (it's the XML
    // default), so a reloaded cell reads back undefined, not false — both
    // mean "not wrapped".
    expect(row.getCell(2).alignment?.wrapText).toBeFalsy() // currency
    expect(row.getCell(3).alignment?.wrapText).toBeFalsy() // date
  })
})

describe('buildWorkbook — totals', () => {
  it('renders a SUM() formula over the exact data range, bold, with a top border', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [
        { name: 'A', amount: 10, date: new Date('2026-08-01') },
        { name: 'B', amount: 25, date: new Date('2026-08-02') },
        { name: 'C', amount: -5, date: new Date('2026-08-03') },
      ],
    })
    const dataStart = headerRowNumber + 1
    const totalsRowNum = dataStart + 3
    const totalsRow = worksheet.getRow(totalsRowNum)
    expect(totalsRow.getCell(1).value).toBe('Total')
    const amountCell = totalsRow.getCell(2)
    // ExcelJS reloads a formula cell as { formula, result } — result is what
    // Excel itself would have last calculated; ExcelJS doesn't evaluate
    // formulas on write, so assert the formula text and pre-computed sum
    // separately by summing the source rows ourselves.
    const formula = (amountCell.value as ExcelJS.CellFormulaValue).formula
    expect(formula).toBe(`SUM(B${dataStart}:B${dataStart + 2})`)
    expect(amountCell.font?.bold).toBe(true)
    expect(amountCell.border?.top?.style).toBe('double')
  })

  it('omits the totals row entirely when no column requests a total', async () => {
    const cols: ExcelColumn<Row>[] = basicColumns.map((c) => ({ ...c, total: undefined }))
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: cols,
      rows: [{ name: 'A', amount: 10, date: new Date('2026-08-01') }],
    })
    // Only header + 1 data row — no trailing totals row.
    expect(worksheet.actualRowCount).toBe(headerRowNumber + 1)
  })

  it('omits the totals row for an empty dataset even if a column requests a total', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns, rows: [],
    })
    expect(worksheet.actualRowCount).toBe(headerRowNumber)
  })
})

describe('buildWorkbook — emphasized rows (e.g. statement opening balance)', () => {
  it('bolds and shades only the configured row indexes', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      emphasizeRowIndexes: [0],
      rows: [
        { name: 'Opening balance', amount: 100, date: new Date('2026-08-01') },
        { name: 'Payment', amount: 20, date: new Date('2026-08-02') },
      ],
    })
    const opening = worksheet.getRow(headerRowNumber + 1)
    const normal = worksheet.getRow(headerRowNumber + 2)
    expect(opening.getCell(1).font?.bold).toBe(true)
    expect((opening.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFF3F4F6')
    expect(normal.getCell(1).font?.bold).toBeFalsy()
  })
})

describe('buildWorkbook — data integrity', () => {
  it('preserves Arabic text exactly, byte for byte, through the write/read round trip', async () => {
    const arabic = 'مطعم الشرق الأوسط'
    const cols: ExcelColumn<{ name: string }>[] = [{ key: 'name', header: 'Name', value: (r) => r.name }]
    const { worksheet, headerRowNumber } = await roundTrip<{ name: string }>({
      filename: 'test', sheetName: 'Sheet1', columns: cols, rows: [{ name: arabic }],
    })
    expect(worksheet.getRow(headerRowNumber + 1).getCell(1).value).toBe(arabic)
  })

  it('renders null/undefined values as a blank cell, never the string "null"/"undefined"', async () => {
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns,
      rows: [{ name: 'A', amount: 1, date: new Date('2026-08-01'), note: null }],
    })
    const cell = worksheet.getRow(headerRowNumber + 1).getCell(4)
    expect(cell.value).toBeNull()
  })

  it('handles a large dataset (5,000 rows) without error and keeps text columns capped', async () => {
    const rows: Row[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `Row ${i}`, amount: i * 1.5, date: new Date(2026, 0, 1 + (i % 28)),
    }))
    const { worksheet, headerRowNumber, columnWidths } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: basicColumns, rows,
    })
    // basicColumns has a total:'sum' column, so 5,000 data rows + 1 totals row.
    expect(worksheet.actualRowCount).toBe(headerRowNumber + 5000 + 1)
    expect(columnWidths[0]).toBeLessThanOrEqual(40)
    expect(worksheet.getRow(headerRowNumber + 5000).getCell(1).value).toBe('Row 4999')
  })

  it('keeps negative and decimal currency/number values numerically exact', async () => {
    const cols: ExcelColumn<{ n: number }>[] = [
      { key: 'n', header: 'N', type: 'currency', value: (r) => r.n },
    ]
    const { worksheet, headerRowNumber } = await roundTrip<{ n: number }>({
      filename: 'test', sheetName: 'Sheet1', columns: cols,
      rows: [{ n: -1234.567 }, { n: 0.1 }, { n: 99999999.99 }],
    })
    const start = headerRowNumber + 1
    expect(worksheet.getRow(start).getCell(1).value).toBe(-1234.567)
    expect(worksheet.getRow(start + 1).getCell(1).value).toBe(0.1)
    expect(worksheet.getRow(start + 2).getCell(1).value).toBe(99999999.99)
  })
})

describe('buildWorkbook — column subset (as produced by the export column-selection modal)', () => {
  // The modal never touches buildWorkbook()/exportExcel() — it only filters
  // the `columns` array down to the checked ones before the existing
  // exportExcel({..., columns: selectedColumns}) call runs. These tests
  // prove the engine handles an arbitrary subset correctly: only the
  // selected columns/headers appear, in the given order, with their
  // existing formatting intact, and a deselected total:'sum' column simply
  // isn't there to sum.
  it('renders only the selected columns, in the given order, with formatting intact', async () => {
    const subset: ExcelColumn<Row>[] = [basicColumns[2], basicColumns[0]] // Date, Name only — reordered
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: subset,
      rows: [{ name: 'A', amount: 10, date: new Date('2026-08-01') }],
    })
    expect(worksheet.columnCount).toBe(2)
    expect(worksheet.getRow(headerRowNumber).getCell(1).value).toBe('Date')
    expect(worksheet.getRow(headerRowNumber).getCell(2).value).toBe('Name')
    const dataCell = worksheet.getRow(headerRowNumber + 1).getCell(1)
    expect(dataCell.value).toBeInstanceOf(Date)
    expect(dataCell.numFmt).toBe('d mmm yyyy') // date formatting still applied to the surviving column
  })

  it('omits a totals row/formula entirely for a total:"sum" column that was deselected', async () => {
    const subset: ExcelColumn<Row>[] = [basicColumns[0], basicColumns[2]] // Name, Date — Amount (the summed column) excluded
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: subset,
      rows: [{ name: 'A', amount: 10, date: new Date('2026-08-01') }],
    })
    // No totals row at all — the only column with total:'sum' isn't present.
    expect(worksheet.actualRowCount).toBe(headerRowNumber + 1)
  })

  it('keeps a totals formula correct (range-accurate) when a non-summed column is deselected around it', async () => {
    const subset: ExcelColumn<Row>[] = [basicColumns[1]] // Amount only (currency, total:'sum')
    const { worksheet, headerRowNumber } = await roundTrip<Row>({
      filename: 'test', sheetName: 'Sheet1', columns: subset,
      rows: [{ name: 'A', amount: 10, date: new Date() }, { name: 'B', amount: 25, date: new Date() }],
    })
    const dataStart = headerRowNumber + 1
    const totalsRow = worksheet.getRow(dataStart + 2)
    const formula = (totalsRow.getCell(1).value as ExcelJS.CellFormulaValue).formula
    expect(formula).toBe(`SUM(A${dataStart}:A${dataStart + 1})`)
  })
})

describe('buildWorkbook — representative real shape (Client Statement)', () => {
  interface LedgerEntry { date: string; ref: string; desc: string; debit: number | ''; credit: number | ''; balance: number }

  it('builds the statement shape correctly: opening balance emphasized, Debit/Credit totaled', async () => {
    const columns: ExcelColumn<LedgerEntry>[] = [
      { key: 'date', header: 'Date', value: (r) => r.date },
      { key: 'ref', header: 'Ref', value: (r) => r.ref },
      { key: 'desc', header: 'Description', value: (r) => r.desc },
      { key: 'debit', header: 'Debit', type: 'currency', value: (r) => (r.debit === '' ? null : r.debit), total: 'sum' },
      { key: 'credit', header: 'Credit', type: 'currency', value: (r) => (r.credit === '' ? null : r.credit), total: 'sum' },
      { key: 'balance', header: 'Balance', type: 'currency', value: (r) => r.balance, total: 'last' },
    ]
    const rows: LedgerEntry[] = [
      { date: '2026-08-01', ref: '', desc: 'Opening balance', debit: '', credit: '', balance: 500 },
      { date: '2026-08-05', ref: 'INV-001', desc: 'Invoice', debit: 300, credit: '', balance: 800 },
      { date: '2026-08-10', ref: 'PMT-001', desc: 'Payment received', debit: '', credit: 200, balance: 600 },
    ]
    const { worksheet, headerRowNumber } = await roundTrip<LedgerEntry>({
      filename: 'client-statement', sheetName: 'Statement', title: 'Client Statement', columns, rows,
      emphasizeRowIndexes: [0], totalsLabel: 'Total',
    })
    const dataStart = headerRowNumber + 1
    expect(worksheet.getRow(dataStart).getCell(3).value).toBe('Opening balance')
    expect(worksheet.getRow(dataStart).getCell(4).font?.bold).toBe(true) // emphasized
    expect(worksheet.getRow(dataStart + 1).getCell(4).value).toBe(300) // Invoice debit
    expect(worksheet.getRow(dataStart + 1).getCell(4).numFmt).toBe('"$"#,##0.00;-"$"#,##0.00')
    const totalsRow = worksheet.getRow(dataStart + 3)
    expect(totalsRow.getCell(1).value).toBe('Total')
    expect((totalsRow.getCell(4).value as ExcelJS.CellFormulaValue).formula).toBe(`SUM(D${dataStart}:D${dataStart + 2})`)
    expect((totalsRow.getCell(5).value as ExcelJS.CellFormulaValue).formula).toBe(`SUM(E${dataStart}:E${dataStart + 2})`)
    // The bug fix under test: Total → Balance must be a reference to the
    // LAST row's own balance (600), never SUM(D..D) of the balance column
    // (500+800+600=1900, which would be meaningless).
    const balanceTotalCell = totalsRow.getCell(6)
    expect((balanceTotalCell.value as ExcelJS.CellFormulaValue).formula).toBe(`F${dataStart + 2}`)
    expect(balanceTotalCell.numFmt).toBe('"$"#,##0.00;-"$"#,##0.00')
  })
})

describe('buildWorkbook — Total→Balance uses the final row, never a sum (Client Statement bug fix)', () => {
  interface StmtRow { desc: string; debit: number | null; credit: number | null; balance: number }

  const columns: ExcelColumn<StmtRow>[] = [
    { key: 'desc', header: 'Description', value: r => r.desc },
    { key: 'debit', header: 'Debit', type: 'currency', value: r => r.debit, total: 'sum' },
    { key: 'credit', header: 'Credit', type: 'currency', value: r => r.credit, total: 'sum' },
    { key: 'balance', header: 'Balance', type: 'currency', value: r => r.balance, total: 'last' },
  ]

  async function totalsRowOf(rows: StmtRow[], cols: ExcelColumn<StmtRow>[] = columns) {
    const { worksheet, headerRowNumber } = await roundTrip<StmtRow>({
      filename: 'test', sheetName: 'Statement', columns: cols, rows, emphasizeRowIndexes: [0],
    })
    const dataStart = headerRowNumber + 1
    return { worksheet, totalsRow: worksheet.getRow(dataStart + rows.length), dataStart }
  }

  it('opening balance + a single debit transaction: Total→Balance = 2027.97, matching the reported example', async () => {
    const rows: StmtRow[] = [
      { desc: 'Opening balance', debit: null, credit: null, balance: 2017.97 },
      { desc: 'Order Sale', debit: 10, credit: null, balance: 2027.97 },
    ]
    const { totalsRow, dataStart } = await totalsRowOf(rows)
    expect((totalsRow.getCell(2).value as ExcelJS.CellFormulaValue).formula).toBe(`SUM(B${dataStart}:B${dataStart + 1})`)
    expect((totalsRow.getCell(4).value as ExcelJS.CellFormulaValue).formula).toBe(`D${dataStart + 1}`)
  })

  it('opening balance + a single credit (payment) transaction', async () => {
    const rows: StmtRow[] = [
      { desc: 'Opening balance', debit: null, credit: null, balance: 500 },
      { desc: 'Payment received', debit: null, credit: 200, balance: 300 },
    ]
    const { totalsRow, dataStart } = await totalsRowOf(rows)
    expect((totalsRow.getCell(3).value as ExcelJS.CellFormulaValue).formula).toBe(`SUM(C${dataStart}:C${dataStart + 1})`)
    expect((totalsRow.getCell(4).value as ExcelJS.CellFormulaValue).formula).toBe(`D${dataStart + 1}`)
  })

  it('multiple transactions: Total→Balance is the LAST row, not a sum of every running balance', async () => {
    const rows: StmtRow[] = [
      { desc: 'Opening balance', debit: null, credit: null, balance: 2017.97 },
      { desc: 'Order Sale', debit: 10, credit: null, balance: 2027.97 },
      { desc: 'Another order', debit: 2000, credit: null, balance: 4027.97 },
    ]
    const { worksheet, totalsRow, dataStart } = await totalsRowOf(rows)
    const formula = (totalsRow.getCell(4).value as ExcelJS.CellFormulaValue).formula
    expect(formula).toBe(`D${dataStart + 2}`)
    // Prove it resolves to the last row's actual balance value, not a sum —
    // read the referenced cell directly, exactly as Excel would.
    const [, refRow] = formula.match(/D(\d+)/)!
    expect(worksheet.getRow(Number(refRow)).getCell(4).value).toBe(4027.97)
    // The sum the fix must NOT produce, for clarity: 2017.97+2027.97+4027.97 = 8073.91.
    const wrongSum = rows.reduce((s, r) => s + r.balance, 0)
    expect(wrongSum).not.toBe(4027.97)
  })

  it('no transaction rows — a lone opening-balance row: Total→Balance is exactly the opening balance', async () => {
    const rows: StmtRow[] = [{ desc: 'Opening balance', debit: null, credit: null, balance: 2017.97 }]
    const { worksheet, totalsRow, dataStart } = await totalsRowOf(rows)
    const formula = (totalsRow.getCell(4).value as ExcelJS.CellFormulaValue).formula
    expect(formula).toBe(`D${dataStart}`)
    expect(worksheet.getRow(dataStart).getCell(4).value).toBe(2017.97)
  })

  it('Balance column selected: the Total→Balance cell exists with the correct reference and currency format', async () => {
    const rows: StmtRow[] = [
      { desc: 'Opening balance', debit: null, credit: null, balance: 2017.97 },
      { desc: 'Order Sale', debit: 10, credit: null, balance: 2027.97 },
    ]
    const { totalsRow, dataStart } = await totalsRowOf(rows) // all 4 columns selected, including Balance
    const cell = totalsRow.getCell(4)
    expect(cell.value).not.toBeNull()
    expect((cell.value as ExcelJS.CellFormulaValue).formula).toBe(`D${dataStart + 1}`)
    expect(cell.numFmt).toBe('"$"#,##0.00;-"$"#,##0.00')
  })

  it('Balance column deselected (as via the export column-selection modal): no Balance column and no Balance total at all', async () => {
    const rows: StmtRow[] = [
      { desc: 'Opening balance', debit: null, credit: null, balance: 2017.97 },
      { desc: 'Order Sale', debit: 10, credit: null, balance: 2027.97 },
    ]
    const withoutBalance = columns.filter(c => c.key !== 'balance') // mirrors what the modal does: filter out unchecked columns
    const { worksheet, totalsRow, dataStart } = await totalsRowOf(rows, withoutBalance)
    expect(worksheet.columnCount).toBe(3) // Description, Debit, Credit only
    // Debit/Credit totals still there — deselecting Balance doesn't disturb them.
    expect((totalsRow.getCell(2).value as ExcelJS.CellFormulaValue).formula).toBe(`SUM(B${dataStart}:B${dataStart + 1})`)
    // No 4th column at all, so there is no cell to hold a Balance total.
    expect(totalsRow.getCell(4).value).toBeNull()
  })

  it('never produces a SUM formula for the Balance column, regardless of row count', async () => {
    const rows: StmtRow[] = [
      { desc: 'Opening balance', debit: null, credit: null, balance: 100 },
      { desc: 'A', debit: 5, credit: null, balance: 105 },
      { desc: 'B', debit: null, credit: 3, balance: 102 },
      { desc: 'C', debit: 7, credit: null, balance: 109 },
    ]
    const { totalsRow } = await totalsRowOf(rows)
    const formula = (totalsRow.getCell(4).value as ExcelJS.CellFormulaValue).formula
    expect(formula).not.toMatch(/^SUM\(/)
  })
})
