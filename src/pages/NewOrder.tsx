import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClients } from '../hooks/useClients'
import { useBagTypes } from '../hooks/useBagTypes'
import { usePackedStockSummary } from '../hooks/useWarehouse'
import { useCreateOrder } from '../hooks/useOrders'
import { useUsers } from '../hooks/useUsers'
import type { CreateOrderBagLineDto } from '../types/api'

interface OrderLine {
  id: number
  bagTypeId: string
  charcoal: string
  qty: number
  kgPerBag: number
  price: number
}

const CHARCOAL_OPTIONS = ['BBQ Hardwood · A', 'BBQ Hardwood · B', 'Shisha · A', 'Shisha · B', 'Restaurant Grade · A']

let _nid = 1

export default function NewOrder() {
  const navigate = useNavigate()

  // Live reference data for the order builder.
  const clientsQ = useClients({ limit: 100 })
  const bagTypesQ = useBagTypes()
  const packedQ = usePackedStockSummary()
  const createOrder = useCreateOrder()
  const driversQ = useUsers({ role: 'driver' })

  const clients = clientsQ.data?.data ?? []
  const bagTypes = bagTypesQ.data ?? []
  const packedSummary = packedQ.data ?? []
  const driverOptions = ['— Assign later —', ...(driversQ.data?.data ?? []).map(u => u.name)]
  // Available packed bags per bag type, for the "available stock" hint.
  const availableByBagType = new Map(packedSummary.map(p => [p.bagTypeId, p.totalBags]))

  const [clientIdx, setClientIdx] = useState(0)
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [ref, setRef] = useState('')
  const [driver, setDriver] = useState('— Assign later —')
  const [addr, setAddr] = useState('')
  const [splitMode, setSplitMode] = useState('No — single shipment')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<OrderLine[]>([
    { id: _nid++, bagTypeId: '', charcoal: 'BBQ Hardwood · A', qty: 0, kgPerBag: 0, price: 0 },
  ])

  const client = clients[clientIdx]
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0)
  const totalKg = lines.reduce((s, l) => s + l.qty * l.kgPerBag, 0)
  const totalBags = lines.reduce((s, l) => s + l.qty, 0)

  function addLine() {
    const first = bagTypes[0]
    setLines(prev => [...prev, { id: _nid++, bagTypeId: first?.id ?? '', charcoal: 'BBQ Hardwood · A', qty: 0, kgPerBag: first ? parseFloat(first.nominalKg) : 0, price: 0 }])
  }
  function removeLine(id: number) {
    if (lines.length === 1) return
    setLines(prev => prev.filter(l => l.id !== id))
  }
  function updateLine(id: number, field: keyof OrderLine, val: string | number) {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: val }
      if (field === 'bagTypeId') {
        const bt = bagTypes.find(b => b.id === val)
        if (bt) updated.kgPerBag = parseFloat(bt.nominalKg)
      }
      return updated
    }))
  }

  // Create the order from the builder, then navigate to its detail page.
  function confirmOrder() {
    if (!client) return
    const bagLines: CreateOrderBagLineDto[] = lines
      .filter(l => l.bagTypeId && l.qty > 0)
      .map(l => ({ bagTypeId: l.bagTypeId, quantity: l.qty }))
    if (bagLines.length === 0) return
    const firstLine = lines.find(l => l.qty > 0) ?? lines[0]
    createOrder.mutate(
      {
        clientId: client.id,
        charcoalType: 'BBQ Hardwood',
        grade: 'Grade A',
        totalKgRequested: totalKg.toFixed(2),
        bagTypeId: firstLine.bagTypeId || null,
        pricePerBag: (firstLine.price || 0).toFixed(2),
        bagLines,
        notes: notes || null,
      },
      { onSuccess: (created) => navigate('/orders/' + created.id) },
    )
  }

  return (
    <>
      <Topbar title="New order">
        <span className="badge badge-gray" style={{ marginLeft: 4 }}>draft</span>
        <button className="btn" onClick={() => navigate('/orders')} style={{ marginLeft: 'auto' }}>Cancel</button>
        <button className="btn">Save draft</button>
        <button className="btn primary" onClick={confirmOrder} disabled={createOrder.isPending}>
          <i className="ti ti-check" style={{ fontSize: 15 }} /> {createOrder.isPending ? 'Creating…' : 'Confirm order'}
        </button>
      </Topbar>
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14, alignItems: 'start' }}>

          {/* LEFT */}
          <div className="stack">

            {/* Client */}
            <div className="form-card">
              <div className="form-card-head">client</div>
              <div className="grid-2c">
                <div className="field">
                  <label className="field-label">Client</label>
                  <select className="select" value={clientIdx} onChange={e => setClientIdx(+e.target.value)}>
                    {clients.length === 0 && <option>{clientsQ.isLoading ? 'Loading clients…' : 'No clients'}</option>}
                    {clients.map((c, i) => <option key={c.id} value={i}>{c.name}{parseFloat(c.balance) > 0 ? ` · balance $${parseFloat(c.balance).toFixed(0)}` : ''}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Currency (from client)</label>
                  <input className="input" style={{ fontFamily: "'IBM Plex Mono',monospace" }} value={client?.currency ?? '—'} readOnly />
                </div>
              </div>
              <div className="grid-2c" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="field-label">Order date</label>
                  <input className="input" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Reference (optional)</label>
                  <input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="WhatsApp / phone / walk-in" />
                </div>
              </div>
            </div>

            {/* Order lines */}
            <div className="form-card">
              <div className="form-card-head">
                <span>order lines · price set at time of sale</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>all in client currency ({client?.currency ?? 'USD'})</span>
              </div>

              {lines.map(l => (
                <div className="line-row" key={l.id}>
                  <div>
                    <span className="lbl">Bag type</span>
                    <select value={l.bagTypeId} onChange={e => updateLine(l.id, 'bagTypeId', e.target.value)}>
                      <option value="">Select bag type…</option>
                      {bagTypes.map(b => {
                        const avail = availableByBagType.get(b.id) ?? 0
                        return <option key={b.id} value={b.id}>{b.name} — {avail} available</option>
                      })}
                    </select>
                  </div>
                  <div>
                    <span className="lbl">Quantity</span>
                    <input className="num" type="number" min="0" value={l.qty || ''} onChange={e => updateLine(l.id, 'qty', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div>
                    <span className="lbl">Nom. kg</span>
                    <input className="num" value={(l.qty * l.kgPerBag).toFixed(0)} readOnly style={{ color: 'var(--text3)', background: 'var(--surface2)' }} />
                  </div>
                  <div>
                    <span className="lbl">Price / bag</span>
                    <input className="num" type="number" min="0" step="0.05" value={l.price || ''} onChange={e => updateLine(l.id, 'price', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div>
                    <span className="lbl">Line total</span>
                    <div className="line-total">${(l.qty * l.price).toFixed(2)}</div>
                  </div>
                  <button className="line-del" onClick={() => removeLine(l.id)} disabled={lines.length === 1}>
                    <i className="ti ti-x" style={{ fontSize: 13 }} />
                  </button>
                </div>
              ))}

              <button className="add-line" onClick={addLine}>
                <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add bag type
              </button>
            </div>

            {/* Delivery */}
            <div className="form-card">
              <div className="form-card-head">delivery</div>
              <div className="grid-2c">
                <div className="field">
                  <label className="field-label">Delivery address</label>
                  <input className="input" value={addr} onChange={e => setAddr(e.target.value)} placeholder={`${client?.name ?? 'Client'} · address`} />
                </div>
                <div className="field">
                  <label className="field-label">Split into shipments?</label>
                  <select className="select" value={splitMode} onChange={e => setSplitMode(e.target.value)}>
                    <option>No — single shipment</option>
                    <option>Yes — split by branch</option>
                    <option>Yes — manual split</option>
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="field-label">Driver</label>
                <select className="select" value={driver} onChange={e => setDriver(e.target.value)}>
                  {driverOptions.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="field-label">Notes (Arabic supported)</label>
                <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. deliver before 11am" />
              </div>
            </div>

          </div>

          {/* RIGHT — sticky summary */}
          <div className="summary">
            <div className="sum-head">
              <span>Order preview</span>
              <span style={{ color: 'var(--text3)' }}>ORD-0359</span>
            </div>
            <div className="sum-body">
              <div className="client-card-mini">
                <div className="cm-av">{(client?.name ?? '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</div>
                <div className="cm-info">
                  <div className="cm-name">{client?.name ?? '—'}</div>
                  <div className="cm-meta">{client?.paymentTerms ?? client?.type ?? ''}</div>
                </div>
                {client && parseFloat(client.balance) > 0 && <div className="cm-bal">${parseFloat(client.balance).toFixed(0)} bal</div>}
              </div>
              <div className="sum-row"><span className="lbl">Items</span><span className="val">{lines.length} lines · {totalBags} bags</span></div>
              <div className="sum-row"><span className="lbl">Nominal kg</span><span className="val">{totalKg.toFixed(0)} kg</span></div>
              <div className="sum-row"><span className="lbl">Subtotal</span><span className="val">${subtotal.toFixed(2)}</span></div>
              <div className="sum-row"><span className="lbl">Discount</span><span className="val">$0.00</span></div>
              <div className="sum-row big"><span className="lbl">Total</span><span className="val">${subtotal.toFixed(2)}</span></div>
            </div>
            <div className="sum-actions">
              <button className="btn green" onClick={confirmOrder} disabled={createOrder.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {createOrder.isPending ? 'Creating…' : 'Confirm order'}
              </button>
              <button className="btn" onClick={confirmOrder} disabled={createOrder.isPending}>Confirm + go to detail</button>
              <button className="btn">Save as draft</button>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
