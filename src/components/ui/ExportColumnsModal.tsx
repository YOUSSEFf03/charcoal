import { useState } from 'react'
import Modal from './Modal'
import type { ExcelColumn } from '../../lib/excelExport'

/**
 * The ONE reusable "choose which columns to export" popup for every Excel
 * export in the app (Orders/Invoices/Warehouse/Payments/Client Statement in
 * ClientDetail.tsx, Supplier Statement in SupplierDetail.tsx, Client Ledger
 * in Reports.tsx). Never create a page-specific variant of this — every
 * export's column list is just a different ExcelColumn<Row>[] passed in via
 * useExportColumnsModal().open().
 *
 * Deliberately dumb: it knows nothing about fetching rows or calling
 * exportExcel(). It only decides WHICH of the caller-supplied columns are
 * checked, then hands that filtered array back via onExport — the caller
 * (each page's existing export function) does the actual fetch/build/
 * exportExcel() work exactly as it did before this feature existed.
 */

export interface ExportColumnsModalState {
  title: string
  /** Optional line under the title, e.g. a client/supplier name or period. */
  subtitle?: string
  columns: ExcelColumn<any>[]
  /** Runs the caller's existing fetch+exportExcel() logic with only the checked columns. */
  onExport: (selectedColumns: ExcelColumn<any>[]) => Promise<void>
}

interface ExportColumnsModalProps extends ExportColumnsModalState {
  onClose: () => void
}

function ExportColumnsModal({ title, subtitle, columns, onExport, onClose }: ExportColumnsModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(columns.filter(c => c.defaultSelected !== false).map(c => c.key)),
  )
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function handleExport() {
    if (selected.size === 0 || exporting) return
    setExporting(true)
    setError('')
    try {
      await onExport(columns.filter(c => selected.has(c.key)))
      onClose()
    } catch (e) {
      // Preserve the real underlying error for debugging (console), and
      // surface a message in the modal — the caller's own try/catch around
      // the fetch/export work already shows its usual toast for expected
      // failure cases (e.g. "Failed to export invoices"); this inline
      // message covers the case where onExport rejects for a reason the
      // caller's toast doesn't already describe, without silently
      // swallowing anything.
      console.error('Export failed:', e)
      const message = e instanceof Error ? e.message : 'Export failed'
      setError(message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      open
      onClose={exporting ? () => {} : onClose}
      title="Export to Excel"
      subtitle={subtitle ? `${title} — ${subtitle}` : title}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="btn primary" onClick={handleExport} disabled={exporting || selected.size === 0}>
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </>
      }
    >
      <div className="form-label" style={{ marginBottom: 10 }}>Select columns to export</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
        {columns.map(col => (
          <label
            key={col.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '6px 4px',
              fontSize: 13, color: 'var(--text2)', cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(col.key)}
              onChange={() => toggle(col.key)}
              style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }}
            />
            {col.header}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: error ? 10 : 0 }}>
        <button className="btn-export preset" onClick={() => setSelected(new Set(columns.map(c => c.key)))} disabled={exporting}>
          Select all
        </button>
        <button className="btn-clear" style={{ padding: '6px 12px' }} onClick={() => setSelected(new Set())} disabled={exporting}>
          Clear all
        </button>
      </div>
      {selected.size === 0 && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>Select at least one column to export.</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>
      )}
    </Modal>
  )
}

/**
 * One hook call per page (even if the page has several exports, e.g.
 * ClientDetail's 5) — each export's trigger just calls openExportModal()
 * with its own columns instead of calling exportExcel() directly.
 */
export function useExportColumnsModal() {
  const [state, setState] = useState<ExportColumnsModalState | null>(null)

  function openExportModal(config: ExportColumnsModalState) {
    setState(config)
  }
  function close() {
    setState(null)
  }

  const exportColumnsModal = state ? (
    <ExportColumnsModal {...state} onClose={close} />
  ) : null

  return { openExportModal, exportColumnsModal }
}
