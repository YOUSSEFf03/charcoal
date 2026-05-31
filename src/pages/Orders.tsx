import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useOrders, useCreateOrder } from '../hooks/useOrders'
import { useClients } from '../hooks/useClients'
import { useCreateShipment, useConfirmDelivery, useLogReturn, useLogActualWeight } from '../hooks/useShipments'
import type { OrderStatus, ClientOrder } from '../types/api'

// Map an order status enum to a badge colour + display label.
function orderStatusMeta(s: OrderStatus): { badge: string; label: string; stripe: string } {
  switch (s) {
    case 'draft': return { badge: 'badge-gray', label: 'Draft', stripe: 'var(--text3)' }
    case 'confirmed': return { badge: 'badge-amber', label: 'Confirmed', stripe: 'var(--accent2)' }
    case 'partially_delivered': return { badge: 'badge-blue', label: 'In delivery', stripe: 'var(--blue)' }
    case 'delivered': return { badge: 'badge-green', label: 'Delivered', stripe: 'var(--accent)' }
    case 'invoiced': return { badge: 'badge-amber', label: 'Invoiced', stripe: 'var(--accent2)' }
    case 'paid': return { badge: 'badge-green', label: 'Paid', stripe: 'var(--accent)' }
    default: return { badge: 'badge-gray', label: s, stripe: 'var(--text3)' }
  }
}

// Map a filter-tab label to the API status param.
function statusParam(label: string): OrderStatus | undefined {
  switch (label) {
    case 'Confirmed': return 'confirmed'
    case 'In delivery': return 'partially_delivered'
    case 'Delivered': return 'delivered'
    case 'Paid': return 'paid'
    default: return undefined
  }
}

function fmtUsd(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'
}

interface Shipment { id: number; addr: string; b2: number; b5: number; b10: number }
interface PanelShipment {
  id: number; num: string; badge: string; status: string; addr: string
  bags: string[]; nom: string; act: string; paid: string; actColor: string; paidColor: string
}

export default function Orders() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'orders' | 'trips'>('orders')
  const [panelOpen, setPanelOpen] = useState(false)
  const [newOrderOpen, setNewOrderOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [expensesOpen, setExpensesOpen] = useState(false)
  const [newTripOpen, setNewTripOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [addShipPanelOpen, setAddShipPanelOpen] = useState(false)
  const [payMethod, setPayMethod] = useState('Cash')
  const [bagCounts, setBagCounts] = useState<Record<number, Record<string, number>>>({})
  const [shipments, setShipments] = useState<Shipment[]>([{ id: 1, addr: '', b2: 0, b5: 0, b10: 0 }])
  const [panelShipments, setPanelShipments] = useState<PanelShipment[]>([
    { id: 1, num: 'Shipment 1', badge: 'badge-green', status: 'Delivered',  addr: 'Hamra, Beirut',      bags: ['80 × 2kg bag', '20 × 5kg bag'], nom: '260 kg', act: '262 kg', paid: '$840 cash', actColor: 'var(--accent)', paidColor: 'var(--accent)' },
    { id: 2, num: 'Shipment 2', badge: 'badge-blue',  status: 'In transit', addr: 'Achrafieh, Beirut',  bags: ['50 × 2kg bag', '10 × 5kg bag'], nom: '150 kg', act: '148 kg', paid: 'pending',   actColor: 'var(--accent)', paidColor: 'var(--text3)' },
    { id: 3, num: 'Shipment 3', badge: 'badge-gray',  status: 'Pending',    addr: 'Jdeideh',            bags: ['120 × 2kg bag'],                nom: '240 kg', act: '—',      paid: '',          actColor: 'var(--text3)',  paidColor: 'var(--text3)' },
  ])
  const [newShipAddr, setNewShipAddr] = useState('')
  const [newShipBag2, setNewShipBag2] = useState(0)
  const [newShipBag5, setNewShipBag5] = useState(0)
  const [newShipBag10, setNewShipBag10] = useState(0)
  const [tripStarted, setTripStarted] = useState(false)
  const [toast, setToast] = useState('')
  const [errClient, setErrClient] = useState(false)
  const [errBags, setErrBags] = useState(false)
  const [selectedClient, setSelectedClient] = useState('Select client…')

  // Filter state
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState('All statuses')

  // Live orders + client name lookup. (Search is applied client-side — the
  // orders list endpoint filters by status only.)
  const ordersQ = useOrders({ status: statusParam(fStatus), limit: 100 })
  const clientsQ = useClients({ limit: 100 })
  const createOrder = useCreateOrder()
  const createShipment = useCreateShipment()
  const confirmDelivery = useConfirmDelivery()
  const logReturn = useLogReturn()
  const logActualWeight = useLogActualWeight()

  const orders = ordersQ.data?.data ?? []
  const orderTotal = ordersQ.data?.total ?? orders.length
  const clientList = clientsQ.data?.data ?? []
  const clientNameById = new Map(clientList.map(c => [c.id, c.name]))

  // Expenses state
  interface ExpRow { id: number; desc: string; amt: string }
  const [expenses, setExpenses] = useState<ExpRow[]>([
    { id: 1, desc: 'Fuel', amt: '' },
    { id: 2, desc: 'Parking', amt: '' },
  ])

  const adj = (shipIdx: number, key: string, delta: number) => {
    setBagCounts(prev => {
      const shipCounts = prev[shipIdx] ?? { '2kg': 0, '5kg': 0, '10kg': 0 }
      return { ...prev, [shipIdx]: { ...shipCounts, [key]: Math.max(0, (shipCounts[key] ?? 0) + delta) } }
    })
  }

  const getBagCount = (shipIdx: number, key: string): number => {
    return bagCounts[shipIdx]?.[key] ?? 0
  }

  function addShipment() {
    setShipments(prev => [...prev, { id: Date.now(), addr: '', b2: 0, b5: 0, b10: 0 }])
  }
  function removeShipment(id: number) {
    setShipments(prev => prev.filter(s => s.id !== id))
  }

  function addExpenseRow() {
    setExpenses(prev => [...prev, { id: Date.now(), desc: '', amt: '' }])
  }
  function removeExpenseRow(id: number) {
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function startTrip() {
    setTripStarted(true)
    showToast('Trip #TRP-0092 started — Ahmad Hassan dispatched')
  }

  function confirmAddShipment() {
    const bags: string[] = []
    if (newShipBag2 > 0) bags.push(`${newShipBag2} × 2kg bag`)
    if (newShipBag5 > 0) bags.push(`${newShipBag5} × 5kg bag`)
    if (newShipBag10 > 0) bags.push(`${newShipBag10} × 10kg bag`)
    const nextNum = panelShipments.length + 1
    setPanelShipments(prev => [...prev, {
      id: Date.now(),
      num: `Shipment ${nextNum}`,
      badge: 'badge-gray',
      status: 'Pending',
      addr: newShipAddr.trim() || '—',
      bags: bags.length > 0 ? bags : ['—'],
      nom: '—', act: '—', paid: '',
      actColor: 'var(--text3)', paidColor: 'var(--text3)',
    }])
    setAddShipPanelOpen(false)
    setNewShipAddr('')
    setNewShipBag2(0); setNewShipBag5(0); setNewShipBag10(0)
    showToast(`Shipment ${nextNum} added to ORD-0284`)
  }

  // Status is filtered server-side; free-text search (client name / order id)
  // is applied client-side over the returned page.
  const filteredOrders = orders.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return o.id.toLowerCase().includes(q) || (clientNameById.get(o.clientId) ?? '').toLowerCase().includes(q)
  })

  // Create-order submit from the in-page modal (full builder lives in NewOrder.tsx).
  function submitNewOrder() {
    const client = clientList.find(c => c.name === selectedClient)
    const hasBags = shipments.some((_, idx) => (['2kg', '5kg', '10kg'] as const).some(k => getBagCount(idx, k) > 0))
    setErrClient(!client)
    setErrBags(!hasBags)
    if (!client || !hasBags) return
    createOrder.mutate(
      {
        clientId: client.id,
        charcoalType: 'BBQ Hardwood',
        grade: 'Grade A',
        totalKgRequested: '0',
        pricePerBag: '0',
        bagLines: [],
      },
      {
        onSuccess: (created) => {
          setNewOrderOpen(false)
          setErrClient(false)
          setErrBags(false)
          setBagCounts({})
          setSelectedClient('Select client…')
          showToast(`Order created`)
          navigate('/orders/' + created.id)
        },
      },
    )
  }

  // Confirm delivery of a shipment from the trip stop action.
  function confirmShipmentDelivery(shipmentId: string, actualKg: string, paymentAmount?: string) {
    confirmDelivery.mutate(
      { id: shipmentId, body: { actualKg, paymentAmount } },
      { onSuccess: () => showToast('Delivery confirmed') },
    )
  }
  void createShipment; void logReturn; void logActualWeight; void confirmShipmentDelivery

  return (
    <>
      <Topbar title="Orders & Delivery">
        <button className="btn" onClick={() => setFilterOpen(true)}><i className="ti ti-filter" style={{ fontSize: 15 }} /> Filter</button>
        <button className="btn primary" onClick={() => setNewOrderOpen(true)}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> New order
        </button>
      </Topbar>

      <div className="tabs">
        <div className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
          <i className="ti ti-file-invoice" style={{ fontSize: 14 }} /> Orders
          <span className="tab-count">{orderTotal}</span>
        </div>
        <div className={`tab ${tab === 'trips' ? 'active' : ''}`} onClick={() => setTab('trips')}>
          <i className="ti ti-truck" style={{ fontSize: 14 }} /> Driver trips
          <span className="tab-count blue">3</span>
        </div>
      </div>

      <div className="content">

        {/* ORDERS TAB */}
        {tab === 'orders' && (
          <div className="fade-up">
            <div className="filters">
              <div className="filter-input">
                <i className="ti ti-search" />
                <input type="text" placeholder="Search client, order ID…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="filter-select" value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option>All statuses</option>
                <option>Confirmed</option>
                <option>In delivery</option>
                <option>Delivered</option>
                <option>Paid</option>
              </select>
              <div className="filter-sep" />
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>{filteredOrders.length} orders</span>
            </div>

            {ordersQ.isLoading && [0, 1, 2].map(i => (
              <div className="order-card" key={i}>
                <div className="order-card-inner">
                  <div className="order-stripe" style={{ background: 'var(--border)' }} />
                  <div className="order-body">
                    <div className="skeleton" style={{ width: '40%', height: 16, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: '60%', height: 12, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: '30%', height: 12 }} />
                  </div>
                </div>
              </div>
            ))}
            {ordersQ.isError && (
              <div className="empty">
                Failed to load orders.
                <div><button className="btn" style={{ marginTop: 10 }} onClick={() => ordersQ.refetch()}>Retry</button></div>
              </div>
            )}
            {!ordersQ.isLoading && !ordersQ.isError && filteredOrders.map((o: ClientOrder) => {
              const meta = orderStatusMeta(o.status)
              return (
                <div className="order-card" key={o.id} onClick={() => navigate('/orders/' + o.id)}>
                  <div className="order-card-inner">
                    <div className="order-stripe" style={{ background: meta.stripe }} />
                    <div className="order-body">
                      <div className="order-head">
                        <div>
                          <div className="order-client">{clientNameById.get(o.clientId) ?? 'Unknown client'}</div>
                          <div className="order-id">{o.id} · {new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                        </div>
                        <span className={`badge ${meta.badge}`}>{meta.label}</span>
                      </div>
                      <div className="order-meta">
                        <span><i className="ti ti-flame" />{o.charcoalType} · {o.grade}</span>
                        <span><i className="ti ti-weight" />{parseFloat(o.totalKgRequested).toLocaleString()} kg requested</span>
                      </div>
                    </div>
                    <div className="order-right">
                      <div className="order-total">
                        <div className="order-total-val">{fmtUsd(o.pricePerBag)}</div>
                        <div className="order-total-lbl">{o.currency} · /bag</div>
                      </div>
                      <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    </div>
                  </div>
                </div>
              )
            })}
            {!ordersQ.isLoading && !ordersQ.isError && filteredOrders.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
                <i className="ti ti-search" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                <div style={{ fontSize: 14 }}>No orders match your search</div>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => { setSearch(''); setFStatus('All statuses') }}>Clear filters</button>
              </div>
            )}
          </div>
        )}

        {/* TRIPS TAB */}
        {tab === 'trips' && (
          <div className="fade-up">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>Today's active trips — Thursday 21 May 2026</div>
              <button className="btn primary" onClick={() => setNewTripOpen(true)}><i className="ti ti-plus" style={{ fontSize: 14 }} /> New trip</button>
            </div>

            {/* Trip 1 — In progress */}
            <div className="trip-card">
              <div className="trip-head">
                <div className="driver-badge" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}>MK</div>
                <div className="trip-info">
                  <div className="trip-driver">Mohammed Khalil</div>
                  <div className="trip-meta">Trip #TRP-0091 · 3 stops · started 08:00</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge badge-blue">In progress</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text2)' }}>890 kg</span>
                </div>
              </div>
              <div className="trip-stops">
                <div className="stop-row">
                  <div className="stop-line" />
                  <div className="stop-dot done"><i className="ti ti-check" style={{ fontSize: 10 }} /></div>
                  <div className="stop-info">
                    <div className="stop-client">Al Rawda Restaurant</div>
                    <div className="stop-addr">Hamra, Beirut · INV-0338</div>
                    <div className="stop-bags"><span>80 × 2kg bag</span><span>20 × 5kg bag</span></div>
                  </div>
                  <div className="stop-right">
                    <span className="badge badge-green">Delivered</span>
                    <span className="stop-kg">260 kg · paid $840</span>
                  </div>
                </div>
                <div className="stop-row">
                  <div className="stop-line" />
                  <div className="stop-dot active">2</div>
                  <div className="stop-info">
                    <div className="stop-client">Chez Michel</div>
                    <div className="stop-addr">Achrafieh, Beirut · INV-0339</div>
                    <div className="stop-bags"><span>50 × 2kg bag</span><span>10 × 5kg bag</span></div>
                  </div>
                  <div className="stop-right">
                    <span className="badge badge-blue">In transit</span>
                    <span className="stop-kg">150 kg</span>
                    <div className="stop-actions">
                      <button className="stop-btn confirm-stop" onClick={() => setReceiptOpen(true)}>Confirm delivery</button>
                    </div>
                  </div>
                </div>
                <div className="stop-row">
                  <div className="stop-dot">3</div>
                  <div className="stop-info">
                    <div className="stop-client">Cedar Grill House</div>
                    <div className="stop-addr">Jdeideh · INV-0340</div>
                    <div className="stop-bags"><span>120 × 2kg bag</span></div>
                  </div>
                  <div className="stop-right">
                    <span className="badge badge-gray">Pending</span>
                    <span className="stop-kg">240 kg</span>
                  </div>
                </div>
              </div>
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Actual weights logged: 262kg / 148kg / pending</div>
                <button className="btn" style={{ fontSize: 12 }} onClick={() => setExpensesOpen(true)}><i className="ti ti-gas-station" style={{ fontSize: 13 }} /> Log expenses</button>
              </div>
            </div>

            {/* Trip 2 — Planned */}
            <div className="trip-card">
              <div className="trip-head">
                <div className="driver-badge" style={{ background: 'var(--accent2-bg)', color: 'var(--accent2)' }}>AH</div>
                <div className="trip-info">
                  <div className="trip-driver">Ahmad Hassan</div>
                  <div className="trip-meta">Trip #TRP-0092 · 2 stops · planned 13:00</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge ${tripStarted ? 'badge-blue' : 'badge-gray'}`}>{tripStarted ? 'In progress' : 'Planned'}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text2)' }}>620 kg</span>
                </div>
              </div>
              <div className="trip-stops">
                <div className="stop-row">
                  <div className="stop-line" />
                  <div className="stop-dot">1</div>
                  <div className="stop-info">
                    <div className="stop-client">Byblos BBQ Supply</div>
                    <div className="stop-addr">Byblos warehouse</div>
                    <div className="stop-bags"><span>100 × 5kg bag</span><span>50 × 10kg bag</span></div>
                  </div>
                  <div className="stop-right">
                    <span className="badge badge-gray">Pending</span>
                    <span className="stop-kg">1,000 kg nom.</span>
                  </div>
                </div>
                <div className="stop-row">
                  <div className="stop-dot">2</div>
                  <div className="stop-info">
                    <div className="stop-client">Hamra Supermarket</div>
                    <div className="stop-addr">Hamra, Beirut</div>
                    <div className="stop-bags"><span>80 × 2kg bag</span></div>
                  </div>
                  <div className="stop-right">
                    <span className="badge badge-gray">Pending</span>
                    <span className="stop-kg">160 kg nom.</span>
                  </div>
                </div>
              </div>
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tripStarted ? 'Dispatched 13:00' : 'Not yet dispatched'}</div>
                {!tripStarted && (
                  <button className="btn green" style={{ fontSize: 12 }} onClick={startTrip}><i className="ti ti-player-play" style={{ fontSize: 13 }} /> Start trip</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ORDER DETAIL PANEL */}
      <div className={`order-panel ${panelOpen ? 'open' : ''}`}>
        <div className="panel-head">
          <button className="panel-close-btn" onClick={() => setPanelOpen(false)}>✕ Close</button>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', marginBottom: 3 }}>ORD-0284 · 21 May 2026</div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.3 }}>Al Rawda Restaurant</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span className="badge badge-blue">In delivery</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>BBQ Hardwood · Grade A · 300kg</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 }}>
            {[
              { label: 'ORDER TOTAL', val: '$840', sub: '$2.80/bag · USD' },
              { label: 'KG DELIVERED', val: '100 / 300', sub: '1 of 3 shipments' },
              { label: 'PAID', val: '$840', valColor: 'var(--accent)', sub: 'on delivery' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '9px 11px' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.5, color: s.valColor }}>{s.val}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel-body">
          <div className="panel-section">
            <div className="panel-section-label">Shipments</div>
            {panelShipments.map(s => (
              <div className="shipment-card" key={s.id}>
                <div className="ship-head">
                  <span className="ship-num">{s.num}</span>
                  <span className={`badge ${s.badge}`}>{s.status}</span>
                </div>
                <div className="ship-body">
                  <div className="ship-addr">{s.addr}</div>
                  <div className="ship-bags">
                    {s.bags.map((b, j) => <span className="ship-bag-pill" key={j}>{b}</span>)}
                  </div>
                  <div className="ship-weights">
                    <div className="ship-weight-item"><div className="ship-weight-label">Nominal</div><div className="ship-weight-val">{s.nom}</div></div>
                    <div className="ship-weight-item"><div className="ship-weight-label">Actual (driver)</div><div className={`ship-weight-val ${s.actColor === 'var(--accent)' ? 'ship-weight-actual' : ''}`} style={{ color: s.actColor }}>{s.act}</div></div>
                    {s.paid && <div className="ship-weight-item"><div className="ship-weight-label">Paid</div><div className="ship-weight-val" style={{ color: s.paidColor }}>{s.paid}</div></div>}
                  </div>
                </div>
              </div>
            ))}
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setAddShipPanelOpen(true)}>
              <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add shipment
            </button>
          </div>
          <div className="panel-section">
            <div className="panel-section-label">Order details</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              {[
                { label: 'Client', val: 'Al Rawda Restaurant', bold: true },
                { label: 'Charcoal type', val: 'BBQ Hardwood · Grade A' },
                { label: 'Bag type', val: '2kg bag + 5kg bag' },
                { label: 'Price per bag', val: '$2.80', mono: true },
                { label: 'Currency', val: 'USD' },
                { label: 'Created by', val: 'Sales rep · 08:30', muted: true },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: i < 5 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ color: 'var(--text2)' }}>{r.label}</span>
                  <span style={{ fontWeight: r.bold ? 500 : 400, fontFamily: r.mono ? "'IBM Plex Mono', monospace" : undefined, color: r.muted ? 'var(--text2)' : undefined }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel-footer">
          <button className="panel-btn pbtn-ghost" onClick={() => { setPanelOpen(false); setInvoiceOpen(true) }}><i className="ti ti-file-invoice" style={{ fontSize: 13 }} /> Generate invoice</button>
          <button className="panel-btn pbtn-green" onClick={() => { setPanelOpen(false); setAssignOpen(true) }}><i className="ti ti-truck" style={{ fontSize: 13 }} /> Assign to trip</button>
        </div>
      </div>

      {/* NEW ORDER MODAL */}
      {newOrderOpen && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) { setNewOrderOpen(false); setErrClient(false); setErrBags(false); setBagCounts({}); setSelectedClient('Select client…') } }}>
          <div className="modal" style={{ width: 580, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <div className="modal-title">New order</div>
              <button className="panel-close-btn" onClick={() => { setNewOrderOpen(false); setErrClient(false); setErrBags(false); setBagCounts({}); setSelectedClient('Select client…') }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Client</label>
                <select className="form-input" value={selectedClient} onChange={e => { setSelectedClient(e.target.value); setErrClient(false) }}>
                  <option>Select client…</option>
                  {clientList.map(c => <option key={c.id}>{c.name}</option>)}
                </select>
                {errClient && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>Client is required</div>}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Charcoal type</label>
                  <select className="form-input">
                    <option>BBQ Hardwood</option><option>Shisha</option><option>Restaurant Grade</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Grade</label>
                  <select className="form-input">
                    <option>Grade A</option><option>Grade B</option><option>Grade C</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Price per bag</label>
                  <input className="form-input" type="number" placeholder="0.00" step="0.01" />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-input"><option>USD</option><option>LBP</option></select>
                </div>
              </div>
              <div className="divider" />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Shipments</div>
                <button className="btn" style={{ fontSize: 12 }} onClick={addShipment}><i className="ti ti-plus" style={{ fontSize: 13 }} /> Add shipment</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Split the order into delivery stops. Each shipment goes to one address.</div>
              {shipments.map((s, idx) => (
                <div className="ship-builder" key={s.id}>
                  <div className="sb-head">
                    <span className="sb-num">Shipment {idx + 1}</span>
                    {shipments.length > 1 && (
                      <button className="sb-del-btn" onClick={() => removeShipment(s.id)}><i className="ti ti-x" style={{ fontSize: 11 }} /></button>
                    )}
                  </div>
                  <div className="sb-body">
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Delivery address</label>
                      <input className="form-input" type="text" placeholder="Street, area, city… (Arabic supported)" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Bags — by size</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                        {(['2kg', '5kg', '10kg'] as const).map(key => (
                          <div className="bag-counter-row" key={key}>
                            <span className="bag-counter-label">{key.replace('kg', ' kg')} bag</span>
                            <div className="mini-counter">
                              <button className="mc-btn" onClick={() => adj(idx, key, -1)}>−</button>
                              <input className="mc-val" type="number" value={getBagCount(idx, key)} onChange={() => {}} min={0} />
                              <button className="mc-btn" onClick={() => { adj(idx, key, 1); setErrBags(false) }}>+</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {errBags && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>At least one bag qty must be &gt; 0</div>}
              <div className="divider" />
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" type="text" placeholder="Any special instructions…" />
              </div>
            </div>
            <div className="modal-footer" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)' }}>
              <button className="btn" onClick={() => { setNewOrderOpen(false); setErrClient(false); setErrBags(false); setBagCounts({}); setSelectedClient('Select client…') }}>Cancel</button>
              <button className="btn primary" onClick={submitNewOrder} disabled={createOrder.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {createOrder.isPending ? 'Creating…' : 'Create order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELIVERY CONFIRMATION MODAL */}
      {receiptOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setReceiptOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Confirm delivery — Stop 2</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Chez Michel · Achrafieh, Beirut</div>
              </div>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Actual weight delivered (kg)</label>
                  <input className="form-input" type="number" defaultValue={148} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Amount collected ($)</label>
                  <input className="form-input" type="number" placeholder="0.00" />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Payment method</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Cash', 'Whish', 'OMT', 'On account'].map(m => (
                    <div key={m} className="stop-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', background: payMethod === m ? 'var(--text)' : 'transparent', color: payMethod === m ? '#fff' : 'var(--text2)', borderColor: payMethod === m ? 'var(--text)' : 'var(--border)' }} onClick={() => setPayMethod(m)}>
                      {m}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 8 }}>Receipt preview</div>
              <div className="receipt">
                <div className="receipt-title">FARAH CHARCOAL</div>
                <div className="receipt-sub">Delivery receipt</div>
                <hr className="receipt-divider" />
                <div className="receipt-row"><span>Date</span><span>21 May 2026</span></div>
                <div className="receipt-row"><span>Receipt #</span><span>INV-0339</span></div>
                <div className="receipt-row"><span>Client</span><span>Chez Michel</span></div>
                <div className="receipt-row"><span>Driver</span><span>Mohammed Khalil</span></div>
                <hr className="receipt-divider" />
                <div className="receipt-row"><span>50 × 2kg bag</span><span>$140.00</span></div>
                <div className="receipt-row"><span>10 × 5kg bag</span><span>$140.00</span></div>
                <hr className="receipt-divider" />
                <div className="receipt-row total"><span>TOTAL</span><span>$280.00</span></div>
                <div className="receipt-row paid"><span>PAID</span><span>{payMethod}</span></div>
                <div className="receipt-sig"><div className="receipt-sig-line">Client signature</div></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setReceiptOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setReceiptOpen(false); showToast('Stop 2 confirmed — Chez Michel · $280') }}><i className="ti ti-printer" style={{ fontSize: 14 }} /> Print &amp; confirm delivery</button>
            </div>
          </div>
        </div>
      )}

      {/* FILTER MODAL */}
      {filterOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setFilterOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div className="modal-title"><i className="ti ti-filter" style={{ fontSize: 14, marginRight: 6 }} />Filter orders</div>
              <button className="panel-close-btn" onClick={() => setFilterOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Status</label>
                <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
                  <option>All statuses</option>
                  <option>Confirmed</option><option>In delivery</option>
                  <option>Delivered</option><option>Paid</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => { setFStatus('All statuses') }}>Clear</button>
              <button className="btn primary" onClick={() => { setFilterOpen(false); showToast('Filters applied') }}>Apply filters</button>
            </div>
          </div>
        </div>
      )}

      {/* LOG EXPENSES MODAL */}
      {expensesOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setExpensesOpen(false)}>
          <div className="modal" style={{ width: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-gas-station" style={{ fontSize: 14, marginRight: 6 }} />Log trip expenses</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Trip #TRP-0091 · Mohammed Khalil</div>
              </div>
              <button className="panel-close-btn" onClick={() => setExpensesOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {expenses.map((e, i) => (
                  <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input className="form-input" style={{ flex: 1, margin: 0 }} placeholder="Description" value={e.desc} onChange={ev => setExpenses(prev => prev.map(r => r.id === e.id ? { ...r, desc: ev.target.value } : r))} />
                    <input className="form-input" style={{ width: 100, margin: 0 }} type="number" placeholder="$0.00" value={e.amt} onChange={ev => setExpenses(prev => prev.map(r => r.id === e.id ? { ...r, amt: ev.target.value } : r))} />
                    {expenses.length > 1 && (
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, padding: 0 }} onClick={() => removeExpenseRow(e.id)}>
                        <i className="ti ti-x" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button className="btn" style={{ marginTop: 12, fontSize: 12 }} onClick={addExpenseRow}><i className="ti ti-plus" style={{ fontSize: 12 }} /> Add row</button>
              <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text2)' }}>Total expenses</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${expenses.reduce((s, e) => s + (parseFloat(e.amt) || 0), 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setExpensesOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setExpensesOpen(false); showToast('Expenses logged for TRP-0091') }}><i className="ti ti-check" style={{ fontSize: 14 }} /> Save expenses</button>
            </div>
          </div>
        </div>
      )}

      {/* NEW TRIP MODAL */}
      {newTripOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setNewTripOpen(false)}>
          <div className="modal" style={{ width: 500, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <div className="modal-title"><i className="ti ti-truck" style={{ fontSize: 14, marginRight: 6 }} />New trip</div>
              <button className="panel-close-btn" onClick={() => setNewTripOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Driver</label>
                <select className="form-input">
                  <option>Select driver…</option>
                  <option>Mohammed Khalil (MK)</option>
                  <option>Ahmad Hassan (AH)</option>
                  <option>Joseph Nasr (JN)</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Planned departure</label>
                  <input className="form-input" type="time" defaultValue="13:00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input className="form-input" type="date" defaultValue="2026-05-21" />
                </div>
              </div>
              <div className="divider" />
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Stops / orders to include</div>
              {['ORD-0283 — Byblos BBQ Supply (2 stops)', 'ORD-0282 — Cedar Grill House (1 stop)'].map((o, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" defaultChecked={i === 0} />
                  {o}
                </label>
              ))}
              <div className="form-group" style={{ marginTop: 14, marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" type="text" placeholder="Any instructions for the driver…" />
              </div>
            </div>
            <div className="modal-footer" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)' }}>
              <button className="btn" onClick={() => setNewTripOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setNewTripOpen(false); showToast('Trip #TRP-0093 created') }}><i className="ti ti-check" style={{ fontSize: 14 }} /> Create trip</button>
            </div>
          </div>
        </div>
      )}

      {/* GENERATE INVOICE MODAL */}
      {invoiceOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setInvoiceOpen(false)}>
          <div className="modal" style={{ width: 480 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-file-invoice" style={{ fontSize: 14, marginRight: 6 }} />Generate invoice</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>ORD-0284 · Al Rawda Restaurant</div>
              </div>
              <button className="panel-close-btn" onClick={() => setInvoiceOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Invoice date</label>
                  <input className="form-input" type="date" defaultValue="2026-05-21" />
                </div>
                <div className="form-group">
                  <label className="form-label">Due date</label>
                  <input className="form-input" type="date" defaultValue="2026-06-04" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Payment terms</label>
                <select className="form-input">
                  <option>Net 14 days</option><option>Net 30 days</option><option>On delivery</option><option>Immediate</option>
                </select>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: 13, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Invoice summary</div>
                {[
                  { label: '80 × 2kg BBQ Hardwood A', val: '$560.00' },
                  { label: '20 × 5kg BBQ Hardwood A', val: '$280.00' },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--text2)' }}>
                    <span>{r.label}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.val}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                  <span>Total</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent)' }}>$840.00</span>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" type="text" placeholder="Delivery note, reference…" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setInvoiceOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setInvoiceOpen(false); showToast('Invoice INV-0342 generated') }}><i className="ti ti-check" style={{ fontSize: 14 }} /> Generate invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* ASSIGN TO TRIP MODAL */}
      {assignOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAssignOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-truck" style={{ fontSize: 14, marginRight: 6 }} />Assign to trip</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>ORD-0284 · Al Rawda Restaurant · 3 shipments</div>
              </div>
              <button className="panel-close-btn" onClick={() => setAssignOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>Select an existing trip or create a new one.</div>
              {[
                { id: 'TRP-0091', driver: 'Mohammed Khalil (MK)', status: 'badge-blue', st: 'In progress', stops: '3 stops · Hamra area', active: true },
                { id: 'TRP-0092', driver: 'Ahmad Hassan (AH)', status: 'badge-gray', st: 'Planned', stops: '2 stops · North Lebanon', active: false },
              ].map((t, i) => (
                <label key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 8, cursor: 'pointer', alignItems: 'center' }}>
                  <input type="radio" name="trip" defaultChecked={i === 0} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{t.id} — {t.driver}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{t.stops}</div>
                  </div>
                  <span className={`badge ${t.status}`}>{t.st}</span>
                </label>
              ))}
              <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={() => { setAssignOpen(false); setNewTripOpen(true) }}>
                <i className="ti ti-plus" style={{ fontSize: 13 }} /> Create new trip
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAssignOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { setAssignOpen(false); showToast('ORD-0284 assigned to TRP-0091') }}><i className="ti ti-check" style={{ fontSize: 14 }} /> Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD SHIPMENT MODAL */}
      {addShipPanelOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAddShipPanelOpen(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Add shipment</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>ORD-0284 · Al Rawda Restaurant</div>
              </div>
              <button className="panel-close-btn" onClick={() => setAddShipPanelOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Delivery address</label>
                <input className="form-input" type="text" placeholder="Street, area, city…" value={newShipAddr} onChange={e => setNewShipAddr(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Bags — by size</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  {([['2 kg', newShipBag2, setNewShipBag2], ['5 kg', newShipBag5, setNewShipBag5], ['10 kg', newShipBag10, setNewShipBag10]] as const).map(([label, val, setter]) => (
                    <div className="bag-counter-row" key={label}>
                      <span className="bag-counter-label">{label} bag</span>
                      <div className="mini-counter">
                        <button className="mc-btn" onClick={() => setter(v => Math.max(0, v - 1))}>−</button>
                        <input className="mc-val" type="number" value={val} onChange={e => setter(Math.max(0, parseInt(e.target.value) || 0))} min={0} />
                        <button className="mc-btn" onClick={() => setter(v => v + 1)}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAddShipPanelOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={confirmAddShipment}><i className="ti ti-plus" style={{ fontSize: 14 }} /> Add shipment</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
