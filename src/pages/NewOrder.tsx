import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClients, useClient, useClientLocations } from '../hooks/useClients'
import { useBagTypes } from '../hooks/useBagTypes'
import { usePackedStockSummary, useStockLots } from '../hooks/useWarehouse'
import { useCreateOrder } from '../hooks/useOrders'
import { useUsers } from '../hooks/useUsers'
import type { Client, StockLot } from '../types/api'
import { roundDp } from '../lib/money'
import { toDateOnlyString } from '../lib/date'

type StockLotFull = StockLot & { supplier?: { id: string; name: string } }

interface BagLine {
  id: number
  bagTypeId: string
  qty: number
  kgPerBag: number
  price: number
}

interface KgLine {
  id: number
  lotId: string
  kgQty: number
  pricePerKg: number
}

let _nid = 1

export default function NewOrder() {
  const navigate = useNavigate()

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [orderMode, setOrderMode] = useState<'bag' | 'kg'>('bag')

  // ── Client search ─────────────────────────────────────────────────────────
  const [searchParams] = useSearchParams()
  const preselectedClientId = searchParams.get('clientId') ?? ''

  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const clientRef = useRef<HTMLDivElement>(null)

  const preselectedClientQ = useClient(preselectedClientId)

  // ── Data queries ──────────────────────────────────────────────────────────
  const clientsQ = useClients({ search: clientSearch || undefined, limit: 20 })
  const bagTypesQ = useBagTypes()
  const packedQ = usePackedStockSummary()
  const stockLotsQ = useStockLots({ hasStock: true, limit: 100 })
  const createOrder = useCreateOrder()
  const driversQ = useUsers({ role: 'driver' })
  // Multiple-locations audit, 2026-08-31 — only fetched once a client is
  // actually selected; never for Warehouse/Walk-in Sales (this page is
  // normal Orders only — see NewOrder's own route, distinct from
  // WarehouseSales.tsx, which never imports this hook at all).
  const selectedClientId = selectedClient?.id ?? ''
  const locationsQ = useClientLocations(selectedClientId)

  const clients = clientsQ.data?.data ?? []
  const bagTypes = bagTypesQ.data ?? []
  const packedSummary = packedQ.data ?? []
  const stockLots = (stockLotsQ.data?.data ?? []) as StockLotFull[]
  const driverList = driversQ.data?.data ?? []
  const availableByBagType = new Map(packedSummary.map(p => [p.bagTypeId, p.totalBags]))
  // Only ever shown/used when the selected client is actually enabled for
  // multiple locations AND has at least one active one — a normal
  // single-location client's form never grows this extra field.
  const activeLocations = (locationsQ.data ?? []).filter(l => l.isActive)
  const showLocationSelector = !!selectedClient?.multiLocationEnabled && activeLocations.length > 0

  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  // ── Shared form fields ────────────────────────────────────────────────────
  const [orderDate, setOrderDate] = useState(toDateOnlyString(new Date()))
  const [driverId, setDriverId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [notes, setNotes] = useState('')

  // ── Bag lines ─────────────────────────────────────────────────────────────
  const [bagLines, setBagLines] = useState<BagLine[]>([
    { id: _nid++, bagTypeId: '', qty: 0, kgPerBag: 0, price: 0 },
  ])

  // ── KG lines ─────────────────────────────────────────────────────────────
  const [kgLines, setKgLines] = useState<KgLine[]>([
    { id: _nid++, lotId: '', kgQty: 0, pricePerKg: 0 },
  ])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (clientRef.current && !clientRef.current.contains(e.target as Node)) {
        setShowClientDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (preselectedClientQ.data && !selectedClient) {
      setSelectedClient(preselectedClientQ.data)
    }
  }, [preselectedClientQ.data])

  // Switching clients invalidates any previously-picked location — a
  // location belongs to ONE specific client (never global).
  useEffect(() => { setLocationId('') }, [selectedClientId])

  // ── Summaries ─────────────────────────────────────────────────────────────
  const bagSubtotal = bagLines.reduce((s, l) => s + Math.round(l.qty * l.price * 100), 0) / 100
  const bagTotalKg  = bagLines.reduce((s, l) => s + l.qty * l.kgPerBag, 0)
  const bagTotalBags = bagLines.reduce((s, l) => s + l.qty, 0)

  const kgSubtotal = kgLines.reduce((s, l) => s + Math.round(l.kgQty * l.pricePerKg * 100), 0) / 100
  const kgTotalKg  = kgLines.reduce((s, l) => s + l.kgQty, 0)

  const subtotal = orderMode === 'bag' ? bagSubtotal : kgSubtotal
  const totalKg  = orderMode === 'bag' ? bagTotalKg  : kgTotalKg

  // ── Multi-line submission guard ──────────────────────────────────────────
  // CreateOrderDto only accepts ONE bagType/lot + ONE price per order — there
  // is no line-array field on the backend. Submitting more than one active
  // line here would silently collapse: totalKgRequested sums every line, but
  // bagTypeId/pricePerBag only ever come from the first one, corrupting the
  // invoice later generated from this order. Until real multi-line order
  // persistence exists, block submission instead of silently discarding data.
  const validBagLines = bagLines.filter(l => l.bagTypeId && l.qty > 0)
  const validKgLines = kgLines.filter(l => l.lotId && l.kgQty > 0)
  const activeLineCount = orderMode === 'bag' ? validBagLines.length : validKgLines.length
  const multiLineBlocked = activeLineCount > 1
  const multiLineMessage = 'Multi-line orders are not supported yet — please create a separate order for each line.'

  // Required-location audit, 2026-09 — UX mirror of the backend's
  // authoritative rule; see showLocationSelector's own doc comment above.
  const locationRequiredBlocked = showLocationSelector && !locationId
  const locationRequiredMessage = 'Select a location for this client'

  // ── Bag line actions ──────────────────────────────────────────────────────
  function addBagLine() {
    setBagLines(prev => [...prev, { id: _nid++, bagTypeId: '', qty: 0, kgPerBag: 0, price: 0 }])
  }
  function removeBagLine(id: number) {
    if (bagLines.length === 1) return
    setBagLines(prev => prev.filter(l => l.id !== id))
  }
  function updateBagLine(id: number, field: keyof BagLine, val: string | number) {
    setBagLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: val }
      if (field === 'bagTypeId') {
        const bt = bagTypes.find(b => b.id === val)
        if (bt) updated.kgPerBag = parseFloat(bt.nominalKg)
      }
      return updated
    }))
  }

  // ── KG line actions ───────────────────────────────────────────────────────
  function addKgLine() {
    setKgLines(prev => [...prev, { id: _nid++, lotId: '', kgQty: 0, pricePerKg: 0 }])
  }
  function removeKgLine(id: number) {
    if (kgLines.length === 1) return
    setKgLines(prev => prev.filter(l => l.id !== id))
  }
  function updateKgLine(id: number, field: keyof KgLine, val: string | number) {
    setKgLines(prev => prev.map(l => l.id !== id ? l : { ...l, [field]: val }))
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  // BUG FIX: every guard below used to `return` silently — a click on a
  // disabled/blocked button (or one whose validation failed) produced zero
  // feedback, which read as "the button does nothing". Guards now surface
  // via toast, and createOrder.mutate() now has an onError handler so a
  // backend rejection is shown too, instead of vanishing silently.
  // `navTo` is the only thing that differs between the three submit buttons —
  // the backend has exactly one order-creation outcome (status always
  // 'draft', see ClientOrder.status @default(draft) — there is no
  // client-settable status field), so "Save as draft" and "Confirm order"
  // create an identical order; they only differ in where you land afterward.
  function submitOrder(navTo: 'detail' | 'list') {
    if (!selectedClient) { showToast('Select a client first'); return }
    // Guard runs before createOrder.mutate() in both branches below — a
    // multi-line order can never reach the backend. See multiLineBlocked's
    // doc comment above for why.
    if (multiLineBlocked) { showToast(multiLineMessage); return }
    // Required-location audit, 2026-09 — UX-only mirror of the backend's
    // authoritative rule (OrdersService.create()): once a client is enabled
    // for multiple locations, every NEW order must pick one of its active
    // locations. Never shown/enforced for a single-location client.
    if (locationRequiredBlocked) { showToast(locationRequiredMessage); return }

    if (orderMode === 'bag') {
      const lines = bagLines.filter(l => l.bagTypeId && l.qty > 0)
      if (lines.length === 0) { showToast('Add at least one bag line with a bag type and quantity'); return }
      const firstLine = bagLines.find(l => l.qty > 0) ?? bagLines[0]
      createOrder.mutate(
        {
          clientId: selectedClient.id,
          charcoalType: 'BBQ Hardwood',
          grade: 'A',
          totalKgRequested: bagTotalKg.toFixed(2),
          bagTypeId: firstLine.bagTypeId || null,
          pricePerBag: (firstLine.price || 0).toFixed(2),
          currency: selectedClient.currency as any,
          notes: notes || null,
          ...(driverId ? { driverId } : {}),
          ...(locationId ? { locationId } : {}),
        },
        {
          onSuccess: (created) => navigate(navTo === 'detail' ? '/orders/' + created.id : '/orders'),
          onError: (err: any) => showToast(err?.error ?? 'Failed to create order'),
        },
      )
    } else {
      const lines = kgLines.filter(l => l.lotId && l.kgQty > 0)
      if (lines.length === 0) { showToast('Add at least one charcoal lot with a quantity'); return }
      const firstLot = stockLots.find(s => s.id === lines[0].lotId)
      createOrder.mutate(
        {
          clientId: selectedClient.id,
          charcoalType: firstLot?.charcoalType ?? 'BBQ Hardwood',
          grade: firstLot?.grade ?? 'A',
          totalKgRequested: kgTotalKg.toFixed(2),
          pricePerBag: lines[0].pricePerKg.toFixed(2),
          currency: selectedClient.currency as any,
          notes: notes || null,
          ...(driverId ? { driverId } : {}),
          ...(locationId ? { locationId } : {}),
          ...(firstLot?.supplier?.name ? { supplierName: firstLot.supplier.name } : {}),
        },
        {
          onSuccess: (created) => navigate(navTo === 'detail' ? '/orders/' + created.id : '/orders'),
          onError: (err: any) => showToast(err?.error ?? 'Failed to create order'),
        },
      )
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Topbar title="New order">
        <span className="badge badge-gray" style={{ marginLeft: 4 }}>draft</span>
        <button className="btn" onClick={() => navigate('/orders')} style={{ marginLeft: 'auto' }}>Cancel</button>
        <button className="btn" onClick={() => submitOrder('list')} disabled={createOrder.isPending || locationRequiredBlocked} title={!selectedClient ? 'Select a client first' : multiLineBlocked ? multiLineMessage : locationRequiredBlocked ? locationRequiredMessage : undefined}>
          Save draft
        </button>
        <button className="btn primary" onClick={() => submitOrder('detail')} disabled={createOrder.isPending || locationRequiredBlocked} title={!selectedClient ? 'Select a client first' : multiLineBlocked ? multiLineMessage : locationRequiredBlocked ? locationRequiredMessage : undefined}>
          <i className="ti ti-check" style={{ fontSize: 15 }} /> {createOrder.isPending ? 'Creating…' : 'Confirm order'}
        </button>
      </Topbar>

      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14, alignItems: 'start' }}>

          {/* ── LEFT ────────────────────────────────────────────────────── */}
          <div className="stack">

            {/* Client */}
            <div className="form-card">
              <div className="form-card-head">client</div>
              <div className="grid-2c">

                {/* Search input */}
                <div className="field" ref={clientRef} style={{ position: 'relative' }}>
                  <label className="field-label">Client</label>
                  {selectedClient ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{
                        flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', background: 'var(--surface2)',
                        fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span style={{ fontWeight: 500 }}>{selectedClient.name}</span>
                        {parseFloat(selectedClient.balance) > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                            ${parseFloat(selectedClient.balance).toFixed(0)} bal
                          </span>
                        )}
                      </div>
                      <button
                        className="btn"
                        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        onClick={() => { setSelectedClient(null); setClientSearch('') }}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        className="input"
                        value={clientSearch}
                        onChange={e => { setClientSearch(e.target.value); setShowClientDrop(true) }}
                        onFocus={() => setShowClientDrop(true)}
                        placeholder="Search by name…"
                        autoComplete="off"
                      />
                      {showClientDrop && (clientsQ.isLoading || clients.length > 0) && (
                        <div style={{
                          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 200,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,.12)',
                          maxHeight: 220, overflowY: 'auto',
                        }}>
                          {clientsQ.isLoading && (
                            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>Loading…</div>
                          )}
                          {clients.map(c => (
                            <div
                              key={c.id}
                              onMouseDown={e => {
                                e.preventDefault()
                                setSelectedClient(c)
                                setClientSearch('')
                                setShowClientDrop(false)
                              }}
                              style={{
                                padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                borderBottom: '1px solid var(--border)',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                              onMouseLeave={e => (e.currentTarget.style.background = '')}
                            >
                              <span>{c.name}</span>
                              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                                {c.type}
                                {parseFloat(c.balance) > 0 && ` · $${parseFloat(c.balance).toFixed(0)}`}
                              </span>
                            </div>
                          ))}
                          {!clientsQ.isLoading && clients.length === 0 && (
                            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>No clients found</div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="field">
                  <label className="field-label">Currency (from client)</label>
                  <input
                    className="input"
                    style={{ fontFamily: "'IBM Plex Mono',monospace" }}
                    value={selectedClient?.currency ?? '—'}
                    readOnly
                  />
                </div>
              </div>

              <div className="grid-2c" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="field-label">Order date</label>
                  <input className="input" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Order lines */}
            <div className="form-card">
              <div className="form-card-head">
                <span>order lines · price set at time of sale</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {selectedClient ? `${selectedClient.currency}` : 'USD'}
                </span>
              </div>

              {/* Mode switch */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: 'inline-flex', gap: 3, padding: 3,
                  background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)',
                }}>
                  {(['bag', 'kg'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setOrderMode(mode)}
                      style={{
                        padding: '5px 18px', borderRadius: 6, border: 'none',
                        cursor: 'pointer', fontSize: 13, fontWeight: 500,
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: orderMode === mode ? 'var(--surface)' : 'transparent',
                        color: orderMode === mode ? 'var(--text)' : 'var(--text3)',
                        boxShadow: orderMode === mode ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                        transition: 'all 0.15s',
                      }}
                    >
                      <i className={`ti ${mode === 'bag' ? 'ti-shopping-bag' : 'ti-weight'}`} style={{ fontSize: 13 }} />
                      {mode === 'bag' ? 'Bag' : 'KG'}
                    </button>
                  ))}
                </div>
                <span style={{ marginLeft: 10, fontSize: 11.5, color: 'var(--text3)' }}>
                  {orderMode === 'bag'
                    ? 'Select packed bag types to deliver'
                    : 'Sell raw charcoal by weight — pick a lot to prefill type, grade, price & supplier'}
                </span>
              </div>

              {/* ── BAG MODE ─────────────────────────────────────────── */}
              {orderMode === 'bag' && (
                <>
                  {bagLines.map(l => (
                    <div className="line-row" key={l.id}>
                      <div>
                        <span className="lbl">Bag type</span>
                        <select value={l.bagTypeId} onChange={e => updateBagLine(l.id, 'bagTypeId', e.target.value)}>
                          <option value="">Select bag type…</option>
                          {bagTypes.map(b => {
                            const avail = availableByBagType.get(b.id) ?? 0
                            return <option key={b.id} value={b.id}>{b.name} — {avail} available</option>
                          })}
                        </select>
                      </div>
                      <div>
                        <span className="lbl">Quantity</span>
                        <input className="num" type="number" min="0" value={l.qty || ''} onChange={e => updateBagLine(l.id, 'qty', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div>
                        <span className="lbl">Nom. kg</span>
                        <input className="num" value={(l.qty * l.kgPerBag).toFixed(0)} readOnly style={{ color: 'var(--text3)', background: 'var(--surface2)' }} />
                      </div>
                      <div>
                        <span className="lbl">Price / bag</span>
                        <input className="num" type="number" min="0" step="0.05" value={l.price || ''} onChange={e => updateBagLine(l.id, 'price', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div>
                        <span className="lbl">Line total</span>
                        <div className="line-total">${roundDp(l.qty * l.price).toFixed(2)}</div>
                      </div>
                      <button className="line-del" aria-label="Remove line" onClick={() => removeBagLine(l.id)} disabled={bagLines.length === 1}>
                        <i className="ti ti-x" style={{ fontSize: 13 }} />
                      </button>
                    </div>
                  ))}
                  <button className="add-line" onClick={addBagLine}>
                    <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add bag type
                  </button>
                </>
              )}

              {/* ── KG MODE ──────────────────────────────────────────── */}
              {orderMode === 'kg' && (
                <>
                  {kgLines.map(l => {
                    return (
                      <div
                        key={l.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '2.2fr 1fr 1fr 1fr auto',
                          gap: 10, alignItems: 'end',
                          paddingTop: 12, paddingBottom: 12,
                          borderTop: '1px solid var(--border)',
                        }}
                      >
                        <div>
                          <span className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                            Charcoal lot
                          </span>
                          <select
                            style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, background: 'var(--surface)', outline: 'none', fontFamily: "'IBM Plex Sans',sans-serif" }}
                            value={l.lotId}
                            onChange={e => updateKgLine(l.id, 'lotId', e.target.value)}
                          >
                            <option value="">Select charcoal lot…</option>
                            {stockLots.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.charcoalType} {s.grade} · {s.supplier?.name ?? '—'} ({parseFloat(s.kgRemaining).toFixed(0)} kg)
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <span className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                            Qty (kg)
                          </span>
                          <input
                            style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, background: 'var(--surface)', outline: 'none', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}
                            type="number" min="0" step="0.5"
                            value={l.kgQty || ''}
                            onChange={e => updateKgLine(l.id, 'kgQty', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div>
                          <span className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                            Price / kg
                          </span>
                          <input
                            style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, background: 'var(--surface)', outline: 'none', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}
                            type="number" min="0" step="0.01"
                            value={l.pricePerKg || ''}
                            onChange={e => updateKgLine(l.id, 'pricePerKg', parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div>
                          <span className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                            Line total
                          </span>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600, textAlign: 'right', padding: '9px 0' }}>
                            ${roundDp(l.kgQty * l.pricePerKg).toFixed(2)}
                          </div>
                        </div>
                        <button
                          aria-label="Remove line"
                          style={{ width: 32, height: 36, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexShrink: 0, marginBottom: 0 }}
                          onClick={() => removeKgLine(l.id)}
                          disabled={kgLines.length === 1}
                        >
                          <i className="ti ti-x" style={{ fontSize: 13 }} />
                        </button>
                      </div>
                    )
                  })}
                  <button className="add-line" onClick={addKgLine} style={{ marginTop: 4 }}>
                    <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add charcoal type
                  </button>
                </>
              )}
            </div>

            {/* Delivery */}
            <div className="form-card">
              <div className="form-card-head">delivery</div>
              {/* Multiple-locations audit, 2026-08-31 — only shown for a
                  client actually enabled for multiple locations with at
                  least one active branch. A normal single-location client's
                  form stays exactly as it was. Required-location audit,
                  2026-09 — once shown, a location must actually be picked;
                  "— Not specified —" is no longer a valid resting choice
                  (see locationRequiredBlocked). */}
              {showLocationSelector && (
                <div className="field">
                  <label className="field-label">Location *</label>
                  <select className="select" value={locationId} onChange={e => setLocationId(e.target.value)}>
                    <option value="">Select a location…</option>
                    {activeLocations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label">Driver</label>
                <select className="select" value={driverId} onChange={e => setDriverId(e.target.value)}>
                  <option value="">— Assign later —</option>
                  {driverList.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="field-label">Notes (Arabic supported)</label>
                <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. deliver before 11am" />
              </div>
            </div>

          </div>

          {/* ── RIGHT — sticky summary ───────────────────────────────────── */}
          <div className="summary">
            <div className="sum-head">
              <span>Order preview</span>
              <span style={{ color: 'var(--text3)' }}>
                {orderMode === 'bag' ? `${bagTotalBags} bags` : `${kgTotalKg.toFixed(0)} kg`}
              </span>
            </div>
            <div className="sum-body">
              {selectedClient ? (
                <div className="client-card-mini">
                  <div className="cm-av">
                    {selectedClient.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                  </div>
                  <div className="cm-info">
                    <div className="cm-name">{selectedClient.name}</div>
                    <div className="cm-meta">{selectedClient.paymentTerms ?? selectedClient.type ?? ''}</div>
                  </div>
                  {parseFloat(selectedClient.balance) > 0 && (
                    <div className="cm-bal">${parseFloat(selectedClient.balance).toFixed(0)} bal</div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '12px 0', color: 'var(--text3)', fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
                  No client selected
                </div>
              )}

              <div className="sum-row">
                <span className="lbl">Mode</span>
                <span className="val" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                  {orderMode === 'bag' ? 'Bag order' : 'KG order'}
                </span>
              </div>
              {orderMode === 'bag' && bagLines.some(l => l.bagTypeId && l.qty > 0) && (
                <div style={{ margin: '8px 0', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {bagLines.filter(l => l.bagTypeId && l.qty > 0).map(l => {
                    const bt = bagTypes.find(b => b.id === l.bagTypeId)
                    return (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: 'var(--text2)' }}>
                        <span style={{ flex: 1 }}>{bt?.name ?? l.bagTypeId}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", marginLeft: 8 }}>
                          {l.qty} bags · {(l.qty * l.kgPerBag).toFixed(0)} kg
                        </span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", marginLeft: 12, fontWeight: 600, color: 'var(--text)' }}>
                          ${roundDp(l.qty * l.price).toFixed(2)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="sum-row">
                <span className="lbl">Total bags</span>
                <span className="val">{bagTotalBags} bags</span>
              </div>
              <div className="sum-row">
                <span className="lbl">Nominal kg</span>
                <span className="val">{totalKg.toFixed(0)} kg</span>
              </div>
              <div className="sum-row">
                <span className="lbl">Subtotal</span>
                <span className="val">${subtotal.toFixed(2)}</span>
              </div>
              <div className="sum-row big">
                <span className="lbl">Est. total</span>
                <span className="val">${subtotal.toFixed(2)}</span>
              </div>
            </div>
            {multiLineBlocked && (
              <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 6, background: 'var(--red-bg)', color: 'var(--red)', fontSize: 12, lineHeight: 1.4 }}>
                {multiLineMessage}
              </div>
            )}
            <div className="sum-actions">
              <button className="btn green" onClick={() => submitOrder('detail')} disabled={createOrder.isPending || locationRequiredBlocked} title={!selectedClient ? 'Select a client first' : multiLineBlocked ? multiLineMessage : locationRequiredBlocked ? locationRequiredMessage : undefined}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {createOrder.isPending ? 'Creating…' : 'Confirm order'}
              </button>
              <button className="btn" onClick={() => submitOrder('detail')} disabled={createOrder.isPending || locationRequiredBlocked} title={!selectedClient ? 'Select a client first' : multiLineBlocked ? multiLineMessage : locationRequiredBlocked ? locationRequiredMessage : undefined}>
                Confirm + go to detail
              </button>
              <button className="btn" onClick={() => submitOrder('list')} disabled={createOrder.isPending || locationRequiredBlocked} title={!selectedClient ? 'Select a client first' : multiLineBlocked ? multiLineMessage : locationRequiredBlocked ? locationRequiredMessage : undefined}>
                Save as draft
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-alert-circle" style={{ color: 'var(--red)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
