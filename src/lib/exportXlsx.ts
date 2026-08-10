import * as XLSX from 'xlsx'

/**
 * Writes a 2D array (header row + data rows) to a downloaded .xlsx file, named
 * `${filename}-YYYY-MM-DD.xlsx`. Shared by every page-level Excel export
 * (Client Statement, Supplier Statement, and their sibling record-list exports)
 * so the write-a-sheet logic exists in exactly one place.
 */
export function exportSheet(aoa: unknown[][], sheet: string, filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
