import { useState, useRef, useEffect } from 'react'
import Topbar from '../components/layout/Topbar'
import { useBagTypes } from '../hooks/useBagTypes'
import { useAvailableStockLots, usePackedStockSummary, useGroupedStockExits, useCreateStockExit, useUpdateStockExit, useWalkInSummary, useWarehouseCashSummary, useOnAccountCount, useFifoDraw } from '../hooks/useWarehouse'
import { useClients } from '../hooks/useClients'
import { useCashReceivers } from '../hooks/useUsers'
import { useCreateWalkInSale } from '../hooks/useWalkInSales'
import { useRate } from '../context/RateContext'
import { roundDp } from '../lib/money'
import { toDateOnlyString, currentWeekToDateRange } from '../lib/date'

type SaleMode = 'packed' | 'kg'
type SaleTab = 'entry' | 'log'

interface PackedLine {
  id: number
  bagTypeId: string
  qty: string
  price: string
  curr: 'USD' | 'LBP'
}


function clientBadgeCls(type: string) {
  if (type === 'walk_in') return 'badge-gray'
  if (type === 'wholesale' || type === 'export') return 'badge-green'
  if (type === 'shop') return 'badge-amber'
  return 'badge-blue'
}

function mkInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// Money in its OWN currency (never converted) — same $/LL convention Invoices.tsx
// uses for payment rows. `amount` is a decimal string from the API, or null/undefined.
function fmtCcy(amount: string | number | null | undefined, currency?: string | null) {
  if (amount == null) return '—'
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  if (!Number.isFinite(n)) return '—'
  return currency === 'LBP' ? `LL ${n.toLocaleString()}` : `$${n.toFixed(2)}`
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', whish: 'Whish', omt: 'OMT', bank_transfer: 'Bank transfer', cheque: 'Cheque',
}
// Anonymous (non-invoiced) walk-in sales have no `method` column on StockExit
// at all — see findAllGrouped()'s doc comment (backend) — so this is reported
// honestly as "Not recorded" rather than guessed from the Entry form's dropdown.
function methodLabel(method: string | null | undefined) {
  return method ? (PAYMENT_METHOD_LABELS[method] ?? method) : 'Not recorded'
}

export default function WarehouseSales() {
  // Real data from API
  const bagTypesQ = useBagTypes()
  // Unbounded (not limit:100) — a KG sale draws from exactly ONE manually-
  // selected lot, so every lot with stock must be listable in the dropdown,
  // not just the 100 most recently received. See useAvailableStockLots()'s
  // doc comment / StockLotsService.findAvailable() for the full reasoning.
  const lotsQ = useAvailableStockLots()
  const packedSummaryQ = usePackedStockSummary()
  const receiversQ = useCashReceivers()
  const rateCtx = useRate()
  const rawRate = rateCtx.rawRate

  // Log tab date filter — must be declared before exitsQ uses them.
  // toDateOnlyString (local calendar-day parts), never toISOString().slice(0,10)
  // — the latter converts to UTC first and rolls the date back a day in a
  // timezone ahead of UTC (Beirut, UTC+3).
  const thirtyDaysAgoStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return toDateOnlyString(d)
  })()
  const [logDateFrom, setLogDateFrom] = useState(thirtyDaysAgoStr)
  const [logDateTo, setLogDateTo] = useState('')

  // Sales Log pagination — 20/page, matching the Orders/Invoices convention.
  const SALES_LOG_PAGE_SIZE = 20
  const [salesLogPage, setSalesLogPage] = useState(1)
  // Any change to the log's date filter must land back on page 1 — otherwise
  // a user on page 3 of "last 30 days" could switch filters and see a stale
  // out-of-range page instead of their new results.
  useEffect(() => { setSalesLogPage(1) }, [logDateFrom, logDateTo])

  const exitsQ = useGroupedStockExits({
    exitType: 'walk_in',
    dateFrom: logDateFrom || undefined,
    dateTo: logDateTo || undefined,
    page: salesLogPage,
    limit: SALES_LOG_PAGE_SIZE,
  })
  const exitsTotal = exitsQ.data?.total ?? 0
  const exitsTotalPages = Math.max(1, Math.ceil(exitsTotal / SALES_LOG_PAGE_SIZE))

  const { dateFrom: weekStart, dateTo: today } = currentWeekToDateRange()
  // KPI: backend-aggregated totals (no page limit, accurate for any volume).
  const todaySummaryQ = useWalkInSummary({ dateFrom: today, dateTo: today })
  const weekSummaryQ  = useWalkInSummary({ dateFrom: weekStart, dateTo: today })

  // Paginated exits list — kept for the today's log table only. Counts
  // ("Sales today" etc.) use todayExitsQ.data?.total (already unbounded,
  // straight from the backend's count()), never todayExits.length (capped
  // at 100 rows — would silently undercount on a busy day).
  const todayExitsQ = useGroupedStockExits({ exitType: 'walk_in', dateFrom: today, dateTo: today, limit: 100 })
  // Cash actually collected today — anonymous StockExit amounts + payments on
  // warehouse-sale invoices, computed server-side. See
  // StockExitsService.getWarehouseCashSummary() for the accounting rule.
  const cashSummaryQ = useWarehouseCashSummary(today)
  // "On account (no amount)" diagnostic — computed server-side, unbounded.
  // See StockExitsService.getOnAccountCount() for the exact (unchanged)
  // business definition this preserves.
  const onAccountQ = useOnAccountCount(today)
  const createExit = useCreateStockExit()
  const createWalkInSale = useCreateWalkInSale()
  const fifoDraw = useFifoDraw()

  const bagTypes = bagTypesQ.data ?? []
  const activeLots = lotsQ.data ?? []
  const totalBagsInStock = (packedSummaryQ.data ?? []).reduce((s, p) => s + p.totalBags, 0)

  // Map bagTypeId → AVAILABLE bags in stock (free = totalBags − reservedBags).
  // BUG-E (P2): bags reserved for pending shipments must not show as available for sale.
  const bagStockMap = new Map<string, number>(
    (packedSummaryQ.data ?? []).map(p => [p.bagTypeId, p.availableBags])
  )

  // Every user who can receive cash (owner/accountant/sales_rep/worker/
  // receiver) — see useCashReceivers()'s doc comment for why this replaced
  // the old useWorkers()+useReceivers() combination (worker.id was the wrong
  // FK; a worker's real id lives on the linked User via Worker.userId).
  const allReceivers = receiversQ.data ?? []

  const WALK_IN = { id: 'walk-in', name: 'Walk-in customer', type: 'walk_in', initials: 'W', meta: 'no account · cash only' }

  const [tab, setTab] = useState<SaleTab>('entry')

  // Buyer combo
  const [buyerInput, setBuyerInput] = useState('')
  const [buyerOpen, setBuyerOpen] = useState(false)
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  // Server-side search (GET /clients?search=) reactive on buyerInput — a
  // static limit:100 fetch (newest-first) would silently hide any client
  // older than the 100 most recently created, making them unselectable and
  // pushing their sales into the anonymous/walk-in path by mistake.
  const clientsQ = useClients({ search: buyerInput || undefined, limit: 100 })
  const apiClients = clientsQ.data?.data ?? []

  const [saleDate, setSaleDate] = useState(toDateOnlyString(new Date()))
  const [mode, setMode] = useState<SaleMode>('packed')

  // Packed lines — use first real bag type as default
  const [packedLines, setPackedLines] = useState<PackedLine[]>([
    { id: 1, bagTypeId: '', qty: '', price: '', curr: 'USD' },
  ])
  // Set default bag type when loaded
  useEffect(() => {
    if (bagTypes.length > 0 && !packedLines[0].bagTypeId) {
      setPackedLines([{ id: 1, bagTypeId: bagTypes[0].id, qty: '', price: '', curr: 'USD' }])
    }
  }, [bagTypes.length])

  // By-kg
  const [kgLotId, setKgLotId] = useState('')
  useEffect(() => {
    if (activeLots.length > 0 && !kgLotId) setKgLotId(activeLots[0].id)
  }, [activeLots.length])
  const [kgWeight, setKgWeight] = useState('')
  const [kgPrice, setKgPrice] = useState('')
  const [kgCurr, setKgCurr] = useState<'USD' | 'LBP'>('USD')

  // Payment
  const [rcvUsd, setRcvUsd] = useState('')
  const [rcvLbp, setRcvLbp] = useState('')
  const [payMethod, setPayMethod] = useState('Cash')
  const [receiverId, setReceiverId] = useState('')
  const [notes, setNotes] = useState('')

  // Identifies ONE logical sale-submission attempt — sent as
  // CreateWalkInSaleDto.idempotencyKey (registered-client sales, POST
  // /walk-in-sales) or CreateStockExitDto.idempotencyKey (anonymous sales,
  // POST /stock-exits — the endpoint anonymous walk-ins actually use) so the
  // backend can collapse a double-click/network-retry into the original
  // result instead of creating a duplicate sale (see WalkInSalesService/
  // StockExitsService.create()'s doc comments for the real guarantee — the
  // submitInFlightRef guard and the disabled button below are UX protection
  // only, not this). Generated once per sale-entry session; regenerated only
  // after a submission actually completes (every success path below —
  // registered-client and anonymous alike — calls this), never on every
  // keystroke or re-render, so retries of the SAME attempt keep the SAME key.
  const [saleIdempotencyKey, setSaleIdempotencyKey] = useState(() => crypto.randomUUID())

  const updateExit = useUpdateStockExit()
  const [selectedExit, setSelectedExit] = useState<any>(null)
  const [editAmount, setEditAmount] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setBuyerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2400)
  }

  // Filtered buyer list (real clients + walk-in)
  const allBuyers = [WALK_IN, ...apiClients.map(c => ({
    id: c.id, name: c.name, type: c.type,
    initials: mkInitials(c.name),
    meta: `${c.type} · ${c.currency}`,
  }))]
  const q = buyerInput.toLowerCase().trim()
  // apiClients is already server-filtered by `search` (see clientsQ above) —
  // only WALK_IN (a synthetic, non-API entry) still needs local filtering.
  const filteredClients = q
    ? allBuyers.filter(c => c.id === 'walk-in' ? (c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q)) : true)
    : allBuyers
  const showAddNew = q.length > 0 && !allBuyers.some(c => c.name.toLowerCase() === q)
  const selectedBuyer = allBuyers.find(c => c.id === selectedBuyerId) ?? null

  function pickBuyer(c: typeof allBuyers[0]) {
    setSelectedBuyerId(c.id)
    setBuyerInput(c.name)
    setBuyerOpen(false)
  }

  // Display-only USD amount for a stock exit row. Registered-client sales keep
  // StockExit.amount = null (see schema.prisma StockExit.invoiceId doc) so their
  // real price has to be read off the linked invoice's line instead.
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

  // Display-only USD amount for a GROUPED sale-history row (see
  // useGroupedStockExits — one row per invoice, not per StockExit).
  // Standalone (non-invoiced) rows delegate straight to exitDisplayAmountUsd()
  // via the attached rawExit, so that logic (and its edit-amount flow) stays
  // exactly as it was. An invoiced row sums every line's lineTotal — already
  // the exact figure InvoiceCalculatorService.computeLines() stored — instead
  // of re-deriving qty × price per line.
  function groupAmountUsd(row: any): number | null {
    if (row.rawExit) return exitDisplayAmountUsd(row.rawExit)
    const total = (row.lines ?? []).reduce((sum: number, l: any) => sum + (parseFloat(l.lineTotal ?? '0') || 0), 0)
    return row.currency === 'LBP' ? (rawRate > 0 ? total / rawRate : 0) : total
  }

  // Short one-line description of a grouped sale-history row for compact
  // (non-tabular) displays — the Entry tab's "Today's sales" mini-list.
  function groupDescription(row: any): string {
    const lines: any[] = row.lines ?? []
    if (lines.length === 0) return '—'
    if (lines.length > 1) return `${lines.length} items`
    const l = lines[0]
    return l.saleUnit === 'KG'
      ? `${(parseFloat(l.kgQuantity ?? '0') || 0).toFixed(1)} kg raw`
      : `${l.qty ?? 0} × ${l.bagTypeName ?? '—'}`
  }

  // Totals
  function lineTotalUSD(ln: PackedLine) {
    const sub = roundDp((parseFloat(ln.qty) || 0) * (parseFloat(ln.price) || 0), 2)
    return ln.curr === 'LBP' ? roundDp(rawRate > 0 ? sub / rawRate : 0, 2) : sub
  }

  let totalUSD = 0
  let breakdown = ''
  if (mode === 'packed') {
    const parts: string[] = []
    packedLines.forEach(ln => {
      const qty = parseFloat(ln.qty) || 0
      const price = parseFloat(ln.price) || 0
      const bt = bagTypes.find(b => b.id === ln.bagTypeId)
      if (qty > 0 && price > 0 && bt)
        parts.push(`${qty}×${bt.name} @ ${ln.curr === 'USD' ? '$' : ''}${ln.price}${ln.curr === 'LBP' ? ' LL' : ''}`)
      totalUSD += lineTotalUSD(ln)
    })
    totalUSD = roundDp(totalUSD, 2)
    breakdown = parts.length ? parts.join(' · ') : 'Add bag, qty and price'
  } else {
    const w = parseFloat(kgWeight) || 0
    const p = parseFloat(kgPrice) || 0
    const sub = roundDp(w * p, 2)
    totalUSD = kgCurr === 'LBP' ? roundDp(rawRate > 0 ? sub / rawRate : 0, 2) : sub
    const lot = activeLots.find(l => l.id === kgLotId)
    breakdown = w > 0 && p > 0
      ? `${w} kg × ${kgCurr === 'USD' ? '$' : ''}${p}${kgCurr === 'LBP' ? ' LL' : ''}/kg · ${lot?.charcoalType || ''} Grade ${lot?.grade || ''}`
      : 'Pick a lot, enter weight and price'
  }

  const usdNum = parseFloat(rcvUsd) || 0
  const lbpNum = parseFloat(rcvLbp) || 0
  const lbpEq = rawRate > 0 ? roundDp(lbpNum / rawRate, 2) : 0
  const totalRecv = roundDp(usdNum + lbpEq, 2)

  // Cash/Whish/OMT are personal-custody methods — same rule
  // PaymentsService.RECEIVER_REQUIRED_METHODS enforces server-side (and
  // Invoices.tsx's Log Payment modal already mirrors client-side). Only
  // matters once a registered-client sale will actually create a Payment
  // (totalRecv > 0) — an "On account" or zero-received sale never reaches
  // WalkInSalesService's receiver check at all.
  const receiverRequired = totalRecv > 0 && (payMethod === 'Cash' || payMethod === 'Whish' || payMethod === 'OMT')

  let recvBarCls = 'recv-bar none'
  let recvLabel = 'Enter amount received above'
  if (totalRecv > 0) {
    if (totalUSD === 0) {
      recvBarCls = 'recv-bar ok'
      recvLabel = 'Received'
    } else {
      const diff = totalRecv - totalUSD
      if (Math.abs(diff) < 0.01) {
        recvBarCls = 'recv-bar ok'
        recvLabel = 'Matches total ✓'
      } else if (diff < 0) {
        recvBarCls = 'recv-bar short'
        recvLabel = `Short $${Math.abs(diff).toFixed(2)} — goes on account`
      } else {
        recvBarCls = 'recv-bar ok'
        recvLabel = `Over by $${diff.toFixed(2)}`
      }
    }
  }

  function addPackedLine() {
    setPackedLines(prev => [...prev, { id: Date.now(), bagTypeId: bagTypes[0]?.id ?? '', qty: '', price: '', curr: 'USD' }])
  }
  function removePackedLine(id: number) {
    if (packedLines.length === 1) return
    setPackedLines(prev => prev.filter(l => l.id !== id))
  }
  function updateLine(id: number, field: keyof PackedLine, val: string) {
    setPackedLines(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l))
  }

  // Maps the UI payment label to the backend PaymentMethod enum.
  const PAY_METHOD_MAP: Record<string, 'cash' | 'whish' | 'omt' | 'bank_transfer'> = {
    'Cash': 'cash', 'Whish': 'whish', 'OMT': 'omt', 'Bank transfer': 'bank_transfer',
  }

  // ── UX-layer guard ONLY — read this before assuming it's the real fix ──────
  // A repeat-click/double-tap on "Record this sale" (or a slow network making
  // a user tap again before anything visibly happens) must not even ATTEMPT a
  // second HTTP request in the common case. This ref is a synchronous
  // re-entrancy guard checked BEFORE the first `await` in doSubmitSale, so it
  // closes the whole in-tab window — including while an earlier FIFO-draw
  // lookup is still in flight, before createWalkInSale.isPending would even
  // turn true. The button's `disabled={createWalkInSale.isPending || ...}`
  // below is the visible feedback for the same guard.
  //
  // What this CANNOT do: stop a second tab, a retrying proxy, a direct API
  // call, or any request this ref never sees. THE ACTUAL GUARANTEE against a
  // duplicate sale is server-side — WalkInSalesService.create()'s idempotency
  // check + the invoices_idempotencyKey_key DB constraint (see that method's
  // doc comment). This ref exists purely so a normal double-click doesn't even
  // round-trip to the server; without it the request would still be safely
  // deduplicated there, just after a wasted network call.
  const submitInFlightRef = useRef(false)

  async function submitSale() {
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    try {
      await doSubmitSale()
    } finally {
      submitInFlightRef.current = false
    }
  }

  async function doSubmitSale() {
    const buyerName = selectedBuyer ? selectedBuyer.name : (buyerInput.trim() || 'Walk-in')
    const isRegisteredClient = !!selectedBuyerId && selectedBuyerId !== 'walk-in'

    // Mirrors PaymentsService's server-side RECEIVER_REQUIRED_METHODS check
    // (WalkInSalesService.create() now enforces the same rule) — validated
    // here too so the user gets an immediate, specific toast instead of a
    // round-trip 400. A registered-client sale is the only path that creates
    // a real Payment row here; anonymous walk-ins record the amount directly
    // on the StockExit and never reach this rule.
    if (isRegisteredClient && receiverRequired && !receiverId) {
      showToast('Select who received the payment — required for Cash, Whish, and OMT')
      return
    }

    // BUG-3/BUG-4: a sale to a REGISTERED client (packed bags) goes through one atomic
    // backend endpoint that writes stock exit + issued invoice + payment together, in the
    // client's currency. This replaces the old flow that created a payment with no invoice
    // (balance went negative) and hardcoded USD.
    if (isRegisteredClient && mode === 'packed') {
      const activeLines = packedLines.filter(ln => (parseInt(ln.qty) || 0) > 0 && (parseFloat(ln.price) || 0) > 0)
      if (activeLines.length === 0) { showToast('Add at least one bag with qty + price'); return }

      for (const ln of activeLines) {
        const avail = bagStockMap.get(ln.bagTypeId) ?? 0
        if (avail > 0 && (parseInt(ln.qty) || 0) > avail) {
          const bt = bagTypes.find(b => b.id === ln.bagTypeId)
          showToast(`Not enough stock for ${bt?.name ?? 'bag'} — only ${avail} available`)
          return
        }
      }

      // FIFO across multiple packed-stock records per bag type — computed
      // server-side (unbounded), not from the capped packedRecords list.
      // BUG-E (P2): only FREE bags (quantity − reservedQuantity) are sellable.
      const bagsPayload: { packedStockId: string; bagTypeId: string; bagTypeName: string; quantity: number; pricePerBag: string; currency: 'USD' | 'LBP' }[] = []
      for (const ln of activeLines) {
        const bt = bagTypes.find(b => b.id === ln.bagTypeId)
        const qty = parseInt(ln.qty)
        let plan
        try {
          plan = await fifoDraw.mutateAsync({ bagTypeId: ln.bagTypeId, quantity: qty })
        } catch (err: any) {
          showToast(err?.error ?? 'Failed to check stock availability')
          return
        }
        if (plan.draws.length === 0) { showToast(`No packed stock found for ${bt?.name ?? 'bag'}`); return }
        for (const d of plan.draws) {
          bagsPayload.push({
            packedStockId: d.packedStockId,
            bagTypeId: ln.bagTypeId,
            bagTypeName: bt?.name ?? 'Bag',
            quantity: d.quantity,
            pricePerBag: (parseFloat(ln.price) || 0).toFixed(2),
            currency: ln.curr,
          })
        }
        if (!plan.fulfilled) {
          const drawn = plan.draws.reduce((s, d) => s + d.quantity, 0)
          showToast(`Only ${drawn} of ${qty} bags available for ${bt?.name ?? 'bag'}`)
          return
        }
      }

      const mappedMethod = PAY_METHOD_MAP[payMethod]

      try {
        await createWalkInSale.mutateAsync({
          clientId: selectedBuyerId!,
          date: saleDate,
          bags: bagsPayload,
          ...(usdNum > 0 ? { receivedUsd: usdNum.toFixed(2) } : {}),
          ...(lbpNum > 0 ? { receivedLbp: lbpNum.toFixed(2) } : {}),
          method: mappedMethod ?? 'cash',
          ...(receiverId ? { receiverId } : {}),
          recipient: buyerName,
          notes: notes || undefined,
          idempotencyKey: saleIdempotencyKey,
        })
      } catch (err: any) {
        showToast(err?.error ?? err?.response?.data?.error ?? 'Failed to record sale')
        return
      }

      showToast(`Sale recorded · invoiced ${buyerName}`)
      setBuyerInput(''); setSelectedBuyerId(null)
      setRcvUsd(''); setRcvLbp('')
      setKgWeight(''); setKgPrice('')
      setNotes('')
      setPackedLines([{ id: Date.now(), bagTypeId: bagTypes[0]?.id ?? '', qty: '', price: '', curr: 'USD' }])
      // A new idempotency key for the NEXT sale — this attempt already
      // succeeded, so its key must never be reused (that would make the next
      // genuinely different sale look like a retry of this one and get
      // silently collapsed into it).
      setSaleIdempotencyKey(crypto.randomUUID())
      return
    }

    if (mode === 'packed') {
      const activeLines = packedLines.filter(ln => (parseInt(ln.qty) || 0) > 0 && (parseFloat(ln.price) || 0) > 0)
      if (activeLines.length === 0) { showToast('Add at least one bag with qty + price'); return }

      for (const ln of activeLines) {
        const avail = bagStockMap.get(ln.bagTypeId) ?? 0
        if (avail > 0 && (parseInt(ln.qty) || 0) > avail) {
          const bt = bagTypes.find(b => b.id === ln.bagTypeId)
          showToast(`Not enough stock for ${bt?.name ?? 'bag'} — only ${avail} available`)
          return
        }
      }

      // Anonymous packed-bag sale — no invoice, no client; amount recorded
      // directly on each exit (mirrors the anonymous KG-sale branch below).
      // This branch is only reachable when isRegisteredClient is false (see
      // the early return above), so clientId is never sent here.
      for (const ln of activeLines) {
        const qty = parseInt(ln.qty)
        const bt = bagTypes.find(b => b.id === ln.bagTypeId)
        // FIFO draw plan computed server-side (unbounded, not from the
        // capped packedRecords list — see PackedStockService.getFifoDraw()).
        // BUG-E (P2): only FREE bags (quantity − reservedQuantity) are
        // drawable — same rule the backend already enforces at write time.
        let plan
        try {
          plan = await fifoDraw.mutateAsync({ bagTypeId: ln.bagTypeId, quantity: qty })
        } catch (err: any) {
          showToast(err?.error ?? 'Failed to check stock availability')
          return
        }

        let remaining = qty
        for (const d of plan.draws) {
          try {
            const lineAmt = bt ? roundDp(d.quantity * (parseFloat(ln.price) || 0) * (ln.curr === 'LBP' ? (rawRate > 0 ? 1 / rawRate : 0) : 1), 2) : 0
            await createExit.mutateAsync({
              packedStockId: d.packedStockId,
              bagTypeId: ln.bagTypeId,
              quantity: d.quantity,
              exitType: 'walk_in',
              date: saleDate,
              recipient: buyerName,
              reason: notes || undefined,
              ...(lineAmt > 0 ? { amount: lineAmt, currency: ln.curr } : {}),
              ...(receiverId ? { collectedById: receiverId } : {}),
              // Same one-per-submission key used for the registered-client
              // branches below — each FIFO draw still fingerprints uniquely
              // (distinct packedStockId/quantity/amount), so sharing this key
              // across every draw in ONE submission is safe: a genuine retry
              // of the whole submission reproduces the same (key, fingerprint)
              // pairs and every call short-circuits to its original row.
              idempotencyKey: saleIdempotencyKey,
            })
            remaining -= d.quantity
          } catch (err: any) {
            showToast(err?.error ?? 'Failed to record sale')
            return
          }
        }
        if (remaining > 0) {
          showToast(`Could not fulfill full quantity — only ${qty - remaining} bags deducted`)
        }
      }
    } else {
      // By-kg: validate inputs and lot availability first (common to all paths).
      if (!kgWeight || !kgPrice) { showToast('Enter weight and price/kg'); return }
      const lot = activeLots.find(l => l.id === kgLotId)
      if (!lot) { showToast('Select a lot'); return }
      const kgNum = parseFloat(kgWeight)
      if (kgNum > parseFloat(lot.kgRemaining)) {
        showToast(`Only ${parseFloat(lot.kgRemaining).toLocaleString()} kg available`)
        return
      }

      if (isRegisteredClient) {
        // Phase 4: registered-client KG sale → atomic StockExit + Invoice + Payment.
        // Uses the same endpoint as bag sales so the client gets a proper invoice.
        const description = `${lot.charcoalType} Grade ${lot.grade}`
        const mappedMethod = PAY_METHOD_MAP[payMethod]
        try {
          await createWalkInSale.mutateAsync({
            clientId: selectedBuyerId!,
            date: saleDate,
            kgLines: [{
              lotId:       lot.id,
              kgQuantity:  kgNum.toFixed(3),
              description,
              pricePerKg:  (parseFloat(kgPrice) || 0).toFixed(2),
              currency:    kgCurr,
            }],
            ...(usdNum > 0 ? { receivedUsd: usdNum.toFixed(2) } : {}),
            ...(lbpNum > 0 ? { receivedLbp: lbpNum.toFixed(2) } : {}),
            method:    mappedMethod ?? 'cash',
            ...(receiverId ? { receiverId } : {}),
            recipient: buyerName,
            notes:     notes || undefined,
            idempotencyKey: saleIdempotencyKey,
          })
        } catch (err: any) {
          showToast(err?.error ?? err?.response?.data?.error ?? 'Failed to record sale')
          return
        }
        showToast(`Sale recorded · invoiced ${buyerName}`)
        setBuyerInput(''); setSelectedBuyerId(null)
        setRcvUsd(''); setRcvLbp('')
        setKgWeight(''); setKgPrice('')
        setNotes('')
        setPackedLines([{ id: Date.now(), bagTypeId: bagTypes[0]?.id ?? '', qty: '', price: '', curr: 'USD' }])
        setSaleIdempotencyKey(crypto.randomUUID())
        return
      }

      // Anonymous KG sale — no invoice; amount recorded directly on the exit.
      try {
        const kgAmt = roundDp(kgNum * (parseFloat(kgPrice) || 0) * (kgCurr === 'LBP' ? (rawRate > 0 ? 1 / rawRate : 0) : 1), 2)
        await createExit.mutateAsync({
          lotId:     lot.id,
          kgQuantity: kgNum,
          exitType:  'walk_in',
          date:      saleDate,
          recipient: buyerName,
          reason:    notes || undefined,
          ...(kgAmt > 0 ? { amount: kgAmt, currency: kgCurr } : {}),
          ...(receiverId ? { collectedById: receiverId } : {}),
          idempotencyKey: saleIdempotencyKey,
        })
      } catch (err: any) {
        showToast(err?.error ?? 'Failed to record sale')
        return
      }
    }

    // NOTE: registered-client PACKED sales are handled atomically above via
    // POST /walk-in-sales (stock exit + issued invoice + payment, in client currency).
    // The old block here created a Payment with NO invoice and hardcoded USD — the
    // BUG-3/BUG-4 root cause — and has been removed. Anonymous packed-bag and anonymous
    // by-kg sales both record the amount directly on the stock exit itself (previously
    // the packed-bag branch's amount/currency were incorrectly gated behind a registered
    // buyer, which that branch can never have — fixed above); no standalone payment is
    // created for either.
    //
    // Both anonymous branches above fall through to here only on SUCCESS (their
    // catch blocks `return` early on failure) — this is where the anonymous-sale
    // idempotency key is regenerated for the NEXT sale, mirroring the two
    // registered-client branches (which regenerate their own key right before
    // their early `return`). This attempt already succeeded, so its key must
    // never be reused for a genuinely different next sale.
    setSaleIdempotencyKey(crypto.randomUUID())

    showToast(`Sale recorded · $${totalUSD.toFixed(2)} from ${buyerName}`)
    setBuyerInput(''); setSelectedBuyerId(null)
    setRcvUsd(''); setRcvLbp('')
    setKgWeight(''); setKgPrice('')
    setNotes('')
    setPackedLines([{ id: Date.now(), bagTypeId: bagTypes[0]?.id ?? '', qty: '', price: '', curr: 'USD' }])
  }

  // Cash box — today's log list, kept only for the "Today's sales" table below.
  const todayExits = todayExitsQ.data?.data ?? []
  const todayExitsTotal = todayExitsQ.data?.total ?? 0
  // "On account (no amount)" — server-computed, unbounded. NOT a client-side
  // filter over the capped todayExits/todayPayments lists.
  const cashBoxOnAccountCount = onAccountQ.data?.onAccountCount ?? 0
  // Total collected — server-computed (anonymous StockExit amounts + payments
  // on warehouse-sale invoices only). NOT a client-side reduce over a capped
  // list, and NOT invoice totals.
  const cashBoxCollected = parseFloat(cashSummaryQ.data?.cashCollected ?? '0')
  const cashBoxTotal2 = cashBoxCollected

  return (
    <>
      <Topbar title="Warehouse sales">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
          Rate: 89,550 LL/$
        </span>
      </Topbar>


      {/* Tabs */}
      <div className="tabs">
        <div className={`tab${tab === 'entry' ? ' active' : ''}`} onClick={() => setTab('entry')}>
          <i className="ti ti-plus" style={{ fontSize: 14 }} /> Enter sale
        </div>
        <div className={`tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>
          <i className="ti ti-list" style={{ fontSize: 14 }} /> Sales log
          {(exitsQ.data?.total ?? 0) > 0 && <span className="tab-count">{exitsQ.data?.total}</span>}
        </div>
      </div>

      <div className="content">

        {/* KPI row */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Bags sold today</div>
            <div className="kpi-value">
              {todaySummaryQ.isLoading ? '—' : (todaySummaryQ.data?.bags ?? 0).toLocaleString()}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)' }}> bags</span>
            </div>
            <div className="kpi-sub">
              {todaySummaryQ.isLoading ? '' : `${parseFloat(todaySummaryQ.data?.kg ?? '0').toFixed(1)} kg · ${todayExitsQ.data?.total ?? 0} exits`}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">This week</div>
            <div className="kpi-value">
              {weekSummaryQ.isLoading ? '—' : (weekSummaryQ.data?.bags ?? 0).toLocaleString()}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)' }}> bags</span>
            </div>
            <div className="kpi-sub">
              {weekSummaryQ.isLoading ? '' : `${parseFloat(weekSummaryQ.data?.kg ?? '0').toFixed(1)} kg`}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Packed stock on hand</div>
            <div className="kpi-value" style={{ color: 'var(--accent)' }}>
              {packedSummaryQ.isLoading ? '—' : totalBagsInStock.toLocaleString()}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)' }}> bags</span>
            </div>
            <div className="kpi-sub">
              {packedSummaryQ.isLoading ? '' : `${(packedSummaryQ.data ?? []).length} bag type${(packedSummaryQ.data ?? []).length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Total sales recorded</div>
            <div className="kpi-value">{exitsQ.isLoading ? '—' : (exitsQ.data?.total ?? 0).toLocaleString()}</div>
            <div className="kpi-sub">walk-in sales</div>
          </div>
        </div>

        {/* ── ENTRY TAB ── */}
        {tab === 'entry' && (
          <div className="two-col">

            {/* Left: Sale form */}
            <div>
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-plus" /> Enter a sale</div>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    packed bags or sold by kg
                  </span>
                </div>
                <div className="sale-form">

                  {/* Step 1: Buyer + date */}
                  <div className="section-title"><span className="step">1</span> Buyer</div>
                  <div className="form-row">
                    <div>
                      <label className="form-label">Buyer</label>
                      <div className={`combo${buyerOpen ? ' open' : ''}`} ref={comboRef}>
                        <input
                          className="combo-input"
                          placeholder="Search clients or type new name…"
                          autoComplete="off"
                          value={buyerInput}
                          onChange={e => { setBuyerInput(e.target.value); setBuyerOpen(true); setSelectedBuyerId(null) }}
                          onFocus={() => setBuyerOpen(true)}
                        />
                        <i className="ti ti-chevron-down combo-caret" style={{ fontSize: 14 }} />
                        <div className="combo-list">
                          {filteredClients.map(c => (
                            <div key={c.id} className="combo-item" onClick={() => pickBuyer(c)}>
                              <div className="ci-avatar">{c.initials}</div>
                              <div className="ci-body">
                                <div className="ci-name">{c.name}</div>
                                <div className="ci-meta">{c.meta}</div>
                              </div>
                              <span className={`badge ${clientBadgeCls(c.type)}`}>{c.type}</span>
                            </div>
                          ))}
                          {filteredClients.length === 0 && !showAddNew && (
                            <div style={{ padding: 14, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                              No matches
                            </div>
                          )}
                          {showAddNew && (
                            <div
                              className="combo-item add-new"
                              onClick={() => {
                                setSelectedBuyerId('walk-in')
                                setBuyerOpen(false)
                                showToast(`"${buyerInput.trim()}" logged as walk-in`)
                              }}
                            >
                              <i className="ti ti-plus" style={{ fontSize: 15, color: 'var(--accent)' }} />
                              <span>Add "<strong>{buyerInput}</strong>" as new buyer</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Sale date</label>
                      <input
                        className="form-input"
                        type="date"
                        value={saleDate}
                        onChange={e => setSaleDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="section-divider" />

                  {/* Step 2: Mode toggle */}
                  <div className="section-title"><span className="step">2</span> How is it sold?</div>
                  <div className="mode-toggle">
                    <div
                      className={`mode-opt${mode === 'packed' ? ' active' : ''}`}
                      onClick={() => setMode('packed')}
                    >
                      <i className="ti ti-package" /> Packed bags
                    </div>
                    <div
                      className={`mode-opt${mode === 'kg' ? ' active' : ''}`}
                      onClick={() => setMode('kg')}
                    >
                      <i className="ti ti-weight" /> By kilogram
                    </div>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text3)', margin: '8px 0 14px', fontFamily: "'IBM Plex Mono', monospace" }}>
                    {mode === 'packed'
                      ? 'Packed: each bag size has its own price & currency'
                      : 'By kg: pick the charcoal lot (type · supplier · grade) then enter weight × price/kg'}
                  </p>

                  {/* Step 3a: Packed bags */}
                  {mode === 'packed' && (
                    <div>
                      <div className="section-title"><span className="step">3</span> Bags sold</div>
                      {packedLines.map((ln, idx) => {
                        const stockAvail = bagStockMap.get(ln.bagTypeId) ?? 0
                        const qtyNum = parseInt(ln.qty) || 0
                        const overStock = qtyNum > stockAvail && stockAvail > 0
                        return (
                        <div key={ln.id} className="packed-line">
                          <div>
                            {idx === 0 && <div className="lbl-mini">Bag type</div>}
                            <select
                              value={ln.bagTypeId}
                              onChange={e => updateLine(ln.id, 'bagTypeId', e.target.value)}
                            >
                              {bagTypes.length === 0 && <option value="">Loading…</option>}
                              {bagTypes.map(b => {
                                const avail = bagStockMap.get(b.id) ?? 0
                                return (
                                  <option key={b.id} value={b.id}>
                                    {b.name} ({parseFloat(b.nominalKg).toFixed(1)} kg) — {avail} in stock
                                  </option>
                                )
                              })}
                            </select>
                          </div>
                          <div>
                            {idx === 0 && <div className="lbl-mini">Qty {stockAvail > 0 ? `(max ${stockAvail})` : ''}</div>}
                            <input
                              className="num"
                              type="number"
                              min="0"
                              max={stockAvail > 0 ? stockAvail : undefined}
                              placeholder="0"
                              value={ln.qty}
                              style={overStock ? { borderColor: 'var(--red)', color: 'var(--red)' } : undefined}
                              onChange={e => updateLine(ln.id, 'qty', e.target.value)}
                            />
                            {overStock && (
                              <div style={{ fontSize: 10, color: 'var(--red)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>
                                only {stockAvail} available
                              </div>
                            )}
                          </div>
                          <div>
                            {idx === 0 && <div className="lbl-mini">Price / bag</div>}
                            <input
                              className="num"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={ln.price}
                              onChange={e => updateLine(ln.id, 'price', e.target.value)}
                            />
                          </div>
                          <div>
                            {idx === 0 && <div className="lbl-mini">Currency</div>}
                            <select
                              value={ln.curr}
                              onChange={e => updateLine(ln.id, 'curr', e.target.value as 'USD' | 'LBP')}
                            >
                              <option>USD</option>
                              <option>LBP</option>
                            </select>
                          </div>
                          <button
                            className="del-btn"
                            aria-label="Remove line"
                            onClick={() => removePackedLine(ln.id)}
                            disabled={packedLines.length === 1}
                          >
                            <i className="ti ti-x" style={{ fontSize: 13 }} />
                          </button>
                        </div>
                        )
                      })}
                      <button className="btn-add-line" onClick={addPackedLine}>
                        <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add another bag size
                      </button>
                    </div>
                  )}

                  {/* Step 3b: By kg */}
                  {mode === 'kg' && (
                    <div>
                      <div className="section-title"><span className="step">3</span> Charcoal sold by kg</div>
                      <div className="kg-block">
                        <div style={{ marginBottom: 12 }}>
                          <label className="form-label" style={{ fontSize: 10.5 }}>
                            Charcoal lot — type · supplier · grade
                          </label>
                          <select className="form-input" value={kgLotId} onChange={e => setKgLotId(e.target.value)}>
                            {activeLots.length === 0 && <option value="">No active lots</option>}
                            {activeLots.map(l => (
                              <option key={l.id} value={l.id}>
                                {l.charcoalType} · Grade {l.grade} · {parseFloat(l.kgRemaining).toLocaleString()} kg remaining
                              </option>
                            ))}
                          </select>
                        </div>
                        {(() => {
                          const selectedLot = activeLots.find(l => l.id === kgLotId)
                          const maxKg = selectedLot ? parseFloat(selectedLot.kgRemaining) : 0
                          const kgNum = parseFloat(kgWeight) || 0
                          const overKg = kgNum > maxKg && maxKg > 0
                          return (
                        <div className="kg-price">
                          <div>
                            <label className="form-label" style={{ fontSize: 10.5 }}>
                              Weight (kg){maxKg > 0 ? ` — max ${maxKg.toLocaleString()} kg` : ''}
                            </label>
                            <input
                              className="form-input"
                              style={{ fontFamily: "'IBM Plex Mono', monospace", textAlign: 'right', fontWeight: 600, ...(overKg ? { borderColor: 'var(--red)', color: 'var(--red)' } : {}) }}
                              type="number"
                              min="0"
                              max={maxKg > 0 ? maxKg : undefined}
                              step="0.1"
                              placeholder="0"
                              value={kgWeight}
                              onChange={e => setKgWeight(e.target.value)}
                            />
                            {overKg && (
                              <div style={{ fontSize: 10, color: 'var(--red)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>
                                only {maxKg.toLocaleString()} kg available
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="form-label" style={{ fontSize: 10.5 }}>Price / kg</label>
                            <input
                              className="form-input"
                              style={{ fontFamily: "'IBM Plex Mono', monospace", textAlign: 'right', fontWeight: 600 }}
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={kgPrice}
                              onChange={e => setKgPrice(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="form-label" style={{ fontSize: 10.5 }}>Currency</label>
                            <select
                              className="form-input"
                              value={kgCurr}
                              onChange={e => setKgCurr(e.target.value as 'USD' | 'LBP')}
                            >
                              <option>USD</option>
                              <option>LBP</option>
                            </select>
                          </div>
                        </div>
                          )
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Total preview */}
                  <div className="total-preview" style={{ marginTop: 14 }}>
                    <div>
                      <div className="tp-label" style={{ fontWeight: 600 }}>Sale total</div>
                      <div className="tp-breakdown">{breakdown}</div>
                    </div>
                    <div className="tp-value">${totalUSD.toFixed(2)}</div>
                  </div>

                  <div className="section-divider" />

                  {/* Step 4: Amount received */}
                  <div className="section-title"><span className="step">4</span> Amount received</div>
                  <label className="form-label" style={{ marginBottom: 5 }}>USD + LBP split (can be both)</label>
                  <div className="currency-split">
                    <div className="cs-row">
                      <span className="cs-label">USD</span>
                      <input
                        className="cs-input"
                        type="number"
                        placeholder="0.00"
                        value={rcvUsd}
                        onChange={e => setRcvUsd(e.target.value)}
                      />
                      <span className="cs-curr">$</span>
                      <span className="cs-eq">{usdNum > 0 ? `= $${usdNum.toFixed(2)}` : ''}</span>
                    </div>
                    <div className="cs-row">
                      <span className="cs-label">LBP</span>
                      <input
                        className="cs-input"
                        type="number"
                        placeholder="0"
                        value={rcvLbp}
                        onChange={e => setRcvLbp(e.target.value)}
                      />
                      <span className="cs-curr">LL</span>
                      <span className="cs-eq">{lbpNum > 0 ? `≈ $${lbpEq.toFixed(2)}` : ''}</span>
                    </div>
                  </div>
                  <div className={recvBarCls}>
                    <span>{recvLabel}</span>
                    <span className="recv-val">{totalRecv > 0 ? `$${totalRecv.toFixed(2)}` : '—'}</span>
                  </div>

                  {/* Payment method + receiver */}
                  <div className="form-row">
                    <div>
                      <label className="form-label">Payment method</label>
                      <select className="form-input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                        <option>Cash</option>
                        <option>Whish</option>
                        <option>OMT</option>
                        <option>Bank transfer</option>
                        <option>On account</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">
                        Received by {receiverRequired && <span style={{ color: 'var(--red)' }}>*</span>}
                        {!receiverRequired && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> (optional for bank transfer / on account)</span>}
                      </label>
                      <select className="form-input" value={receiverId} onChange={e => setReceiverId(e.target.value)}>
                        <option value="">— select receiver —</option>
                        {allReceivers.map(r => (
                          <option key={r.id} value={r.id}>{r.name}{r.role ? ` (${r.role})` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Notes (optional)</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="any observations…"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                    />
                  </div>

                  <button
                    className="submit-btn"
                    onClick={submitSale}
                    disabled={createWalkInSale.isPending || createExit.isPending || fifoDraw.isPending}
                  >
                    <i className="ti ti-check" /> {createWalkInSale.isPending || createExit.isPending || fifoDraw.isPending ? 'Recording…' : 'Record this sale'}
                  </button>

                </div>
              </div>
            </div>

            {/* Right: Cash box + Today's log */}
            <div>
              <div className="cash-box">
                <div className="cb-head">
                  <div className="cb-title">
                    <i className="ti ti-safe" style={{ fontSize: 14, color: 'var(--text2)' }} />
                    Warehouse cash box
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    since handover
                  </span>
                </div>
                <div className="cb-row">
                  <span className="cb-label">Amount recorded</span>
                  <span className="cb-val green">
                    {cashSummaryQ.isLoading ? '—' : cashSummaryQ.isError ? <span style={{ color: 'var(--red)' }}>error</span> : `$${cashBoxCollected.toFixed(2)}`}
                  </span>
                </div>
                <div className="cb-row">
                  <span className="cb-label">Sales today</span>
                  <span className="cb-val">
                    {todayExitsQ.isLoading ? '—' : `${todayExitsTotal} exit${todayExitsTotal !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="cb-row">
                  <span className="cb-label">On account (no amount)</span>
                  <span className="cb-val amber">
                    {onAccountQ.isLoading ? '—' : `${cashBoxOnAccountCount} sale${cashBoxOnAccountCount !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="cb-total">
                  <span className="cb-total-label">Total collected today</span>
                  <span className="cb-total-val">
                    {cashSummaryQ.isLoading
                      ? '—'
                      : cashSummaryQ.isError
                        ? <span style={{ color: 'var(--red)', cursor: 'pointer' }} onClick={() => cashSummaryQ.refetch()} title="Failed to load — click to retry">error · retry</span>
                        : `$${cashBoxTotal2.toFixed(2)}`}
                  </span>
                </div>
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-list" /> Today's sales</div>
                  <span className="badge badge-gray">{todayExitsTotal} sales</span>
                </div>
                {todayExitsQ.isLoading && <div className="empty" style={{ fontSize: 12 }}>Loading…</div>}
                {!todayExitsQ.isLoading && todayExits.length === 0 && (
                  <div className="empty" style={{ fontSize: 12 }}>No sales recorded today.</div>
                )}
                {todayExits.map((row: any) => {
                  const desc = groupDescription(row)
                  const displayAmt = groupAmountUsd(row)
                  const collectedBy = row.rawExit?.collectedBy
                  return (
                    <div
                      key={row.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 18px', borderBottom: '1px solid var(--border)', fontSize: 12,
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedExit(row)}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{row.recipient ?? 'Walk-in'}</div>
                        <div style={{ color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                          {desc}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
                          {displayAmt != null ? `$${displayAmt.toFixed(2)}` : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {collectedBy ?? ''}{collectedBy && ' · '}
                          {new Date(row.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div style={{
                  padding: '10px 18px', borderTop: '1px solid var(--border)',
                  background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Total today</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
                    ${cashBoxCollected.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── LOG TAB ── */}
        {tab === 'log' && (
          <div className="card">
            <div className="card-head">
              <div className="card-title"><i className="ti ti-list" /> Warehouse sales log</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="date"
                  className="filter-select"
                  value={logDateFrom}
                  onChange={e => setLogDateFrom(e.target.value)}
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>to</span>
                <input
                  type="date"
                  className="filter-select"
                  value={logDateTo}
                  onChange={e => setLogDateTo(e.target.value)}
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                />
                {(logDateFrom || logDateTo) && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => { setLogDateFrom(''); setLogDateTo('') }}>
                    All dates
                  </button>
                )}
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginLeft: 4 }}>
                  {exitsQ.data?.total ?? 0} sales
                </span>
              </div>
            </div>
            {exitsQ.isLoading && <div className="empty">Loading…</div>}
            {!exitsQ.isLoading && (exitsQ.data?.data ?? []).length === 0 && (
              <div className="empty">No walk-in sales recorded yet. Use the "Enter sale" tab to record a sale.</div>
            )}
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Bag type</th>
                    <th>Charcoal (lot)</th>
                    <th style={{ textAlign: 'right' }}>Qty bags</th>
                    <th style={{ textAlign: 'right' }}>Nominal kg</th>
                    <th>Recipient</th>
                    <th>Payment</th>
                    <th>Logged by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(exitsQ.data?.data ?? []).map((row: any) => {
                    const lines: any[] = row.lines ?? []
                    const multi = lines.length > 1
                    // Bag-type / charcoal-lot cells only make sense as a single
                    // value when every line in this sale agrees — otherwise show
                    // a "N items" summary badge rather than a misleading first line.
                    const uniformBagType = !multi ? lines[0] : (lines.every(l => l.bagTypeId === lines[0]?.bagTypeId) ? lines[0] : null)
                    const uniformCharcoal = !multi ? lines[0] : (lines.every(l => l.charcoalType === lines[0]?.charcoalType && l.grade === lines[0]?.grade) ? lines[0] : null)
                    const isRaw = !multi && lines[0]?.saleUnit === 'KG'
                    return (
                      <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedExit(row)}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>
                          {new Date(row.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td>
                          {multi ? (
                            <span className="badge badge-gray">{lines.length} items</span>
                          ) : isRaw ? (
                            <span className="badge badge-amber">By kg</span>
                          ) : (
                            <>
                              <div style={{ fontWeight: 500 }}>{uniformBagType?.bagTypeName ?? '—'}</div>
                              <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                                {uniformBagType?.nominalKgPerBag ? `${parseFloat(uniformBagType.nominalKgPerBag).toFixed(1)} kg / bag` : ''}
                              </div>
                            </>
                          )}
                        </td>
                        <td>
                          {uniformCharcoal?.charcoalType ? (
                            <>
                              <div style={{ fontWeight: 500 }}>{uniformCharcoal.charcoalType}</div>
                              <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                                Grade {uniformCharcoal.grade}
                              </div>
                            </>
                          ) : multi ? <span style={{ color: 'var(--text3)' }}>Mixed</span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right' }}>
                          {row.totalQtyBags > 0 ? row.totalQtyBags : '—'}
                        </td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', color: 'var(--text2)' }}>
                          {parseFloat(row.totalKg) > 0 ? `${parseFloat(row.totalKg).toFixed(1)} kg` : '—'}
                        </td>
                        <td style={{ color: 'var(--text2)' }}>{row.recipient ?? '—'}</td>
                        <td>
                          {row.paidAmount != null ? (
                            <>
                              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>
                                {fmtCcy(row.paidAmount, row.currency)}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                                {row.payments?.[0]?.receiverName ?? '—'}
                                {row.remaining != null && parseFloat(row.remaining) > 0
                                  ? ` · ${fmtCcy(row.remaining, row.currency)} due`
                                  : ''}
                              </div>
                            </>
                          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{row.loggedBy?.name ?? '—'}</td>
                        <td><i className="ti ti-chevron-right" style={{ color: 'var(--text3)' }} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!exitsQ.isLoading && (exitsQ.data?.data ?? []).length > 0 && exitsTotalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                <button className="btn" disabled={salesLogPage <= 1} onClick={() => setSalesLogPage(p => Math.max(1, p - 1))}>
                  <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                </button>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Page {salesLogPage} of {exitsTotalPages}
                </span>
                <button className="btn" disabled={salesLogPage >= exitsTotalPages} onClick={() => setSalesLogPage(p => Math.min(exitsTotalPages, p + 1))}>
                  Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                </button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Sale detail panel — selectedExit is a GROUPED row (useGroupedStockExits):
          one invoiced sale, however many lines its FIFO draw actually produced,
          or one standalone (non-invoiced) exit via .rawExit. */}
      {selectedExit && (() => {
        const lines: any[] = selectedExit.lines ?? []
        const multi = lines.length > 1
        // Normalize cost/worker-rate/nominalKg onto every line so the section
        // below renders identically whether the figures came from the
        // batched bagType lookup (invoice-grouped rows) or straight off the
        // raw exit's own bagType relation (standalone rows).
        const displayLines = selectedExit.invoiceId
          ? lines
          : lines.map((l: any) => ({
              ...l,
              nominalKgPerBag: selectedExit.rawExit?.bagType?.nominalKg ?? null,
              costPerBag: selectedExit.rawExit?.bagType?.costPerBag ?? null,
              workerRatePerBag: selectedExit.rawExit?.bagType?.workerRate ?? null,
            }))
        return (
        <div className="lot-panel open">
          <div className="panel-head">
            <div>
              <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', marginBottom: 4 }}>
                WALK-IN SALE{selectedExit.invoiceDisplayId ? ` · ${selectedExit.invoiceDisplayId}` : ''} · {new Date(selectedExit.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {multi ? `${lines.length} items` : groupDescription(selectedExit)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                {selectedExit.recipient ?? 'Walk-in'}
              </div>
            </div>
            <button className="panel-close" onClick={() => setSelectedExit(null)}>✕ Close</button>
          </div>
          <div className="panel-body">

            {displayLines.map((line: any, i: number) => {
              const isRaw = line.saleUnit === 'KG'
              return (
                <div key={i}>
                  <div className="panel-section">
                    <div className="panel-section-label">{multi ? `Line ${i + 1} — ` : ''}{isRaw ? 'Raw lot details' : 'Bag details'}</div>
                    {isRaw ? (
                      <>
                        <div className="panel-row">
                          <span className="panel-row-label">Quantity sold</span>
                          <span className="panel-row-value" style={{ color: 'var(--accent)', fontSize: 14 }}>
                            {(parseFloat(line.kgQuantity ?? '0') || 0).toFixed(1)} kg
                          </span>
                        </div>
                        {line.pricePerKg && (
                          <div className="panel-row">
                            <span className="panel-row-label">Unit price (/ kg)</span>
                            <span className="panel-row-value">{fmtCcy(line.pricePerKg, selectedExit.currency)}</span>
                          </div>
                        )}
                        {line.lineTotal != null && (
                          <div className="panel-row">
                            <span className="panel-row-label">Line total</span>
                            <span className="panel-row-value" style={{ fontWeight: 600 }}>{fmtCcy(line.lineTotal, selectedExit.currency)}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="panel-row">
                          <span className="panel-row-label">Bag type</span>
                          <span className="panel-row-value">{line.bagTypeName ?? '—'}</span>
                        </div>
                        <div className="panel-row">
                          <span className="panel-row-label">Nominal kg / bag</span>
                          <span className="panel-row-value">{line.nominalKgPerBag ? `${parseFloat(line.nominalKgPerBag).toFixed(2)} kg` : '—'}</span>
                        </div>
                        <div className="panel-row">
                          <span className="panel-row-label">Quantity sold</span>
                          <span className="panel-row-value" style={{ color: 'var(--accent)', fontSize: 14 }}>{line.qty ?? 0} bags</span>
                        </div>
                        <div className="panel-row">
                          <span className="panel-row-label">Total nominal kg</span>
                          <span className="panel-row-value">
                            {line.nominalKgPerBag ? `${(parseFloat(line.nominalKgPerBag) * (line.qty ?? 0)).toFixed(2)} kg` : '—'}
                          </span>
                        </div>
                        {line.pricePerBag != null && (
                          <div className="panel-row">
                            <span className="panel-row-label">Unit price (/ bag)</span>
                            <span className="panel-row-value">{fmtCcy(line.pricePerBag, selectedExit.currency)}</span>
                          </div>
                        )}
                        {line.lineTotal != null && (
                          <div className="panel-row">
                            <span className="panel-row-label">Line total</span>
                            <span className="panel-row-value" style={{ fontWeight: 600 }}>{fmtCcy(line.lineTotal, selectedExit.currency)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="panel-section">
                    <div className="panel-section-label">Charcoal source</div>
                    {line.charcoalType ? (
                      <>
                        <div className="panel-row">
                          <span className="panel-row-label">Type</span>
                          <span className="panel-row-value">{line.charcoalType}</span>
                        </div>
                        <div className="panel-row">
                          <span className="panel-row-label">Grade</span>
                          <span className="panel-row-value">Grade {line.grade}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>Lot info not available</div>
                    )}
                  </div>

                  {!isRaw && (line.costPerBag || line.workerRatePerBag) && (
                    <div className="panel-section">
                      <div className="panel-section-label">Bag cost & worker rate</div>
                      <div className="panel-row">
                        <span className="panel-row-label">Cost / bag</span>
                        <span className="panel-row-value">
                          {line.costPerBag ? `$${parseFloat(line.costPerBag).toFixed(3)}` : '—'}
                        </span>
                      </div>
                      <div className="panel-row">
                        <span className="panel-row-label">Worker rate / bag</span>
                        <span className="panel-row-value">
                          {line.workerRatePerBag ? `$${parseFloat(line.workerRatePerBag).toFixed(3)}` : '—'}
                        </span>
                      </div>
                      <div className="panel-row">
                        <span className="panel-row-label">Total worker cost</span>
                        <span className="panel-row-value">
                          {line.workerRatePerBag
                            ? `$${(parseFloat(line.workerRatePerBag) * (line.qty ?? 0)).toFixed(2)}`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* SALE — the authoritative total: Invoice.total for a registered-
                client sale, StockExit.amount for an anonymous one. Never
                recomputed from qty × price here — see stock-exits.service.ts's
                findAllGrouped() doc comment. */}
            <div className="panel-section">
              <div className="panel-section-label">Sale</div>
              <div className="panel-row">
                <span className="panel-row-label">Total sale</span>
                <span className="panel-row-value" style={{ fontWeight: 600, fontSize: 14 }}>
                  {selectedExit.saleTotal != null ? fmtCcy(selectedExit.saleTotal, selectedExit.currency) : 'Not set'}
                </span>
              </div>
            </div>

            {/* PAYMENT — every payment actually applied to this sale (a
                registered-client sale can accumulate more than one payment
                over time; an anonymous sale has at most one, recorded
                directly on the exit). */}
            <div className="panel-section">
              <div className="panel-section-label">Payment</div>
              {(selectedExit.payments ?? []).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>No payment recorded — on account</div>
              ) : (
                (selectedExit.payments as any[]).map((p: any, i: number) => (
                  <div key={p.paymentId ?? i}>
                    {selectedExit.payments.length > 1 && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: i > 0 ? 10 : 0 }}>
                        Payment {i + 1}{p.displayId ? ` · ${p.displayId}` : ''}
                      </div>
                    )}
                    <div className="panel-row">
                      <span className="panel-row-label">Paid</span>
                      <span className="panel-row-value">{fmtCcy(p.appliedAmount, p.currency)}</span>
                    </div>
                    <div className="panel-row">
                      <span className="panel-row-label">Method</span>
                      <span className="panel-row-value">{methodLabel(p.method)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* RECEIVER — who actually received the money and how much was
                credited to their cash-ledger account. `creditedAmount` comes
                straight from the ledger's own AccountEntry, never recomputed
                here — see findAllGrouped()'s doc comment (backend). */}
            <div className="panel-section">
              <div className="panel-section-label">Receiver</div>
              {(selectedExit.payments ?? []).filter((p: any) => p.receiverId || p.receiverName).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>No receiver recorded</div>
              ) : (
                (selectedExit.payments as any[])
                  .filter((p: any) => p.receiverId || p.receiverName)
                  .map((p: any, i: number) => (
                    <div key={p.paymentId ?? i}>
                      <div className="panel-row">
                        <span className="panel-row-label">Received by</span>
                        <span className="panel-row-value">{p.receiverName ?? '—'}</span>
                      </div>
                      <div className="panel-row">
                        <span className="panel-row-label">Credited to receiver account</span>
                        <span className="panel-row-value" style={{ color: 'var(--accent)' }}>
                          {p.creditedAmount != null ? `+${fmtCcy(p.creditedAmount, p.currency)}` : '—'}
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* BALANCE — Invoice.paidAmount/status for a registered-client
                sale (recomputed by PaymentAllocationService, never a
                client-side sum); an anonymous sale is binary (recorded =
                fully paid, unset = on account). */}
            <div className="panel-section">
              <div className="panel-section-label">Balance</div>
              <div className="panel-row">
                <span className="panel-row-label">Status</span>
                <span className="panel-row-value" style={{ fontWeight: 600 }}>
                  {selectedExit.remaining == null
                    ? '—'
                    : parseFloat(selectedExit.remaining) <= 0
                      ? 'Paid in full'
                      : `Remaining: ${fmtCcy(selectedExit.remaining, selectedExit.currency)}`}
                </span>
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-label">Transaction</div>
              <div className="panel-row">
                <span className="panel-row-label">Recipient</span>
                <span className="panel-row-value">{selectedExit.recipient ?? '—'}</span>
              </div>
              <div className="panel-row">
                <span className="panel-row-label">Logged by</span>
                <span className="panel-row-value">{selectedExit.loggedBy?.name ?? '—'}</span>
              </div>
              {selectedExit.rawExit?.reason && (
                <div className="panel-row">
                  <span className="panel-row-label">Notes</span>
                  <span className="panel-row-value" style={{ fontSize: 12 }}>{selectedExit.rawExit.reason}</span>
                </div>
              )}
              <div className="panel-row">
                <span className="panel-row-label">Date</span>
                <span className="panel-row-value">
                  {new Date(selectedExit.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            </div>

          </div>
          {/* Edit sale amount — anonymous (non-invoiced) sales only. An
              invoiced sale's price/paid/balance is fully covered by the
              Sale/Payment/Balance sections above (sourced from the invoice
              and its payments) — nothing left to show or edit here. */}
          {!selectedExit.invoiceId && (
            <div className="panel-footer" style={{ flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: selectedExit.rawExit?.amount ? 'var(--text3)' : 'var(--accent2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                {selectedExit.rawExit?.amount ? `Sale amount: $${parseFloat(selectedExit.rawExit.amount).toFixed(2)} — update` : '⚠ Sale amount not set — enter to track revenue'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  type="number" min="0" step="0.01"
                  placeholder={selectedExit.rawExit?.amount ? parseFloat(selectedExit.rawExit.amount).toFixed(2) : 'Enter total sale price $'}
                  value={editAmount}
                  onChange={e => setEditAmount(e.target.value)}
                  style={{ fontFamily: "'IBM Plex Mono',monospace", flex: 1 }}
                  onKeyDown={e => { if (e.key === 'Enter' && editAmount) { updateExit.mutate({ id: selectedExit.rawExit.id, amount: parseFloat(editAmount) }, { onSuccess: (u) => { setSelectedExit((g: any) => g ? { ...g, rawExit: u } : g); setEditAmount(''); showToast('Amount updated') } }) } }}
                />
                <button className="btn primary" disabled={updateExit.isPending || !editAmount}
                  onClick={() => { if (!editAmount) return; updateExit.mutate({ id: selectedExit.rawExit.id, amount: parseFloat(editAmount) }, { onSuccess: (u) => { setSelectedExit((g: any) => g ? { ...g, rawExit: u } : g); setEditAmount(''); showToast('Amount updated — balance & P&L recalculated') } }) }}>
                  <i className="ti ti-check" style={{ fontSize: 13 }} /> {updateExit.isPending ? '…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
        )
      })()}
      {selectedExit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.15)', zIndex: 19 }}
          onClick={() => setSelectedExit(null)} />
      )}

      {/* Toast */}
      {toast && (
        <div className="toast show">
          <i className="ti ti-check-circle" /> <span>{toast}</span>
        </div>
      )}
    </>
  )
}
