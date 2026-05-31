import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useInvoices } from '../hooks/useInvoices'
import { useClientLedger } from '../hooks/useReports'
import { useCreateOrder } from '../hooks/useOrders'
import { useBagTypes } from '../hooks/useBagTypes'
import { useStockExits } from '../hooks/useWarehouse'
import { useCreatePayment } from '../hooks/usePayments'
import { useReceivers } from '../hooks/useReceivers'
import { useWorkers } from '../hooks/useWorkers'

/* ── local edit-form view-model types ── */
interface Phone { number: string; label: string; meta: string; active: boolean; primary: boolean }
interface ClientVM {
  name: string; nameAr: string; initials: string; type: string; currency: string
  address: string; terms: string; limit: number; notesAr: string; notesEn: string
  phones: Phone[]; preferred: string[]
  outstandingBal: number; openInvoices: number; daysSinceOrder: number; avgDays: number
}

const BAG_TYPES = ['1.9 kg', '2 kg', '5 kg', '10 kg', '20 kg']
const CHARCOAL_TYPES = ['BBQ Hardwood · A', 'BBQ Hardwood · B', 'Shisha · A', 'Shisha · B', 'Restaurant Grade · A']
const DEFAULT_PRICES: Record<string, number> = { '1.9 kg': 2.5, '2 kg': 2.6, '5 kg': 6.4, '10 kg': 12.5, '20 kg': 24.0 }

const MONTH_IDX: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 }
function parseDate(s: string) {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (m) return new Date(+m[3], MONTH_IDX[m[2]], +m[1])
  const iso = new Date(s)
  return Number.isNaN(iso.getTime()) ? null : iso
}
function fmt(n: number) { return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusBadge(s: string) {
  const map: Record<string, string> = { paid: 'badge-green', partially_paid: 'badge-amber', partial: 'badge-amber', issued: 'badge-blue', unpaid: 'badge-red', draft: 'badge-gray', cancelled: 'badge-gray' }
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</span>
}

let _olid = 100

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const cid = id ?? ''

  // Live client + related data.
  const clientQ = useClient(cid)
  const invoicesQ = useInvoices({ clientId: cid, limit: 100 })
  const ledgerQ = useClientLedger(cid)
  const warehouseExitsQ = useStockExits({ clientId: cid, limit: 100 })
  const createOrder = useCreateOrder()
  const createPaymentM = useCreatePayment()
  const bagTypesQ = useBagTypes()
  const bagTypesList = bagTypesQ.data ?? []
  const warehousePurchases = warehouseExitsQ.data?.data ?? []
  const { receivers: customReceivers } = useReceivers()
  const workersQ = useWorkers()
  const allReceivers = [
    ...(workersQ.data ?? []).map(w => w.name),
    ...customReceivers.map(r => r.name),
    'Owner',
  ]

  const c = clientQ.data
  const invoiceRows = invoicesQ.data?.data ?? []
  const ledgerEntries = ledgerQ.data?.entries ?? []

  // Derive the display view-model from the API client (graceful for missing fields).
  const initials = (c?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const outstandingBal = c ? parseFloat(c.balance) : 0
  const avgDays = c?.avgOrderDays ? Math.round(parseFloat(c.avgOrderDays)) : 0
  const daysSinceOrder = c?.lastOrderDate ? Math.round((Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000) : 0
  const activePhones = c?.phones ?? []
  const preferred = (c?.preferredTypes ?? []).map(p => `${p.charcoalType} · ${p.grade}`)
  const openInvoices = invoiceRows.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled').length

  // Invoice rows mapped for the table / Excel export.
  const INVOICES = invoiceRows.map(inv => ({
    date: fmtDate(inv.issuedAt ?? inv.createdAt),
    id: inv.id,
    order: inv.orderId ?? '—',
    amount: parseFloat(inv.total),
    paid: parseFloat(inv.paidAmount),
    status: inv.status,
  }))
  // Payment rows derived from the client ledger statement.
  const PAYMENTS = ledgerEntries
    .filter(e => e.type === 'payment')
    .map(e => ({ date: fmtDate(e.date), method: '—', inv: e.reference, by: '—', role: '', amount: parseFloat(e.credit), note: undefined as string | undefined }))
  // Order rows derived from the ledger's invoice entries (orders share the ledger statement).
  const ORDERS = ledgerEntries
    .filter(e => e.type === 'invoice')
    .map(e => ({ date: fmtDate(e.date), id: e.reference, char: '—', items: '—', total: parseFloat(e.debit), status: 'invoiced' }))
  const ACTIVITY = ledgerEntries.slice(0, 6).map(e => ({
    type: e.type === 'payment' ? 'pay' : 'inv',
    text: e.type === 'payment'
      ? `Payment <strong>${fmt(parseFloat(e.credit))}</strong> received (${e.reference})`
      : `Invoice ${e.reference} — <strong>${fmt(parseFloat(e.debit))}</strong>`,
    when: fmtDate(e.date),
  }))

  // Editable client view-model (seeded from the API client).
  const [client, setClient] = useState<ClientVM>(() => ({
    name: c?.name ?? '', nameAr: '', initials, type: c?.type ?? 'restaurant', currency: c?.currency ?? 'USD',
    address: '', terms: c?.paymentTerms ?? '', limit: 0, notesAr: c?.notes ?? '', notesEn: '',
    phones: activePhones.map(p => ({ number: p.number, label: p.label, meta: p.isActive ? 'active' : 'inactive', active: p.isActive, primary: false })),
    preferred, outstandingBal, openInvoices, daysSinceOrder, avgDays,
  }))

  const [shownOrders, setShownOrders] = useState(5)
  const [shownInv, setShownInv] = useState(5)
  const [shownPay, setShownPay] = useState(5)

  const [editOpen, setEditOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)

  const [editForm, setEditForm] = useState({ ...client })
  const [orderLines, setOrderLines] = useState([{ id: _olid++, bag: '2 kg', char: 'BBQ Hardwood · A', qty: 0, price: 2.6 }])
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('cash')
  const [payAmt, setPayAmt] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payReceiverName, setPayReceiverName] = useState('')

  const [ordFrom, setOrdFrom] = useState('')
  const [ordTo, setOrdTo] = useState('')
  const [invFrom, setInvFrom] = useState('')
  const [invTo, setInvTo] = useState('')
  const [payExFrom, setPayExFrom] = useState('')
  const [payExTo, setPayExTo] = useState('')

  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // Resync the editable view-model once the API client arrives.
  useEffect(() => {
    if (!c) return
    setClient({
      name: c.name, nameAr: '', initials, type: c.type, currency: c.currency,
      address: '', terms: c.paymentTerms ?? '', limit: 0, notesAr: c.notes ?? '', notesEn: '',
      phones: c.phones.map(p => ({ number: p.number, label: p.label, meta: p.isActive ? 'active' : 'inactive', active: p.isActive, primary: false })),
      preferred, outstandingBal, openInvoices, daysSinceOrder, avgDays,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, c?.updatedAt, invoiceRows.length])

  const orderSub = orderLines.reduce((s, l) => s + l.qty * l.price, 0)
  const orderVat = orderSub * 0.11

  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  function setPreset(section: string, kind: '30d' | 'ytd') {
    const today = new Date()
    const from = kind === '30d' ? new Date(today.getTime() - 30 * 86400000) : new Date(today.getFullYear(), 0, 1)
    const f = from.toISOString().slice(0, 10), t = today.toISOString().slice(0, 10)
    if (section === 'orders') { setOrdFrom(f); setOrdTo(t) }
    else if (section === 'invoices') { setInvFrom(f); setInvTo(t) }
    else { setPayExFrom(f); setPayExTo(t) }
  }

  function filterByDate<T extends { date: string }>(rows: T[], from: string, to: string) {
    const fromD = from ? new Date(from + 'T00:00:00') : null
    const toD = to ? new Date(to + 'T00:00:00') : null
    return rows.filter(r => {
      const d = parseDate(r.date); if (!d) return false
      if (fromD && d < fromD) return false
      if (toD && d > toD) return false
      return true
    })
  }

  function exportRange(section: string) {
    let rows: unknown[], header: string[], filename: string
    if (section === 'orders') {
      rows = filterByDate(ORDERS, ordFrom, ordTo)
      header = ['Date', 'Order ID', 'Charcoal', 'Items', 'Total (USD)', 'Status']
      filename = `${cid}-orders`
    } else if (section === 'invoices') {
      rows = filterByDate(INVOICES, invFrom, invTo)
      header = ['Issued', 'Invoice ID', 'From Order', 'Amount (USD)', 'Paid (USD)', 'Due (USD)', 'Status']
      filename = `${cid}-invoices`
    } else {
      rows = filterByDate(PAYMENTS, payExFrom, payExTo)
      header = ['Date', 'Method', 'Invoice', 'Received by', 'Role', 'Amount (USD)']
      filename = `${cid}-payments`
    }
    if (rows.length === 0) { showToast('No rows in that range'); return }
    const aoa: unknown[][] = [header]
    if (section === 'orders') {
      ;(rows as typeof ORDERS).forEach(o => aoa.push([o.date, o.id, o.char, o.items, o.total, o.status]))
    } else if (section === 'invoices') {
      ;(rows as typeof INVOICES).forEach(i => aoa.push([i.date, i.id, i.order, i.amount, i.paid, i.amount - i.paid, i.status]))
    } else {
      ;(rows as typeof PAYMENTS).forEach(p => aoa.push([p.date, p.method, p.inv, p.by, p.role, p.amount]))
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, section.charAt(0).toUpperCase() + section.slice(1))
    XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`)
    showToast(`Exported ${rows.length} rows`)
  }

  function openEditModal() {
    setEditForm({ ...client, phones: client.phones.map(p => ({ ...p })) })
    setEditOpen(true)
  }

  function addPhoneInEditor() {
    setEditForm(f => ({ ...f, phones: [...f.phones, { number: '+961 ', label: 'mobile', meta: 'new', active: true, primary: false }] }))
  }
  function removePhoneInEditor(idx: number) {
    setEditForm(f => ({ ...f, phones: f.phones.filter((_, i) => i !== idx) }))
  }
  function updatePhoneField(idx: number, field: keyof Phone, val: string | boolean) {
    setEditForm(f => ({ ...f, phones: f.phones.map((p, i) => i === idx ? { ...p, [field]: val } : p) }))
  }
  function setPhoneStatus(idx: number, status: string) {
    setEditForm(f => ({
      ...f,
      phones: f.phones.map((p, i) => {
        if (status === 'primary' && i !== idx) return { ...p, primary: false, meta: p.primary ? `added ${new Date().getFullYear()}` : p.meta }
        if (i !== idx) return p
        if (status === 'primary') return { ...p, primary: true, active: true, meta: 'primary' }
        if (status === 'active') return { ...p, primary: false, active: true }
        return { ...p, primary: false, active: false, meta: `inactive · ${new Date().getFullYear()}` }
      })
    }))
  }

  function saveEdit() {
    const initials = editForm.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    setClient({ ...editForm, initials })
    setEditOpen(false)
    showToast('Client info updated')
  }

  function addOrderLine() {
    setOrderLines(prev => [...prev, { id: _olid++, bag: '2 kg', char: 'BBQ Hardwood · A', qty: 0, price: 2.6 }])
  }
  function removeOrderLine(id: number) {
    if (orderLines.length === 1) return
    setOrderLines(prev => prev.filter(l => l.id !== id))
  }
  function updateOrderLine(id: number, field: string, val: string | number) {
    setOrderLines(prev => prev.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: val }
      if (field === 'bag' && DEFAULT_PRICES[val as string]) updated.price = DEFAULT_PRICES[val as string]
      return updated
    }))
  }

  function saveOrder(kind: string) {
    if (orderSub === 0) { showToast('Add at least one item'); return }
    const firstLine = orderLines.find(l => l.qty > 0)
    if (!firstLine) { showToast('Enter a quantity'); return }

    const [charType, grade] = firstLine.char.split(' · ')
    const bagType = bagTypesList.find(b => b.name.toLowerCase().includes(firstLine.bag.replace(' kg', 'kg').toLowerCase()) || b.nominalKg === firstLine.bag.replace(' kg', ''))
    const totalKg = orderLines.reduce((s, l) => {
      const bt = bagTypesList.find(b => b.name === l.bag || b.name.toLowerCase().includes(l.bag.replace(' kg', 'kg').toLowerCase()))
      return s + l.qty * parseFloat(bt?.nominalKg ?? l.bag.replace(' kg', ''))
    }, 0)

    createOrder.mutate(
      {
        clientId: cid,
        charcoalType: charType?.trim() ?? 'BBQ Hardwood',
        grade: grade?.trim() ?? 'A',
        totalKgRequested: totalKg.toFixed(3),
        bagTypeId: bagType?.id,
        pricePerBag: firstLine.price.toFixed(2),
        currency: (c?.currency ?? 'USD') as any,
      },
      {
        onSuccess: () => {
          setOrderOpen(false)
          showToast(`Order ${kind === 'draft' ? 'saved as draft' : 'created'} — ${fmt(orderSub)}`)
          setOrderLines([{ id: _olid++, bag: '2 kg', char: 'BBQ Hardwood · A', qty: 0, price: 2.6 }])
        },
        onError: () => showToast('Failed to create order'),
      },
    )
  }

  function savePayment() {
    const amt = parseFloat(payAmt)
    if (!amt || amt <= 0) { showToast('Enter an amount'); return }
    createPaymentM.mutate(
      {
        clientId: cid,
        amount: amt.toFixed(2),
        currency: c?.currency ?? 'USD',
        method: (payMethod as any),
        date: payDate,
        notes: payNote || null,
        receiverName: payReceiverName || undefined,
      },
      {
        onSuccess: () => {
          setPayModalOpen(false)
          showToast(`Payment ${fmt(amt)} logged`)
          setPayAmt('')
          setPayNote('')
        },
        onError: (err: any) => showToast(err?.error ?? 'Failed to log payment'),
      }
    )
  }

  const totalInvoiced = INVOICES.reduce((s, i) => s + i.amount, 0)
  const totalPaid = INVOICES.reduce((s, i) => s + i.paid, 0)

  const actIcons: Record<string, [string, string]> = {
    pay: ['ti-cash', 'green'], truck: ['ti-truck', ''], inv: ['ti-file-invoice', 'amber'], phone: ['ti-phone', '']
  }

  if (clientQ.isLoading) {
    return (
      <>
        <Topbar title="Client" back={{ label: 'All clients', to: '/clients' }} />
        <div className="content">
          <div className="skeleton" style={{ width: '40%', height: 28, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 240 }} />
        </div>
      </>
    )
  }

  if (clientQ.isError || !c) {
    return (
      <>
        <Topbar title="Client" back={{ label: 'All clients', to: '/clients' }} />
        <div className="content">
          <div className="empty">
            Failed to load client.
            <div><button className="btn" style={{ marginTop: 10 }} onClick={() => clientQ.refetch()}>Retry</button></div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar title={client.name} back={{ label: 'All clients', to: '/clients' }}>
        <button className="btn" onClick={openEditModal}>
          <i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit
        </button>
        <button className="btn" onClick={() => setOrderOpen(true)}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> New order
        </button>
        <button className="btn" onClick={() => { setPayDate(new Date().toISOString().slice(0, 10)); setPayModalOpen(true) }}>
          <i className="ti ti-receipt" style={{ fontSize: 15 }} /> Log payment
        </button>
      </Topbar>
      <div className="content">

        {/* HERO */}
        <div className="page-header">
          <div className="client-hero">
            <div className="client-mono">{client.initials}</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{client.name}</h1>
              <div style={{ fontFamily: "'Noto Sans Arabic',sans-serif", fontSize: 15, color: 'var(--text2)', marginTop: 2 }}>{client.nameAr}</div>
              <div className="page-header-meta">
                <span className="badge badge-green">{client.type}</span>
                <span className="badge badge-gray">{client.currency}</span>
                {c.notes && <span className="meta-row"><i className="ti ti-map-pin" /> {c.notes}</span>}
                <span className="meta-row"><i className="ti ti-calendar" /> client since {fmtDate(c.createdAt)}</span>
                {avgDays > 0 && <span className="meta-row"><i className="ti ti-clock" /> avg {avgDays}d between orders</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="kpi-tile amber" style={{ minWidth: 160 }}>
              <div className="kpi-tile-label">Outstanding balance</div>
              <div className="kpi-tile-value">${client.outstandingBal.toFixed(2)}</div>
              <div className="kpi-tile-sub">{client.openInvoices} open invoices</div>
            </div>
            <div className={`kpi-tile ${client.daysSinceOrder > client.avgDays ? 'red' : ''}`} style={{ minWidth: 160 }}>
              <div className="kpi-tile-label">Days since last order</div>
              <div className="kpi-tile-value">{client.daysSinceOrder}</div>
              <div className="kpi-tile-sub">{client.daysSinceOrder > client.avgDays ? `+${client.daysSinceOrder - client.avgDays} vs avg · OVERDUE` : 'on track'}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

          {/* LEFT */}
          <div className="stack">

            {/* Orders */}
            <div className="card">
              <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div className="card-title"><i className="ti ti-file-invoice" /> Order history
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{ORDERS.length} orders · {fmt(ORDERS.reduce((s, o) => s + o.total, 0))} total</span>
                </div>
                <div className="export-bar">
                  <span className="lbl">Export</span>
                  <input className="date-mini" type="date" value={ordFrom} onChange={e => setOrdFrom(e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
                  <input className="date-mini" type="date" value={ordTo} onChange={e => setOrdTo(e.target.value)} />
                  <button className="btn-export preset" onClick={() => setPreset('orders', '30d')}>30d</button>
                  <button className="btn-export preset" onClick={() => setPreset('orders', 'ytd')}>YTD</button>
                  <button className="btn-export" onClick={() => exportRange('orders')}><i className="ti ti-table-export" /> Excel</button>
                </div>
              </div>
              <table className="data-table" style={{ borderBottom: '1px solid var(--border)' }}>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Date</th>
                    <th>Order</th>
                    <th>Items</th>
                    <th className="right" style={{ width: 100 }}>Total</th>
                    <th style={{ width: 90 }}>Status</th>
                    <th className="right" style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDERS.slice(0, shownOrders).map(o => (
                    <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/orders/' + o.id)}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{o.date}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{o.id}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.char}</div>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{o.items}</td>
                      <td className="right num" style={{ fontWeight: 500 }}>{fmt(o.total)}</td>
                      <td>{statusBadge(o.status)}</td>
                      <td>
                        <div className="row-actions" onClick={e => e.stopPropagation()}>
                          <button className="icon-btn" title="View" onClick={() => navigate('/orders/' + o.id)}><i className="ti ti-arrow-up-right" /></button>
                          <a className="icon-btn" href={`/invoice/${o.id}`} target="_blank" rel="noreferrer" title="Invoice"><i className="ti ti-printer" /></a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="more-foot">
                <span>showing {Math.min(shownOrders, ORDERS.length)} of {ORDERS.length} orders</span>
                {ORDERS.length > 5 && (
                  <button className="btn-more" onClick={() => setShownOrders(n => n >= ORDERS.length ? 5 : n + 5)}>
                    <i className={`ti ti-chevron-${shownOrders >= ORDERS.length ? 'up' : 'down'}`} style={{ fontSize: 14 }} />
                    {shownOrders >= ORDERS.length ? ' Show less' : ' Show more'}
                  </button>
                )}
              </div>
            </div>

            {/* Invoices */}
            <div className="card">
              <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div className="card-title"><i className="ti ti-receipt-2" /> Invoices
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{INVOICES.length} issued · {client.openInvoices} open</span>
                </div>
                <div className="export-bar">
                  <span className="lbl">Export</span>
                  <input className="date-mini" type="date" value={invFrom} onChange={e => setInvFrom(e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
                  <input className="date-mini" type="date" value={invTo} onChange={e => setInvTo(e.target.value)} />
                  <button className="btn-export preset" onClick={() => setPreset('invoices', '30d')}>30d</button>
                  <button className="btn-export preset" onClick={() => setPreset('invoices', 'ytd')}>YTD</button>
                  <button className="btn-export" onClick={() => exportRange('invoices')}><i className="ti ti-table-export" /> Excel</button>
                </div>
              </div>
              <table className="data-table" style={{ borderBottom: '1px solid var(--border)' }}>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Issued</th>
                    <th>Invoice</th>
                    <th className="right" style={{ width: 100 }}>Amount</th>
                    <th className="right" style={{ width: 100 }}>Paid</th>
                    <th className="right" style={{ width: 100 }}>Due</th>
                    <th style={{ width: 80 }}>Status</th>
                    <th className="right" style={{ width: 70 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {INVOICES.slice(0, shownInv).map(inv => {
                    const due = inv.amount - inv.paid
                    return (
                      <tr key={inv.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{inv.date}</td>
                        <td>
                          <div style={{ fontWeight: 500, fontFamily: "'IBM Plex Mono',monospace" }}>{inv.id}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>from {inv.order}</div>
                        </td>
                        <td className="right num" style={{ fontWeight: 500 }}>{fmt(inv.amount)}</td>
                        <td className="right num" style={{ color: 'var(--accent)' }}>{fmt(inv.paid)}</td>
                        <td className="right num" style={{ color: due > 0 ? 'var(--accent2)' : 'var(--text3)', fontWeight: due > 0 ? 600 : 400 }}>{fmt(due)}</td>
                        <td>{statusBadge(inv.status)}</td>
                        <td>
                          <div className="row-actions">
                            <a className="icon-btn" href={`/invoice/${inv.id}`} target="_blank" rel="noreferrer" title="Open"><i className="ti ti-arrow-up-right" /></a>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="more-foot">
                <span>showing {Math.min(shownInv, INVOICES.length)} of {INVOICES.length} invoices</span>
                {INVOICES.length > 5 && (
                  <button className="btn-more" onClick={() => setShownInv(n => n >= INVOICES.length ? 5 : n + 5)}>
                    <i className={`ti ti-chevron-${shownInv >= INVOICES.length ? 'up' : 'down'}`} style={{ fontSize: 14 }} />
                    {shownInv >= INVOICES.length ? ' Show less' : ' Show more'}
                  </button>
                )}
              </div>
            </div>

            {/* Warehouse walk-in purchases */}
            {(warehousePurchases.length > 0 || warehouseExitsQ.isLoading) && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">
                    <i className="ti ti-building-warehouse" /> Warehouse sales
                    <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>
                      {warehousePurchases.length} purchase{warehousePurchases.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Bag type</th>
                      <th>Charcoal</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Kg sold</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Logged by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouseExitsQ.isLoading && (
                      <tr><td colSpan={6} className="empty">Loading…</td></tr>
                    )}
                    {warehousePurchases.map((exit: any) => {
                      const isRaw = !!exit.lotId && !exit.packedStockId
                      const charcoalLot = isRaw ? exit.lot : exit.packedStock?.lot
                      const kgOut = isRaw
                        ? parseFloat(exit.kgQuantity ?? '0')
                        : exit.bagType ? parseFloat(exit.bagType.nominalKg) * (exit.quantity ?? 0) : 0
                      return (
                        <tr key={exit.id}>
                          <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>
                            {fmtDate(exit.date)}
                          </td>
                          <td>
                            {isRaw ? (
                              <span className="badge badge-amber">By kg</span>
                            ) : (
                              <>
                                <div style={{ fontWeight: 500 }}>{exit.bagType?.name ?? '—'}</div>
                                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                                  {exit.bagType ? `${parseFloat(exit.bagType.nominalKg).toFixed(1)} kg/bag` : ''}
                                </div>
                              </>
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                            {charcoalLot
                              ? `${charcoalLot.charcoalType} · Grade ${charcoalLot.grade}`
                              : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>
                            {isRaw ? '—' : (exit.quantity ?? '—')}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text2)' }}>
                            {kgOut > 0 ? `${kgOut.toFixed(1)} kg` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: exit.amount ? 'var(--accent2)' : 'var(--text3)' }}>
                            {exit.amount ? `$${parseFloat(exit.amount).toFixed(2)}` : '—'}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text3)' }}>{exit.loggedBy?.name ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Payments */}
            <div className="card">
              <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div className="card-title"><i className="ti ti-cash" /> Payment history
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{PAYMENTS.length} payments</span>
                </div>
                <div className="export-bar">
                  <span className="lbl">Export</span>
                  <input className="date-mini" type="date" value={payExFrom} onChange={e => setPayExFrom(e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
                  <input className="date-mini" type="date" value={payExTo} onChange={e => setPayExTo(e.target.value)} />
                  <button className="btn-export preset" onClick={() => setPreset('payments', '30d')}>30d</button>
                  <button className="btn-export preset" onClick={() => setPreset('payments', 'ytd')}>YTD</button>
                  <button className="btn-export" onClick={() => exportRange('payments')}><i className="ti ti-table-export" /> Excel</button>
                </div>
              </div>
              <div className="pay-kpis">
                <div className="pay-kpi"><div className="lbl">Total invoiced</div><div className="val">{fmt(totalInvoiced)}</div></div>
                <div className="pay-kpi"><div className="lbl">Total paid</div><div className="val green">{fmt(totalPaid)}</div></div>
                <div className="pay-kpi"><div className="lbl">Outstanding</div><div className="val amber">{fmt(totalInvoiced - totalPaid)}</div></div>
              </div>
              <table className="data-table" style={{ borderBottom: '1px solid var(--border)' }}>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Date</th>
                    <th style={{ width: 80 }}>Method</th>
                    <th>Invoice</th>
                    <th>Logged by</th>
                    <th className="right" style={{ width: 110 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYMENTS.slice(0, shownPay).map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{p.date}</td>
                      <td><span className="badge badge-gray">{p.method}</span></td>
                      <td>
                        <a href={`/invoice/${p.inv}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{p.inv}</a>
                        {p.note && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>{p.note}</span>}
                      </td>
                      <td>{p.by} <span style={{ fontSize: 11, color: 'var(--text3)' }}>{p.role}</span></td>
                      <td className="right num" style={{ fontWeight: 500, color: 'var(--accent)' }}>+{fmt(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="more-foot">
                <span>showing {Math.min(shownPay, PAYMENTS.length)} of {PAYMENTS.length} payments</span>
                {PAYMENTS.length > 5 && (
                  <button className="btn-more" onClick={() => setShownPay(n => n >= PAYMENTS.length ? 5 : n + 5)}>
                    <i className={`ti ti-chevron-${shownPay >= PAYMENTS.length ? 'up' : 'down'}`} style={{ fontSize: 14 }} />
                    {shownPay >= PAYMENTS.length ? ' Show less' : ' Show more'}
                  </button>
                )}
              </div>
            </div>

          </div>

          {/* RIGHT */}
          <div className="stack">

            {/* Phones */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-phone" /> Phone numbers
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{client.phones.length} numbers</span>
                </div>
                <button className="card-action" onClick={openEditModal}><i className="ti ti-pencil" style={{ fontSize: 13 }} /> Manage</button>
              </div>
              {client.phones.map((p, i) => (
                <div className={`phone-row ${p.active ? '' : 'inactive'}`} key={i}>
                  <div className={`phone-dot ${p.active ? '' : 'inactive'}`} />
                  <div style={{ minWidth: 0 }}>
                    <div className="phone-number">{p.number}</div>
                    <div className="phone-label">{p.label}</div>
                  </div>
                  <div className="phone-meta">{p.meta}</div>
                  <div className="row-actions">
                    <a className="icon-btn" href={`tel:${p.number.replace(/\s/g, '')}`} title="Call"><i className="ti ti-phone" /></a>
                    <a className="icon-btn" href={`https://wa.me/${p.number.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" title="WhatsApp"><i className="ti ti-brand-whatsapp" /></a>
                  </div>
                </div>
              ))}
            </div>

            {/* Preferred charcoal */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-star" /> Preferred charcoal</div>
              </div>
              <div className="pref-chips">
                {client.preferred.map(p => {
                  const [type, grade] = p.split(' · ')
                  return <span className="pref-chip" key={p}>{type}<span className="grade">{grade}</span></span>
                })}
              </div>
            </div>

            {/* Terms & notes */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-clipboard-text" /> Terms &amp; notes</div>
                <button className="card-action" onClick={openEditModal}>Edit</button>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Payment terms</div>
                  <div>{client.terms}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Notes</div>
                  <div style={{ fontFamily: "'Noto Sans Arabic',sans-serif", direction: 'rtl', fontSize: 13.5 }}>{client.notesAr}</div>
                  <div style={{ color: 'var(--text3)', fontStyle: 'italic', marginTop: 4, fontSize: 12.5 }}>{client.notesEn}</div>
                </div>
              </div>
            </div>

            {/* Activity */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-activity" /> Activity</div>
              </div>
              {ACTIVITY.map((a, i) => {
                const [ic, cls] = actIcons[a.type] ?? ['ti-circle', '']
                return (
                  <div className="tl-row" key={i}>
                    <div className={`tl-icon ${cls}`}><i className={`ti ${ic}`} /></div>
                    <div className="tl-body">
                      <div className="tl-text" dangerouslySetInnerHTML={{ __html: a.text }} />
                      <div className="tl-time">{a.when}</div>
                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditOpen(false)}>
          <div className="modal" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head">
              <div className="modal-title"><i className="ti ti-edit" style={{ marginRight: 8 }} />Edit client</div>
              <button className="close-btn" onClick={() => setEditOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto' }}>
              <div className="form-grid">
                <div className="field">
                  <span className="field-label">Display name</span>
                  <input className="input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="field">
                  <span className="field-label">Arabic name</span>
                  <input className="input" value={editForm.nameAr} onChange={e => setEditForm(f => ({ ...f, nameAr: e.target.value }))} dir="rtl" style={{ fontFamily: "'Noto Sans Arabic',sans-serif" }} />
                </div>
                <div className="field">
                  <span className="field-label">Client type</span>
                  <select className="select" value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}>
                    {['restaurant', 'wholesale', 'retail', 'export', 'shisha'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Currency</span>
                  <select className="select" value={editForm.currency} onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}>
                    {['USD', 'LBP', 'EUR'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field full">
                  <span className="field-label">Address</span>
                  <input className="input" value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="field">
                  <span className="field-label">Payment terms</span>
                  <select className="select" value={editForm.terms} onChange={e => setEditForm(f => ({ ...f, terms: e.target.value }))}>
                    {['Cash on delivery', 'Net 15 days from invoice', 'Net 30 days from invoice', 'Net 45 days from invoice', 'Prepaid'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Credit limit (USD)</span>
                  <input className="input" type="number" value={editForm.limit} onChange={e => setEditForm(f => ({ ...f, limit: +e.target.value }))} style={{ fontFamily: "'IBM Plex Mono',monospace" }} />
                </div>
                <div className="field full">
                  <span className="field-label">Notes (Arabic)</span>
                  <textarea className="textarea" value={editForm.notesAr} onChange={e => setEditForm(f => ({ ...f, notesAr: e.target.value }))} dir="rtl" style={{ minHeight: 60, fontFamily: "'Noto Sans Arabic',sans-serif" }} />
                </div>
                <div className="field full">
                  <span className="field-label">Notes (English)</span>
                  <textarea className="textarea" value={editForm.notesEn} onChange={e => setEditForm(f => ({ ...f, notesEn: e.target.value }))} style={{ minHeight: 50 }} />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="field-label" style={{ display: 'block', marginBottom: 10 }}>Phone numbers</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {editForm.phones.map((p, idx) => (
                      <div key={idx} className="phone-edit-row">
                        <input className="input" value={p.number} placeholder="+961 ..."
                          onChange={e => updatePhoneField(idx, 'number', e.target.value)}
                          style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }} />
                        <input className="input" value={p.label} placeholder="mobile, office…"
                          onChange={e => updatePhoneField(idx, 'label', e.target.value)} />
                        <select className="select" value={p.primary ? 'primary' : p.active ? 'active' : 'inactive'}
                          onChange={e => setPhoneStatus(idx, e.target.value)}>
                          <option value="primary">Primary</option>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <button className="icon-btn danger" title="Remove" onClick={() => removePhoneInEditor(idx)}>
                          <i className="ti ti-trash" style={{ fontSize: 14 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="btn-add-phone" onClick={addPhoneInEditor}>
                    <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add phone
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>last updated 3 Apr 2026 by Rita Salameh</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setEditOpen(false)}>Cancel</button>
                <button className="btn green" onClick={saveEdit}><i className="ti ti-check" style={{ fontSize: 15 }} /> Save changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW ORDER MODAL */}
      {orderOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setOrderOpen(false)}>
          <div className="modal" style={{ maxWidth: 880, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head">
              <div className="modal-title"><i className="ti ti-plus" style={{ marginRight: 8 }} />New order · {client.name}</div>
              <button className="close-btn" onClick={() => setOrderOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto' }}>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                <div>
                  <span className="field-label">Order date</span>
                  <input className="input" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                </div>
                <div>
                  <span className="field-label">Delivery date</span>
                  <input className="input" type="date" />
                </div>
                <div>
                  <span className="field-label">Driver</span>
                  <select className="select">
                    {['— Assign later —', 'Joseph Nasr', 'Mohammed Khalil', 'Hasan Moussa'].map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <span className="field-label">Payment expected</span>
                  <select className="select">
                    {['Cash on delivery', 'Net 15 days', 'Pre-paid'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="field-label">Order items</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>pick bag · grade · qty · price</span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <thead>
                  <tr>
                    {['Bag', 'Charcoal', 'Qty', 'Unit $', 'Subtotal', ''].map((h, i) => (
                      <th key={i} style={{ background: 'var(--surface2)', padding: '8px 10px', textAlign: i >= 2 && i < 5 ? 'right' : 'left', fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderLines.map(l => (
                    <tr key={l.id}>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                        <select style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", background: 'var(--surface)', color: 'var(--text)' }}
                          value={l.bag} onChange={e => updateOrderLine(l.id, 'bag', e.target.value)}>
                          {bagTypesList.length > 0
                            ? bagTypesList.map(b => <option key={b.id} value={b.name}>{b.name}</option>)
                            : BAG_TYPES.map(b => <option key={b}>{b}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                        <select style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", background: 'var(--surface)', color: 'var(--text)' }}
                          value={l.char} onChange={e => updateOrderLine(l.id, 'char', e.target.value)}>
                          {CHARCOAL_TYPES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                        <input style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', background: 'var(--surface)', color: 'var(--text)' }}
                          type="number" min="1" value={l.qty || ''} onChange={e => updateOrderLine(l.id, 'qty', parseFloat(e.target.value) || 0)} placeholder="0" />
                      </td>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                        <input style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', background: 'var(--surface)', color: 'var(--text)' }}
                          type="number" step="0.01" min="0" value={l.price || ''} onChange={e => updateOrderLine(l.id, 'price', parseFloat(e.target.value) || 0)} placeholder="0.00" />
                      </td>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', fontSize: 13 }}>
                        {fmt(l.qty * l.price)}
                      </td>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                        <button style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => removeOrderLine(l.id)} disabled={orderLines.length === 1}>
                          <i className="ti ti-x" style={{ fontSize: 12 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ padding: '8px 10px', background: 'var(--surface2)', textAlign: 'right', color: 'var(--text2)', fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>Subtotal</td>
                      <td style={{ padding: '8px 10px', background: 'var(--surface2)', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right' }}>{fmt(orderSub)}</td>
                      <td style={{ background: 'var(--surface2)' }} />
                    </tr>
                  </tfoot>
                </tbody>
              </table>

              <button className="add-line" style={{ marginTop: 10 }} onClick={addOrderLine}>
                <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add another item
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', marginTop: 14, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: 'var(--text2)' }}>
                <div>Subtotal · {fmt(orderSub)}</div>
                <div>VAT (11%) · {fmt(orderVat)}</div>
                <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)', width: 240, textAlign: 'right' }}>
                  Grand total <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--accent)', letterSpacing: -0.5 }}>{fmt(orderSub + orderVat)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>draft is auto-saved · ORD-0342 (next number)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setOrderOpen(false)}>Cancel</button>
                <button className="btn" onClick={() => saveOrder('draft')} disabled={createOrder.isPending}>Save draft</button>
                <button className="btn green" onClick={() => saveOrder('confirm')} disabled={createOrder.isPending}>
                  <i className="ti ti-check" style={{ fontSize: 15 }} /> {createOrder.isPending ? 'Creating…' : 'Create order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LOG PAYMENT MODAL */}
      {payModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <div className="modal-title"><i className="ti ti-receipt" style={{ marginRight: 8 }} />Log payment</div>
              <button className="close-btn" onClick={() => setPayModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div>
                  <span className="field-label">Date</span>
                  <input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
                </div>
                <div>
                  <span className="field-label">Method</span>
                  <select className="select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                    {['cash', 'whish', 'omt'].map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <span className="field-label">Amount (USD)</span>
                  <input className="input num" type="number" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <span className="field-label">Received by</span>
                  <select className="select" value={payReceiverName} onChange={e => setPayReceiverName(e.target.value)}>
                    <option value="">— select receiver —</option>
                    {allReceivers.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="field-label">Reference / note</span>
                  <input className="input" value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. cheque #4521, whish ref" />
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>payment will deduct from outstanding ${client.outstandingBal.toFixed(2)}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setPayModalOpen(false)}>Cancel</button>
                <button className="btn green" onClick={savePayment}><i className="ti ti-check" style={{ fontSize: 15 }} /> Log payment</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`toast ${toast ? 'show' : ''}`}>
        <i className="ti ti-check-circle" />
        <span>{toast}</span>
      </div>
    </>
  )
}
