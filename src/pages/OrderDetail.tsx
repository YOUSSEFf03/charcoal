import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useOrder, useDeleteOrder, useMarkOrderDelivered, useGenerateOrderInvoice } from '../hooks/useOrders'
import { useBagTypes } from '../hooks/useBagTypes'
import type { OrderStatus, ShipmentStatus } from '../types/api'
import { formatUsd } from '../lib/money'

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
function shipmentBadge(s: ShipmentStatus): { cls: string; label: string } {
  switch (s) {
    case 'pending': return { cls: 'badge-gray', label: 'Pending' }
    case 'loaded': return { cls: 'badge-blue', label: 'Loaded' }
    case 'delivered': return { cls: 'badge-green', label: 'Delivered' }
    case 'returned': return { cls: 'badge-red', label: 'Returned' }
    default: return { cls: 'badge-gray', label: s }
  }
}
export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const orderQ = useOrder(id ?? '')
  const deleteOrder = useDeleteOrder()
  const markDelivered = useMarkOrderDelivered()
  const generateInvoice = useGenerateOrderInvoice()
  const bagTypesQ = useBagTypes()
  const bagTypeById = new Map((bagTypesQ.data ?? []).map(b => [b.id, b]))
  const bagTypeNameById = new Map((bagTypesQ.data ?? []).map(b => [b.id, b.name]))
  const order = orderQ.data

  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  if (orderQ.isLoading) {
    return (
      <>
        <Topbar title="Order" />
        <div className="content">
          <div className="skeleton" style={{ width: '40%', height: 28, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 240 }} />
        </div>
      </>
    )
  }
  if (orderQ.isError || !order) {
    return (
      <>
        <Topbar title="Order" />
        <div className="content">
          <div className="empty">
            Failed to load order.
            <div><button className="btn" style={{ marginTop: 10 }} onClick={() => orderQ.refetch()}>Retry</button></div>
          </div>
        </div>
      </>
    )
  }

  const statusMeta = orderStatusMeta(order.status)
  const orderDisplay = order.displayId ?? `#${order.id.slice(0, 8).toUpperCase()}`
  const isBagOrder = !!order.bagTypeId
  const pricePerUnit = parseFloat(order.pricePerBag)
  const totalKg = parseFloat(order.totalKgRequested)
  const totalBags = isBagOrder
    ? (order.bagLines.length > 0
        ? order.bagLines.reduce((s, l) => s + l.quantity, 0)
        : order.bagType ? Math.round(totalKg / parseFloat(order.bagType.nominalKg)) : 0)
    : 0
  const totalAmount = isBagOrder ? totalBags * pricePerUnit : totalKg * pricePerUnit
  const invoice = order.invoices[0]
  const invoiceTotal = invoice ? parseFloat(invoice.total) : 0
  const invoicePaid = invoice ? parseFloat(invoice.paidAmount) : 0
  const outstanding = invoiceTotal - invoicePaid

  return (
    <>
      <Topbar title={orderDisplay}>
        {invoice && (
          <a className="btn" href={`/invoice/${invoice.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print invoice
          </a>
        )}
        <button className="btn" onClick={() => navigate(`/orders/${order.id}/edit`)}><i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit</button>
        {order.status === 'draft' && (
          <button
            className="btn"
            style={{ color: 'var(--red)' }}
            disabled={deleteOrder.isPending}
            onClick={() => {
              if (confirm('Delete this draft order? This cannot be undone.')) {
                deleteOrder.mutate(order.id, {
                  onSuccess: () => navigate('/orders'),
                  onError: (err: any) => showToast(err?.error ?? 'Failed to delete order'),
                })
              }
            }}
          >
            <i className="ti ti-trash" style={{ fontSize: 15 }} />
            {deleteOrder.isPending ? 'Deleting…' : 'Delete'}
          </button>
        )}
        {!['delivered', 'invoiced', 'paid'].includes(order.status) && (
          <button
            className="btn primary"
            disabled={markDelivered.isPending}
            onClick={() => {
              if (confirm('Mark this order as delivered?')) {
                markDelivered.mutate(order.id, {
                  onError: (err: any) => showToast(err?.error ?? 'Failed to mark order as delivered'),
                })
              }
            }}
          >
            <i className="ti ti-truck-delivery" style={{ fontSize: 15 }} />
            {markDelivered.isPending ? 'Marking…' : 'Mark as delivered'}
          </button>
        )}
        {order.status === 'delivered' && order.invoices.length === 0 && (
          <button
            className="btn primary"
            disabled={generateInvoice.isPending}
            onClick={() => {
              generateInvoice.mutate(order.id, {
                onSuccess: (inv: any) => navigate(`/invoice/${inv.id}`),
              })
            }}
          >
            <i className="ti ti-receipt" style={{ fontSize: 15 }} />
            {generateInvoice.isPending ? 'Generating…' : 'Generate Invoice'}
          </button>
        )}
      </Topbar>
      <div className="content">

        {/* Page header */}
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button className="back-link" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => navigate('/orders')}>
                <i className="ti ti-chevron-left" /> Orders
              </button>
              <span style={{ color: 'var(--text3)' }}>·</span>
              <span className={`badge ${statusMeta.cls}`}>{statusMeta.label}</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }} title={order.id}>{orderDisplay} · {order.client.name}</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-users" /> <Link to={`/clients/${order.clientId}`} style={{ color: 'inherit' }}>{order.client.name}</Link></span>
              <span className="meta-row"><i className="ti ti-calendar" /> created {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className="meta-row"><i className="ti ti-currency-dollar" /> {order.currency}</span>
              <span className="meta-row"><i className="ti ti-package" /> {order.charcoalType} · {order.grade}{order.supplierName ? ` · ${order.supplierName}` : ''}</span>
              {order.driver && <span className="meta-row"><i className="ti ti-user" /> {order.driver.name}</span>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minWidth: 300 }}>
            <div className="kpi-tile">
              <div className="kpi-tile-label">{isBagOrder ? 'Total bags' : 'Total weight'}</div>
              <div className="kpi-tile-value">
                {isBagOrder ? totalBags : totalKg.toLocaleString()}
                <span style={{ fontSize: 14, color: 'var(--text3)', fontWeight: 400 }}>&nbsp;{isBagOrder ? 'bags' : 'kg'}</span>
              </div>
              <div className="kpi-tile-sub">
                <span className={`badge ${isBagOrder ? 'badge-blue' : 'badge-amber'}`}>{isBagOrder ? 'Bag order' : 'KG order'}</span>
                {isBagOrder && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>{totalKg.toLocaleString()} kg</span>}
              </div>
            </div>
            <div className="kpi-tile green">
              <div className="kpi-tile-label">Est. total</div>
              <div className="kpi-tile-value">${totalAmount.toFixed(2)}</div>
              <div className="kpi-tile-sub">{order.shipments.length} shipments</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

          {/* LEFT */}
          <div className="stack">

            {/* Line items */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-list" /> Order details</div>
                <span className={`badge ${isBagOrder ? 'badge-blue' : 'badge-amber'}`}>
                  {isBagOrder ? 'Bag order' : 'KG order'}
                </span>
              </div>
              <div style={{ background: 'var(--surface2)', display: 'grid', gridTemplateColumns: '1fr 130px 120px 120px', gap: 12, padding: '7px 18px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: '1px solid var(--border)' }}>
                <span>Charcoal</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span style={{ textAlign: 'right' }}>{isBagOrder ? 'Price / bag' : 'Price / kg'}</span>
                <span style={{ textAlign: 'right' }}>Est. total</span>
              </div>
              {isBagOrder && order.bagLines.length > 0 ? (
                order.bagLines.map(l => {
                  const bt = bagTypeById.get(l.bagTypeId)
                  const lineKg = bt ? l.quantity * parseFloat(bt.nominalKg) : 0
                  const lineTotal = l.quantity * pricePerUnit
                  return (
                    <div className="item-row" key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 120px 120px', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{bt?.name ?? l.bagTypeId}</div>
                        <div className="meta">{order.charcoalType} · Grade {order.grade}</div>
                      </div>
                      <div className="num">{l.quantity} bags · {lineKg.toFixed(0)} kg</div>
                      <div className="num">${pricePerUnit.toFixed(2)}</div>
                      <div className="num" style={{ fontWeight: 600 }}>${lineTotal.toFixed(2)}</div>
                    </div>
                  )
                })
              ) : (
                <div className="item-row" style={{ display: 'grid', gridTemplateColumns: '1fr 130px 120px 120px', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {order.charcoalType} · Grade {order.grade}
                      {order.supplierName && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {order.supplierName}</span>}
                    </div>
                    <div className="meta">
                      {isBagOrder
                        ? order.bagType?.name ?? order.bagTypeId ?? 'Bag order'
                        : 'Sold by weight (KG)'}
                    </div>
                  </div>
                  <div className="num">
                    {isBagOrder ? `${totalBags} bags · ${totalKg.toLocaleString()} kg` : `${totalKg.toLocaleString()} kg`}
                  </div>
                  <div className="num">${pricePerUnit.toFixed(2)}</div>
                  <div className="num" style={{ fontWeight: 600 }}>${totalAmount.toFixed(2)}</div>
                </div>
              )}
              <div style={{ background: 'var(--surface2)', padding: '11px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 }}>
                <span>
                  {isBagOrder ? `${totalBags} bags · ${totalKg.toLocaleString()} kg` : `${totalKg.toLocaleString()} kg`} · {order.currency}
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15 }}>${totalAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Shipments */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-truck" /> Shipments</div>
              </div>
              <div style={{ padding: '12px 18px 4px' }}>
                {order.shipments.length === 0 && <div className="empty">No shipment for this order — delivered directly.</div>}
                {order.shipments.map((sh, idx) => {
                  const badge = shipmentBadge(sh.status)
                  const done = sh.status === 'delivered'
                  return (
                    <div className="ship-card" key={sh.id}>
                      <div className="ship-head">
                        <div className={`ship-num ${done ? 'done' : 'active'}`}>
                          {done ? <i className="ti ti-check" style={{ fontSize: 12 }} /> : idx + 1}
                        </div>
                        <div className="ship-info">
                          <div className="ship-addr">{sh.address}</div>
                          <div className="ship-meta" title={sh.id}>{sh.displayId ?? sh.id}</div>
                        </div>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <div className="ship-body">
                        <div className="bag-pills">
                          {sh.bags.map(b => <span className="bag-pill" key={b.id}>{b.quantity} × {bagTypeNameById.get(b.bagTypeId) ?? b.bagTypeId}</span>)}
                        </div>
                        <div className="ship-weights">
                          <div>
                            <div className="lbl">Nominal</div>
                            <div className="val">{parseFloat(sh.nominalKg).toFixed(0)} kg</div>
                          </div>
                          <div>
                            <div className="lbl">Actual</div>
                            <div className="val" style={{ color: sh.actualKg ? 'var(--accent)' : 'var(--text3)' }}>
                              {sh.actualKg != null ? `${parseFloat(sh.actualKg).toFixed(0)} kg` : '— kg'}
                            </div>
                          </div>
                          <div>
                            <div className="lbl">Delivered</div>
                            <div className="val" style={{ color: 'var(--text3)' }}>
                              {sh.deliveredAt ? new Date(sh.deliveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>

          {/* RIGHT */}
          <div className="stack">

            {/* Timeline */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-history" /> Timeline</div>
              </div>
              <div style={{ padding: '8px 18px 14px' }}>
                <div className="tl-list">
                  <div className="tl-item current">
                    <div className="tl-text">Status: {statusMeta.label}</div>
                    <div className="tl-when">updated {new Date(order.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  </div>
                  {order.shipments.map((sh, idx) => (
                    <div className={`tl-item ${sh.status === 'delivered' ? 'done' : ''}`} key={sh.id}>
                      <div className="tl-text">Shipment {idx + 1} — {shipmentBadge(sh.status).label}</div>
                      <div className="tl-when">{sh.deliveredAt ? new Date(sh.deliveredAt).toLocaleString('en-GB') : sh.address}</div>
                    </div>
                  ))}
                  <div className="tl-item done">
                    <div className="tl-text">Order created</div>
                    <div className="tl-when">{new Date(order.createdAt).toLocaleString('en-GB')}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Invoice status */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-receipt" /> Invoice &amp; payment</div>
                {invoice && (
                  <a className="card-action" href={`/invoice/${invoice.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <i className="ti ti-arrow-up-right" style={{ fontSize: 12 }} /> View invoice
                  </a>
                )}
              </div>
              {!invoice ? (
                <div className="empty">No invoice for this order yet.</div>
              ) : (
                <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Status', value: <span className="badge badge-amber">{invoice.status.replace('_', ' ')}</span> },
                    { label: 'Invoice #', value: <span style={{ fontFamily: "'IBM Plex Mono',monospace" }} title={invoice.id}>{invoice.displayId ?? invoice.id}</span> },
                    { label: 'Total', value: <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>{formatUsd(invoice.total)}</span> },
                    { label: 'Paid', value: <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent)', fontWeight: 600 }}>+{formatUsd(invoice.paidAmount)}</span> },
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>{row.label}</span>
                      {row.value}
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 500 }}>Outstanding</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent2)', fontWeight: 600 }}>${outstanding.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-notes" /> Order notes</div>
              </div>
              <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.55, color: 'var(--text2)' }}>
                {order.notes
                  ? <div style={{ fontFamily: "'Noto Sans Arabic',sans-serif", direction: 'rtl', marginBottom: 4 }}>{order.notes}</div>
                  : <div style={{ color: 'var(--text3)' }}>No notes.</div>}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
