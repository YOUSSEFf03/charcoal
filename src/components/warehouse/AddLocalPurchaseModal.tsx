import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'
import { useSuppliers } from '../../hooks/useSuppliers'
import { useCreateStockLot } from '../../hooks/useWarehouse'
import { toDateOnlyString } from '../../lib/date'

const GRADES = ['A', 'B', 'C']

interface Props {
  open: boolean
  onClose: () => void
  /** Called after the lot is saved (e.g. to show a toast). */
  onSaved?: (summary: string) => void
  /** Charcoal types already in stock, offered as suggestions for the Type field. */
  knownTypes?: string[]
}

const mono = { fontFamily: "'IBM Plex Mono',monospace" } as const

/**
 * "Add local purchase" — records charcoal bought outside a container (e.g. 500 kg
 * from a local supplier) as a direct raw lot via POST /stock-lots. The lot is then
 * packed / sold like any container lot, and kg × cost/kg is charged to the
 * supplier's balance and statement.
 */
export default function AddLocalPurchaseModal({ open, onClose, onSaved, knownTypes = [] }: Props) {
  const suppliersQ = useSuppliers({ limit: 100 })
  const createLot = useCreateStockLot()
  const suppliers = suppliersQ.data?.data ?? []

  const [supplierId, setSupplierId] = useState('')
  const [charcoalType, setCharcoalType] = useState('')
  const [grade, setGrade] = useState('A')
  const [kg, setKg] = useState('')
  const [costPerKg, setCostPerKg] = useState('')
  const [date, setDate] = useState(() => toDateOnlyString(new Date()))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  // Fresh form every time it opens.
  useEffect(() => {
    if (!open) return
    setSupplierId('')
    setCharcoalType('')
    setGrade('A')
    setKg('')
    setCostPerKg('')
    setDate(toDateOnlyString(new Date()))
    setNotes('')
    setError('')
  }, [open])

  const kgNum = parseFloat(kg)
  const costNum = parseFloat(costPerKg)
  const total = !isNaN(kgNum) && !isNaN(costNum) ? kgNum * costNum : null

  function submit() {
    if (!supplierId) return setError('Choose the supplier')
    if (!charcoalType.trim()) return setError('Enter the charcoal type')
    if (isNaN(kgNum) || kgNum <= 0) return setError('Enter the kg bought')
    if (isNaN(costNum) || costNum < 0) return setError('Enter the cost per kg (0 or more)')
    if (!date) return setError('Pick the date received')
    setError('')
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
        onSuccess: () => {
          onSaved?.(`${kgNum.toLocaleString()} kg ${charcoalType.trim()} added to stock`)
          onClose()
        },
        onError: (err: any) => setError(err?.error ?? err?.message ?? 'Failed to save'),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add local purchase"
      subtitle="Stock bought without a container — it goes straight into raw stock"
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={createLot.isPending} onClick={submit}>
            <i className="ti ti-check" style={{ fontSize: 13 }} />
            {createLot.isPending ? 'Saving…' : 'Add to stock'}
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
            No suppliers yet — add the local supplier in <Link to="/suppliers">Suppliers</Link> first.
          </div>
        )}
      </div>

      <div className="form-row">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-type">Charcoal type</label>
          <input
            id="lp-type"
            className="form-input"
            list="lp-type-options"
            placeholder="e.g. BBQ Hardwood"
            value={charcoalType}
            onChange={e => setCharcoalType(e.target.value)}
          />
          <datalist id="lp-type-options">
            {knownTypes.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-grade">Grade</label>
          <select id="lp-grade" className="form-input" value={grade} onChange={e => setGrade(e.target.value)}>
            {GRADES.map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="lp-kg">Kg bought</label>
          <input
            id="lp-kg"
            className="form-input"
            type="number" min="0" step="0.1" placeholder="500"
            value={kg}
            onChange={e => setKg(e.target.value)}
            style={mono}
          />
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
