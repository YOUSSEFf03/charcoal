import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useInvoices } from '../hooks/useInvoices'
import { useClientLedger } from '../hooks/useReports'
import { useOrders, useCreateOrder } from '../hooks/useOrders'
import { useBagTypes } from '../hooks/useBagTypes'
import { useStockExits } from '../hooks/useWarehouse'
import { usePayments, useCreatePayment } from '../hooks/usePayments'
import { useReceivers } from '../hooks/useReceivers'
import { useWorkers } from '../hooks/useWorkers'
import { roundDp } from '../lib/money'

/* ── local edit-form view-model types ── */
interface Phone { number: string; label: string; meta: string; active: boolean; primary: boolean }
interface ClientVM {
  name: string; nameAr: string; initials: string; type: string; currency: string
  address: string; terms: string; limit: number; notesAr: string; notesEn: string
  phones: Phone[]; preferred: string[]
  outstandingBal: number; openInvoices: number; daysSinceOrder: number; avgDays: number
}

type View = 'detail' | 'orders' | 'invoices' | 'warehouse' | 'statement' | 'payments'

const CHARCOAL_TYPES = ['BBQ Hardwood · A', 'BBQ Hardwood · B', 'Shisha · A', 'Shisha · B', 'Restaurant Grade · A']

const MONTH_IDX: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 }
function parseDate(s: string) {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (m) return new Date(+m[3], MONTH_IDX[m[2]], +m[1])
  const iso = new Date(s)
  return Number.isNaN(iso.getTime()) ? null : iso
}
function fmt(n: number) {
  const neg = n < 0
  const a = Math.abs(n)
  return (neg ? '-$' : '$') + a.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fmtDate(iso)
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${datePart} ${h}:${m}`
}
function shortDate(s: string) { return String(s).split(' ').slice(0, 2).join(' ') }

function statusBadge(s: string) {
  const map: Record<string, string> = { paid: 'badge-green', partially_paid: 'badge-amber', partial: 'badge-amber', issued: 'badge-blue', unpaid: 'badge-red', draft: 'badge-gray', cancelled: 'badge-gray', delivered: 'badge-green' }
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</span>
}

let _olid = 100

/* ════════════ ACCOUNT ACTIVITY CHART ════════════ */
interface ChartPt { date: string; charged: number; paid: number }
function AccountChart({ pts, totalCharged, totalPaid, outstanding }: { pts: ChartPt[]; totalCharged: number; totalPaid: number; outstanding: number }) {
  const COL = { amber: '#B45309', green: '#1D6B4A', grid: '#E4E1D9', surface: '#FFFFFF' }

  if (pts.length === 0) {
    return <div className="empty" style={{ padding: '48px 18px' }}>No account activity yet</div>
  }

  const W = 760, H = 300, padL = 58, padR = 22, padT = 18, padB = 40
  const plotW = W - padL - padR, plotH = H - padT - padB
  const maxV = Math.max(totalCharged, totalPaid, 1)
  const niceMax = Math.max(Math.ceil(maxV / 300) * 300, 300)
  const n = pts.length
  const denom = Math.max(n - 1, 1)
  const X = (i: number) => padL + (n === 1 ? plotW / 2 : (i / denom) * plotW)
  const Y = (v: number) => padT + (1 - v / niceMax) * plotH
  const chargedPts = pts.map((p, i) => [X(i), Y(p.charged)] as [number, number])
  const paidPts = pts.map((p, i) => [X(i), Y(p.paid)] as [number, number])
  const line = (arr: [number, number][]) => arr.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = (arr: [number, number][]) => `${line(arr)} L${X(n - 1).toFixed(1)} ${Y(0).toFixed(1)} L${X(0).toFixed(1)} ${Y(0).toFixed(1)} Z`
  const ticks = [0, niceMax / 3, (niceMax * 2) / 3, niceMax]

  return (
    <>
      <div className="chart-legend">
        <div className="chart-leg"><span className="sw" style={{ background: COL.amber }} /><div><div className="lg-l">Charged</div><div className="lg-v" style={{ color: COL.amber }}>{fmt(totalCharged)}</div></div></div>
        <div className="chart-leg"><span className="sw" style={{ background: COL.green }} /><div><div className="lg-l">Paid</div><div className="lg-v" style={{ color: COL.green }}>{fmt(totalPaid)}</div></div></div>
        <div className="chart-leg out"><span className="sw" style={{ background: 'var(--text)' }} /><div><div className="lg-l">Outstanding</div><div className="lg-v">{fmt(outstanding)}</div></div></div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="acct-chart" preserveAspectRatio="xMidYMid meet">
          {ticks.map((t, i) => (
            <g key={'g' + i}>
              <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke={COL.grid} strokeWidth="1" />
              <text x={padL - 12} y={Y(t) + 4} textAnchor="end" className="ax">${Math.round(t).toLocaleString()}</text>
            </g>
          ))}
          <path d={area(chargedPts)} fill={COL.amber} opacity="0.09" />
          <path d={area(paidPts)} fill={COL.green} opacity="0.14" />
          <path d={line(chargedPts)} fill="none" stroke={COL.amber} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <path d={line(paidPts)} fill="none" stroke={COL.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {chargedPts.map((p, i) => <circle key={'c' + i} cx={p[0]} cy={p[1]} r="3.6" fill={COL.surface} stroke={COL.amber} strokeWidth="2" />)}
          {paidPts.map((p, i) => <circle key={'p' + i} cx={p[0]} cy={p[1]} r="3.6" fill={COL.surface} stroke={COL.green} strokeWidth="2" />)}
          {pts.map((p, i) => <text key={'x' + i} x={X(i)} y={H - padB + 22} textAnchor="middle" className="ax">{shortDate(p.date)}</text>)}
        </svg>
      </div>
    </>
  )
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const cid = id ?? ''

  // In-page hub navigation.
  const [view, setView] = useState<View>('detail')

  // Live client + related data.
  const clientQ = useClient(cid)
  const ordersQ = useOrders({ clientId: cid, limit: 200 })
  const invoicesQ = useInvoices({ clientId: cid, limit: 100 })
  const ledgerQ = useClientLedger(cid)
  const warehouseExitsQ = useStockExits({ clientId: cid, limit: 100 })
  const paymentsQ = usePayments({ clientId: cid, limit: 200 })
  const createOrder = useCreateOrder()
  const createPaymentM = useCreatePayment()
  const bagTypesQ = useBagTypes()
  const bagTypesList = bagTypesQ.data ?? []
  const bagTypeNames = bagTypesList.map(b => b.name)
  const defaultPriceByName: Record<string, number> = Object.fromEntries(
    bagTypesList.map(b => [b.name, b.costPerBag ? parseFloat(b.costPerBag) : 0])
  )
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
  const paymentRows = paymentsQ.data?.data ?? []

  // Derive the display view-model from the API client (graceful for missing fields).
  const initials = (c?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const outstandingBal = c ? parseFloat(c.balance) : 0
  const avgDays = c?.avgOrderDays ? Math.round(parseFloat(c.avgOrderDays)) : 0
  const daysSinceOrder = c?.lastOrderDate ? Math.round((Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000) : 0
  const activePhones = c?.phones ?? []
  const preferred = (c?.preferredTypes ?? []).map(p => `${p.charcoalType} · ${p.grade}`)
  const openInvoices = invoiceRows.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled').length

  // Real backend display ID keyed by order id, to resolve the related order of an
  // invoice (invoices carry only orderId).
  const orderDisplayById = new Map((ordersQ.data?.data ?? []).map(o => [o.id, o.displayId]))
  const invoiceDisplayById = new Map(invoiceRows.map(inv => [inv.id, inv.displayId ?? inv.id.slice(0, 8).toUpperCase()]))

  // Invoice rows mapped for the table / Excel export.
  const INVOICES = invoiceRows.map(inv => ({
    rawDate: inv.issuedAt ?? inv.createdAt ?? '',
    date: fmtDate(inv.issuedAt ?? inv.createdAt),
    id: inv.id,
    displayId: inv.displayId ?? inv.id.slice(0, 8).toUpperCase(),
    order: inv.orderId ?? null,
    orderDisplay: inv.orderId ? (orderDisplayById.get(inv.orderId) ?? inv.orderId) : '—',
    amount: parseFloat(inv.total),
    paid: parseFloat(inv.paidAmount),
    status: inv.status,
  }))
  // Payment rows from the real payments API.
  const PAYMENTS = paymentRows.map(p => ({
    rawDate: p.createdAt ?? p.date ?? '',
    date: fmtDate(p.date),
    id: p.id,
    displayId: p.displayId ?? p.id.slice(0, 8),
    method: p.method,
    invId: p.invoiceId,
    invDisplay: p.invoiceId ? (invoiceDisplayById.get(p.invoiceId) ?? p.invoiceId) : '—',
    by: p.receiverName ?? '—',
    ref: p.notes ?? '',
    amount: parseFloat(p.amount),
  }))
  // Order rows from the real orders API — all orders regardless of invoice status.
  const ORDERS = (ordersQ.data?.data ?? []).map(o => {
    const isBag = !!o.bagTypeId
    const totalKg = parseFloat(o.totalKgRequested)
    const pricePerUnit = parseFloat(o.pricePerBag)
    const nominalKg = o.bagType ? parseFloat(o.bagType.nominalKg) : 1
    const bagCount = isBag && nominalKg > 0 ? Math.round(totalKg / nominalKg) : 0
    const orderTotal = isBag && nominalKg > 0
      ? bagCount * pricePerUnit
      : totalKg * pricePerUnit
    return {
      rawDate: o.createdAt ?? '',
      date: fmtDate(o.createdAt),
      id: o.id,
      displayId: o.displayId ?? o.id.slice(0, 8).toUpperCase(),
      char: `${o.charcoalType} · ${o.grade}`,
      bagTypeName: o.bagType?.name ?? null,
      supplier: o.supplierName ?? null,
      items: `${totalKg.toLocaleString()} kg`,
      total: pricePerUnit,
      bagCount,
      orderTotal,
      status: o.status,
      isBag,
    }
  })

  // Warehouse-sale rows derived for the sub-view table + export.
  const WAREHOUSE = warehousePurchases.map((exit: any) => {
    const isRaw = !!exit.lotId && !exit.packedStockId
    const charcoalLot = isRaw ? exit.lot : exit.packedStock?.lot
    const kgOut = isRaw
      ? parseFloat(exit.kgQuantity ?? '0')
      : exit.bagType ? parseFloat(exit.bagType.nominalKg) * (exit.quantity ?? 0) : 0
    return {
      id: exit.id,
      displayId: (exit.displayId as string | undefined) ?? null,
      rawDate: exit.createdAt ?? exit.date ?? '',
      date: fmtDate(exit.date),
      isRaw,
      bagTypeName: exit.bagType?.name ?? null,
      bagNominal: exit.bagType ? `${parseFloat(exit.bagType.nominalKg).toFixed(1)} kg/bag` : '',
      charcoal: charcoalLot ? `${charcoalLot.charcoalType} · Grade ${charcoalLot.grade}` : '—',
      qty: isRaw ? null : (exit.quantity ?? null),
      kg: kgOut,
      amount: exit.amount ? parseFloat(exit.amount) : 0,
      by: exit.loggedBy?.name ?? '—',
    }
  })

  // Statement ledger sourced from backend — invoices + payments only, cancelled/draft excluded.
  const LEDGER = (ledgerQ.data?.entries ?? []).map(e => {
    const rawDate = typeof e.date === 'string' ? e.date : new Date((e.date as any)).toISOString()
    const debit  = parseFloat(e.debit)
    const credit = parseFloat(e.credit)
    return {
      rawDate,
      date:        fmtDate(rawDate),
      ref:         e.displayId ?? e.reference.slice(0, 8).toUpperCase(),
      referenceId: e.reference,
      desc:        e.description,
      kind:        e.type as 'invoice' | 'payment',
      debit,
      credit,
      balance:     parseFloat(e.runningBalance),
    }
  })
  const totalCharged = LEDGER.reduce((s, e) => s + e.debit, 0)
  const totalPaid    = LEDGER.reduce((s, e) => s + e.credit, 0)

  // Cumulative chart points (one per distinct date, at close of day).
  const chartPts = useMemo(() => {
    const map = new Map<string, ChartPt>()
    let cumC = 0, cumP = 0
    LEDGER.forEach(e => { cumC += e.debit; cumP += e.credit; map.set(e.date, { date: e.date, charged: cumC, paid: cumP }) })
    return Array.from(map.values())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerQ.data?.entries?.length ?? 0])

  // Editable client view-model (seeded from the API client).
  const [client, setClient] = useState<ClientVM>(() => ({
    name: c?.name ?? '', nameAr: '', initials, type: c?.type ?? 'restaurant', currency: c?.currency ?? 'USD',
    address: '', terms: c?.paymentTerms ?? '', limit: 0, notesAr: c?.notes ?? '', notesEn: '',
    phones: activePhones.map(p => ({ number: p.number, label: p.label, meta: p.isActive ? 'active' : 'inactive', active: p.isActive, primary: false })),
    preferred, outstandingBal, openInvoices, daysSinceOrder, avgDays,
  }))

  const [editOpen, setEditOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)

  const [editForm, setEditForm] = useState({ ...client })
  const [orderLines, setOrderLines] = useState([{ id: _olid++, bag: '', char: 'BBQ Hardwood · A', qty: 0, price: 0 }])
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('cash')
  const [payAmt, setPayAmt] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payReceiverName, setPayReceiverName] = useState('')

  // Sub-view local filters.
  const [ordStatus, setOrdStatus] = useState('all')
  const [ordQ, setOrdQ] = useState('')
  const [stmtFrom, setStmtFrom] = useState('')
  const [stmtTo, setStmtTo] = useState('')
  const [stmtType, setStmtType] = useState<'all' | 'debit' | 'credit'>('all')
  const [stmtQ, setStmtQ] = useState('')

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

  // Sum per-line amounts rounded to cents first, avoiding float accumulation drift.
  const orderSub = orderLines.reduce((s, l) => s + Math.round(l.qty * l.price * 100), 0) / 100
  const orderVat = roundDp(orderSub * 0.11, 2)

  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  /* ── Excel export (per section) ── */
  function isoToMs(iso: string) { return iso ? new Date(iso + 'T00:00:00').getTime() : null }

  function exportSheet(aoa: unknown[][], sheet: string, filename: string) {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheet)
    XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function exportOrders() {
    const aoa: unknown[][] = [['Date', 'Order #', 'Type', 'Charcoal', 'Weight', 'Price/bag', 'Status']]
    filteredOrders.forEach(o => aoa.push([o.date, o.displayId, o.isBag ? 'Bag' : 'KG', o.char, o.items, `$${o.total.toFixed(2)}`, o.status]))
    if (aoa.length === 1) { showToast('Nothing to export'); return }
    exportSheet(aoa, 'Orders', `${cid}-orders`)
    showToast(`Exported ${aoa.length - 1} rows`)
  }
  function exportInvoices() {
    const aoa: unknown[][] = [['Issued', 'Invoice #', 'From Order', 'Amount', 'Paid', 'Due', 'Status']]
    INVOICES.forEach(i => aoa.push([i.date, i.displayId, i.orderDisplay, i.amount, i.paid, i.amount - i.paid, i.status]))
    if (aoa.length === 1) { showToast('Nothing to export'); return }
    exportSheet(aoa, 'Invoices', `${cid}-invoices`)
    showToast(`Exported ${aoa.length - 1} rows`)
  }
  function exportWarehouse() {
    const aoa: unknown[][] = [['Date', 'Bag type', 'Charcoal', 'Qty', 'Kg sold', 'Amount', 'Logged by']]
    WAREHOUSE.forEach(w => aoa.push([w.date, w.isRaw ? 'By kg' : (w.bagTypeName ?? '—'), w.charcoal, w.qty ?? '—', w.kg || '—', w.amount || 0, w.by]))
    if (aoa.length === 1) { showToast('Nothing to export'); return }
    exportSheet(aoa, 'Warehouse', `${cid}-warehouse`)
    showToast(`Exported ${aoa.length - 1} rows`)
  }
  function exportPayments() {
    const aoa: unknown[][] = [['Receipt #', 'Date', 'Method', 'Invoice', 'Received by', 'Notes', 'Amount']]
    PAYMENTS.forEach(p => aoa.push([p.displayId, p.date, p.method, p.invDisplay, p.by, p.ref, p.amount]))
    if (aoa.length === 1) { showToast('Nothing to export'); return }
    exportSheet(aoa, 'Payments', `${cid}-payments`)
    showToast(`Exported ${aoa.length - 1} rows`)
  }
  function exportStatement() {
    const aoa: unknown[][] = [['Date', 'Ref', 'Description', 'Debit', 'Credit', 'Balance']]
    aoa.push([stmtOpeningDate, '', 'Opening balance', '', '', stmtOpening])
    stmtFiltered.forEach(e => aoa.push([e.date, e.ref, e.desc, e.debit || '', e.credit || '', e.balance]))
    if (aoa.length === 2) { showToast('Nothing to export'); return }
    exportSheet(aoa, 'Statement', `${cid}-statement`)
    showToast(`Exported ${aoa.length - 2} rows`)
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
    const ini = editForm.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    setClient({ ...editForm, initials: ini })
    setEditOpen(false)
    showToast('Client info updated')
  }

  function addOrderLine() {
    setOrderLines(prev => [...prev, { id: _olid++, bag: '', char: 'BBQ Hardwood · A', qty: 0, price: 0 }])
  }
  function removeOrderLine(lid: number) {
    if (orderLines.length === 1) return
    setOrderLines(prev => prev.filter(l => l.id !== lid))
  }
  function updateOrderLine(lid: number, field: string, val: string | number) {
    setOrderLines(prev => prev.map(l => {
      if (l.id !== lid) return l
      const updated = { ...l, [field]: val }
      if (field === 'bag' && defaultPriceByName[val as string]) updated.price = defaultPriceByName[val as string]
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
          setOrderLines([{ id: _olid++, bag: '', char: 'BBQ Hardwood · A', qty: 0, price: 0 }])
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
          clientQ.refetch()
          ledgerQ.refetch()
          invoicesQ.refetch()
          paymentsQ.refetch()
        },
        onError: (err: any) => showToast(err?.error ?? 'Failed to log payment'),
      }
    )
  }

  /* ── derived sub-view data ── */
  const totalInvoiced = INVOICES.reduce((s, i) => s + i.amount, 0)
  const totalPaidInv = INVOICES.reduce((s, i) => s + i.paid, 0)

  const filteredOrders = ORDERS.filter(o => {
    if (ordStatus !== 'all' && o.status !== ordStatus) return false
    if (ordQ && !(o.displayId + ' ' + o.char + ' ' + (o.supplier ?? '')).toLowerCase().includes(ordQ.toLowerCase())) return false
    return true
  })
  const ordDelivered = ORDERS.filter(o => o.status === 'delivered').length
  const ordDraft = ORDERS.filter(o => o.status === 'draft').length

  const warehouseTotal = WAREHOUSE.reduce((s, w) => s + w.amount, 0)
  const warehouseKg = WAREHOUSE.reduce((s, w) => s + w.kg, 0)

  const paymentsTotal = PAYMENTS.reduce((s, p) => s + p.amount, 0)
  let paymentsRun = 0
  const paymentsWithRun = PAYMENTS.map(p => { paymentsRun += p.amount; return { ...p, run: paymentsRun } })
  const lastPayment = PAYMENTS.length ? PAYMENTS[PAYMENTS.length - 1] : null

  // Statement filtering — opening = running balance just before first shown row.
  const stmtFromMs = isoToMs(stmtFrom), stmtToMs = isoToMs(stmtTo)
  const stmtFiltered = LEDGER.filter(e => {
    const ms = e.rawDate ? new Date(e.rawDate).getTime() : 0
    if (stmtFromMs && ms < stmtFromMs) return false
    if (stmtToMs && ms > stmtToMs) return false
    if (stmtType === 'debit' && !e.debit) return false
    if (stmtType === 'credit' && !e.credit) return false
    if (stmtQ && !(e.desc + ' ' + e.ref).toLowerCase().includes(stmtQ.toLowerCase())) return false
    return true
  })
  const stmtDebit = stmtFiltered.reduce((s, e) => s + e.debit, 0)
  const stmtCredit = stmtFiltered.reduce((s, e) => s + e.credit, 0)
  const stmtFirstIdx = stmtFiltered.length ? LEDGER.indexOf(stmtFiltered[0]) : -1
  const stmtOpening = stmtFirstIdx > 0 ? LEDGER[stmtFirstIdx - 1].balance : 0
  const stmtClosing = stmtFiltered.length ? stmtFiltered[stmtFiltered.length - 1].balance : stmtOpening
  const stmtOpeningDate = stmtFiltered.length ? stmtFiltered[0].date : (LEDGER[0]?.date ?? fmtDate(new Date().toISOString()))
  const stmtPeriod = stmtFiltered.length ? `${stmtFiltered[0].date} — ${stmtFiltered[stmtFiltered.length - 1].date}` : '—'
  const stmtFilterActive = stmtFrom || stmtTo || stmtType !== 'all' || stmtQ
  function resetStmt() { setStmtFrom(''); setStmtTo(''); setStmtType('all'); setStmtQ('') }

  const overdue = daysSinceOrder > avgDays

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
        {view === 'detail' ? (
          <>
            <button className="btn" onClick={openEditModal}>
              <i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit
            </button>
            <button className="btn" onClick={() => navigate(`/orders/new?clientId=${cid}`)}>
              <i className="ti ti-plus" style={{ fontSize: 15 }} /> New order
            </button>
            <button className="btn" onClick={() => { setPayDate(new Date().toISOString().slice(0, 10)); setPayModalOpen(true) }}>
              <i className="ti ti-receipt" style={{ fontSize: 15 }} /> Log payment
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setView('detail')}>
            <i className="ti ti-arrow-left" style={{ fontSize: 15 }} /> Back to client
          </button>
        )}
      </Topbar>
      <div className="content">

        {/* ════════════ DETAIL HUB ════════════ */}
        {view === 'detail' && (
          <div className="fade-up">
            {/* HERO */}
            <div className="page-header">
              <div className="client-hero">
                <div className="client-mono">{client.initials}</div>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{client.name}</h1>
                  {client.nameAr && <div style={{ fontFamily: "'Noto Sans Arabic',sans-serif", fontSize: 15, color: 'var(--text2)', marginTop: 2 }}>{client.nameAr}</div>}
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
                  <div className="kpi-tile-value">{fmt(parseFloat(ledgerQ.data?.balance ?? String(outstandingBal)))}</div>
                  <div className="kpi-tile-sub">{openInvoices} open invoices</div>
                </div>
                <div className={`kpi-tile ${overdue ? 'red' : ''}`} style={{ minWidth: 160 }}>
                  <div className="kpi-tile-label">Days since last order</div>
                  <div className="kpi-tile-value">{daysSinceOrder}</div>
                  <div className="kpi-tile-sub">{overdue ? `+${daysSinceOrder - avgDays} vs avg · OVERDUE` : 'on track'}</div>
                </div>
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="sec-label">Quick actions</div>
            <div className="action-bar">
              <button className="action-card" onClick={() => setOrderOpen(true)}>
                <div className="action-ic green"><i className="ti ti-file-invoice" /></div>
                <div className="action-tx"><span className="t">Make invoice</span><span className="s">issue a new charge</span></div>
              </button>
              <button className="action-card" onClick={() => { setPayDate(new Date().toISOString().slice(0, 10)); setPayModalOpen(true) }}>
                <div className="action-ic dark"><i className="ti ti-receipt" /></div>
                <div className="action-tx"><span className="t">Make payment</span><span className="s">log money received</span></div>
              </button>
            </div>

            {/* RECORDS */}
            <div className="sec-label">Records</div>
            <div className="action-bar">
              <button className="action-card" onClick={() => setView('statement')}>
                <div className="action-ic amber"><i className="ti ti-table" /></div>
                <div className="action-tx"><span className="t">Statement of account</span><span className="s">debit · credit · balance</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
              <button className="action-card" onClick={() => setView('orders')}>
                <div className="action-ic amber"><i className="ti ti-file-invoice" /></div>
                <div className="action-tx"><span className="t">Order history</span><span className="s">{ORDERS.length} orders</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
              <button className="action-card" onClick={() => setView('invoices')}>
                <div className="action-ic green"><i className="ti ti-receipt-2" /></div>
                <div className="action-tx"><span className="t">Invoices</span><span className="s">{INVOICES.length} issued</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
              <button className="action-card" onClick={() => setView('warehouse')}>
                <div className="action-ic dark"><i className="ti ti-building-warehouse" /></div>
                <div className="action-tx"><span className="t">Warehouse sales</span><span className="s">{WAREHOUSE.length} purchases</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
              <button className="action-card" onClick={() => setView('payments')}>
                <div className="action-ic blue"><i className="ti ti-cash" /></div>
                <div className="action-tx"><span className="t">All payments</span><span className="s">{PAYMENTS.length} on record</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
              {/* LEFT — Account activity chart */}
              <div className="stack">
                <div className="card">
                  <div className="card-head">
                    <div className="card-title"><i className="ti ti-chart-bar" /> Account activity</div>
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{client.currency} · cumulative</span>
                  </div>
                  {ledgerQ.isLoading
                    ? <div className="empty" style={{ padding: '48px 18px' }}>Loading…</div>
                    : <AccountChart pts={chartPts} totalCharged={totalCharged} totalPaid={totalPaid} outstanding={totalCharged - totalPaid} />}
                </div>
              </div>

              {/* RIGHT — phones / preferred / terms */}
              <div className="stack">
                <div className="card">
                  <div className="card-head">
                    <div className="card-title"><i className="ti ti-phone" /> Phone numbers
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{client.phones.length} numbers</span>
                    </div>
                    <button className="card-action" onClick={openEditModal}><i className="ti ti-pencil" style={{ fontSize: 13 }} /> Manage</button>
                  </div>
                  {client.phones.length === 0 && <div className="pref-empty">No phone numbers recorded</div>}
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

                <div className="card">
                  <div className="card-head">
                    <div className="card-title"><i className="ti ti-star" /> Preferred charcoal</div>
                  </div>
                  {client.preferred.length ? (
                    <div className="pref-chips">
                      {client.preferred.map(p => {
                        const [type, grade] = p.split(' · ')
                        return <span className="pref-chip" key={p}>{type}<span className="grade">{grade}</span></span>
                      })}
                    </div>
                  ) : <div className="pref-empty">No preferences recorded</div>}
                </div>

                <div className="card">
                  <div className="card-head">
                    <div className="card-title"><i className="ti ti-clipboard-text" /> Terms &amp; notes</div>
                    <button className="card-action" onClick={openEditModal}>Edit</button>
                  </div>
                  <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Payment terms</div>
                      <div>{client.terms || <span style={{ color: 'var(--text3)' }}>Not set</span>}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Notes</div>
                      {client.notesAr && <div style={{ fontFamily: "'Noto Sans Arabic',sans-serif", direction: 'rtl', fontSize: 13.5 }}>{client.notesAr}</div>}
                      {client.notesEn && <div style={{ color: 'var(--text3)', fontStyle: 'italic', marginTop: 4, fontSize: 12.5 }}>{client.notesEn}</div>}
                      {!client.notesAr && !client.notesEn && <div style={{ color: 'var(--text3)' }}>No notes</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════ ORDER HISTORY ════════════ */}
        {view === 'orders' && (
          <div className="fade-up">
            <div className="view-head">
              <div>
                <div className="view-title">Order history</div>
                <div className="view-sub">
                  <span className="meta-row"><i className="ti ti-user" /> {client.name}</span>
                  <span className="meta-row"><i className="ti ti-file-invoice" /> {ORDERS.length} orders</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn" onClick={() => navigate(`/orders/new?clientId=${cid}`)}><i className="ti ti-plus" style={{ fontSize: 15 }} /> New order</button>
                <button className="btn-export" onClick={exportOrders}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="stmt-cell"><div className="l">Total orders</div><div className="v">{ORDERS.length}</div><div className="s">all time</div></div>
              <div className="stmt-cell"><div className="l">Delivered</div><div className="v green">{ordDelivered}</div><div className="s">completed</div></div>
              <div className="stmt-cell"><div className="l">Draft</div><div className="v amber">{ordDraft}</div><div className="s">not yet delivered</div></div>
            </div>

            <div className="filter-row">
              <div className="filter-search">
                <i className="ti ti-search" />
                <input placeholder="Search order or charcoal…" value={ordQ} onChange={e => setOrdQ(e.target.value)} />
              </div>
              <div className="seg">
                {[['all', 'All'], ['confirmed', 'Confirmed'], ['partially_delivered', 'In delivery'], ['delivered', 'Delivered'], ['invoiced', 'Invoiced'], ['paid', 'Paid'], ['draft', 'Draft']].map(([k, lbl]) => (
                  <div key={k} className={`seg-opt ${ordStatus === k ? 'sel' : ''}`} onClick={() => setOrdStatus(k)}>{lbl}</div>
                ))}
              </div>
            </div>

            <div className="card">
              <table className="data-table">
                <thead><tr>
                  <th style={{ width: 120 }}>Date</th><th>Order</th><th style={{ width: 60 }}>Type</th>
                  <th>Weight</th><th className="right" style={{ width: 100 }}>Price/bag</th>
                  <th style={{ width: 90 }}>Status</th><th className="right" style={{ width: 90 }}>Actions</th>
                </tr></thead>
                <tbody>
                  {ordersQ.isLoading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
                  {!ordersQ.isLoading && filteredOrders.length === 0 && <tr><td colSpan={7} className="empty">No orders match this filter</td></tr>}
                  {filteredOrders.map(o => (
                    <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/orders/' + o.id)}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{o.date}</td>
                      <td>
                        <div style={{ fontWeight: 500, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }} title={o.id}>{o.displayId}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {o.char}{o.supplier ? ` · ${o.supplier}` : ''}{o.bagTypeName ? ` · ${o.bagTypeName}` : ''}
                        </div>
                      </td>
                      <td><span className={`badge ${o.isBag ? 'badge-blue' : 'badge-amber'}`}>{o.isBag ? 'Bag' : 'KG'}</span></td>
                      <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{o.items}</td>
                      <td className="num" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>${o.total.toFixed(2)}</td>
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
            </div>
          </div>
        )}

        {/* ════════════ INVOICES ════════════ */}
        {view === 'invoices' && (
          <div className="fade-up">
            <div className="view-head">
              <div>
                <div className="view-title">Invoices</div>
                <div className="view-sub">
                  <span className="meta-row"><i className="ti ti-user" /> {client.name}</span>
                  <span className="meta-row"><i className="ti ti-receipt-2" /> {INVOICES.length} issued</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn" onClick={() => setOrderOpen(true)}><i className="ti ti-plus" style={{ fontSize: 15 }} /> Make invoice</button>
                <button className="btn-export" onClick={exportInvoices}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
              <div className="stmt-cell"><div className="l">Issued</div><div className="v">{INVOICES.length}</div><div className="s">invoices</div></div>
              <div className="stmt-cell"><div className="l">Total billed</div><div className="v amber">{fmt(totalInvoiced)}</div><div className="s">all time</div></div>
              <div className="stmt-cell"><div className="l">Total paid</div><div className="v green">{fmt(totalPaidInv)}</div><div className="s">collected</div></div>
              <div className="stmt-cell"><div className="l">Outstanding</div><div className="v">{openInvoices > 0 ? <span style={{ color: 'var(--accent2)' }}>{fmt(totalInvoiced - totalPaidInv)}</span> : fmt(0)}</div><div className="s">{openInvoices} open</div></div>
            </div>

            <div className="card">
              <table className="data-table">
                <thead><tr>
                  <th style={{ width: 120 }}>Issued</th><th>Invoice</th>
                  <th className="right" style={{ width: 100 }}>Amount</th><th className="right" style={{ width: 100 }}>Paid</th>
                  <th className="right" style={{ width: 100 }}>Due</th><th style={{ width: 80 }}>Status</th>
                  <th className="right" style={{ width: 70 }}>Actions</th>
                </tr></thead>
                <tbody>
                  {invoicesQ.isLoading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
                  {!invoicesQ.isLoading && INVOICES.length === 0 && <tr><td colSpan={7} className="empty">No invoices issued yet</td></tr>}
                  {INVOICES.map(inv => {
                    const due = inv.amount - inv.paid
                    return (
                      <tr key={inv.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{inv.date}</td>
                        <td>
                          <div style={{ fontWeight: 500, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }} title={inv.id}>{inv.displayId}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>from {inv.orderDisplay}</div>
                        </td>
                        <td className="num" style={{ fontWeight: 500 }}>{fmt(inv.amount)}</td>
                        <td className="num green">{fmt(inv.paid)}</td>
                        <td className="num" style={{ color: due > 0 ? 'var(--accent2)' : 'var(--text3)', fontWeight: due > 0 ? 600 : 400 }}>{fmt(due)}</td>
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
            </div>
          </div>
        )}

        {/* ════════════ WAREHOUSE SALES ════════════ */}
        {view === 'warehouse' && (
          <div className="fade-up">
            <div className="view-head">
              <div>
                <div className="view-title">Warehouse sales</div>
                <div className="view-sub">
                  <span className="meta-row"><i className="ti ti-user" /> {client.name}</span>
                  <span className="meta-row"><i className="ti ti-building-warehouse" /> {WAREHOUSE.length} purchases</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn-export" onClick={exportWarehouse}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="stmt-cell"><div className="l">Purchases</div><div className="v">{WAREHOUSE.length}</div><div className="s">transactions</div></div>
              <div className="stmt-cell"><div className="l">Total kg sold</div><div className="v">{warehouseKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</div><div className="s">across all grades</div></div>
              <div className="stmt-cell"><div className="l">Total amount</div><div className="v amber">{fmt(warehouseTotal)}</div><div className="s">charged</div></div>
            </div>

            <div className="card">
              <table className="data-table">
                <thead><tr>
                  <th>Date</th><th>Bag type</th><th>Charcoal</th>
                  <th className="right">Qty</th><th className="right">Kg sold</th><th className="right">Amount</th><th>Logged by</th>
                </tr></thead>
                <tbody>
                  {warehouseExitsQ.isLoading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
                  {!warehouseExitsQ.isLoading && WAREHOUSE.length === 0 && <tr><td colSpan={7} className="empty">No warehouse sales recorded</td></tr>}
                  {WAREHOUSE.map(w => (
                    <tr key={w.id}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{w.date}</td>
                      <td>{w.isRaw
                        ? <span className="badge badge-amber">By kg</span>
                        : <><div style={{ fontWeight: 500 }}>{w.bagTypeName ?? '—'}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{w.bagNominal}</div></>}</td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{w.charcoal}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{w.qty ?? '—'}</td>
                      <td className="num" style={{ color: 'var(--text2)' }}>{w.kg > 0 ? `${w.kg.toFixed(1)} kg` : '—'}</td>
                      <td className="num" style={{ fontWeight: 600, color: w.amount ? 'var(--accent2)' : 'var(--text3)' }}>{w.amount ? fmt(w.amount) : '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{w.by}</td>
                    </tr>
                  ))}
                </tbody>
                {WAREHOUSE.length > 0 && (
                  <tfoot><tr>
                    <td colSpan={5} style={{ textAlign: 'right', background: 'var(--surface2)', fontWeight: 700 }}>Total</td>
                    <td className="num amber" style={{ background: 'var(--surface2)', fontWeight: 700, borderTop: '2px solid var(--border2)' }}>{fmt(warehouseTotal)}</td>
                    <td style={{ background: 'var(--surface2)', borderTop: '2px solid var(--border2)' }}></td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {/* ════════════ STATEMENT OF ACCOUNT ════════════ */}
        {view === 'statement' && (
          <div className="fade-up stmt-view">
            <div className="view-head">
              <div>
                <div className="view-title">Statement of account</div>
                <div className="view-sub">
                  <span className="meta-row"><i className="ti ti-user" /> {client.name}</span>
                  <span className="meta-row"><i className="ti ti-calendar" /> {stmtPeriod}</span>
                  <span className="meta-row"><i className="ti ti-currency-dollar" /> {client.currency}</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print</button>
                <button className="btn-export" onClick={exportStatement}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="filter-row">
              <div className="filter-search">
                <i className="ti ti-search" />
                <input placeholder="Search description or ref…" value={stmtQ} onChange={e => setStmtQ(e.target.value)} />
              </div>
              <div className="seg">
                {([['all', 'All'], ['debit', 'Charges'], ['credit', 'Payments']] as const).map(([k, lbl]) => (
                  <div key={k} className={`seg-opt ${stmtType === k ? 'sel' : ''}`} onClick={() => setStmtType(k)}>{lbl}</div>
                ))}
              </div>
              <div className="filter-dates">
                <span className="lbl">From</span>
                <input className="date-mini" type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} />
                <span className="lbl">To</span>
                <input className="date-mini" type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} />
              </div>
              {stmtFilterActive ? <button className="btn" onClick={resetStmt}><i className="ti ti-x" style={{ fontSize: 14 }} /> Reset</button> : null}
            </div>

            {/* Opening / closing summary */}
            <div className="stmt-summary">
              <div className="stmt-cell"><div className="l">Opening balance</div><div className="v">{fmt(stmtOpening)}</div><div className="s">{stmtOpeningDate}</div></div>
              <div className="stmt-cell"><div className="l">Total debit</div><div className="v amber">{fmt(stmtDebit)}</div><div className="s">charges &amp; invoices</div></div>
              <div className="stmt-cell"><div className="l">Total credit</div><div className="v green">{fmt(stmtCredit)}</div><div className="s">payments received</div></div>
              <div className="stmt-cell"><div className="l">Closing balance</div><div className={`v ${stmtClosing > 0 ? 'amber' : stmtClosing < 0 ? 'red' : 'green'}`}>{fmt(stmtClosing)}</div><div className="s">{stmtClosing > 0 ? 'owed by client' : stmtClosing < 0 ? 'in credit' : 'settled'}</div></div>
            </div>

            <div className="card">
              <table className="data-table stmt-table">
                <thead><tr>
                  <th style={{ width: 165 }}>Date &amp; time</th><th style={{ width: 90 }}>Ref</th><th>Description</th>
                  <th className="right" style={{ width: 120 }}>Debit</th><th className="right" style={{ width: 120 }}>Credit</th>
                  <th className="right" style={{ width: 130 }}>Balance</th>
                </tr></thead>
                <tbody>
                  <tr className="opening">
                    <td className="mono">{stmtOpeningDate}</td>
                    <td></td>
                    <td className="desc">Opening balance</td>
                    <td className="num"></td><td className="num"></td>
                    <td className="num">{fmt(stmtOpening)}</td>
                  </tr>
                  {stmtFiltered.map((e, i) => {
                    return (
                      <tr key={i}>
                        <td className="mono">{fmtDateTime(e.rawDate)}</td>
                        <td className="mono ref-cell">
                          {e.kind === 'invoice' ? (
                            <a href={`/invoice/${e.referenceId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{e.ref}</a>
                          ) : (
                            <span style={{ color: e.kind === 'payment' ? 'var(--accent)' : undefined }}>{e.ref}</span>
                          )}
                        </td>
                        <td className="desc">{e.desc}</td>
                        <td className="num dr">{e.debit ? fmt(e.debit) : ''}</td>
                        <td className="num cr">{e.credit ? fmt(e.credit) : ''}</td>
                        <td className={`num ${e.balance < 0 ? 'bal-neg' : 'bal-pos'}`} style={{ fontWeight: 600 }}>{fmt(e.balance)}</td>
                      </tr>
                    )
                  })}
                  {stmtFiltered.length === 0 && <tr><td colSpan={6} className="empty">No entries match this filter</td></tr>}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3} style={{ textAlign: 'right' }}>Totals</td>
                  <td className="num dr">{fmt(stmtDebit)}</td>
                  <td className="num cr">{fmt(stmtCredit)}</td>
                  <td className="num">{fmt(stmtClosing)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ════════════ ALL PAYMENTS ════════════ */}
        {view === 'payments' && (
          <div className="fade-up">
            <div className="view-head">
              <div>
                <div className="view-title">All payments</div>
                <div className="view-sub">
                  <span className="meta-row"><i className="ti ti-user" /> {client.name}</span>
                  <span className="meta-row"><i className="ti ti-cash" /> {PAYMENTS.length} payments on record</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn" onClick={() => { setPayDate(new Date().toISOString().slice(0, 10)); setPayModalOpen(true) }}><i className="ti ti-plus" style={{ fontSize: 15 }} /> Log payment</button>
                <button className="btn-export" onClick={exportPayments}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="stmt-cell"><div className="l">Total received</div><div className="v green">{fmt(paymentsTotal)}</div><div className="s">all time</div></div>
              <div className="stmt-cell"><div className="l">Payments</div><div className="v">{PAYMENTS.length}</div><div className="s">transactions</div></div>
              <div className="stmt-cell"><div className="l">Last payment</div><div className="v">{lastPayment ? fmt(lastPayment.amount) : '—'}</div><div className="s">{lastPayment ? lastPayment.date : '—'}</div></div>
            </div>

            <div className="card">
              <table className="data-table">
                <thead><tr>
                  <th style={{ width: 90 }}>Receipt #</th>
                  <th style={{ width: 130 }}>Date</th><th style={{ width: 90 }}>Method</th>
                  <th>Invoice / Ref</th><th>Received by</th>
                  <th className="right" style={{ width: 120 }}>Amount</th><th className="right" style={{ width: 140 }}>Running total</th>
                </tr></thead>
                <tbody>
                  {paymentsQ.isLoading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
                  {!paymentsQ.isLoading && PAYMENTS.length === 0 && <tr><td colSpan={7} className="empty">No payments recorded</td></tr>}
                  {paymentsWithRun.map(p => (
                    <tr key={p.id}>
                      <td><span className="mono" style={{ fontSize: 12 }} title={p.id}>{p.displayId}</span></td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{p.date}</td>
                      <td><span className="badge badge-gray">{p.method}</span></td>
                      <td>
                        {p.invId
                          ? <a href={`/invoice/${p.invId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{p.invDisplay}</a>
                          : <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text3)' }}>—</span>}
                        {p.ref && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>{p.ref}</span>}
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{p.by}</td>
                      <td className="num green" style={{ fontWeight: 600 }}>+{fmt(p.amount)}</td>
                      <td className="num" style={{ color: 'var(--text2)' }}>{fmt(p.run)}</td>
                    </tr>
                  ))}
                </tbody>
                {PAYMENTS.length > 0 && (
                  <tfoot><tr>
                    <td colSpan={5} style={{ textAlign: 'right', background: 'var(--surface2)', fontWeight: 700 }}>Total received</td>
                    <td className="num green" style={{ background: 'var(--surface2)', fontWeight: 700, borderTop: '2px solid var(--border2)' }}>{fmt(paymentsTotal)}</td>
                    <td style={{ background: 'var(--surface2)', borderTop: '2px solid var(--border2)' }}></td>
                  </tr></tfoot>
                )}
              </table>
              {totalInvoiced > 0 && (
                <div className="pay-kpis">
                  <div className="pay-kpi"><div className="lbl">Total invoiced</div><div className="val">{fmt(totalInvoiced)}</div></div>
                  <div className="pay-kpi"><div className="lbl">Total paid</div><div className="val green">{fmt(totalPaidInv)}</div></div>
                  <div className="pay-kpi"><div className="lbl">Outstanding</div><div className="val amber">{fmt(totalInvoiced - totalPaidInv)}</div></div>
                </div>
              )}
            </div>
          </div>
        )}
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
                    {['USD', 'LBP', 'EUR'].map(cc => <option key={cc}>{cc}</option>)}
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
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
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
                          <option value="">Select bag type…</option>
                          {bagTypeNames.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                        <select style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", background: 'var(--surface)', color: 'var(--text)' }}
                          value={l.char} onChange={e => updateOrderLine(l.id, 'char', e.target.value)}>
                          {CHARCOAL_TYPES.map(ct => <option key={ct}>{ct}</option>)}
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
                        {fmt(roundDp(l.qty * l.price))}
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
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
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
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>payment will deduct from outstanding {fmt(outstandingBal)}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setPayModalOpen(false)}>Cancel</button>
                <button className="btn green" onClick={savePayment} disabled={createPaymentM.isPending}><i className="ti ti-check" style={{ fontSize: 15 }} /> {createPaymentM.isPending ? 'Saving…' : 'Log payment'}</button>
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
