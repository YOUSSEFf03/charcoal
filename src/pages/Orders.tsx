import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useOrders, useDeleteOrder, useDeliveryQueue, useMarkOrderDelivered } from '../hooks/useOrders'
import { useClients } from '../hooks/useClients'
import { useUsers } from '../hooks/useUsers'
import { useConfirmDelivery, useLogReturn, useLogActualWeight } from '../hooks/useShipments'
import type { OrderStatus, ClientOrderListItem, DeliveryQueueOrderItem } from '../types/api'
import { formatUsd } from '../lib/money'
import { formatDate } from '../lib/date'

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

// Delivery Queue's own operational status framing — deliberately distinct
// from orderStatusMeta() above (which uses accounting-lifecycle language:
// Draft/Confirmed/Invoiced/Paid). A card in the queue only ever has status
// draft/confirmed/partially_delivered (OrdersService.findDeliveryQueue()'s
// DELIVERY_QUEUE_STATUSES) — 'confirmed' is included for schema-correctness
// but never actually occurs (CreateOrderDto/UpdateOrderDto have no `status`
// field; every order is created 'draft'), so it's given the same "waiting"
// framing as draft rather than inventing a distinct label for a state that
// doesn't happen in practice.
function deliveryStateMeta(s: OrderStatus): { badge: string; label: string; stripe: string } {
  switch (s) {
    case 'partially_delivered': return { badge: 'badge-blue', label: 'Partially delivered', stripe: 'var(--blue)' }
    default: return { badge: 'badge-amber', label: 'Awaiting delivery', stripe: 'var(--accent2)' }
  }
}

const DELIVERY_QUEUE_PAGE_SIZE = 8

// Delivery Queue sort options — no backend "priority" field exists (see
// OrdersService.findDeliveryQueue()'s doc comment for why the default is
// oldest-waiting-first, not an invented priority order).
const DQ_SORT_OPTIONS: { label: string; sortBy: 'createdAt' | 'client' | 'weight'; sortOrder: 'asc' | 'desc' }[] = [
  { label: 'Oldest waiting first', sortBy: 'createdAt', sortOrder: 'asc' },
  { label: 'Newest order first', sortBy: 'createdAt', sortOrder: 'desc' },
  { label: 'Client name (A–Z)', sortBy: 'client', sortOrder: 'asc' },
  { label: 'Weight (highest first)', sortBy: 'weight', sortOrder: 'desc' },
]

export default function Orders() {
  const navigate = useNavigate()
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [payMethod, setPayMethod] = useState('Cash')
  const [toast, setToast] = useState('')

  // Filter state
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fStatus, setFStatus] = useState('All statuses')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Pagination — the backend already scopes findAll() with skip/take + a
  // matching count() (see OrdersService.findAll()); this page previously
  // requested a single fixed page (limit: 100) with no way to reach anything
  // beyond it. ORDERS_PAGE_SIZE keeps each page a reasonable scroll length;
  // MAX_PAGE_LIMIT (100, server-enforced) is the hard ceiling either way.
  const ORDERS_PAGE_SIZE = 20
  const [page, setPage] = useState(1)

  // Changing status or search must land back on page 1 — otherwise a user
  // sitting on page 8 of "All statuses" could apply a filter with only 1
  // matching page and see an empty page 8 instead of their results.
  useEffect(() => { setPage(1) }, [fStatus, debouncedSearch])

  // Live orders — search, status, AND pagination all server-side.
  const ordersQ = useOrders({ status: statusParam(fStatus), search: debouncedSearch || undefined, page, limit: ORDERS_PAGE_SIZE })
  const clientsQ = useClients({ limit: 100 })
  const confirmDelivery = useConfirmDelivery()
  const logReturn = useLogReturn()
  const logActualWeight = useLogActualWeight()
  const deleteOrder = useDeleteOrder()

  // ── Delivery Queue — its OWN search/filter/sort/pagination state, entirely
  // independent of the Order History state above. Changing one must never
  // move the other's page (instruction: "changing the Delivery Queue page
  // must NOT change the history page" and vice versa).
  const [dqSearch, setDqSearch] = useState('')
  const [dqDebouncedSearch, setDqDebouncedSearch] = useState('')
  const [dqStatus, setDqStatus] = useState<'' | 'draft' | 'partially_delivered'>('')
  const [dqDriverId, setDqDriverId] = useState('')
  const [dqSortIdx, setDqSortIdx] = useState(0) // index into DQ_SORT_OPTIONS
  const [dqPage, setDqPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setDqDebouncedSearch(dqSearch), 300)
    return () => clearTimeout(t)
  }, [dqSearch])

  useEffect(() => { setDqPage(1) }, [dqDebouncedSearch, dqStatus, dqDriverId, dqSortIdx])

  const dqSort = DQ_SORT_OPTIONS[dqSortIdx]
  const deliveryQueueQ = useDeliveryQueue({
    page: dqPage,
    limit: DELIVERY_QUEUE_PAGE_SIZE,
    search: dqDebouncedSearch || undefined,
    driverId: dqDriverId || undefined,
    status: dqStatus || undefined,
    sortBy: dqSort.sortBy,
    sortOrder: dqSort.sortOrder,
  })
  const deliveryQueueOrders = deliveryQueueQ.data?.data ?? []
  const deliveryQueueTotal = deliveryQueueQ.data?.total ?? deliveryQueueOrders.length
  const deliveryQueueTotalPages = Math.max(1, Math.ceil(deliveryQueueTotal / DELIVERY_QUEUE_PAGE_SIZE))
  const dqFilterActive = Boolean(dqDebouncedSearch || dqStatus || dqDriverId)

  // Drivers for the Delivery Queue's driver filter — same role-scoped query
  // NewOrder.tsx already uses to populate its own driver picker.
  const driversQ = useUsers({ role: 'driver', limit: 100 })
  const driverList = driversQ.data?.data ?? []

  const markDelivered = useMarkOrderDelivered()

  const orders = ordersQ.data?.data ?? []
  const orderTotal = ordersQ.data?.total ?? orders.length
  const totalPages = Math.max(1, Math.ceil(orderTotal / ORDERS_PAGE_SIZE))
  const clientList = clientsQ.data?.data ?? []
  const clientNameById = new Map(clientList.map(c => [c.id, c.name]))

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  // Both search and status are filtered server-side; `orders` is the final set.
  const filteredOrders = orders

  // Confirm delivery of a shipment from the trip stop action. Actual weight has
  // its own dedicated endpoint (ConfirmDeliveryDto has no actualKg field — see
  // DriverMobile.tsx's confirmActiveDelivery for the same contract).
  function confirmShipmentDelivery(shipmentId: string, actualKg: string, paymentAmount?: string) {
    if (actualKg) logActualWeight.mutate({ id: shipmentId, body: { actualKg } })
    confirmDelivery.mutate(
      { id: shipmentId, body: { paymentAmount } },
      { onSuccess: () => showToast('Delivery confirmed') },
    )
  }
  void logReturn; void logActualWeight; void confirmShipmentDelivery

  // Reuses OrdersService's existing PATCH /orders/:id/mark-delivered via the
  // same useMarkOrderDelivered() hook OrderDetail.tsx calls — same
  // confirm-dialog wording, same mutation, not a duplicated implementation.
  function handleMarkDelivered(id: string) {
    if (confirm('Mark this order as delivered?')) {
      markDelivered.mutate(id, {
        onSuccess: () => showToast('Order marked as delivered'),
        onError: (err: any) => showToast(err?.error ?? 'Failed to mark order as delivered'),
      })
    }
  }

  return (
    <>
      <Topbar title="Orders & Delivery">
        <button className="btn" onClick={() => setFilterOpen(true)}><i className="ti ti-filter" style={{ fontSize: 15 }} /> Filter</button>
        <button className="btn primary" onClick={() => navigate('/orders/new')}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> New order
        </button>
      </Topbar>

      <div className="content">

        {/* ══════════════════════════════════════════════════════════════
            DELIVERY QUEUE — "what needs delivery attention right now?"
            Own backend query, own pagination/search/filter/sort — never a
            frontend filter over the Order History list below.
            ══════════════════════════════════════════════════════════════ */}
        <div className="fade-up" style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ti ti-truck-delivery" style={{ fontSize: 18, color: 'var(--accent2)' }} />
                Delivery Queue
                {deliveryQueueTotal > 0 && (
                  <span className="badge badge-amber" style={{ fontSize: 11 }}>{deliveryQueueTotal} order{deliveryQueueTotal !== 1 ? 's' : ''}</span>
                )}
              </h2>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>Orders waiting for delivery or currently being delivered</div>
            </div>
          </div>

          <div className="filters" style={{ marginBottom: 12 }}>
            <div className="filter-input">
              <i className="ti ti-search" />
              <input type="text" placeholder="Search client…" value={dqSearch} onChange={e => setDqSearch(e.target.value)} />
            </div>
            <select className="filter-select" value={dqStatus} onChange={e => setDqStatus(e.target.value as typeof dqStatus)}>
              <option value="">All delivery states</option>
              <option value="draft">Awaiting delivery</option>
              <option value="partially_delivered">Partially delivered</option>
            </select>
            <select className="filter-select" value={dqDriverId} onChange={e => setDqDriverId(e.target.value)}>
              <option value="">All drivers</option>
              {driverList.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="filter-select" value={dqSortIdx} onChange={e => setDqSortIdx(Number(e.target.value))}>
              {DQ_SORT_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
            </select>
            {dqFilterActive && (
              <button className="btn" style={{ fontSize: 12 }} onClick={() => { setDqSearch(''); setDqStatus(''); setDqDriverId(''); setDqSortIdx(0) }}>Clear</button>
            )}
          </div>

          {deliveryQueueQ.isLoading && [0, 1, 2].map(i => (
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

          {deliveryQueueQ.isError && (
            <div className="empty">
              Couldn't load delivery queue.
              <div><button className="btn" style={{ marginTop: 10 }} onClick={() => deliveryQueueQ.refetch()}>Retry</button></div>
            </div>
          )}

          {!deliveryQueueQ.isLoading && !deliveryQueueQ.isError && deliveryQueueOrders.length === 0 && !dqFilterActive && (
            <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text3)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
              <i className="ti ti-circle-check" style={{ fontSize: 30, display: 'block', marginBottom: 8, color: 'var(--accent)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>All caught up</div>
              <div style={{ fontSize: 12.5, marginTop: 3 }}>No orders are currently waiting for delivery.</div>
            </div>
          )}

          {!deliveryQueueQ.isLoading && !deliveryQueueQ.isError && deliveryQueueOrders.length === 0 && dqFilterActive && (
            <div style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--text3)' }}>
              <i className="ti ti-search" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
              <div style={{ fontSize: 13.5 }}>No orders match your filters</div>
              <button className="btn" style={{ marginTop: 10 }} onClick={() => { setDqSearch(''); setDqStatus(''); setDqDriverId(''); setDqSortIdx(0) }}>Clear filters</button>
            </div>
          )}

          {!deliveryQueueQ.isLoading && !deliveryQueueQ.isError && deliveryQueueOrders.map((o: DeliveryQueueOrderItem) => {
            const meta = deliveryStateMeta(o.status)
            const totalKg = parseFloat(o.totalKgRequested)
            const totalBags = o.bagType ? Math.round(totalKg / parseFloat(o.bagType.nominalKg)) : 0
            return (
              <div className="order-card" key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                <div className="order-card-inner">
                  <div className="order-stripe" style={{ background: meta.stripe }} />
                  <div className="order-body">
                    <div className="order-head">
                      <div>
                        <div className="order-client">{o.client?.name ?? 'Unknown client'}</div>
                        <div className="order-id" title={o.id}>{o.displayId ?? o.id} · {formatDate(o.createdAt)}</div>
                      </div>
                      <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    </div>
                    <div className="order-meta">
                      <span>
                        <i className="ti ti-flame" />
                        {o.charcoalType} · {o.grade}
                        {o.bagType?.name ? ` · ${o.bagType.name}` : ''}
                      </span>
                      <span>
                        <i className="ti ti-weight" />
                        {o.bagTypeId ? `${totalBags} bags · ${totalKg.toLocaleString()} kg` : `${totalKg.toLocaleString()} kg`}
                      </span>
                      <span>
                        <i className="ti ti-user" />
                        {o.driver?.name ?? <span style={{ color: 'var(--text3)' }}>No driver assigned</span>}
                      </span>
                    </div>
                  </div>
                  <div className="order-right">
                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button className="btn" style={{ padding: '5px 10px' }} onClick={() => navigate(`/orders/${o.id}`)}>
                        View
                      </button>
                      <button
                        className="btn primary"
                        style={{ padding: '5px 10px' }}
                        disabled={markDelivered.isPending}
                        onClick={() => handleMarkDelivered(o.id)}
                      >
                        <i className="ti ti-truck-delivery" style={{ fontSize: 13 }} /> Mark delivered
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {!deliveryQueueQ.isLoading && !deliveryQueueQ.isError && deliveryQueueOrders.length > 0 && deliveryQueueTotalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 2px' }}>
              <button className="btn" disabled={dqPage <= 1} onClick={() => setDqPage(p => Math.max(1, p - 1))}>
                <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
              </button>
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                Page {dqPage} of {deliveryQueueTotalPages}
              </span>
              <button className="btn" disabled={dqPage >= deliveryQueueTotalPages} onClick={() => setDqPage(p => Math.min(deliveryQueueTotalPages, p + 1))}>
                Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
              </button>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            ORDER HISTORY — "what orders exist?" — unchanged behavior,
            own independent search/filter/pagination.
            ══════════════════════════════════════════════════════════════ */}
        <div className="fade-up">
            <div style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>Order History</h2>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>All orders and their history</div>
            </div>
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
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                {orderTotal} order{orderTotal !== 1 ? 's' : ''}{totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
              </span>
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
            {!ordersQ.isLoading && !ordersQ.isError && filteredOrders.map((o: ClientOrderListItem) => {
              const meta = orderStatusMeta(o.status)
              return (
                <div className="order-card" key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                  <div className="order-card-inner">
                    <div className="order-stripe" style={{ background: meta.stripe }} />
                    <div className="order-body">
                      <div className="order-head">
                        <div>
                          <div className="order-client">{clientNameById.get(o.clientId) ?? 'Unknown client'}</div>
                          <div className="order-id" title={o.id}>{o.displayId ?? o.id} · {new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                        </div>
                        <span className={`badge ${meta.badge}`}>{meta.label}</span>
                      </div>
                      <div className="order-meta">
                        <span>
                          <i className="ti ti-flame" />
                          {o.charcoalType} · {o.grade}
                          {o.supplierName ? ` · ${o.supplierName}` : ''}
                          {o.bagType?.name ? ` · ${o.bagType.name}` : ''}
                        </span>
                        <span><i className="ti ti-weight" />{parseFloat(o.totalKgRequested).toLocaleString()} kg</span>
                        <span className={`badge ${o.bagTypeId ? 'badge-blue' : 'badge-amber'}`} style={{ fontSize: 10 }}>{o.bagTypeId ? 'Bag' : 'KG'}</span>
                      </div>
                    </div>
                    <div className="order-right">
                      <div className="order-total">
                        <div className="order-total-val">{formatUsd(o.pricePerBag)}</div>
                        <div className="order-total-lbl">{o.currency} · {o.bagTypeId ? '/bag' : '/kg'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <button
                          className="btn"
                          style={{ padding: '5px 10px' }}
                          onClick={() => navigate(`/orders/${o.id}/edit`)}
                          title="Edit order"
                        >
                          <i className="ti ti-edit" style={{ fontSize: 14 }} />
                        </button>
                        {o.status === 'draft' && (
                          <button
                            className="btn"
                            style={{ padding: '5px 10px', color: 'var(--red)' }}
                            disabled={deleteOrder.isPending}
                            title="Delete order"
                            onClick={() => {
                              if (confirm('Delete this draft order? This cannot be undone.')) {
                                deleteOrder.mutate(o.id, { onSuccess: () => showToast('Order deleted') })
                              }
                            }}
                          >
                            <i className="ti ti-trash" style={{ fontSize: 14 }} />
                          </button>
                        )}
                      </div>
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
            {!ordersQ.isLoading && !ordersQ.isError && filteredOrders.length > 0 && totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '18px 0 6px' }}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                </button>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Page {page} of {totalPages}
                </span>
                <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                </button>
              </div>
            )}
        </div>
      </div>

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

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
