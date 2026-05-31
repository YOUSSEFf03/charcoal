import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useSuppliers } from '../hooks/useSuppliers'
import { useCreateContainer } from '../hooks/useContainers'
import type { ContainerStatus, CreateContainerProductLineDto } from '../types/api'

interface PLine {
  id: number
  type: string
  grade: string
  supplierId: string
  paidBags: number
  giftBags: number
  kgPerBag: number
  dollarPerTon: number
}

type StepKey = 'created' | 'port' | 'transit' | 'arrived'

const GRADES = ['A', 'B', 'C']
const STATUS_STEPS: { key: StepKey; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'port', label: 'At port' },
  { key: 'transit', label: 'In transit' },
  { key: 'arrived', label: 'Arrived' },
]

let _nextId = 1

export default function NewContainer() {
  const navigate = useNavigate()

  // Suppliers feed the supplier dropdowns; createContainer persists the form.
  const suppliersQ = useSuppliers({ limit: 100 })
  const suppliers = suppliersQ.data?.data ?? []
  const createContainer = useCreateContainer()

  const [contNum, setContNum] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [eta, setEta] = useState('')
  const [status, setStatus] = useState<StepKey>('created')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PLine[]>([
    { id: _nextId++, type: 'BBQ Hardwood', grade: 'A', supplierId: '', paidBags: 0, giftBags: 0, kgPerBag: 10.0, dollarPerTon: 680 },
  ])
  const [discount, setDiscount] = useState(0)
  const [freight, setFreight] = useState(0)

  // Default the header + line suppliers to the first loaded supplier.
  const effectiveSupplierId = supplierId || suppliers[0]?.id || ''

  const totalTons = lines.reduce((s, l) => s + (l.paidBags * l.kgPerBag) / 1000, 0)
  const totalPaidBags = lines.reduce((s, l) => s + l.paidBags, 0)
  const totalGiftBags = lines.reduce((s, l) => s + l.giftBags, 0)
  const productCost = lines.reduce((s, l) => s + (l.paidBags * l.kgPerBag * l.dollarPerTon) / 1000, 0)
  const allIn = productCost + freight - discount
  const avgKg = totalTons > 0 ? allIn / (totalTons * 1000) : 0

  function addLine() {
    setLines(prev => [...prev, { id: _nextId++, type: '', grade: 'A', supplierId: effectiveSupplierId, paidBags: 0, giftBags: 0, kgPerBag: 10.0, dollarPerTon: 0 }])
  }
  function removeLine(id: number) {
    setLines(prev => prev.filter(l => l.id !== id))
  }
  function updateLine(id: number, field: keyof PLine, val: string | number) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l))
  }

  // Create the container from the form, then navigate to its detail page.
  function createContainerSubmit() {
    if (!contNum.trim() || !effectiveSupplierId) return
    const productLines: CreateContainerProductLineDto[] = lines
      .filter(l => l.type.trim() && l.paidBags > 0)
      .map(l => ({
        charcoalType: l.type.trim(),
        grade: l.grade,
        supplierId: l.supplierId || effectiveSupplierId,
        paidBags: l.paidBags,
        giftBags: l.giftBags,
        kgPerBag: l.kgPerBag.toFixed(2),
        pricePerTon: l.dollarPerTon.toFixed(2),
      }))
    createContainer.mutate(
      {
        number: contNum.trim(),
        supplierId: effectiveSupplierId,
        status: (status === 'created' ? 'port' : status) as ContainerStatus,
        notes: notes || null,
        productLines,
      },
      { onSuccess: (created) => navigate('/containers/' + created.id) },
    )
  }

  return (
    <>
      <Topbar title="New container">
        <span className="badge badge-gray" style={{ marginLeft: 4 }}>draft</span>
        <button className="btn" onClick={() => navigate('/containers')} style={{ marginLeft: 'auto' }}>Cancel</button>
        <button className="btn">Save draft</button>
        <button className="btn primary" onClick={createContainerSubmit} disabled={createContainer.isPending}>
          <i className="ti ti-check" style={{ fontSize: 15 }} /> {createContainer.isPending ? 'Creating…' : 'Create container'}
        </button>
      </Topbar>
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14, alignItems: 'start' }}>

          {/* LEFT */}
          <div className="stack">

            {/* Container details */}
            <div className="form-card">
              <div className="form-card-head">container details</div>
              <div className="grid-3c">
                <div className="field">
                  <label className="field-label">Container number</label>
                  <input className="input" style={{ fontFamily: "'IBM Plex Mono',monospace" }} value={contNum} onChange={e => setContNum(e.target.value)} placeholder="CONT-2026-016" />
                </div>
                <div className="field">
                  <label className="field-label">Supplier</label>
                  <select className="select" value={effectiveSupplierId} onChange={e => setSupplierId(e.target.value)}>
                    {suppliers.length === 0 && <option value="">{suppliersQ.isLoading ? 'Loading…' : 'No suppliers'}</option>}
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} — {s.country}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">ETA</label>
                  <input className="input" type="date" value={eta} onChange={e => setEta(e.target.value)} />
                </div>
              </div>

              <div className="field" style={{ marginTop: 14 }}>
                <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>Status</label>
                <div className="status-track">
                  {STATUS_STEPS.map((s, i) => (
                    <span key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
                      {i > 0 && <div className="status-arrow" />}
                      <div className={`status-step ${status === s.key ? 'sel' : ''}`} onClick={() => setStatus(s.key)}>
                        <span className="dot" />{s.label}
                      </div>
                    </span>
                  ))}
                </div>
              </div>

              <div className="field" style={{ marginTop: 14 }}>
                <label className="field-label">Notes</label>
                <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. expected 28 tons total, request 3 lots" />
              </div>
            </div>

            {/* Product lines */}
            <div className="form-card">
              <div className="form-card-head">
                <span>product lines · one row per charcoal type</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>cost calculated live</span>
              </div>

              {lines.map((l) => {
                return (
                  <div className="pline-row" key={l.id}>
                    <div>
                      <span className="lbl">Type</span>
                      <input value={l.type} onChange={e => updateLine(l.id, 'type', e.target.value)} placeholder="e.g. BBQ Hardwood" />
                    </div>
                    <div>
                      <span className="lbl">Grade</span>
                      <select value={l.grade} onChange={e => updateLine(l.id, 'grade', e.target.value)}>
                        {GRADES.map(g => <option key={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <span className="lbl">Supplier</span>
                      <select value={l.supplierId || effectiveSupplierId} onChange={e => updateLine(l.id, 'supplierId', e.target.value)}>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <span className="lbl">Paid bags</span>
                      <input className="num" type="number" min="0" value={l.paidBags || ''} onChange={e => updateLine(l.id, 'paidBags', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <span className="lbl">Gift bags</span>
                      <input className="num" type="number" min="0" value={l.giftBags || ''} onChange={e => updateLine(l.id, 'giftBags', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <span className="lbl">kg / bag</span>
                      <input className="num" type="number" min="0" step="0.1" value={l.kgPerBag || ''} onChange={e => updateLine(l.id, 'kgPerBag', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <span className="lbl">$ / ton</span>
                      <input className="num" type="number" min="0" value={l.dollarPerTon || ''} onChange={e => updateLine(l.id, 'dollarPerTon', parseFloat(e.target.value) || 0)} />
                    </div>
                    <button className="line-del" onClick={() => removeLine(l.id)} disabled={lines.length === 1}>
                      <i className="ti ti-x" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                )
              })}

              <button className="add-line" onClick={addLine}>
                <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add product line
              </button>
            </div>

            {/* Discount + initial expense */}
            <div className="form-card">
              <div className="form-card-head">discount &amp; pre-arrival expenses (optional · add more after arrival)</div>
              <div className="grid-2c">
                <div className="field">
                  <label className="field-label">Supplier discount (USD)</label>
                  <div className="input-prefix">
                    <span className="input-prefix-text">$</span>
                    <input className="input num" type="number" value={discount || ''} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} step="10" />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontFamily: "'IBM Plex Mono',monospace", display: 'block' }}>split across product lines by tonnage</span>
                </div>
                <div className="field">
                  <label className="field-label">Pre-arrival freight estimate (USD)</label>
                  <div className="input-prefix">
                    <span className="input-prefix-text">$</span>
                    <input className="input num" type="number" value={freight || ''} onChange={e => setFreight(parseFloat(e.target.value) || 0)} step="100" />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontFamily: "'IBM Plex Mono',monospace", display: 'block' }}>add port fees, agent, etc. on detail page</span>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT — sticky summary */}
          <div className="summary">
            <div className="sum-head">
              <span>Cost preview</span>
              <span style={{ color: 'var(--text3)' }}>live</span>
            </div>
            <div className="sum-body">
              <div className="sum-row"><span className="lbl">Product lines</span><span className="val">{lines.length}</span></div>
              <div className="sum-row"><span className="lbl">Paid bags · gift</span><span className="val">{totalPaidBags.toLocaleString()} · {totalGiftBags}</span></div>
              <div className="sum-row"><span className="lbl">Total tonnage</span><span className="val">{totalTons.toFixed(2)} t</span></div>
              <div className="sum-row"><span className="lbl">Product cost</span><span className="val">${Math.round(productCost).toLocaleString()}</span></div>
              <div className="sum-row"><span className="lbl">+ Pre-arrival</span><span className="val" style={{ color: 'var(--red)' }}>+ ${freight.toLocaleString()}</span></div>
              <div className="sum-row"><span className="lbl">− Discount</span><span className="val" style={{ color: 'var(--accent)' }}>− ${discount.toLocaleString()}</span></div>
              <div className="sum-row big"><span className="lbl">All-in (est.)</span><span className="val">${Math.round(allIn).toLocaleString()}</span></div>
              <div className="sum-row" style={{ color: 'var(--text3)' }}>
                <span className="lbl">Avg cost / kg</span>
                <span className="val">≈ ${avgKg.toFixed(2)}</span>
              </div>
            </div>
            <div className="sum-actions">
              <button className="btn green" onClick={createContainerSubmit} disabled={createContainer.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {createContainer.isPending ? 'Creating…' : 'Create container'}
              </button>
              <button className="btn" onClick={createContainerSubmit} disabled={createContainer.isPending}>Create + open detail</button>
              <button className="btn">Save as draft</button>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
