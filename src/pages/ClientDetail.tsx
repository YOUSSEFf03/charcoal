import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient, useUpdateClient, useAddPhone, useDeactivatePhone } from '../hooks/useClients'
import { useInvoices } from '../hooks/useInvoices'
import { useClientLedger } from '../hooks/useReports'
import { useOrders, useCreateOrder } from '../hooks/useOrders'
import { useBagTypes } from '../hooks/useBagTypes'
import { useStockExits, useClientWarehouseSummary } from '../hooks/useWarehouse'
import { usePayments, useCreatePayment } from '../hooks/usePayments'
import { useCashReceivers } from '../hooks/useUsers'
import { useRate } from '../context/RateContext'
import { roundDp, formatUsd } from '../lib/money'
import { formatDate, formatDateTime, toDateOnlyString } from '../lib/date'
import { exportExcel, type ExcelColumn } from '../lib/excelExport'
import { buildStatementPdf, exportStatementPdf, statementPdfFilename, type StatementPdfConfig } from '../lib/statementPdf'
import { toWhatsAppDigits } from '../lib/phone'
import { useExportColumnsModal } from '../components/ui/ExportColumnsModal'
import SortHeader, { toggleSort } from '../components/ui/SortHeader'
import { api } from '../lib/api'
import type { Invoice, PaginatedResponse } from '../types/api'

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
function fmt(n: number) { return formatUsd(n) }
function fmtDate(iso?: string | null) { return formatDate(iso, { day: '2-digit' }) }
function fmtDateTime(iso?: string | null) { return formatDateTime(iso, { day: '2-digit' }) }
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

  // Invoice table pagination — server-side, 20/page. KPIs (totalInvoiced,
  // totalPaid, outstanding, openInvoices) do NOT depend on this — they're
  // sourced from ledgerQ, which is already fetched unbounded per client.
  const INVOICE_PAGE_SIZE = 20
  const [invoicePage, setInvoicePage] = useState(1)

  // Warehouse-sales table pagination — server-side, 20/page. KPIs (Purchases
  // count, Total kg sold, Total amount) do NOT depend on this — they're
  // sourced from warehouseSummaryQ, a dedicated unbounded-per-client
  // aggregate (see useClientWarehouseSummary / StockExitsService.
  // getClientWarehouseSummary()).
  const WAREHOUSE_PAGE_SIZE = 20
  const [warehouseSalesPage, setWarehouseSalesPage] = useState(1)

  // Payments table pagination — server-side, 20/page. KPIs (Total received,
  // Payments count, Last payment) do NOT depend on this — they're sourced
  // from ledgerQ / paymentsQ.data.total, both already unbounded per client.
  const PAYMENT_PAGE_SIZE = 20
  const [paymentPage, setPaymentPage] = useState(1)

  // Invoices/Payments are genuinely server-paginated (20/page), so their
  // sort has to be applied server-side too — sorting only the currently
  // loaded page would be misleading (e.g. "highest amount" could miss the
  // real highest if it's on another page). Declared here, before the query
  // hooks below, so they can feed straight into useInvoices()/usePayments().
  const [invoiceSort, setInvoiceSort] = useState<{ key: 'date' | 'amount' | 'paid' | 'status'; order: 'asc' | 'desc' } | null>(null)
  const [paymentSort, setPaymentSort] = useState<{ key: 'date' | 'amount'; order: 'asc' | 'desc' } | null>(null)

  // Live client + related data.
  const clientQ = useClient(cid)
  const ordersQ = useOrders({ clientId: cid, limit: 200 })
  const invoicesQ = useInvoices({
    clientId: cid, page: invoicePage, limit: INVOICE_PAGE_SIZE,
    sortBy: invoiceSort?.key, sortOrder: invoiceSort?.order,
  })
  const ledgerQ = useClientLedger(cid)
  const warehouseExitsQ = useStockExits({ clientId: cid, page: warehouseSalesPage, limit: WAREHOUSE_PAGE_SIZE })
  const warehouseSummaryQ = useClientWarehouseSummary(cid)
  const paymentsQ = usePayments({
    clientId: cid, page: paymentPage, limit: PAYMENT_PAGE_SIZE,
    sortBy: paymentSort?.key, sortOrder: paymentSort?.order,
  })
  const { rawRate } = useRate()
  const createOrder = useCreateOrder()
  const createPaymentM = useCreatePayment()
  const updateClient = useUpdateClient()
  const addPhone = useAddPhone()
  const deactivatePhone = useDeactivatePhone()
  const bagTypesQ = useBagTypes()
  const bagTypesList = bagTypesQ.data ?? []
  const bagTypeNames = bagTypesList.map(b => b.name)
  const defaultPriceByName: Record<string, number> = Object.fromEntries(
    bagTypesList.map(b => [b.name, b.costPerBag ? parseFloat(b.costPerBag) : 0])
  )
  const warehousePurchases = warehouseExitsQ.data?.data ?? []
  // receiverId must be a real User ID (payments_receiverId_fkey → users
  // table). useCashReceivers() now resolves a real id for every role that can
  // receive cash (owner/accountant/sales_rep/worker/receiver) — workers have
  // a linked User via Worker.userId (see the add_worker_user_link migration),
  // so they no longer stay name-only/unresolvable the way they used to.
  const receiversQ = useCashReceivers()
  const allReceivers = receiversQ.data ?? []

  // Reset the invoice table to page 1 whenever the client changes — otherwise
  // navigating from a client with many invoice pages to one with fewer could
  // land on a page past the end (empty/stale table).
  useEffect(() => { setInvoicePage(1) }, [cid])
  // Same reset for the warehouse-sales table.
  useEffect(() => { setWarehouseSalesPage(1) }, [cid])
  // Same reset for the payments table.
  useEffect(() => { setPaymentPage(1) }, [cid])

  const c = clientQ.data
  const invoiceRows = invoicesQ.data?.data ?? []
  const invoiceTotal = invoicesQ.data?.total ?? invoiceRows.length
  const invoiceTotalPages = Math.max(1, Math.ceil(invoiceTotal / INVOICE_PAGE_SIZE))
  const paymentRows = paymentsQ.data?.data ?? []
  const paymentCount = paymentsQ.data?.total ?? paymentRows.length
  const paymentTotalPages = Math.max(1, Math.ceil(paymentCount / PAYMENT_PAGE_SIZE))
  const warehouseSalesTotal = warehouseExitsQ.data?.total ?? 0
  const warehouseSalesTotalPages = Math.max(1, Math.ceil(warehouseSalesTotal / WAREHOUSE_PAGE_SIZE))

  // Derive the display view-model from the API client (graceful for missing fields).
  const initials = (c?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const outstandingBal = c ? parseFloat(c.balance) : 0
  const avgDays = c?.avgOrderDays ? Math.round(parseFloat(c.avgOrderDays)) : 0
  const daysSinceOrder = c?.lastOrderDate ? Math.round((Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000) : 0
  const activePhones = c?.phones ?? []
  const preferred = (c?.preferredTypes ?? []).map(p => `${p.charcoalType} · ${p.grade}`)

  // Real backend display ID keyed by order id, to resolve the related order of an
  // invoice (invoices carry only orderId).
  const orderDisplayById = new Map((ordersQ.data?.data ?? []).map(o => [o.id, o.displayId]))

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
    invDisplay: p.invoiceId ? (p.invoice?.displayId ?? p.invoiceId) : '—',
    // receiver (authoritative relation, same value cash attribution uses)
    // takes priority over receiverName (a denormalized display string set at
    // creation time — goes stale if the receiver's name is later edited).
    by: p.receiver?.name ?? p.receiverName ?? '—',
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
      kg: totalKg,
      total: pricePerUnit,
      bagCount,
      orderTotal,
      status: o.status,
      isBag,
    }
  })

  // Display-only USD amount for a warehouse-sale exit. StockExit.amount is
  // NULL for invoice-linked registered-client sales (the real price lives on
  // a specific line of the linked invoice instead — see StockExit.invoiceId
  // doc comment in schema.prisma) — treating that as $0 was the bug found in
  // the ClientDetail warehouse-sales audit. Exact same fallback rule as
  // WarehouseSales.tsx's exitDisplayAmountUsd() — ported, not reinvented, so
  // the two pages can never disagree. Returns null (not 0) when no price can
  // be resolved at all, so the table can still distinguish "$0" from "unknown".
  function exitDisplayAmountUsd(exit: any): number | null {
    if (exit.amount != null) {
      const amt = parseFloat(exit.amount)
      return exit.currency === 'LBP' ? (rawRate > 0 ? amt / rawRate : 0) : amt
    }
    if (exit.invoice) {
      const lines: any[] = exit.invoice.lines ?? []
      const line = exit.lotId
        ? (lines.find(l => l.saleUnit === 'KG' && exit.lot && l.description === `${exit.lot.charcoalType} Grade ${exit.lot.grade}`)
          ?? lines.find(l => l.saleUnit === 'KG'))
        : lines.find(l => l.bagTypeId === exit.bagTypeId)
      if (!line) return null
      const qty = exit.lotId ? (parseFloat(exit.kgQuantity ?? '0') || 0) : (exit.quantity ?? 0)
      const unitPrice = parseFloat((exit.lotId ? line.pricePerKg : line.pricePerBag) ?? '0') || 0
      const amt = qty * unitPrice
      return exit.invoice.currency === 'LBP' ? (rawRate > 0 ? amt / rawRate : 0) : amt
    }
    return null
  }

  // Warehouse-sale rows derived for the sub-view table (export fetches its
  // own complete-history data separately — see exportWarehouse()).
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
      amount: exitDisplayAmountUsd(exit),
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
      // Present on 'invoice' entries only — see openInvoices below.
      status:      e.status,
    }
  })
  const totalCharged = LEDGER.reduce((s, e) => s + e.debit, 0)
  const totalPaid    = LEDGER.reduce((s, e) => s + e.credit, 0)
  // Open-invoice count derived from the already-unbounded-per-client ledger —
  // no second, page-scoped invoice query. Same "open" definition as before
  // (not paid, not cancelled).
  const openInvoices = LEDGER.filter(e => e.kind === 'invoice' && e.status !== 'paid' && e.status !== 'cancelled').length

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
    name: c?.name ?? '', nameAr: c?.nameAr ?? '', initials, type: c?.type ?? 'restaurant', currency: c?.currency ?? 'USD',
    address: c?.address ?? '', terms: c?.paymentTerms ?? '', limit: c?.creditLimit ? parseFloat(c.creditLimit) : 0,
    notesAr: c?.notes ?? '', notesEn: c?.notesEn ?? '',
    phones: activePhones.map(p => ({ number: p.number, label: p.label, meta: p.isActive ? 'active' : 'inactive', active: p.isActive, primary: false })),
    preferred, outstandingBal, openInvoices, daysSinceOrder, avgDays,
  }))

  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)

  const [editForm, setEditForm] = useState({ ...client })
  const [orderLines, setOrderLines] = useState([{ id: _olid++, bag: '', char: 'BBQ Hardwood · A', qty: 0, price: 0 }])
  const [payDate, setPayDate] = useState(toDateOnlyString(new Date()))
  const [payMethod, setPayMethod] = useState('cash')
  const [payAmt, setPayAmt] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payReceiverName, setPayReceiverName] = useState('')
  const resolvedPayReceiverId = allReceivers.find(r => r.name === payReceiverName)?.id

  // Sub-view local filters.
  const [ordStatus, setOrdStatus] = useState('all')
  const [ordQ, setOrdQ] = useState('')
  const [stmtFrom, setStmtFrom] = useState('')
  const [stmtTo, setStmtTo] = useState('')
  const [stmtType, setStmtType] = useState<'all' | 'debit' | 'credit'>('all')
  const [stmtQ, setStmtQ] = useState('')

  // Sort state for Orders/Statement — invoiceSort/paymentSort are declared
  // earlier (before their query hooks; see the block above ordersQ/paymentsQ)
  // since those two need to feed the backend's sortBy/sortOrder directly.
  // Orders/Statement sort the already-fully-loaded in-memory array
  // client-side instead (Orders fetches up to 200 rows in one shot;
  // Statement's LEDGER is the full unpaginated ledger) — safe and correct
  // since every matching row is already on the client.
  type OrderSortKey = 'date' | 'kg' | 'price'
  type StmtSortKey = 'date' | 'debit' | 'credit' | 'balance'
  const [orderSort, setOrderSort] = useState<{ key: OrderSortKey; order: 'asc' | 'desc' } | null>(null)
  const [stmtSort, setStmtSort] = useState<{ key: StmtSortKey; order: 'asc' | 'desc' } | null>(null)

  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // ── Export-PDF split-button menu (Download / Share / Share via WhatsApp) ──
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  // Web Share API file-sharing (Level 2) is the only mechanism that can hand
  // the PDF directly to an installed app (WhatsApp Desktop, Mail, etc.) via
  // the native OS share sheet — supported in Chromium on Windows 10 1809+/11
  // (and Android/iOS), not in Firefox or non-secure contexts. Checked once;
  // the "Share…" menu item only renders when this is true.
  const [canShareFiles] = useState(() => {
    try {
      return typeof navigator !== 'undefined' && !!navigator.canShare &&
        navigator.canShare({ files: [new File([''], 'test.pdf', { type: 'application/pdf' })] })
    } catch {
      return false
    }
  })
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  // The column-selection modal itself owns the in-flight/disabled UX for
  // each export now (see useExportColumnsModal below), so a per-export
  // "am I currently exporting" flag on the trigger button is no longer
  // needed — the trigger just opens the modal synchronously.
  const { openExportModal, exportColumnsModal } = useExportColumnsModal()

  // Resync the editable view-model once the API client arrives.
  useEffect(() => {
    if (!c) return
    setClient({
      name: c.name, nameAr: c.nameAr ?? '', initials, type: c.type, currency: c.currency,
      address: c.address ?? '', terms: c.paymentTerms ?? '', limit: c.creditLimit ? parseFloat(c.creditLimit) : 0,
      notesAr: c.notes ?? '', notesEn: c.notesEn ?? '',
      phones: c.phones.map(p => ({ number: p.number, label: p.label, meta: p.isActive ? 'active' : 'inactive', active: p.isActive, primary: false })),
      preferred, outstandingBal, openInvoices, daysSinceOrder, avgDays,
    })
    // openInvoices is now ledger-derived (unbounded per-client), so resync on
    // ledger entry count rather than the paginated invoice page's row count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, c?.updatedAt, ledgerQ.data?.entries?.length ?? 0])

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

  function exportOrders() {
    if (filteredOrders.length === 0) { showToast('Nothing to export'); return }
    const columns: ExcelColumn<(typeof filteredOrders)[number]>[] = [
      { key: 'date', header: 'Date', type: 'date', value: o => o.rawDate ? new Date(o.rawDate) : null },
      { key: 'orderNo', header: 'Order #', value: o => o.displayId },
      { key: 'type', header: 'Type', value: o => o.isBag ? 'Bag' : 'KG' },
      { key: 'charcoal', header: 'Charcoal', value: o => o.char },
      { key: 'weight', header: 'Weight', value: o => o.items },
      { key: 'price', header: 'Price/bag', type: 'currency', value: o => o.total },
      { key: 'status', header: 'Status', value: o => o.status },
    ]
    openExportModal({
      title: 'Orders', subtitle: client.name, columns,
      onExport: async selectedColumns => {
        await exportExcel({
          filename: `${cid}-orders`, sheetName: 'Orders', title: `Orders — ${client.name}`,
          columns: selectedColumns, rows: filteredOrders,
        })
        showToast(`Exported ${filteredOrders.length} rows`)
      },
    })
  }
  // The on-screen table is paginated (20/page) — export must cover the
  // client's FULL invoice history, so it fetches its own pages directly
  // (limit:100 per request) rather than reading the capped table state.
  const EXPORT_PAGE_SIZE = 100
  function exportInvoices() {
    // Column definitions never depend on the fetched rows, so the picker can
    // open immediately — the full-history page-fetch loop only runs once the
    // user actually confirms, so Cancel costs nothing.
    const columns: ExcelColumn<Invoice>[] = [
      { key: 'issued', header: 'Issued', type: 'date', value: inv => new Date(inv.issuedAt ?? inv.createdAt) },
      { key: 'invoiceNo', header: 'Invoice #', value: inv => inv.displayId ?? inv.id.slice(0, 8).toUpperCase() },
      { key: 'fromOrder', header: 'From Order', value: inv => inv.orderId ? (orderDisplayById.get(inv.orderId) ?? inv.orderId) : null },
      { key: 'amount', header: 'Amount', type: 'currency', value: inv => parseFloat(inv.total), total: 'sum' },
      { key: 'paid', header: 'Paid', type: 'currency', value: inv => parseFloat(inv.paidAmount), total: 'sum' },
      { key: 'due', header: 'Due', type: 'currency', value: inv => parseFloat(inv.total) - parseFloat(inv.paidAmount), total: 'sum' },
      { key: 'status', header: 'Status', value: inv => inv.status },
    ]
    openExportModal({
      title: 'Invoices', subtitle: client.name, columns,
      onExport: async selectedColumns => {
        try {
          let all: Invoice[] = []
          let fetchPage = 1
          let total = Infinity
          while (all.length < total) {
            const res = await api.get<PaginatedResponse<Invoice>>('/invoices', {
              params: { clientId: cid, page: fetchPage, limit: EXPORT_PAGE_SIZE },
            })
            const { data, total: resTotal } = res.data
            total = resTotal
            if (data.length === 0) break
            all = all.concat(data)
            if (all.length >= total) break
            fetchPage++
          }
          if (all.length === 0) { showToast('Nothing to export'); return }
          await exportExcel({
            filename: `${cid}-invoices`, sheetName: 'Invoices', title: `Invoices — ${client.name}`,
            columns: selectedColumns, rows: all,
          })
          showToast(`Exported ${all.length} rows`)
        } catch (e) {
          console.error('Failed to export invoices:', e)
          showToast('Failed to export invoices')
        }
      },
    })
  }
  // The on-screen table is paginated (20/page) — export must cover the
  // client's FULL warehouse-sales history, so it fetches its own pages
  // directly (limit:100 per request) rather than reading the capped table
  // state. Mirrors exportInvoices()'s page-loop exactly.
  interface WarehouseExportRow {
    date: Date | null; bagType: string; charcoal: string
    qty: number | null; kg: number | null; amount: number; loggedBy: string
  }
  function exportWarehouse() {
    const columns: ExcelColumn<WarehouseExportRow>[] = [
      { key: 'date', header: 'Date', type: 'date', value: r => r.date },
      { key: 'bagType', header: 'Bag type', value: r => r.bagType },
      { key: 'charcoal', header: 'Charcoal', value: r => r.charcoal },
      { key: 'qty', header: 'Qty', type: 'number', value: r => r.qty },
      { key: 'kg', header: 'Kg sold', type: 'number', decimals: 2, value: r => r.kg },
      { key: 'amount', header: 'Amount', type: 'currency', value: r => r.amount, total: 'sum' },
      { key: 'loggedBy', header: 'Logged by', value: r => r.loggedBy },
    ]
    openExportModal({
      title: 'Warehouse sales', subtitle: client.name, columns,
      onExport: async selectedColumns => {
        try {
          let all: any[] = []
          let fetchPage = 1
          let total = Infinity
          while (all.length < total) {
            const res = await api.get<{ data: any[]; total: number }>('/stock-exits', {
              params: { clientId: cid, page: fetchPage, limit: EXPORT_PAGE_SIZE },
            })
            const { data, total: resTotal } = res.data
            total = resTotal
            if (data.length === 0) break
            all = all.concat(data)
            if (all.length >= total) break
            fetchPage++
          }
          if (all.length === 0) { showToast('Nothing to export'); return }
          const exportRows: WarehouseExportRow[] = all.map(exit => {
            const isRaw = !!exit.lotId && !exit.packedStockId
            const charcoalLot = isRaw ? exit.lot : exit.packedStock?.lot
            const kgOut = isRaw
              ? parseFloat(exit.kgQuantity ?? '0')
              : exit.bagType ? parseFloat(exit.bagType.nominalKg) * (exit.quantity ?? 0) : 0
            return {
              date: exit.date ? new Date(exit.date) : null,
              bagType: isRaw ? 'By kg' : (exit.bagType?.name ?? '—'),
              charcoal: charcoalLot ? `${charcoalLot.charcoalType} · Grade ${charcoalLot.grade}` : '—',
              qty: isRaw ? null : (exit.quantity ?? null),
              kg: kgOut || null,
              amount: exitDisplayAmountUsd(exit) ?? 0,
              loggedBy: exit.loggedBy?.name ?? '—',
            }
          })
          await exportExcel({
            filename: `${cid}-warehouse`, sheetName: 'Warehouse', title: `Warehouse sales — ${client.name}`,
            columns: selectedColumns, rows: exportRows,
          })
          showToast(`Exported ${exportRows.length} rows`)
        } catch (e) {
          console.error('Failed to export warehouse sales:', e)
          showToast('Failed to export warehouse sales')
        }
      },
    })
  }
  // The on-screen table is paginated (20/page) — export must cover the
  // client's FULL payment history, so it fetches its own pages directly
  // (limit:100 per request) rather than reading the capped table state.
  // Mirrors exportInvoices()'s / exportWarehouse()'s page-loop exactly.
  function exportPayments() {
    const columns: ExcelColumn<any>[] = [
      { key: 'receiptNo', header: 'Receipt #', value: p => p.displayId ?? p.id.slice(0, 8) },
      { key: 'date', header: 'Date', type: 'date', value: p => p.date ? new Date(p.date) : null },
      { key: 'method', header: 'Method', value: p => p.method },
      { key: 'invoice', header: 'Invoice', value: p => p.invoiceId ? (p.invoice?.displayId ?? p.invoiceId) : null },
      { key: 'receivedBy', header: 'Received by', value: p => p.receiver?.name ?? p.receiverName ?? '—' },
      // Deselected by default — the one free-text/optional field among all 7
      // exports' columns; every transactional column stays checked.
      { key: 'notes', header: 'Notes', value: p => p.notes ?? null, defaultSelected: false },
      { key: 'amount', header: 'Amount', type: 'currency', value: p => parseFloat(p.amount), total: 'sum' },
    ]
    openExportModal({
      title: 'Payments', subtitle: client.name, columns,
      onExport: async selectedColumns => {
        try {
          let all: any[] = []
          let fetchPage = 1
          let total = Infinity
          while (all.length < total) {
            const res = await api.get<PaginatedResponse<any>>('/payments', {
              params: { clientId: cid, page: fetchPage, limit: EXPORT_PAGE_SIZE },
            })
            const { data, total: resTotal } = res.data
            total = resTotal
            if (data.length === 0) break
            all = all.concat(data)
            if (all.length >= total) break
            fetchPage++
          }
          if (all.length === 0) { showToast('Nothing to export'); return }
          await exportExcel({
            filename: `${cid}-payments`, sheetName: 'Payments', title: `Payments — ${client.name}`,
            columns: selectedColumns, rows: all,
          })
          showToast(`Exported ${all.length} rows`)
        } catch (e) {
          console.error('Failed to export payments:', e)
          showToast('Failed to export payments')
        }
      },
    })
  }
  function exportStatement() {
    if (stmtFiltered.length === 0) { showToast('Nothing to export'); return }
    const stmtOpeningRawDate = stmtFiltered[0].rawDate ?? (LEDGER[0]?.rawDate ?? new Date().toISOString())
    type StmtRow = { rawDate: string; ref: string; desc: string; debit: number | null; credit: number | null; balance: number }
    const rows: StmtRow[] = [
      { rawDate: stmtOpeningRawDate, ref: '', desc: 'Opening balance', debit: null, credit: null, balance: stmtOpening },
      ...stmtFiltered.map(e => ({ rawDate: e.rawDate, ref: e.ref, desc: e.desc, debit: e.debit || null, credit: e.credit || null, balance: e.balance })),
    ]
    const columns: ExcelColumn<StmtRow>[] = [
      { key: 'date', header: 'Date', type: 'date', value: r => new Date(r.rawDate) },
      { key: 'ref', header: 'Ref', value: r => r.ref || null },
      { key: 'desc', header: 'Description', value: r => r.desc },
      { key: 'debit', header: 'Debit', type: 'currency', value: r => r.debit, total: 'sum' },
      { key: 'credit', header: 'Credit', type: 'currency', value: r => r.credit, total: 'sum' },
      // 'last', not 'sum' — every row's balance is already the running
      // balance as of that row (from the ledger's authoritative
      // runningBalance), so the Total row should show the final row's
      // balance, not Σ(all balances).
      { key: 'balance', header: 'Balance', type: 'currency', value: r => r.balance, total: 'last' },
    ]
    openExportModal({
      title: 'Client Statement', subtitle: client.name, columns,
      onExport: async selectedColumns => {
        await exportExcel({
          filename: `${cid}-statement`, sheetName: 'Statement', title: `Client Statement — ${client.name}`,
          columns: selectedColumns, rows, emphasizeRowIndexes: [0],
        })
        showToast(`Exported ${stmtFiltered.length} rows`)
      },
    })
  }

  // Shared by all three export/share actions below so Download, Share, and
  // Share-via-WhatsApp always render the exact same document from the exact
  // same stmtFiltered/stmtOpening/stmtDebit/stmtCredit/stmtClosing figures
  // already shown on screen and in exportStatement()'s Excel export — no
  // second accounting calculation, no drift between the three actions.
  function statementPdfConfig(): StatementPdfConfig {
    const primaryPhone = client.phones.find(p => p.active)?.number ?? client.phones[0]?.number ?? null
    return {
      client: {
        name: client.name,
        address: client.address || null,
        phone: primaryPhone,
        currency: client.currency,
      },
      // Falls back to the actual first/last row date when no explicit
      // From/To filter is set — same fallback stmtPeriod (shown on screen
      // just above this table) already uses, so the PDF never shows a bare
      // "—" for a statement that plainly does cover real dates.
      from: stmtFrom ? new Date(stmtFrom).toISOString() : (stmtFiltered[0]?.rawDate ?? null),
      to: stmtTo ? new Date(stmtTo).toISOString() : (stmtFiltered[stmtFiltered.length - 1]?.rawDate ?? null),
      rows: stmtFiltered.map(e => ({ ref: e.ref, rawDate: e.rawDate, desc: e.desc, debit: e.debit, credit: e.credit, balance: e.balance })),
      openingBalance: stmtOpening,
      periodDebitTotal: stmtDebit,
      periodCreditTotal: stmtCredit,
      closingBalance: stmtClosing,
    }
  }

  // Downloads the Statement of Account as a PDF directly — no column-picker
  // modal (unlike the Excel export, this always has the complete period;
  // stmtFiltered is never a paginated slice, so there's nothing to fetch first).
  async function downloadStatementPdf() {
    try {
      await exportStatementPdf(statementPdfConfig())
    } catch (e) {
      console.error('Failed to export statement PDF:', e)
      showToast('Failed to export statement PDF')
    }
  }

  // Hands the PDF to the native OS share sheet (Web Share API, file
  // sharing) — the only way a browser can pass a file directly to an
  // installed app. On Windows 10 1809+/11 with a Chromium browser, WhatsApp
  // Desktop shows up there automatically (alongside Mail, Nearby Share,
  // etc.) if it's installed — same file, same document, no manual attach
  // step. Only ever called when canShareFiles is true (menu item is hidden
  // otherwise — Firefox and non-secure contexts don't support this).
  // Deliberately no title/text — some share targets (WhatsApp included) show
  // those as a caption alongside the file, and the ask here is the file
  // alone, no message.
  async function shareStatementPdf() {
    try {
      const doc = await buildStatementPdf(statementPdfConfig())
      const filename = statementPdfFilename(client.name)
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' })
      await navigator.share({ files: [file] })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return // user closed the share sheet — not a failure
      console.error('Failed to share statement PDF:', e)
      showToast('Failed to share statement PDF')
    }
  }

  // WhatsApp has no URL scheme that accepts a pre-attached file (neither
  // wa.me links nor the desktop app's protocol handler expose that, for
  // security reasons — this isn't a gap in this app). So when the native OS
  // share sheet is available (canShareFiles), this hands it the file first —
  // same mechanism as shareStatementPdf() — and the file arrives already
  // attached the moment the user picks WhatsApp from that panel, no manual
  // step. Only when that's unsupported does this fall back to downloading
  // the file and opening a bare WhatsApp chat (wa.me, no pre-filled text) to
  // the client's own number, where the user attaches the just-downloaded
  // file themselves — a genuine platform limitation on browsers/OSes without
  // Web Share file support, not something a web page can route around.
  //
  // Requires a stored phone number even on the native-share branch — this
  // button's whole point is "send to THIS client", so it must never open a
  // blank/unaddressed share with nothing identifying who it's for (see
  // toWhatsAppDigits() in lib/phone.ts for why a naive digit-strip of the
  // stored number isn't enough — real client records include both bare
  // local numbers and malformed "+961 0…" entries).
  async function shareStatementViaWhatsApp() {
    const primaryPhone = client.phones.find(p => p.active)?.number ?? client.phones[0]?.number ?? null
    const digits = toWhatsAppDigits(primaryPhone)
    if (!digits) {
      showToast('No phone number on file for this client')
      return
    }

    if (canShareFiles) {
      try {
        const doc = await buildStatementPdf(statementPdfConfig())
        const filename = statementPdfFilename(client.name)
        const file = new File([doc.output('blob')], filename, { type: 'application/pdf' })
        await navigator.share({ files: [file] })
        return
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return // user closed the share sheet — not a failure
        console.error('Failed to share statement PDF, falling back to download:', e)
        // fall through to the download+wa.me fallback below
      }
    }
    try {
      await exportStatementPdf(statementPdfConfig())
    } catch (e) {
      console.error('Failed to export statement PDF:', e)
      showToast('Failed to export statement PDF')
      return
    }
    window.open(`https://wa.me/${digits}`, '_blank', 'noreferrer')
    showToast('Statement downloaded — attach it in the WhatsApp chat that just opened')
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

  // Persists the Edit modal to the real backend. nameAr/address/creditLimit/
  // notesEn now have real Client columns (migration add_client_profile_fields)
  // — previously these were pure local view-model fields that silently reset
  // to blank on the next refetch, which is exactly the "edit doesn't save"
  // bug this fixes. name/type/currency/paymentTerms/notes go through the same
  // PATCH /clients/:id useUpdateClient() already used correctly by
  // FillClientDetail.tsx. Phones go through the separate add/deactivate
  // endpoints (CONSTRAINT 14 — phones are never deleted, only deactivated;
  // there is no edit-in-place or reactivate endpoint, so those two actions
  // remain local-only exactly as before, matching existing behavior).
  async function saveEdit() {
    if (!cid || !editForm.name.trim()) return
    setEditSaving(true)
    try {
      await updateClient.mutateAsync({
        id: cid,
        body: {
          name: editForm.name.trim(),
          nameAr: editForm.nameAr.trim() || null,
          type: editForm.type as any,
          currency: editForm.currency as any,
          paymentTerms: editForm.terms.trim() || undefined,
          address: editForm.address.trim() || null,
          creditLimit: editForm.limit ? editForm.limit.toFixed(2) : null,
          notes: editForm.notesAr.trim() || undefined,
          notesEn: editForm.notesEn.trim() || null,
        },
      })

      // Phone diff against the untouched pre-edit snapshot (`client.phones`
      // is never mutated while the modal is open — only `editForm` is).
      const originalPhones = client.phones
      const newPhones = editForm.phones.filter(p => !originalPhones.some(op => op.number === p.number))
      const toDeactivate = originalPhones.filter(op => {
        if (!op.active) return false
        const stillPresent = editForm.phones.find(p => p.number === op.number)
        return !stillPresent || !stillPresent.active
      })

      await Promise.all([
        ...newPhones.map(p => addPhone.mutateAsync({ id: cid, body: { number: p.number, label: p.label as any } })),
        ...toDeactivate.map(op => deactivatePhone.mutateAsync({ id: cid, body: { phoneNumber: op.number } })),
      ])

      const ini = editForm.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
      setClient({ ...editForm, initials: ini })
      setEditOpen(false)
      showToast('Client info updated')
    } catch (e: any) {
      showToast(e?.error ?? 'Failed to update client')
    } finally {
      setEditSaving(false)
    }
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
    // Only cash/whish/omt are offered here (the 3-option select below), and
    // all three are personal-custody methods — the backend rejects them with
    // no receiverId (RECEIVER_REQUIRED) anyway; this is just an honest
    // inline message instead of a round-trip 400. Never auto-select one.
    if (!resolvedPayReceiverId) { showToast('Receiver is required.'); return }
    createPaymentM.mutate(
      {
        clientId: cid,
        amount: amt.toFixed(2),
        currency: c?.currency ?? 'USD',
        method: (payMethod as any),
        date: payDate,
        notes: payNote || null,
        receiverId: resolvedPayReceiverId,
      },
      {
        onSuccess: () => {
          // No manual refetch() calls here — useCreatePayment()'s onSuccess
          // (src/hooks/usePayments.ts) already invalidates the client,
          // client-ledger, invoices, and payments query keys, and React
          // Query auto-refetches active queries on invalidation.
          setPayModalOpen(false)
          showToast(`Payment ${fmt(amt)} logged`)
          setPayAmt('')
          setPayNote('')
        },
        onError: (err: any) => showToast(err?.error ?? 'Failed to log payment'),
      }
    )
  }

  /* ── derived sub-view data ── */
  // totalCharged/totalPaid (ledger-derived, unbounded per client) are the
  // KPI source — NOT INVOICES.reduce(...), which would only cover the
  // current 20-row page.

  const filteredOrders = ORDERS.filter(o => {
    if (ordStatus !== 'all' && o.status !== ordStatus) return false
    if (ordQ && !(o.displayId + ' ' + o.char + ' ' + (o.supplier ?? '')).toLowerCase().includes(ordQ.toLowerCase())) return false
    return true
  })
  const ordDelivered = ORDERS.filter(o => o.status === 'delivered').length
  const ordDraft = ORDERS.filter(o => o.status === 'draft').length
  // Sorted separately from filteredOrders — exportOrders() reads
  // filteredOrders directly and must keep exporting the natural (API) order
  // regardless of how the on-screen table is currently sorted.
  const sortedOrders = orderSort ? [...filteredOrders].sort((a, b) => {
    const dir = orderSort.order === 'asc' ? 1 : -1
    if (orderSort.key === 'date') return dir * ((a.rawDate ? new Date(a.rawDate).getTime() : 0) - (b.rawDate ? new Date(b.rawDate).getTime() : 0))
    if (orderSort.key === 'kg') return dir * (a.kg - b.kg)
    return dir * (a.total - b.total)
  }) : filteredOrders

  // Complete-history totals — NOT WAREHOUSE.reduce(...), which would only
  // cover the current 20-row page. Sourced from the dedicated per-client
  // aggregate (see useClientWarehouseSummary).
  const warehousePurchasesCount = warehouseSummaryQ.data?.totalCount ?? 0
  const warehouseKg = parseFloat(warehouseSummaryQ.data?.totalKg ?? '0')
  const warehouseTotal = parseFloat(warehouseSummaryQ.data?.totalAmount ?? '0')

  // "Total received · all time" — NOT a sum over the paginated PAYMENTS page;
  // reuses totalPaid, already computed unbounded from ledgerQ above (same
  // number the Invoices/Statement tabs already show).
  const paymentsTotal = totalPaid
  let paymentsRun = 0
  const paymentsWithRun = PAYMENTS.map(p => { paymentsRun += p.amount; return { ...p, run: paymentsRun } })
  // "Last payment" — sourced from the full, unbounded, chronologically
  // ascending-sorted LEDGER (not the paginated PAYMENTS page), so this is
  // genuinely the most recent payment ever made, not just the oldest one on
  // the current page.
  const paymentLedgerEntries = LEDGER.filter(e => e.kind === 'payment')
  const lastPayment = paymentLedgerEntries.length
    ? { amount: paymentLedgerEntries[paymentLedgerEntries.length - 1].credit, date: paymentLedgerEntries[paymentLedgerEntries.length - 1].date }
    : null

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
  // Table-display-only sort — stmtFiltered itself must stay chronological:
  // stmtOpening/stmtClosing/stmtPeriod above, and exportStatement()'s Excel
  // export, all rely on stmtFiltered[0]/[length-1] being the chronologically
  // first/last row.
  const sortedStmtRows = stmtSort ? [...stmtFiltered].sort((a, b) => {
    const dir = stmtSort.order === 'asc' ? 1 : -1
    if (stmtSort.key === 'date') return dir * ((a.rawDate ? new Date(a.rawDate).getTime() : 0) - (b.rawDate ? new Date(b.rawDate).getTime() : 0))
    if (stmtSort.key === 'debit') return dir * (a.debit - b.debit)
    if (stmtSort.key === 'credit') return dir * (a.credit - b.credit)
    return dir * (a.balance - b.balance)
  }) : stmtFiltered
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
            <button className="btn" onClick={() => { setPayDate(toDateOnlyString(new Date())); setPayModalOpen(true) }}>
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
                    {client.address && <span className="meta-row"><i className="ti ti-map-pin" /> {client.address}</span>}
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
              <button className="action-card" onClick={() => { setPayDate(toDateOnlyString(new Date())); setPayModalOpen(true) }}>
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
                <div className="action-tx"><span className="t">Invoices</span><span className="s">{invoiceTotal} issued</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
              <button className="action-card" onClick={() => setView('warehouse')}>
                <div className="action-ic dark"><i className="ti ti-building-warehouse" /></div>
                <div className="action-tx"><span className="t">Warehouse sales</span><span className="s">{warehousePurchasesCount} purchases</span></div>
                <i className="ti ti-chevron-right chev" />
              </button>
              <button className="action-card" onClick={() => setView('payments')}>
                <div className="action-ic blue"><i className="ti ti-cash" /></div>
                <div className="action-tx"><span className="t">All payments</span><span className="s">{paymentCount} on record</span></div>
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
                        <a className="icon-btn" href={`https://wa.me/${toWhatsAppDigits(p.number)}`} target="_blank" rel="noreferrer" title="WhatsApp"><i className="ti ti-brand-whatsapp" /></a>
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
                  <SortHeader label="Date" sortKey="date" sort={orderSort} onSort={k => toggleSort(orderSort, setOrderSort, k)} width={120} />
                  <th>Order</th><th style={{ width: 60 }}>Type</th>
                  <SortHeader label="Weight" sortKey="kg" sort={orderSort} onSort={k => toggleSort(orderSort, setOrderSort, k)} />
                  <SortHeader label="Price/bag" sortKey="price" sort={orderSort} onSort={k => toggleSort(orderSort, setOrderSort, k)} width={100} align="right" />
                  <th style={{ width: 90 }}>Status</th><th className="right" style={{ width: 90 }}>Actions</th>
                </tr></thead>
                <tbody>
                  {ordersQ.isLoading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
                  {!ordersQ.isLoading && sortedOrders.length === 0 && <tr><td colSpan={7} className="empty">No orders match this filter</td></tr>}
                  {sortedOrders.map(o => (
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
                  <span className="meta-row"><i className="ti ti-receipt-2" /> {invoiceTotal} issued</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn" onClick={() => setOrderOpen(true)}><i className="ti ti-plus" style={{ fontSize: 15 }} /> Make invoice</button>
                <button className="btn-export" onClick={exportInvoices}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
              <div className="stmt-cell"><div className="l">Issued</div><div className="v">{invoiceTotal}</div><div className="s">invoices</div></div>
              <div className="stmt-cell"><div className="l">Total billed</div><div className="v amber">{fmt(totalCharged)}</div><div className="s">all time</div></div>
              <div className="stmt-cell"><div className="l">Total paid</div><div className="v green">{fmt(totalPaid)}</div><div className="s">collected</div></div>
              <div className="stmt-cell"><div className="l">Outstanding</div><div className="v">{openInvoices > 0 ? <span style={{ color: 'var(--accent2)' }}>{fmt(totalCharged - totalPaid)}</span> : fmt(0)}</div><div className="s">{openInvoices} open</div></div>
            </div>

            <div className="card">
              <table className="data-table">
                <thead><tr>
                  <SortHeader label="Issued" sortKey="date" sort={invoiceSort} onSort={k => toggleSort(invoiceSort, setInvoiceSort, k)} width={120} />
                  <th>Invoice</th>
                  <SortHeader label="Amount" sortKey="amount" sort={invoiceSort} onSort={k => toggleSort(invoiceSort, setInvoiceSort, k)} width={100} align="right" />
                  <SortHeader label="Paid" sortKey="paid" sort={invoiceSort} onSort={k => toggleSort(invoiceSort, setInvoiceSort, k)} width={100} align="right" />
                  <th className="right" style={{ width: 100 }}>Due</th>
                  <SortHeader label="Status" sortKey="status" sort={invoiceSort} onSort={k => toggleSort(invoiceSort, setInvoiceSort, k)} width={80} />
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
              {!invoicesQ.isLoading && INVOICES.length > 0 && invoiceTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                  <button className="btn" disabled={invoicePage <= 1} onClick={() => setInvoicePage(p => Math.max(1, p - 1))}>
                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    Page {invoicePage} of {invoiceTotalPages}
                  </span>
                  <button className="btn" disabled={invoicePage >= invoiceTotalPages} onClick={() => setInvoicePage(p => Math.min(invoiceTotalPages, p + 1))}>
                    Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                  </button>
                </div>
              )}
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
                  <span className="meta-row"><i className="ti ti-building-warehouse" /> {warehousePurchasesCount} purchases</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn-export" onClick={exportWarehouse}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="stmt-cell"><div className="l">Purchases</div><div className="v">{warehousePurchasesCount}</div><div className="s">transactions</div></div>
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
              {!warehouseExitsQ.isLoading && WAREHOUSE.length > 0 && warehouseSalesTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                  <button className="btn" disabled={warehouseSalesPage <= 1} onClick={() => setWarehouseSalesPage(p => Math.max(1, p - 1))}>
                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    Page {warehouseSalesPage} of {warehouseSalesTotalPages}
                  </span>
                  <button className="btn" disabled={warehouseSalesPage >= warehouseSalesTotalPages} onClick={() => setWarehouseSalesPage(p => Math.min(warehouseSalesTotalPages, p + 1))}>
                    Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                  </button>
                </div>
              )}
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
              <div className="stmt-actions no-print">
                <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print</button>
                <div ref={exportMenuRef} style={{ position: 'relative' }}>
                  <button className="btn-export" onClick={() => setExportMenuOpen(o => !o)}>
                    <i className="ti ti-download" /> Export PDF <i className="ti ti-chevron-down" style={{ fontSize: 11 }} />
                  </button>
                  {exportMenuOpen && (
                    <div className="export-menu">
                      <button className="export-menu-item" onClick={() => { setExportMenuOpen(false); downloadStatementPdf() }}>
                        <i className="ti ti-download" /> Download
                      </button>
                      {canShareFiles && (
                        <button className="export-menu-item" onClick={() => { setExportMenuOpen(false); shareStatementPdf() }}>
                          <i className="ti ti-share-2" /> Share…
                        </button>
                      )}
                      <button className="export-menu-item whatsapp" onClick={() => { setExportMenuOpen(false); shareStatementViaWhatsApp() }}>
                        <i className="ti ti-brand-whatsapp" /> Share via WhatsApp
                      </button>
                    </div>
                  )}
                </div>
                <button className="btn-export" onClick={exportStatement}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            {/* Filter bar — hidden on print (see .no-print in index.css); the
                view-head above already shows client name + selected period,
                so nothing period-identifying is lost from the printout. Same
                fix already applied to SupplierDetail.tsx's Statement view. */}
            <div className="filter-row no-print">
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
                  <SortHeader label="Date & time" sortKey="date" sort={stmtSort} onSort={k => toggleSort(stmtSort, setStmtSort, k)} width={165} />
                  <th style={{ width: 90 }}>Ref</th><th>Description</th>
                  <SortHeader label="Debit" sortKey="debit" sort={stmtSort} onSort={k => toggleSort(stmtSort, setStmtSort, k)} width={120} align="right" />
                  <SortHeader label="Credit" sortKey="credit" sort={stmtSort} onSort={k => toggleSort(stmtSort, setStmtSort, k)} width={120} align="right" />
                  <SortHeader label="Balance" sortKey="balance" sort={stmtSort} onSort={k => toggleSort(stmtSort, setStmtSort, k)} width={130} align="right" />
                </tr></thead>
                <tbody>
                  {/* Opening balance always renders first, regardless of sort —
                      it's a summary anchor for the period, not a transaction row. */}
                  <tr className="opening">
                    <td className="mono">{stmtOpeningDate}</td>
                    <td></td>
                    <td className="desc">Opening balance</td>
                    <td className="num"></td><td className="num"></td>
                    <td className="num">{fmt(stmtOpening)}</td>
                  </tr>
                  {sortedStmtRows.map((e, i) => {
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
                  <span className="meta-row"><i className="ti ti-cash" /> {paymentCount} payments on record</span>
                </div>
              </div>
              <div className="stmt-actions">
                <button className="btn" onClick={() => { setPayDate(toDateOnlyString(new Date())); setPayModalOpen(true) }}><i className="ti ti-plus" style={{ fontSize: 15 }} /> Log payment</button>
                <button className="btn-export" onClick={exportPayments}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="stmt-cell"><div className="l">Total received</div><div className="v green">{fmt(paymentsTotal)}</div><div className="s">all time</div></div>
              <div className="stmt-cell"><div className="l">Payments</div><div className="v">{paymentCount}</div><div className="s">transactions</div></div>
              <div className="stmt-cell"><div className="l">Last payment</div><div className="v">{lastPayment ? fmt(lastPayment.amount) : '—'}</div><div className="s">{lastPayment ? lastPayment.date : '—'}</div></div>
            </div>

            <div className="card">
              <table className="data-table">
                <thead><tr>
                  <th style={{ width: 90 }}>Receipt #</th>
                  <SortHeader label="Date" sortKey="date" sort={paymentSort} onSort={k => toggleSort(paymentSort, setPaymentSort, k)} width={130} />
                  <th style={{ width: 90 }}>Method</th>
                  <th>Invoice / Ref</th><th>Received by</th>
                  <SortHeader label="Amount" sortKey="amount" sort={paymentSort} onSort={k => toggleSort(paymentSort, setPaymentSort, k)} width={120} align="right" />
                  <th className="right" style={{ width: 140 }}>Running total</th>
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
              {!paymentsQ.isLoading && PAYMENTS.length > 0 && paymentTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                  <button className="btn" disabled={paymentPage <= 1} onClick={() => setPaymentPage(p => Math.max(1, p - 1))}>
                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    Page {paymentPage} of {paymentTotalPages}
                  </span>
                  <button className="btn" disabled={paymentPage >= paymentTotalPages} onClick={() => setPaymentPage(p => Math.min(paymentTotalPages, p + 1))}>
                    Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                  </button>
                </div>
              )}
              {totalCharged > 0 && (
                <div className="pay-kpis">
                  <div className="pay-kpi"><div className="lbl">Total invoiced</div><div className="val">{fmt(totalCharged)}</div></div>
                  <div className="pay-kpi"><div className="lbl">Total paid</div><div className="val green">{fmt(totalPaid)}</div></div>
                  <div className="pay-kpi"><div className="lbl">Outstanding</div><div className="val amber">{fmt(totalCharged - totalPaid)}</div></div>
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
                    {/* Prisma ClientType enum values (schema.prisma) — the previous list
                        ('retail', 'shisha', 'EUR' below) didn't exist in the enum and
                        would 400 on save (@IsEnum(ClientType)/@IsEnum(Currency)). */}
                    {['restaurant', 'shop', 'wholesale', 'walk_in', 'corporate', 'export'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Currency</span>
                  <select className="select" value={editForm.currency} onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}>
                    {['USD', 'LBP'].map(cc => <option key={cc}>{cc}</option>)}
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
                <button className="btn" onClick={() => setEditOpen(false)} disabled={editSaving}>Cancel</button>
                <button className="btn green" onClick={saveEdit} disabled={editSaving || !editForm.name.trim()}>
                  <i className="ti ti-check" style={{ fontSize: 15 }} /> {editSaving ? 'Saving…' : 'Save changes'}
                </button>
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
                  <input className="input" type="date" defaultValue={toDateOnlyString(new Date())} />
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
                  <span className="field-label">Received by <span style={{ color: 'var(--red)' }}>*</span></span>
                  <select className="select" value={payReceiverName} onChange={e => setPayReceiverName(e.target.value)}>
                    <option value="">— select receiver —</option>
                    {allReceivers.map(r => <option key={r.id || r.name} value={r.name}>{r.name}</option>)}
                  </select>
                  {!resolvedPayReceiverId && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Receiver is required.</div>
                  )}
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

      {exportColumnsModal}

      {/* Toast */}
      <div className={`toast ${toast ? 'show' : ''}`}>
        <i className="ti ti-check-circle" />
        <span>{toast}</span>
      </div>
    </>
  )
}
