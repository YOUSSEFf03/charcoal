import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useOrder, useUpdateOrder } from '../hooks/useOrders'
import { useClients, useClient, useClientLocations } from '../hooks/useClients'
import { useBagTypes } from '../hooks/useBagTypes'
import { usePackedStockSummary, useAvailableStockLots } from '../hooks/useWarehouse'
import { useUsers } from '../hooks/useUsers'
import type { Client, OrderStatus, UpdateOrderDto } from '../types/api'
import { roundDp } from '../lib/money'
import { formatDate } from '../lib/date'

// Mirrors OrderDetail.tsx's orderStatusMeta() — small enough that extracting
// a shared module isn't worth the indirection for one switch statement used
// in two places.
function orderStatusMeta(s: OrderStatus): { cls: string; label: string } {
  switch (s) {
    case 'draft': return { cls: 'badge-gray', label: 'Draft' }
    case 'confirmed': return { cls: 'badge-amber', label: 'Confirmed' }
    case 'partially_delivered': return { cls: 'badge-amber', label: 'Partially delivered' }
    case 'delivered': return { cls: 'badge-green', label: 'Delivered' }
    case 'invoiced': return { cls: 'badge-amber', label: 'Invoiced' }
    case 'paid': return { cls: 'badge-green', label: 'Paid' }
    default: return { cls: 'badge-gray', label: s }
  }
}

/**
 * Edit an existing order — deliberately built as the editing counterpart of
 * NewOrder.tsx (same cards/layout/preview), NOT a rebuild of the old
 * generic modal. Two real differences from NewOrder, both forced by the
 * actual data model rather than chosen for convenience:
 *
 * 1. ONE line only, never an "add another line" control. CreateOrderDto/
 *    UpdateOrderDto have exactly one bagTypeId/pricePerBag/totalKgRequested
 *    per order — no line-array field exists on the backend (see NewOrder.tsx's
 *    own multiLineBlocked guard). An existing order already has its one line;
 *    there is nothing to add to it.
 * 2. KG mode's "Charcoal lot" selector mirrors NewOrder's KG-mode lot picker
 *    (same option format — "type grade · supplier (kg remaining)" — and
 *    picking one auto-fills charcoalType/grade/supplierName the same way),
 *    but it cannot be a locked record of "the lot this order came from":
 *    ClientOrder has no stockLotId anywhere in the schema, and a KG order
 *    doesn't even deduct stock from a lot on delivery (see OrdersService.
 *    markDelivered()'s "nothing to deduct" branch). So this is a convenience
 *    selector over CURRENT stock that writes the same real, persisted fields
 *    NewOrder's picker does (charcoalType/grade/supplierName) — not a
 *    fabricated lot relationship. Charcoal type/Grade/Supplier are not shown
 *    at all in BAG mode — not needed there; their existing values are still
 *    submitted unchanged.
 *
 * Editability mirrors OrdersService.update() exactly: clientId/currency/
 * bagTypeId/totalKgRequested/pricePerBag are only writable while the order
 * is still 'draft' (its lockedFields guard rejects the KEY being present at
 * all on a non-draft order, even unchanged) — those fields render disabled
 * with a "Locked after leaving draft" caption once status !== 'draft', and
 * are omitted from the PATCH body entirely rather than merely disabled in
 * the UI. charcoalType/grade/supplierName/notes/driverId have no such guard
 * in the service and stay editable in every status.
 */
export default function EditOrder() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const orderQ = useOrder(id ?? '')
  const updateOrder = useUpdateOrder()
  const bagTypesQ = useBagTypes()
  const packedQ = usePackedStockSummary()
  const driversQ = useUsers({ role: 'driver' })
  // Real stock lots for the KG-mode "Charcoal lot" picker — same source and
  // option format as NewOrder.tsx's own KG-mode lot picker. useAvailableStockLots()
  // (also used by WarehouseSales.tsx) is preferred over useStockLots({hasStock:true,
  // limit:100}) specifically because it's unbounded — it can't hide an older,
  // still-in-stock lot behind a 100-row page cap.
  const stockLotsQ = useAvailableStockLots()

  const order = orderQ.data
  const isDraft = order?.status === 'draft'
  const bagTypes = bagTypesQ.data ?? []
  const packedSummary = packedQ.data ?? []
  const driverList = driversQ.data?.data ?? []
  const availableByBagType = new Map(packedSummary.map(p => [p.bagTypeId, p.totalBags]))
  const stockLots = stockLotsQ.data ?? []

  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  // ── Client (draft-editable via the same search UI as New Order; locked
  // display otherwise) ────────────────────────────────────────────────────
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const clientRef = useRef<HTMLDivElement>(null)
  const clientsQ = useClients({ search: clientSearch || undefined, limit: 20 })
  const clients = clientsQ.data?.data ?? []
  // Full Client record (currency/balance/paymentTerms) for the order's
  // CURRENT client — order.client from useOrder() is a narrow Pick<>.
  const currentClientQ = useClient(order?.clientId ?? '')
  // Multiple-locations audit, 2026-08-31 — locations belong to whichever
  // client the order is CURRENTLY for (selectedClient, which tracks
  // clientId changes while draft — see the client-picker section below).
  const locationsQ = useClientLocations(selectedClient?.id ?? '')
  const activeLocations = (locationsQ.data ?? []).filter(l => l.isActive)
  const showLocationSelector = !!selectedClient?.multiLocationEnabled && activeLocations.length > 0

  // ── Order-level fields, editable in any status ─────────────────────────
  const [charcoalType, setCharcoalType] = useState('')
  const [grade, setGrade] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [driverId, setDriverId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [notes, setNotes] = useState('')

  // ── The one line — bag or kg, only meaningful/editable while draft ─────
  const [orderMode, setOrderMode] = useState<'bag' | 'kg'>('bag')
  const [bagTypeId, setBagTypeId] = useState('')
  const [qty, setQty] = useState(0)
  const [kgPerBag, setKgPerBag] = useState(0)
  const [price, setPrice] = useState(0)
  const [kgQty, setKgQty] = useState(0)

  // Seed local state exactly once when the order first loads — a later
  // background refetch (e.g. after this same mutation succeeds) must never
  // stomp in-progress edits.
  const seededRef = useRef(false)
  useEffect(() => {
    if (!order || seededRef.current) return
    seededRef.current = true
    setCharcoalType(order.charcoalType)
    setGrade(order.grade)
    setSupplierName(order.supplierName ?? '')
    setDriverId(order.driverId ?? '')
    setLocationId(order.locationId ?? '')
    setNotes(order.notes ?? '')
    if (order.bagTypeId && order.bagType) {
      setOrderMode('bag')
      setBagTypeId(order.bagTypeId)
      setKgPerBag(parseFloat(order.bagType.nominalKg))
      setQty(Math.round(parseFloat(order.totalKgRequested) / parseFloat(order.bagType.nominalKg)))
      setPrice(parseFloat(order.pricePerBag))
    } else {
      setOrderMode('kg')
      setKgQty(parseFloat(order.totalKgRequested))
      setPrice(parseFloat(order.pricePerBag))
    }
  }, [order])

  useEffect(() => {
    if (currentClientQ.data && !selectedClient) {
      setSelectedClient(currentClientQ.data)
    }
  }, [currentClientQ.data])

  // Close client dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (clientRef.current && !clientRef.current.contains(e.target as Node)) {
        setShowClientDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function updateBagTypeId(val: string) {
    setBagTypeId(val)
    const bt = bagTypes.find(b => b.id === val)
    if (bt) setKgPerBag(parseFloat(bt.nominalKg))
  }

  // ── Summaries — same formulas as New Order, single line ────────────────
  const lineTotal = orderMode === 'bag' ? roundDp(qty * price) : roundDp(kgQty * price)
  const totalKg = orderMode === 'bag' ? qty * kgPerBag : kgQty
  const totalBags = orderMode === 'bag' ? qty : 0
  const subtotal = lineTotal

  // The KG line's "Charcoal lot" selector — matches the order's current
  // (charcoalType, grade, supplierName) against a real, currently-available
  // lot when one exists (same charcoalType/grade and same supplier name);
  // otherwise the current combo is ALWAYS still offered as its own option,
  // never silently swapped for something else once a match can't be found.
  const kgMatchedLot = stockLots.find(
    l => l.charcoalType === charcoalType && l.grade === grade && (l.supplier?.name ?? '') === supplierName,
  )
  const kgLotIsLegacy = charcoalType !== '' && !kgMatchedLot
  const kgLotValue = kgMatchedLot ? kgMatchedLot.id : (charcoalType ? '__legacy__' : '')

  function updateKgLot(lotId: string) {
    if (lotId === '') {
      setCharcoalType('')
      setGrade('')
      setSupplierName('')
      return
    }
    if (lotId === '__legacy__') return // already reflects the current combo — no-op
    const lot = stockLots.find(l => l.id === lotId)
    if (!lot) return
    setCharcoalType(lot.charcoalType)
    setGrade(lot.grade)
    setSupplierName(lot.supplier?.name ?? '')
  }

  if (orderQ.isLoading || !order) {
    return (
      <>
        <Topbar title="Edit order" />
        <div className="content">
          <div className="skeleton" style={{ width: '40%', height: 28, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 240 }} />
        </div>
      </>
    )
  }
  if (orderQ.isError) {
    return (
      <>
        <Topbar title="Edit order" />
        <div className="content">
          <div className="empty">
            Failed to load order.
            <div><button className="btn" style={{ marginTop: 10 }} onClick={() => orderQ.refetch()}>Retry</button></div>
          </div>
        </div>
      </>
    )
  }

  const orderDisplay = order.displayId ?? `#${order.id.slice(0, 8).toUpperCase()}`
  const statusMeta = orderStatusMeta(order.status)

  function submitEdit() {
    if (!order) return
    if (isDraft && !selectedClient) { showToast('Select a client first'); return }
    if (!charcoalType.trim()) { showToast('Charcoal type is required'); return }
    if (!grade.trim()) { showToast('Grade is required'); return }
    if (isDraft && orderMode === 'bag' && (!bagTypeId || qty <= 0)) {
      showToast('Select a bag type and quantity'); return
    }
    if (isDraft && orderMode === 'kg' && kgQty <= 0) {
      showToast('Enter a kg quantity'); return
    }

    const body: UpdateOrderDto = {
      charcoalType: charcoalType.trim(),
      grade: grade.trim(),
      supplierName: supplierName.trim() || null,
      driverId: driverId || null,
      locationId: locationId || null,
      notes: notes || null,
      // Financially/relationally significant fields are only ever included
      // when the order is still draft — OrdersService.update() rejects the
      // KEY being present at all on a non-draft order, even unchanged.
      ...(isDraft ? {
        clientId: selectedClient!.id,
        currency: selectedClient!.currency,
        bagTypeId: orderMode === 'bag' ? bagTypeId : null,
        totalKgRequested: (orderMode === 'bag' ? qty * kgPerBag : kgQty).toFixed(2),
        pricePerBag: price.toFixed(2),
      } : {}),
    }

    updateOrder.mutate(
      { id: order.id, body },
      {
        onSuccess: () => navigate(`/orders/${order.id}`),
        onError: (err: any) => showToast(err?.error ?? 'Failed to update order'),
      },
    )
  }

  return (
    <>
      <Topbar title={`Edit ${orderDisplay}`}>
        <span className={`badge ${statusMeta.cls}`} style={{ marginLeft: 4 }}>{order.status}</span>
        <button className="btn" onClick={() => navigate(`/orders/${order.id}`)} style={{ marginLeft: 'auto' }}>Cancel</button>
        <button className="btn primary" onClick={submitEdit} disabled={updateOrder.isPending}>
          <i className="ti ti-check" style={{ fontSize: 15 }} /> {updateOrder.isPending ? 'Saving…' : 'Save changes'}
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
                <div className="field" ref={clientRef} style={{ position: 'relative' }}>
                  <label className="field-label">Client</label>
                  {!isDraft ? (
                    <div style={{
                      padding: '8px 12px', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', background: 'var(--surface2)',
                      fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <span style={{ fontWeight: 500 }}>{order.client.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }} title="Locked after leaving draft">
                        <i className="ti ti-lock" style={{ fontSize: 11 }} /> Locked
                      </span>
                    </div>
                  ) : selectedClient ? (
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
                                // A location belongs to ONE specific client —
                                // switching clients invalidates any previous pick.
                                setLocationId('')
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
                  <label className="field-label" htmlFor="edit-order-currency">Currency (from client)</label>
                  <input
                    id="edit-order-currency"
                    className="input"
                    style={{ fontFamily: "'IBM Plex Mono',monospace" }}
                    value={(isDraft ? selectedClient?.currency : order.currency) ?? '—'}
                    readOnly
                  />
                </div>
              </div>

              <div className="grid-2c" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="field-label" htmlFor="edit-order-date">Order date</label>
                  <input
                    id="edit-order-date"
                    className="input"
                    value={formatDate(order.createdAt)}
                    readOnly
                    title="Order date is set at creation and cannot be changed"
                  />
                </div>
              </div>
            </div>

            {/* Order line */}
            <div className="form-card">
              <div className="form-card-head">
                <span>order line · price set at time of sale</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {isDraft ? selectedClient?.currency ?? order.currency : order.currency}
                </span>
              </div>

              {/* Mode switch — locked once the order has left draft */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: 'inline-flex', gap: 3, padding: 3,
                  background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)',
                }}>
                  {(['bag', 'kg'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => isDraft && setOrderMode(mode)}
                      disabled={!isDraft}
                      style={{
                        padding: '5px 18px', borderRadius: 6, border: 'none',
                        cursor: isDraft ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 500,
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
                {!isDraft && (
                  <span style={{ marginLeft: 10, fontSize: 11.5, color: 'var(--text3)' }}>
                    <i className="ti ti-lock" style={{ fontSize: 11 }} /> Locked after leaving draft — bag type, quantity, and price can no longer change.
                  </span>
                )}
              </div>

              {/* ── BAG MODE ─────────────────────────────────────────── */}
              {orderMode === 'bag' && (
                <>
                  <div className="line-row">
                    <div>
                      <label className="lbl" htmlFor="edit-order-bag-type">Bag type</label>
                      <select id="edit-order-bag-type" value={bagTypeId} onChange={e => updateBagTypeId(e.target.value)} disabled={!isDraft}>
                        <option value="">Select bag type…</option>
                        {bagTypes.map(b => {
                          const avail = availableByBagType.get(b.id) ?? 0
                          return <option key={b.id} value={b.id}>{b.name} — {avail} available</option>
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="lbl" htmlFor="edit-order-qty">Quantity</label>
                      <input id="edit-order-qty" className="num" type="number" min="0" value={qty || ''} onChange={e => setQty(parseFloat(e.target.value) || 0)} disabled={!isDraft} />
                    </div>
                    <div>
                      <span className="lbl">Nom. kg</span>
                      <input className="num" value={(qty * kgPerBag).toFixed(0)} readOnly style={{ color: 'var(--text3)', background: 'var(--surface2)' }} />
                    </div>
                    <div>
                      <label className="lbl" htmlFor="edit-order-price">Price / bag</label>
                      <input id="edit-order-price" className="num" type="number" min="0" step="0.05" value={price || ''} onChange={e => setPrice(parseFloat(e.target.value) || 0)} disabled={!isDraft} />
                    </div>
                    <div>
                      <span className="lbl">Line total</span>
                      <div className="line-total">${roundDp(qty * price).toFixed(2)}</div>
                    </div>
                  </div>
                  {/* Charcoal type / grade / supplier intentionally not shown for bag
                      orders — not needed in this edit view. Their existing values (seeded
                      from the order on load) are still submitted unchanged; there's just
                      no UI to edit them here. */}
                </>
              )}

              {/* ── KG MODE ──────────────────────────────────────────── */}
              {orderMode === 'kg' && (
                <>
                  {/* Charcoal lot — same option format as New Order's KG-mode lot
                      picker ("type grade · supplier (kg remaining)"), and selecting
                      one auto-fills charcoalType/grade/supplierName exactly like New
                      Order does at creation. It still isn't a persisted relationship:
                      ClientOrder has no stockLotId (a KG order doesn't even deduct
                      stock from a lot on delivery — see OrdersService.markDelivered()'s
                      "nothing to deduct" branch), so there's no lot identity to lock or
                      reconstruct — this dropdown is a convenience over current stock,
                      not a record of which lot the order actually came from. */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2.2fr 1fr 1fr 1fr',
                      gap: 10, alignItems: 'end',
                      paddingTop: 12, paddingBottom: 12,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <label htmlFor="edit-order-charcoal-lot" className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                        Charcoal lot
                      </label>
                      <select
                        id="edit-order-charcoal-lot"
                        style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, background: 'var(--surface)', outline: 'none', fontFamily: "'IBM Plex Sans',sans-serif" }}
                        value={kgLotValue}
                        onChange={e => updateKgLot(e.target.value)}
                      >
                        <option value="">Select charcoal lot…</option>
                        {kgLotIsLegacy && (
                          <option value="__legacy__">
                            {charcoalType} {grade} · {supplierName || '—'} (not currently in stock)
                          </option>
                        )}
                        {stockLots.map(lot => (
                          <option key={lot.id} value={lot.id}>
                            {lot.charcoalType} {lot.grade} · {lot.supplier?.name ?? '—'} ({parseFloat(lot.kgRemaining).toFixed(0)} kg)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="edit-order-kg-qty" className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                        Qty (kg)
                      </label>
                      <input
                        id="edit-order-kg-qty"
                        style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, background: isDraft ? 'var(--surface)' : 'var(--surface2)', outline: 'none', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}
                        type="number" min="0" step="0.5"
                        value={kgQty || ''}
                        onChange={e => setKgQty(parseFloat(e.target.value) || 0)}
                        disabled={!isDraft}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-order-kg-price" className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                        Price / kg
                      </label>
                      <input
                        id="edit-order-kg-price"
                        style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, background: isDraft ? 'var(--surface)' : 'var(--surface2)', outline: 'none', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}
                        type="number" min="0" step="0.01"
                        value={price || ''}
                        onChange={e => setPrice(parseFloat(e.target.value) || 0)}
                        disabled={!isDraft}
                      />
                    </div>
                    <div>
                      <span className="lbl" style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
                        Line total
                      </span>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600, textAlign: 'right', padding: '9px 0', minWidth: 90 }}>
                        ${roundDp(kgQty * price).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {kgLotIsLegacy && (
                    <div style={{ marginTop: 4, marginBottom: 8, fontSize: 11.5, color: 'var(--text3)' }}>
                      <i className="ti ti-alert-triangle" style={{ fontSize: 11 }} /> This order's charcoal type/grade/supplier isn't a current stock lot — kept as-is rather than replaced. Choose another option only if you mean to change it.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Delivery */}
            <div className="form-card">
              <div className="form-card-head">delivery</div>
              {/* Multiple-locations audit, 2026-08-31 — same gating as New
                  Order: only shown for a client actually enabled for
                  multiple locations with at least one active branch. */}
              {showLocationSelector && (
                <div className="field">
                  <label className="field-label" htmlFor="edit-order-location">Location</label>
                  <select id="edit-order-location" className="select" value={locationId} onChange={e => setLocationId(e.target.value)}>
                    <option value="">— Not specified —</option>
                    {activeLocations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label" htmlFor="edit-order-driver">Driver</label>
                <select id="edit-order-driver" className="select" value={driverId} onChange={e => setDriverId(e.target.value)}>
                  <option value="">— Assign later —</option>
                  {driverList.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="field-label" htmlFor="edit-order-notes">Notes (Arabic supported)</label>
                <textarea id="edit-order-notes" className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. deliver before 11am" />
              </div>
            </div>

          </div>

          {/* ── RIGHT — sticky summary ───────────────────────────────────── */}
          <div className="summary">
            <div className="sum-head">
              <span>Order preview</span>
              <span style={{ color: 'var(--text3)' }}>
                {orderMode === 'bag' ? `${totalBags} bags` : `${kgQty.toFixed(0)} kg`}
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
                <div className="client-card-mini">
                  <div className="cm-av">
                    {order.client.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                  </div>
                  <div className="cm-info">
                    <div className="cm-name">{order.client.name}</div>
                  </div>
                </div>
              )}

              <div className="sum-row">
                <span className="lbl">Mode</span>
                <span className="val" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                  {orderMode === 'bag' ? 'Bag order' : 'KG order'}
                </span>
              </div>
              {orderMode === 'bag' && bagTypeId && qty > 0 && (
                <div style={{ margin: '8px 0', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: 'var(--text2)' }}>
                    <span style={{ flex: 1 }}>{bagTypes.find(b => b.id === bagTypeId)?.name ?? order.bagType?.name}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", marginLeft: 8 }}>
                      {qty} bags · {(qty * kgPerBag).toFixed(0)} kg
                    </span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", marginLeft: 12, fontWeight: 600, color: 'var(--text)' }}>
                      ${roundDp(qty * price).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              <div className="sum-row">
                <span className="lbl">Total bags</span>
                <span className="val">{totalBags} bags</span>
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
            <div className="sum-actions">
              <button className="btn green" onClick={submitEdit} disabled={updateOrder.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {updateOrder.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button className="btn" onClick={() => navigate(`/orders/${order.id}`)} disabled={updateOrder.isPending}>
                Cancel
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
