// @vitest-environment jsdom
//
// The other test file (excelExport.test.ts) only exercises buildWorkbook(),
// which is pure and has no browser dependency. It never once called the
// actual exportExcel() function real UI buttons invoke — the one that does
// URL.createObjectURL / document.createElement('a') / a.click(). This file
// closes that gap: it runs in a real jsdom DOM (not plain Node), through
// Vite's own dynamic-import resolution for `exceljs`, and inspects the exact
// Blob that would be handed to the browser's download machinery.
import { describe, it, expect, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { exportExcel, type ExcelColumn } from './excelExport'

interface Row { name: string; amount: number }

describe('exportExcel — real browser-API path (jsdom)', () => {
  it('resolves the dynamic import, builds a workbook, and hands a valid XLSX Blob to the anchor download', async () => {
    // jsdom's own Blob polyfill in this environment only implements
    // {constructor, slice, size, type} — no arrayBuffer()/text()/stream()
    // (a jsdom gap; every real browser and Node's own Blob implement all
    // three). Spy on the Blob constructor itself to capture the raw bytes
    // exportExcel() actually hands it, sidestepping that gap entirely.
    let capturedParts: BlobPart[] | null = null
    let capturedType = ''
    const OriginalBlob = globalThis.Blob
    const BlobSpy = vi.fn(function (this: Blob, parts: BlobPart[], opts?: BlobPropertyBag) {
      capturedParts = parts
      capturedType = opts?.type ?? ''
      return new OriginalBlob(parts, opts)
    }) as unknown as typeof Blob
    vi.stubGlobal('Blob', BlobSpy)

    let capturedFilename = ''
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      capturedFilename = this.download
    })

    const columns: ExcelColumn<Row>[] = [
      { key: 'name', header: 'Name', value: r => r.name },
      { key: 'amount', header: 'Amount', type: 'currency', value: r => r.amount, total: 'sum' },
    ]

    await exportExcel({
      filename: 'browser-path-test', sheetName: 'Sheet1', columns,
      rows: [{ name: 'A', amount: 42.5 }, { name: 'B', amount: -10 }],
    })

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
    expect(capturedFilename).toMatch(/^browser-path-test-\d{4}-\d{2}-\d{2}\.xlsx$/)

    expect(capturedType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(capturedParts).not.toBeNull()
    const rawPart = capturedParts![0] as ArrayBuffer
    expect(rawPart.byteLength).toBeGreaterThan(0)

    // The real proof: feed the exact bytes that would have been downloaded
    // back into ExcelJS and confirm it's a structurally valid, correctly
    // formatted workbook — not just "some bytes were produced".
    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(rawPart as any)
    const ws = reloaded.worksheets[0]
    expect(ws.getRow(1).getCell(1).value).toBe('Name')
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true)
    expect(ws.getRow(2).getCell(2).value).toBe(42.5)
    expect(ws.getRow(2).getCell(2).numFmt).toBe('"$"#,##0.00;-"$"#,##0.00')

    vi.unstubAllGlobals()
    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('propagates a thrown error to the caller instead of silently swallowing it', async () => {
    const columns: ExcelColumn<Row>[] = [
      // A column value() that throws simulates a bad data-extraction bug —
      // exportExcel() must not swallow it, so a caller's catch block can
      // report a real error instead of a generic "failed" with no cause.
      { key: 'name', header: 'Name', value: () => { throw new Error('boom') } },
    ]
    await expect(exportExcel({
      filename: 'error-path-test', sheetName: 'Sheet1', columns, rows: [{ name: 'A', amount: 1 }],
    })).rejects.toThrow('boom')
  })
})
