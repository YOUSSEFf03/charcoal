import { useState, useRef, useEffect } from 'react'
import Topbar from '../components/layout/Topbar'
import { useBagTypes } from '../hooks/useBagTypes'
import { useStockLots, usePackedStockSummary, usePackedStockRecords, useStockExits, useCreateStockExit, useUpdateStockExit, useWalkInSummary } from '../hooks/useWarehouse'
import { useClients } from '../hooks/useClients'
import { useWorkers } from '../hooks/useWorkers'
import { useReceivers } from '../hooks/useReceivers'
import { useCreatePayment } from '../hooks/usePayments'
import { useRate } from '../context/RateContext'
import { roundDp } from '../lib/money'

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

export default function WarehouseSales() {
  // Real data from API
  const bagTypesQ = useBagTypes()
  const lotsQ = useStockLots({ hasStock: true, limit: 100 })
  const packedSummaryQ = usePackedStockSummary()
  const clientsQ = useClients({ limit: 100 })
  const workersQ = useWorkers()
  const { receivers: customReceivers } = useReceivers()
  const rateCtx = useRate()
  const rawRate = rateCtx.rawRate

  const packedRecordsQ = usePackedStockRecords({ limit: 200 })

  // Log tab date filter — must be declared before exitsQ uses them.
  const thirtyDaysAgoStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })()
  const [logDateFrom, setLogDateFrom] = useState(thirtyDaysAgoStr)
  const [logDateTo, setLogDateTo] = useState('')

  const exitsQ = useStockExits({
    exitType: 'walk_in',
    dateFrom: logDateFrom || undefined,
    dateTo: logDateTo || undefined,
    limit: 100,
  })

  const today = new Date().toISOString().slice(0, 10)
  const weekStart = (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10)
  })()
  // KPI: backend-aggregated totals (no page limit, accurate for any volume).
  const todaySummaryQ = useWalkInSummary({ dateFrom: today, dateTo: today })
  const weekSummaryQ  = useWalkInSummary({ dateFrom: weekStart, dateTo: today })

  // Paginated exits list — kept for the today's log table and cash-box totals only.
  const todayExitsQ = useStockExits({ exitType: 'walk_in', dateFrom: today, dateTo: today, limit: 100 })
  const createExit = useCreateStockExit()
  const createPayment = useCreatePayment()

  const bagTypes = bagTypesQ.data ?? []
  const activeLots = lotsQ.data?.data ?? []
  const apiClients = clientsQ.data?.data ?? []
  const packedRecords = packedRecordsQ.data ?? []
  const totalBagsInStock = (packedSummaryQ.data ?? []).reduce((s, p) => s + p.totalBags, 0)

  // Map bagTypeId → available bags in stock
  const bagStockMap = new Map<string, number>(
    (packedSummaryQ.data ?? []).map(p => [p.bagTypeId, p.totalBags])
  )

  // Receivers: real workers + custom receivers from Settings
  const allReceivers = [
    ...(workersQ.data ?? []).map(w => ({ id: w.id, name: w.name, role: 'worker' })),
    ...customReceivers,
  ]

  const WALK_IN = { id: 'walk-in', name: 'Walk-in customer', type: 'walk_in', initials: 'W', meta: 'no account · cash only' }

  const [tab, setTab] = useState<SaleTab>('entry')

  // Buyer combo
  const [buyerInput, setBuyerInput] = useState('')
  const [buyerOpen, setBuyerOpen] = useState(false)
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10))
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
  const [receiver, setReceiver] = useState('')
  const [notes, setNotes] = useState('')

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
  const filteredClients = q
    ? allBuyers.filter(c => c.name.toLowerCase().includes(q) || c.meta.toLowerCase().includes(q))
    : allBuyers
  const showAddNew = q.length > 0 && !allBuyers.some(c => c.name.toLowerCase() === q)
  const selectedBuyer = allBuyers.find(c => c.id === selectedBuyerId) ?? null

  function pickBuyer(c: typeof allBuyers[0]) {
    setSelectedBuyerId(c.id)
    setBuyerInput(c.name)
    setBuyerOpen(false)
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

  async function submitSale() {
    const buyerName = selectedBuyer ? selectedBuyer.name : (buyerInput.trim() || 'Walk-in')

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

      // For each bag line find a packed stock record and create an exit
      for (const ln of activeLines) {
        const qty = parseInt(ln.qty)
        // Find packed stock records for this bag type sorted by oldest first
        const records = packedRecords
          .filter(r => r.bagTypeId === ln.bagTypeId && r.quantity > 0)
          .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

        let remaining = qty
        for (const rec of records) {
          if (remaining <= 0) break
          const take = Math.min(rec.quantity, remaining)
          try {
            const bt = bagTypes.find(b => b.id === ln.bagTypeId)
            const lineAmt = bt ? roundDp(take * (parseFloat(ln.price) || 0) * (ln.curr === 'LBP' ? (rawRate > 0 ? 1 / rawRate : 0) : 1), 2) : 0
            await createExit.mutateAsync({
              packedStockId: rec.id,
              bagTypeId: ln.bagTypeId,
              quantity: take,
              exitType: 'walk_in',
              date: saleDate,
              recipient: buyerName,
              reason: notes || undefined,
              ...(selectedBuyerId && selectedBuyerId !== 'walk-in' ? { clientId: selectedBuyerId } : {}),
              ...(lineAmt > 0 && selectedBuyerId && selectedBuyerId !== 'walk-in' ? { amount: lineAmt } : {}),
              ...(receiver ? { collectedBy: receiver } : {}),
            })
            remaining -= take
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
      // By-kg: create a raw lot stock exit (deducts from lot.kgRemaining)
      if (!kgWeight || !kgPrice) { showToast('Enter weight and price/kg'); return }
      const lot = activeLots.find(l => l.id === kgLotId)
      if (!lot) { showToast('Select a lot'); return }
      const kgNum = parseFloat(kgWeight)
      if (kgNum > parseFloat(lot.kgRemaining)) {
        showToast(`Only ${parseFloat(lot.kgRemaining).toLocaleString()} kg available`)
        return
      }
      try {
        const kgAmt = roundDp(kgNum * (parseFloat(kgPrice) || 0) * (kgCurr === 'LBP' ? (rawRate > 0 ? 1 / rawRate : 0) : 1), 2)
        await createExit.mutateAsync({
          lotId: lot.id,
          kgQuantity: kgNum,
          exitType: 'walk_in',
          date: saleDate,
          recipient: buyerName,
          reason: notes || undefined,
          ...(selectedBuyerId && selectedBuyerId !== 'walk-in' ? { clientId: selectedBuyerId } : {}),
          ...(kgAmt > 0 && selectedBuyerId && selectedBuyerId !== 'walk-in' ? { amount: kgAmt } : {}),
          ...(receiver ? { collectedBy: receiver } : {}),
        })
      } catch (err: any) {
        showToast(err?.error ?? 'Failed to record sale')
        return
      }
    }

    // If a registered client paid (partially or fully), record the payment so it
    // reduces their balance. Walk-in / "On account" → skip (balance stays as owed).
    const PAY_METHOD_MAP: Record<string, string> = {
      'Cash': 'cash', 'Whish': 'whish', 'OMT': 'omt', 'Bank transfer': 'cash',
    }
    const mappedMethod = PAY_METHOD_MAP[payMethod]
    if (selectedBuyerId && selectedBuyerId !== 'walk-in' && totalRecv > 0 && mappedMethod) {
      try {
        await createPayment.mutateAsync({
          clientId: selectedBuyerId,
          amount: totalRecv.toFixed(2),
          currency: 'USD',
          method: mappedMethod as any,
          date: saleDate,
          notes: notes ? `[ws] ${notes}` : '[ws]',
        })
      } catch (err: any) {
        showToast(err?.error ?? 'Sale recorded but payment entry failed')
        return
      }
    }

    showToast(`Sale recorded · $${totalUSD.toFixed(2)} from ${buyerName}`)
    setBuyerInput(''); setSelectedBuyerId(null)
    setRcvUsd(''); setRcvLbp('')
    setKgWeight(''); setKgPrice('')
    setNotes('')
    setPackedLines([{ id: Date.now(), bagTypeId: bagTypes[0]?.id ?? '', qty: '', price: '', curr: 'USD' }])
  }

  // Cash box — derived from today's real exit data
  const todayExits = todayExitsQ.data?.data ?? []
  const cashBoxCollected = roundDp(todayExits.reduce((s, e) => s + (e.amount ? parseFloat(e.amount) : 0), 0), 2)
  const cashBoxOnAccountCount = todayExits.filter((e: any) => e.clientId && !e.amount).length
  const cashBoxTotal2 = cashBoxCollected

  return (
    <>
      <Topbar title="Warehouse sales">
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
          Rate: 89,550 LL/$
        </span>
        <button className="btn">
          <i className="ti ti-history" style={{ fontSize: 15 }} /> Full history
        </button>
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
            <div className="kpi-label">Total exits recorded</div>
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
                      <label className="form-label">Received by</label>
                      <select className="form-input" value={receiver} onChange={e => setReceiver(e.target.value)}>
                        <option value="">— select receiver —</option>
                        {allReceivers.map(r => (
                          <option key={r.id} value={r.name}>{r.name}{r.role ? ` (${r.role})` : ''}</option>
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

                  <button className="submit-btn" onClick={submitSale}>
                    <i className="ti ti-check" /> Record this sale
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
                    {todayExitsQ.isLoading ? '—' : `$${cashBoxCollected.toFixed(2)}`}
                  </span>
                </div>
                <div className="cb-row">
                  <span className="cb-label">Sales today</span>
                  <span className="cb-val">
                    {todayExitsQ.isLoading ? '—' : `${todayExits.length} exit${todayExits.length !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="cb-row">
                  <span className="cb-label">On account (no amount)</span>
                  <span className="cb-val amber">
                    {todayExitsQ.isLoading ? '—' : `${cashBoxOnAccountCount} sale${cashBoxOnAccountCount !== 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="cb-total">
                  <span className="cb-total-label">Total collected today</span>
                  <span className="cb-total-val">
                    {todayExitsQ.isLoading ? '—' : `$${cashBoxTotal2.toFixed(2)}`}
                  </span>
                </div>
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-list" /> Today's sales</div>
                  <span className="badge badge-gray">{todayExits.length} sales</span>
                </div>
                {todayExitsQ.isLoading && <div className="empty" style={{ fontSize: 12 }}>Loading…</div>}
                {!todayExitsQ.isLoading && todayExits.length === 0 && (
                  <div className="empty" style={{ fontSize: 12 }}>No sales recorded today.</div>
                )}
                {todayExits.map((exit: any) => {
                  const isRaw = !!exit.lotId
                  const bagName = exit.bagType?.name ?? (isRaw ? 'By kg' : '—')
                  const desc = isRaw
                    ? `${parseFloat(exit.kgQuantity ?? 0).toFixed(1)} kg raw`
                    : `${exit.quantity} × ${bagName}`
                  return (
                    <div
                      key={exit.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 18px', borderBottom: '1px solid var(--border)', fontSize: 12,
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedExit(exit)}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{exit.recipient ?? 'Walk-in'}</div>
                        <div style={{ color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                          {desc}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
                          {exit.amount ? `$${parseFloat(exit.amount).toFixed(2)}` : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {exit.collectedBy ?? ''}{exit.collectedBy && ' · '}
                          {new Date(exit.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
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
                  {exitsQ.data?.total ?? 0} exits
                </span>
              </div>
            </div>
            {exitsQ.isLoading && <div className="empty">Loading…</div>}
            {!exitsQ.isLoading && (exitsQ.data?.data ?? []).length === 0 && (
              <div className="empty">No walk-in sales recorded yet. Use the "Enter sale" tab to record a sale.</div>
            )}
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bag type</th>
                  <th>Charcoal (lot)</th>
                  <th style={{ textAlign: 'right' }}>Qty bags</th>
                  <th style={{ textAlign: 'right' }}>Nominal kg</th>
                  <th>Recipient</th>
                  <th>Logged by</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(exitsQ.data?.data ?? []).map((exit: any) => {
                  const isRaw = !!exit.lotId
                  const nomKg = isRaw
                    ? parseFloat(exit.kgQuantity ?? '0')
                    : exit.bagType ? parseFloat(exit.bagType.nominalKg) * exit.quantity : 0
                  const charcoalLot = isRaw ? exit.lot : exit.packedStock?.lot
                  return (
                    <tr key={exit.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedExit(exit)}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>
                        {new Date(exit.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        {isRaw ? (
                          <span className="badge badge-amber">By kg</span>
                        ) : (
                          <>
                            <div style={{ fontWeight: 500 }}>{exit.bagType?.name ?? '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                              {exit.bagType ? `${parseFloat(exit.bagType.nominalKg).toFixed(1)} kg / bag` : ''}
                            </div>
                          </>
                        )}
                      </td>
                      <td>
                        {charcoalLot ? (
                          <>
                            <div style={{ fontWeight: 500 }}>{charcoalLot.charcoalType}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                              Grade {charcoalLot.grade}
                            </div>
                          </>
                        ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right' }}>
                        {isRaw ? '—' : exit.quantity}
                      </td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', color: 'var(--text2)' }}>
                        {nomKg > 0 ? `${nomKg.toFixed(1)} kg` : '—'}
                      </td>
                      <td style={{ color: 'var(--text2)' }}>{exit.recipient ?? '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{exit.loggedBy?.name ?? '—'}</td>
                      <td><i className="ti ti-chevron-right" style={{ color: 'var(--text3)' }} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Exit detail panel */}
      {selectedExit && (
        <div className="lot-panel open">
          <div className="panel-head">
            <div>
              <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', marginBottom: 4 }}>
                WALK-IN SALE · {new Date(selectedExit.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {selectedExit.lotId
                  ? `${parseFloat(selectedExit.kgQuantity ?? '0').toFixed(1)} kg raw lot`
                  : `${selectedExit.quantity} × ${selectedExit.bagType?.name ?? '—'}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                {selectedExit.recipient ?? 'Walk-in'}
              </div>
            </div>
            <button className="panel-close" onClick={() => setSelectedExit(null)}>✕ Close</button>
          </div>
          <div className="panel-body">

            <div className="panel-section">
              <div className="panel-section-label">Bag details</div>
              <div className="panel-row">
                <span className="panel-row-label">Bag type</span>
                <span className="panel-row-value">{selectedExit.bagType?.name ?? '—'}</span>
              </div>
              <div className="panel-row">
                <span className="panel-row-label">Nominal kg / bag</span>
                <span className="panel-row-value">{selectedExit.bagType ? `${parseFloat(selectedExit.bagType.nominalKg).toFixed(2)} kg` : '—'}</span>
              </div>
              <div className="panel-row">
                <span className="panel-row-label">Quantity sold</span>
                <span className="panel-row-value" style={{ color: 'var(--accent)', fontSize: 14 }}>{selectedExit.quantity} bags</span>
              </div>
              <div className="panel-row">
                <span className="panel-row-label">Total nominal kg</span>
                <span className="panel-row-value">
                  {selectedExit.bagType
                    ? `${(parseFloat(selectedExit.bagType.nominalKg) * selectedExit.quantity).toFixed(2)} kg`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-label">Charcoal source (lot)</div>
              {selectedExit.packedStock?.lot ? (
                <>
                  <div className="panel-row">
                    <span className="panel-row-label">Type</span>
                    <span className="panel-row-value">{selectedExit.packedStock.lot.charcoalType}</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row-label">Grade</span>
                    <span className="panel-row-value">Grade {selectedExit.packedStock.lot.grade}</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row-label">Lot ID</span>
                    <span className="panel-row-value" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>
                      {selectedExit.packedStock.lot.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Lot info not available</div>
              )}
            </div>

            <div className="panel-section">
              <div className="panel-section-label">Bag cost & worker rate</div>
              <div className="panel-row">
                <span className="panel-row-label">Cost / bag</span>
                <span className="panel-row-value">
                  {selectedExit.bagType?.costPerBag ? `$${parseFloat(selectedExit.bagType.costPerBag).toFixed(3)}` : '—'}
                </span>
              </div>
              <div className="panel-row">
                <span className="panel-row-label">Worker rate / bag</span>
                <span className="panel-row-value">
                  {selectedExit.bagType?.workerRate ? `$${parseFloat(selectedExit.bagType.workerRate).toFixed(3)}` : '—'}
                </span>
              </div>
              <div className="panel-row">
                <span className="panel-row-label">Total worker cost</span>
                <span className="panel-row-value">
                  {selectedExit.bagType?.workerRate
                    ? `$${(parseFloat(selectedExit.bagType.workerRate) * selectedExit.quantity).toFixed(2)}`
                    : '—'}
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
              {selectedExit.reason && (
                <div className="panel-row">
                  <span className="panel-row-label">Notes</span>
                  <span className="panel-row-value" style={{ fontSize: 12 }}>{selectedExit.reason}</span>
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
          {/* Edit sale amount */}
          <div className="panel-footer" style={{ flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: selectedExit.amount ? 'var(--text3)' : 'var(--accent2)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {selectedExit.amount ? `Sale amount: $${parseFloat(selectedExit.amount).toFixed(2)} — update` : '⚠ Sale amount not set — enter to track revenue'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type="number" min="0" step="0.01"
                placeholder={selectedExit.amount ? parseFloat(selectedExit.amount).toFixed(2) : 'Enter total sale price $'}
                value={editAmount}
                onChange={e => setEditAmount(e.target.value)}
                style={{ fontFamily: "'IBM Plex Mono',monospace", flex: 1 }}
                onKeyDown={e => { if (e.key === 'Enter' && editAmount) { updateExit.mutate({ id: selectedExit.id, amount: parseFloat(editAmount) }, { onSuccess: (u) => { setSelectedExit(u); setEditAmount(''); showToast('Amount updated') } }) } }}
              />
              <button className="btn primary" disabled={updateExit.isPending || !editAmount}
                onClick={() => { if (!editAmount) return; updateExit.mutate({ id: selectedExit.id, amount: parseFloat(editAmount) }, { onSuccess: (u) => { setSelectedExit(u); setEditAmount(''); showToast('Amount updated — balance & P&L recalculated') } }) }}>
                <i className="ti ti-check" style={{ fontSize: 13 }} /> {updateExit.isPending ? '…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
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
