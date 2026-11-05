import { useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'
import { useSuppliers } from '../../hooks/useSuppliers'
import { useCreateStockLot, useUpdateStockLot } from '../../hooks/useWarehouse'
import type { UpdateStockLotBody } from '../../hooks/useWarehouse'
import type { StockLot } from '../../types/api'
import { toDateOnlyString } from '../../lib/date'

const GRADES = ['A', 'B', 'C']

interface Props {
  open: boolean
  onClose: () => void
  /** Called after the lot is saved (e.g. to show a toast). */
  onSaved?: (summary: string) => void
  /** Charcoal types already in stock, offered as suggestions for the Type field. */
  knownTypes?: string[]
  /** When set, the form edits this local purchase instead of adding a new one. */
  lot?: StockLot
}

const mono = { fontFamily: "'IBM Plex Mono',monospace" } as const

/** Trim trailing zeros from a decimal string for display in an input ("500.000" → "500"). */
function plain(n: string | null | undefined) {
  if (n == null) return ''
  const v = parseFloat(n)
  return isNaN(v) ? '' : String(v)
}

/**
 * "Add / Edit local purchase": charcoal bought outside a container (e.g. 500 kg from
 * a local supplier), stored as a direct raw lot. Add → POST /stock-lots; edit →
 * PATCH /stock-lots/:id. kg × cost/kg is charged to the supplier's balance and
 * statement. Mount it only while open: it loads GET /suppliers (owner/accountant).
 */
export default function AddLocalPurchaseModal({ open, onClose, onSaved, knownTypes = [], lot }: Props) {
  const editing = Boolean(lot)
  const suppliersQ = useSuppliers({ limit: 100 })
  const createLot = useCreateStockLot()
  const updateLot = useUpdateStockLot()
  const pending = createLot.isPending || updateLot.isPending
  const suppliers = suppliersQ.data?.data ?? []

  // Kg already drawn from this lot (packed, sold, used in fill jobs, adjusted).
  const usedKg = lot ? Math.max(0, parseFloat(lot.kgReceived) - parseFloat(lot.kgRemaining)) : 0
  // Type/grade lock once the lot has been drawn on. The server also checks for
  // references this page can't see and answers LOT_IN_USE, shown as the error.
  const typeLocked = usedKg > 0

  const [supplierId, setSupplierId] = useState(lot?.supplierId ?? '')
  const [charcoalType, setCharcoalType] = useState(lot?.charcoalType ?? '')
  const [grade, setGrade] = useState(lot?.grade ?? 'A')
  const [kg, setKg] = useState(plain(lot?.kgReceived))
  const [costPerKg, setCostPerKg] = useState(plain(lot?.costPerKg))
  const [date, setDate] = useState(() => (lot ? lot.dateReceived.slice(0, 10) : toDateOnlyString(new Date())))
  const [notes, setNotes] = useState(lot?.notes ?? '')
  const [error, setError] = useState('')

  const kgNum = parseFloat(kg)
  const costNum = parseFloat(costPerKg)
  const total = !isNaN(kgNum) && !isNaN(costNum) ? kgNum * costNum : null

  function submit() {
    if (!supplierId) return setError('Choose the supplier')
    if (!charcoalType.trim()) return setError('Enter the charcoal type')
    if (isNaN(kgNum) || kgNum <= 0) return setError('Enter the kg bought')
    if (kgNum < usedKg) return setError(`${usedKg.toLocaleString()} kg is already used, so kg bought can't be less`)
    if (isNaN(costNum) || costNum < 0) return setError('Enter the cost per kg (0 or more)')
    if (!date) return setError('Pick the date received')
    setError('')
    const onError = (err: any) => setError(err?.error ?? err?.message ?? 'Failed to save')

    if (lot) {
      const body: UpdateStockLotBody = {
        supplierId,
        kgReceived: kgNum.toFixed(3),
        costPerKg: costNum.toFixed(4),
        dateReceived: date,
        notes: notes.trim(),
        // Only send type/grade when they actually changed, so a cost fix on a used
        // lot never trips the server's type-change guard.
        ...(charcoalType.trim() !== lot.charcoalType ? { charcoalType: charcoalType.trim() } : {}),
        ...(grade !== lot.grade ? { grade } : {}),
      }
      updateLot.mutate(
        { id: lot.id, body },
        { onSuccess: () => { onSaved?.('Local purchase updated'); onClose() }, onError },
      )
      return
    }

    createLot.mutate(
      {
        supplierId,
        charcoalType: charcoalType.trim(),
        grade,
        kgRemaining: kgNum.toFixed(3),
        costPerKg: costNum.toFixed(4),
        dateReceived: date,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      {
        onSuccess: () => { onSaved?.(`${kgNum.toLocaleString()} kg ${charcoalType.trim()} added to stock`); onClose() },
        onError,
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit local purchase' : 'Add local purchase'}
      subtitle={editing ? 'Fix a mistake in this purchase' : 'Stock bought without a container goes straight into raw stock'}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={pending} onClick={submit}>
            <i className="ti ti-check" style={{ fontSize: 13 }} />
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add to stock'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="lp-supplier">Supplier</label>
        <select
          id="lp-supplier"
          className="form-input"
          value={supplierId}
          onChange={e => setSupplierId(e.target.value)}
          disabled={suppliersQ.isLoading}
        >
          <option value="">{suppliersQ.isLoading ? 'Loading…' : 'Choose supplier…'}</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!suppliersQ.isLoading && suppliers.length === 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)' }}>
            No suppliers yet. Add the local supplier in <Link to="/suppliers">Suppliers</Link> first.
          </div>
        )}
      </div>

      <div className="form-row" style={typeLocked ? { marginBottom: 6 } : undefined}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-type">Charcoal type</label>
          <input
            id="lp-type"
            className="form-input"
            list="lp-type-options"
            placeholder="e.g. BBQ Hardwood"
            value={charcoalType}
            onChange={e => setCharcoalType(e.target.value)}
            disabled={typeLocked}
          />
          <datalist id="lp-type-options">
            {knownTypes.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-grade">Grade</label>
          <select id="lp-grade" className="form-input" value={grade} onChange={e => setGrade(e.target.value)} disabled={typeLocked}>
            {GRADES.map(g => <option key={g}>{g}</option>)}
            {!GRADES.includes(grade) && <option>{grade}</option>}
          </select>
        </div>
      </div>
      {typeLocked && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
          Type and grade are locked because some of this stock is already used.
        </div>
      )}

      <div className="form-row">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-kg">Kg bought</label>
          <input
            id="lp-kg"
            className="form-input"
            type="number" min={usedKg || 0} step="0.1" placeholder="500"
            value={kg}
            onChange={e => setKg(e.target.value)}
            style={mono}
          />
          {usedKg > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)' }} data-testid="lp-used">
              {usedKg.toLocaleString()} kg already used, so it can't go lower
            </div>
          )}
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-cost">Cost per kg ($)</label>
          <input
            id="lp-cost"
            className="form-input"
            type="number" min="0" step="0.01" placeholder="0.80"
            value={costPerKg}
            onChange={e => setCostPerKg(e.target.value)}
            style={mono}
          />
        </div>
      </div>

      <div
        data-testid="lp-total"
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, marginBottom: 14, ...mono }}
      >
        Total owed to supplier: <strong>{total == null ? '—' : `$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="lp-date">Date received</label>
        <input id="lp-date" className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" htmlFor="lp-notes">Notes (optional)</label>
        <input
          id="lp-notes"
          className="form-input"
          type="text"
          placeholder="e.g. bought from Tripoli market"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
    </Modal>
  )
}
