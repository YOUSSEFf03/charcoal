import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useStockLots, usePackedStockSummary, useWarehouseSummary, useStockAdjustments, useCreateStockAdjustment, useUpdateStockAdjustment, useDeleteStockAdjustment, useApproveStockAdjustment, useRejectStockAdjustment, useStockExits, useLotMaterialFlow, useAvailableStockLots } from '../hooks/useWarehouse'
import type { StockLot } from '../types/api'
import { usePackingSessions } from '../hooks/usePacking'
import { useSuppliers } from '../hooks/useSuppliers'
import { formatDate, toDateOnlyString } from '../lib/date'

type WTab = 'raw' | 'packed' | 'adj'

interface LotVM {
  id: string
  displayId?: string
  createdAt: string
  supplier: string
  arrival: string
  rawKg: number
  remainKg: number
  costPerKg: number
  status: string
  charcoalType: string
  grade: string
  source: string
}

function fmtDate(iso?: string | null) { return formatDate(iso) }

export default function Warehouse() {
  const [tab, setTab] = useState<WTab>('raw')
  const [lotPanelOpen, setLotPanelOpen] = useState(false)
  const [selectedLot, setSelectedLot] = useState<LotVM | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'depleted'>('all')
  const [filterSearch, setFilterSearch] = useState('')
  const [adjModalOpen, setAdjModalOpen] = useState(false)
  const [adjLotId, setAdjLotId] = useState('')
  const [adjQtyAfter, setAdjQtyAfter] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjError, setAdjError] = useState('')
  const [toast, setToast] = useState('')

  const stockLotsQ = useStockLots({ limit: 100 })
  // Unbounded (no 100-lot page cap) — feeds only the "New stock adjustment" lot
  // selector, which (unlike the main table above) must never hide an older lot
  // that still has real kgRemaining just because it isn't among the 100
  // most-recently-received (same fix as WarehouseSales' KG-sale picker).
  const availableLotsQ = useAvailableStockLots()
  const packedQ = usePackedStockSummary()
  const sessionsQ = usePackingSessions({ limit: 100 })
  const summaryQ = useWarehouseSummary()
  const adjQ = useStockAdjustments({ limit: 100 })
  const lotExitsQ = useStockExits(selectedLot ? { lotId: selectedLot.id, limit: 200 } : undefined)
  const lotFlowQ = useLotMaterialFlow(selectedLot?.id ?? '')
  const createAdj = useCreateStockAdjustment()
  const updateAdj = useUpdateStockAdjustment()
  const deleteAdj = useDeleteStockAdjustment()
  const approveAdj = useApproveStockAdjustment()
  const rejectAdj = useRejectStockAdjustment()
  const [editAdj, setEditAdj] = useState<any>(null)
  const [editAdjQty, setEditAdjQty] = useState('')
  const [editAdjReason, setEditAdjReason] = useState('')
  const [editAdjError, setEditAdjError] = useState('')
  const suppliersQ = useSuppliers({ limit: 100 })
  const supplierNameById = new Map((suppliersQ.data?.data ?? []).map(s => [s.id, s.name]))

  const stockLots = stockLotsQ.data?.data ?? []
  const packedSummary = packedQ.data ?? []
  const sessions = sessionsQ.data?.data ?? []

  const lots: LotVM[] = stockLots.map(l => {
    const received = parseFloat(l.kgReceived)
    const remaining = parseFloat(l.kgRemaining)
    return {
      id: l.id,
      displayId: l.displayId,
      createdAt: l.createdAt ?? l.dateReceived,
      supplier: supplierNameById.get(l.supplierId) ?? l.supplierId,
      arrival: fmtDate(l.dateReceived),
      rawKg: received,
      remainKg: remaining,
      costPerKg: l.costPerKg != null ? parseFloat(l.costPerKg) : 0,
      status: remaining > 0 ? 'active' : 'depleted',
      charcoalType: l.charcoalType ?? '—',
      grade: l.grade ?? '—',
      source: l.source ?? 'direct',
    }
  })

  const adjustmentLots: LotVM[] = (availableLotsQ.data ?? []).map((l: StockLot) => {
    const received = parseFloat(l.kgReceived)
    const remaining = parseFloat(l.kgRemaining)
    return {
      id: l.id,
      displayId: l.displayId,
      createdAt: l.createdAt ?? l.dateReceived,
      supplier: supplierNameById.get(l.supplierId) ?? l.supplierId,
      arrival: fmtDate(l.dateReceived),
      rawKg: received,
      remainKg: remaining,
      costPerKg: l.costPerKg != null ? parseFloat(l.costPerKg) : 0,
      status: remaining > 0 ? 'active' : 'depleted',
      charcoalType: l.charcoalType ?? '—',
      grade: l.grade ?? '—',
      source: l.source ?? 'direct',
    }
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  const totalRaw = summaryQ.data ? parseFloat(summaryQ.data.totalRawKg) : lots.reduce((s, l) => s + l.remainKg, 0)
  const totalPacked = summaryQ.data ? parseFloat(summaryQ.data.totalPackedNominalKg) : 0
  const systemTotal = totalRaw + totalPacked
  const totalValue = summaryQ.data && (summaryQ.data as any).estimatedTotalValue
    ? parseFloat((summaryQ.data as any).estimatedTotalValue)
    : lots.reduce((s, l) => s + l.remainKg * l.costPerKg, 0)
  const activeLots = summaryQ.data?.lotCount ?? lots.filter(l => l.status === 'active').length
  const totalPackedBags = (summaryQ.data?.packedSummary ?? packedSummary).reduce((s, p) => s + p.totalBags, 0)

  const filteredLots = lots.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      return (
        l.charcoalType.toLowerCase().includes(q) ||
        l.supplier.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q)
      )
    }
    return true
  })

  function openLot(lot: LotVM) {
    setSelectedLot(lot)
    setLotPanelOpen(true)
  }

  const lotById = new Map(lots.map(l => [l.id, l]))

  // `selectedLot` only records WHICH lot the panel is open for — it must never be read for
  // display, since it's a one-time snapshot taken at openLot() and never re-synced (Finding
  // D). `liveLot` re-derives the current row from the already-reactive `lots`/`lotById`
  // (itself sourced from useStockLots, refetched by every mutation below), so every field
  // shown in the panel — including Remaining — reflects the latest data, never a stale one.
  const liveLot = selectedLot ? (lotById.get(selectedLot.id) ?? selectedLot) : null

  const packedCards = packedSummary.map(p => ({
    size: p.bagTypeName,
    bags: p.totalBags,
    totalKg: parseFloat(p.totalNominalKg),
    lots: 0,
  }))
  const totalPackedKg = packedCards.reduce((s, c) => s + c.totalKg, 0) || 1

  const adjustments = adjQ.data?.data ?? []
  // Lots with at least one APPROVED adjustment — pending/rejected ones never
  // touched kgRemaining, so they don't earn the "Adjusted" badge on the raw-
  // lots table. Bounded by adjQ's own 100-row page, same as the Adjustments
  // tab itself — a lot whose only adjustment fell off that page won't show
  // the badge, matching what the Adjustments tab would show for it too.
  const adjustedLotIds = new Set(
    adjustments.filter((a: any) => a.adjustmentType === 'lot' && a.status === 'approved' && a.lotId).map((a: any) => a.lotId),
  )

  const tabCounts = {
    raw: lots.filter(l => l.status === 'active').length,
    packed: packedCards.length,
    adj: adjQ.data?.total ?? 0,
  }

  return (
    <>
      <Topbar title="Warehouse">
        <button className="btn primary">
          <i className="ti ti-tools" style={{ fontSize: 15 }} /> New packing session
        </button>
      </Topbar>

      <div className="tabs">
        <button className={`tab${tab === 'raw' ? ' active' : ''}`} onClick={() => setTab('raw')}>
          <i className="ti ti-stack-2" style={{ fontSize: 15 }} /> Raw lots
          <span className="tab-count">{tabCounts.raw}</span>
        </button>
        <button className={`tab${tab === 'packed' ? ' active' : ''}`} onClick={() => setTab('packed')}>
          <i className="ti ti-box" style={{ fontSize: 15 }} /> Packed goods
          <span className="tab-count">{tabCounts.packed}</span>
        </button>
        <button className={`tab${tab === 'adj' ? ' active' : ''}`} onClick={() => setTab('adj')}>
          <i className="ti ti-adjustments" style={{ fontSize: 15 }} /> Adjustments
          <span className="tab-count">{tabCounts.adj}</span>
        </button>
      </div>

      <div className="content">
        {/* Summary bar */}
        <div className="summary-bar">
          <div className="sum-cell">
            <div className="sum-label">total raw stock</div>
            <div className="sum-value">
              {Math.round(totalRaw).toLocaleString()}{' '}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)' }}>kg</span>
            </div>
            <div className="sum-sub">across {activeLots} open lots</div>
          </div>
          <div className="sum-cell">
            <div className="sum-label">total packed</div>
            <div className="sum-value">
              {Math.round(totalPacked).toLocaleString()}{' '}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)' }}>kg</span>
            </div>
            <div className="sum-sub">{totalPackedBags.toLocaleString()} bags ready</div>
          </div>
          <div className="sum-cell">
            <div className="sum-label">system total</div>
            <div className="sum-value" style={{ color: 'var(--accent)' }}>
              {Math.round(systemTotal).toLocaleString()}{' '}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)' }}>kg</span>
            </div>
            <div className="sum-sub">raw + packed combined</div>
          </div>
          <div className="sum-cell">
            <div className="sum-label">warehouse value</div>
            <div className="sum-value">${Math.round(totalValue).toLocaleString()}</div>
            <div className="sum-sub">at cost price</div>
          </div>
          <div className="sum-cell">
            <div className="sum-label">open lots</div>
            <div className="sum-value" style={{ fontSize: 15, marginTop: 2 }}>{activeLots}</div>
            <div className="sum-sub">active stock</div>
          </div>
        </div>

        {/* Raw lots tab */}
        {tab === 'raw' && (
          <div>
            <div className="filters">
              <div className="filter-input">
                <i className="ti ti-search" />
                <input
                  type="text"
                  placeholder="Search by type, supplier, lot ID…"
                  value={filterSearch}
                  onChange={e => setFilterSearch(e.target.value)}
                />
              </div>
              <select
                className="filter-select"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
              >
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="depleted">Depleted</option>
              </select>
              <div className="filter-sep" />
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                {filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">
                  <i className="ti ti-stack-2" /> Raw stock lots
                </div>
                <button className="card-action">Export</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Type / grade</th>
                    <th>Supplier</th>
                    <th>Received</th>
                    <th>Remaining</th>
                    <th>Fill level</th>
                    <th>Cost / kg</th>
                    <th>Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stockLotsQ.isLoading && [0, 1, 2].map(i => (
                    <tr key={i}>
                      <td colSpan={9}>
                        <div className="skeleton" style={{ width: '100%', height: 16 }} />
                      </td>
                    </tr>
                  ))}
                  {stockLotsQ.isError && (
                    <tr>
                      <td colSpan={9} className="empty">
                        Failed to load stock lots.
                        <div><button className="btn" style={{ marginTop: 10 }} onClick={() => stockLotsQ.refetch()}>Retry</button></div>
                      </td>
                    </tr>
                  )}
                  {!stockLotsQ.isLoading && !stockLotsQ.isError && filteredLots.map(lot => {
                    const pct = lot.rawKg > 0 ? (lot.remainKg / lot.rawKg) * 100 : 0
                    const barClass = pct >= 60 ? 'bar-high' : pct >= 30 ? 'bar-mid' : 'bar-low'
                    return (
                      <tr key={lot.id} style={{ cursor: 'pointer' }} onClick={() => openLot(lot)}>
                        <td>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text3)' }} title={lot.id}>
                            {lot.displayId ?? lot.id.slice(0, 8).toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {lot.charcoalType}
                            {adjustedLotIds.has(lot.id) && (
                              <span
                                className="badge badge-amber"
                                style={{ fontSize: 10, padding: '1px 6px' }}
                                title="This lot has at least one approved stock adjustment"
                              >
                                <i className="ti ti-adjustments" style={{ fontSize: 10 }} /> Adjusted
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Grade {lot.grade}</div>
                        </td>
                        <td style={{ color: 'var(--text2)' }}>{lot.supplier}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text2)' }}>
                          {lot.rawKg.toLocaleString()} kg
                        </td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>
                          {lot.remainKg.toLocaleString()} kg
                        </td>
                        <td>
                          <div className="bar-wrap">
                            <div className="bar-track">
                              <div className={`bar-fill ${barClass}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="bar-pct" style={pct < 30 ? { color: 'var(--red)' } : undefined}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>${lot.costPerKg.toFixed(3)}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>
                          ${Math.round(lot.remainKg * lot.costPerKg).toLocaleString()}
                        </td>
                        <td><i className="ti ti-chevron-right" style={{ color: 'var(--text3)' }} /></td>
                      </tr>
                    )
                  })}
                  {!stockLotsQ.isLoading && !stockLotsQ.isError && filteredLots.length === 0 && (
                    <tr><td colSpan={9} className="empty">No stock lots found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Packed goods tab */}
        {tab === 'packed' && (
          <div>
            <div className="packed-grid">
              {packedQ.isLoading && [0, 1, 2].map(i => (
                <div key={i} className="packed-card">
                  <div className="skeleton" style={{ width: '50%', height: 12, marginBottom: 8 }} />
                  <div className="skeleton" style={{ width: '40%', height: 22 }} />
                </div>
              ))}
              {!packedQ.isLoading && packedCards.map(card => (
                <div key={card.size} className="packed-card">
                  <div className="pc-header">
                    <span className="pc-size">{card.size}</span>
                    <span className="pc-cost">{card.lots} lot{card.lots !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="pc-count">{card.bags.toLocaleString()}</div>
                  <div className="pc-unit">bags in stock</div>
                  <div className="bar-track" style={{ marginTop: 10 }}>
                    <div className="bar-fill bar-high" style={{ width: `${(card.totalKg / totalPackedKg) * 100}%` }} />
                  </div>
                  <div className="pc-footer">
                    <div className="pc-meta">Nominal kg <span>{card.totalKg.toLocaleString()} kg</span></div>
                  </div>
                </div>
              ))}
              {!packedQ.isLoading && packedCards.length > 0 && (
                <div className="packed-card" style={{ background: 'var(--surface2)', borderColor: 'var(--border2)' }}>
                  <div className="pc-header">
                    <span className="pc-size" style={{ color: 'var(--text2)' }}>All types</span>
                  </div>
                  <div className="pc-count" style={{ color: 'var(--accent)' }}>
                    {packedCards.reduce((s, c) => s + c.bags, 0).toLocaleString()}
                  </div>
                  <div className="pc-unit">total bags</div>
                  <div style={{ height: 20 }} />
                  <div className="pc-footer">
                    <div className="pc-meta">Total kg <span>{packedCards.reduce((s, c) => s + c.totalKg, 0).toLocaleString()} kg</span></div>
                    <div className="pc-meta">{packedCards.length} bag types</div>
                  </div>
                </div>
              )}
              {!packedQ.isLoading && packedCards.length === 0 && (
                <div className="empty">No packed stock.</div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-list" /> Packed stock — by source lot</div>
                <button className="card-action">Export</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bag type</th>
                    <th>Source lot</th>
                    <th>Qty</th>
                    <th>kg packed</th>
                    <th>Packed on</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const bagCount = s.bagsOutput.reduce((acc, b) => acc + b.qty, 0)
                    return (
                      <tr key={s.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>
                          {s.bagsOutput.length} type{s.bagsOutput.length !== 1 ? 's' : ''}
                        </td>
                        <td>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text3)' }}>
                            {(s.sessionLots?.[0]?.lot?.displayId ?? s.sessionLots?.[0]?.lotId?.slice(0, 8) ?? s.workerId.slice(0, 8))?.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>{bagCount}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                          {parseFloat(s.kgOutputTotal).toFixed(0)} kg
                        </td>
                        <td style={{ color: 'var(--text2)' }}>{fmtDate(s.date)}</td>
                      </tr>
                    )
                  })}
                  {sessions.length === 0 && (
                    <tr><td colSpan={5} className="empty">No packing sessions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Adjustments tab */}
        {tab === 'adj' && (
          <div className="card">
            <div className="card-head">
              <div className="card-title"><i className="ti ti-adjustments" /> Stock adjustments</div>
              <button className="btn primary" style={{ fontSize: 12 }} onClick={() => {
                setAdjLotId(lots.find(l => l.status === 'active')?.id ?? '')
                setAdjQtyAfter('')
                setAdjReason('')
                setAdjError('')
                setAdjModalOpen(true)
              }}>
                <i className="ti ti-plus" style={{ fontSize: 13 }} /> New adjustment
              </button>
            </div>
            {adjQ.isLoading && <div className="empty">Loading…</div>}
            {!adjQ.isLoading && adjustments.length === 0 && (
              <div className="empty">No adjustments logged yet.</div>
            )}
            {adjustments.map((a: any) => {
              const diff = parseFloat(a.difference ?? '0')
              const isLoss = diff < 0
              return (
                <div key={a.id} className="adj-row">
                  <div className="adj-icon" style={{ background: isLoss ? 'var(--red-bg)' : 'var(--accent-bg)' }}>
                    <i className={`ti ti-${isLoss ? 'minus' : 'plus'}`} style={{ color: isLoss ? 'var(--red)' : 'var(--accent)' }} />
                  </div>
                  <div className="adj-body">
                    <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {a.adjustmentType === 'lot'
                        ? `${a.lot?.charcoalType ?? 'Lot'} · Grade ${a.lot?.grade ?? '—'}`
                        : `Packed stock`}
                      {a.status === 'pending' && (
                        <span className="badge badge-amber" style={{ fontSize: 10, padding: '1px 6px' }}>
                          Pending approval
                        </span>
                      )}
                      {a.status === 'rejected' && (
                        <span className="badge badge-gray" style={{ fontSize: 10, padding: '1px 6px' }}>
                          Rejected
                        </span>
                      )}
                    </strong>
                    <div className="adj-meta">
                      {new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}Before: {parseFloat(a.qtyBefore).toLocaleString()} kg
                      {' · '}After: {parseFloat(a.qtyAfter).toLocaleString()} kg
                      {a.reason && ` · ${a.reason}`}
                      {a.status === 'pending' && ` · submitted by ${a.countedBy?.name ?? 'unknown'} — stock not yet changed`}
                    </div>
                  </div>
                  <div className="adj-diff" style={{ color: isLoss ? 'var(--red)' : 'var(--accent)', marginRight: 8 }}>
                    {diff > 0 ? '+' : ''}{diff.toFixed(0)} kg
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {a.status === 'pending' && (
                      <>
                        <button
                          className="btn"
                          style={{ padding: '4px 8px', fontSize: 12, background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                          disabled={approveAdj.isPending}
                          onClick={() => approveAdj.mutate(a.id, {
                            onSuccess: () => showToast('Adjustment approved — stock updated'),
                            onError: (err: any) => showToast(err?.error ?? 'Failed to approve adjustment'),
                          })}
                          title="Approve — applies the stock change now"
                        >
                          <i className="ti ti-check" style={{ fontSize: 13 }} />
                        </button>
                        <button
                          className="btn"
                          style={{ padding: '4px 8px', fontSize: 12, background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' }}
                          disabled={rejectAdj.isPending}
                          onClick={() => {
                            if (confirm('Reject this adjustment? It will be discarded with no stock change.')) {
                              rejectAdj.mutate(a.id, {
                                onSuccess: () => showToast('Adjustment rejected'),
                                onError: (err: any) => showToast(err?.error ?? 'Failed to reject adjustment'),
                              })
                            }
                          }}
                          title="Reject — discards it, no stock change"
                        >
                          <i className="ti ti-x" style={{ fontSize: 13 }} />
                        </button>
                      </>
                    )}
                    <button
                      className="btn"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => {
                        setEditAdj(a)
                        setEditAdjQty(parseFloat(a.qtyAfter).toString())
                        setEditAdjReason(a.reason ?? '')
                        setEditAdjError('')
                      }}
                    >
                      <i className="ti ti-edit" style={{ fontSize: 13 }} />
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '4px 8px', fontSize: 12, background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' }}
                      disabled={deleteAdj.isPending}
                      onClick={() => {
                        if (confirm(a.status === 'approved' ? 'Delete this adjustment? The stock quantity will be reversed.' : 'Delete this adjustment?')) {
                          deleteAdj.mutate(a.id, { onSuccess: () => showToast('Adjustment deleted') })
                        }
                      }}
                    >
                      <i className="ti ti-trash" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Lot detail — full screen overlay */}
      {lotPanelOpen && liveLot && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Topbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 56, borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn" onClick={() => setLotPanelOpen(false)}>
                <i className="ti ti-arrow-left" style={{ fontSize: 14 }} /> Back to warehouse
              </button>
              <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
              <div>
                <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', marginRight: 8 }} title={liveLot.id}>
                  {liveLot.displayId ?? liveLot.id.slice(0, 8).toUpperCase()}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{liveLot.charcoalType} · Grade {liveLot.grade}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 8 }}>{liveLot.supplier} · {liveLot.arrival}</span>
              </div>
            </div>
            <span className={`badge ${liveLot.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{liveLot.status}</span>
          </div>

          {/* Body */}
          <div style={{ padding: '24px', flex: 1 }}>

            {(() => {
              const flow = lotFlowQ.data
              const received = flow ? parseFloat(flow.received) : liveLot.rawKg
              const remaining = flow ? parseFloat(flow.remaining) : liveLot.remainKg
              const consumedPacking = flow ? parseFloat(flow.consumedPacking) : null
              const packedOutput = flow ? parseFloat(flow.packedOutput) : null
              const waste = flow ? parseFloat(flow.waste) : null
              const wastePct = flow?.wastePct != null ? parseFloat(flow.wastePct) : null
              const yieldPct = flow?.yieldPct != null ? parseFloat(flow.yieldPct) : null
              const consumedFillJobs = flow ? parseFloat(flow.consumedFillJobs) : null
              const rawMaterialExits = flow ? parseFloat(flow.rawMaterialExitsKg) : null
              const packedBagSales = flow ? parseFloat(flow.packedBagSalesKg) : null
              const lotAdjustments = flow ? parseFloat(flow.lotAdjustmentsKg) : null
              const currentPackedStock = flow ? parseFloat(flow.currentPackedStockKg) : null
              const fmtKg = (n: number | null) => n == null ? '—' : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`

              return (
                <>
                  {/* KPI row — material flow, never a combined "packed/sold" figure. "Packed
                      Output" is the HISTORICAL, immutable production figure (from
                      PackingSession.kgOutputTotal) — it is never derived from current
                      PackedStock.quantity, which shrinks as bags are sold. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
                    {[
                      { label: 'Received', value: fmtKg(received), color: '' },
                      { label: 'Consumed — Packing', value: fmtKg(consumedPacking), color: '' },
                      { label: 'Packed Output', value: fmtKg(packedOutput), color: 'var(--accent)' },
                      { label: 'Remaining Raw Material', value: fmtKg(remaining), color: 'var(--accent)' },
                    ].map(k => (
                      <div key={k.label} className="kpi-tile">
                        <div className="kpi-tile-label">{k.label}</div>
                        <div className="kpi-tile-value" style={k.color ? { color: k.color } : {}}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar — raw stock remaining */}
                  <div style={{ marginBottom: 4 }}>
                    <div className="bar-track" style={{ height: 10 }}>
                      <div className="bar-fill bar-high" style={{ width: `${received > 0 ? (remaining / received) * 100 : 0}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }}>
                      <span>0 kg</span>
                      <span>{received > 0 ? ((remaining / received) * 100).toFixed(1) : 0}% remaining · lot value ${Math.round(remaining * liveLot.costPerKg).toLocaleString()}</span>
                      <span>{received.toLocaleString()} kg</span>
                    </div>
                  </div>

                  {/* Packing performance — input → output → waste, mirrors the packing-session detail panel's waste bar */}
                  <div className="pd-section-label" style={{ marginTop: 20 }}>Packing performance</div>
                  <div className="pd-waste-bar" style={{ margin: '0 0 4px' }}>
                    <div className="pd-wc">
                      <div className="wl">Consumed — packing</div>
                      <div className="wv">{fmtKg(consumedPacking)}</div>
                      <div className="ws">raw charcoal input</div>
                    </div>
                    <div className="pd-wc">
                      <div className="wl">Packed output</div>
                      <div className="wv" style={{ color: 'var(--accent)' }}>{fmtKg(packedOutput)}</div>
                      <div className="ws">{yieldPct != null ? `${yieldPct.toFixed(1)}% yield` : '—'}</div>
                    </div>
                    <div className="pd-wc">
                      <div className="wl">Waste / loss</div>
                      <div className="wv" style={{ color: waste && waste > 0 ? 'var(--red)' : undefined }}>{fmtKg(waste)}</div>
                      <div className="ws">{wastePct != null ? `${wastePct.toFixed(1)}% of consumed` : '—'}</div>
                    </div>
                  </div>
                  {currentPackedStock !== null && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 14 }}>
                      Current Packed Stock (on hand from these batches today, not a production figure): <strong style={{ color: 'var(--text2)' }}>{fmtKg(currentPackedStock)}</strong>
                    </div>
                  )}
                  {lotFlowQ.isLoading && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 10 }}>Loading material flow…</div>
                  )}
                  {lotFlowQ.isError && (
                    <div style={{ fontSize: 11.5, color: 'var(--red)', marginBottom: 10 }}>Failed to load material-flow data.</div>
                  )}

                  {/* Other stock movements — four structurally distinct categories, never
                      merged: fill-job consumption (raw), raw-material exits (raw — reduces
                      Remaining), packed-bag sales (finished goods — does NOT reduce
                      Remaining), and lot-level count adjustments (raw — reduces/increases
                      Remaining, signed). Together with Consumed — Packing above, these are
                      the complete reconciliation of Received against Remaining Raw Material:
                      Received − Consumed(Packing) − Consumed(Fill jobs) − Raw Material Exits
                      + Lot Adjustments = Remaining Raw Material. */}
                  {(consumedFillJobs !== null && (consumedFillJobs > 0 || (rawMaterialExits ?? 0) > 0 || (packedBagSales ?? 0) > 0 || (lotAdjustments ?? 0) !== 0)) && (
                    <div className="card" style={{ marginBottom: 16 }}>
                      <div className="card-head"><div className="card-title"><i className="ti ti-transfer" /> Other stock movements</div></div>
                      {consumedFillJobs > 0 && (
                        <div className="pd-row" style={{ padding: '7px 18px' }}>
                          <span className="pd-label">Consumed — Fill jobs</span>
                          <span className="pd-value">{fmtKg(consumedFillJobs)}</span>
                        </div>
                      )}
                      {(rawMaterialExits ?? 0) > 0 && (
                        <div className="pd-row" style={{ padding: '7px 18px' }}>
                          <span className="pd-label">Raw Material Exits (by kg, reduces Remaining)</span>
                          <span className="pd-value">{fmtKg(rawMaterialExits)}</span>
                        </div>
                      )}
                      {(packedBagSales ?? 0) > 0 && (
                        <div className="pd-row" style={{ padding: '7px 18px' }}>
                          <span className="pd-label">Packed-Bag Sales (finished goods — does not reduce Remaining)</span>
                          <span className="pd-value">{fmtKg(packedBagSales)}</span>
                        </div>
                      )}
                      {(lotAdjustments ?? 0) !== 0 && (
                        <div className="pd-row" style={{ padding: '7px 18px' }}>
                          <span className="pd-label">
                            Stock Adjustments ({(lotAdjustments ?? 0) < 0 ? 'loss — reduces Remaining' : 'gain — increases Remaining'})
                          </span>
                          <span className="pd-value" style={{ color: (lotAdjustments ?? 0) < 0 ? 'var(--red)' : 'var(--accent)' }}>
                            {(lotAdjustments ?? 0) > 0 ? '+' : ''}{fmtKg(lotAdjustments)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>

              {/* Left: lot info + source contribution */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="card">
                  <div className="card-head"><div className="card-title">Lot details</div></div>
                  {[
                    ['Source', liveLot.source === 'container' ? 'Container' : 'Direct'],
                    ['Date received', liveLot.arrival],
                    ['Lot value (remaining)', `$${Math.round(liveLot.remainKg * liveLot.costPerKg).toLocaleString()}`],
                  ].map(([l, v]) => (
                    <div key={l} className="panel-row" style={{ padding: '7px 18px' }}>
                      <span className="panel-row-label">{l}</span>
                      <span className="panel-row-value">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: packing sessions (per-lot allocation) + exits / orders / sales table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-tools" /> Packing sessions — this lot's share</div>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                    historical input/output allocated per lot — never the session's full total
                  </span>
                </div>
                {lotFlowQ.isLoading && <div className="empty">Loading…</div>}
                {!lotFlowQ.isLoading && (lotFlowQ.data?.sessions.length ?? 0) === 0 && (
                  <div className="empty">No packing sessions.</div>
                )}
                {!lotFlowQ.isLoading && (lotFlowQ.data?.sessions.length ?? 0) > 0 && (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="right">Bags</th>
                        <th className="right">This lot's input</th>
                        <th className="right">Share of session</th>
                        <th className="right">Historical output</th>
                        <th className="right">Waste</th>
                        <th className="right">Current stock (batch)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotFlowQ.data!.sessions.map(s => (
                        <tr key={s.sessionId}>
                          <td style={{ color: 'var(--text2)' }}>{fmtDate(s.date)}</td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{s.bagCount}</td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 500 }}>{parseFloat(s.lotKgUsed).toFixed(1)} kg</td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }}>{s.sharePct}%</td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent)' }}>
                            {parseFloat(s.allocatedOutputKg).toFixed(1)} kg
                          </td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", color: parseFloat(s.allocatedWasteKg) > 0 ? 'var(--red)' : 'var(--text3)' }}>
                            {parseFloat(s.allocatedWasteKg).toFixed(1)} kg
                          </td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }} title="Current on-hand stock from this batch — not a production figure">
                            {parseFloat(s.currentBatchStockKg).toFixed(1)} kg
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--surface2)' }}>
                        <td colSpan={2} style={{ padding: '10px 18px', fontWeight: 600, fontSize: 13 }}>Total (this lot only)</td>
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>
                          {lotFlowQ.data!.sessions.reduce((s, r) => s + parseFloat(r.lotKgUsed), 0).toFixed(1)} kg
                        </td>
                        <td />
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>
                          {lotFlowQ.data!.sessions.reduce((s, r) => s + parseFloat(r.allocatedOutputKg), 0).toFixed(1)} kg
                        </td>
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>
                          {lotFlowQ.data!.sessions.reduce((s, r) => s + parseFloat(r.allocatedWasteKg), 0).toFixed(1)} kg
                        </td>
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--text3)' }}>
                          {lotFlowQ.data!.sessions.reduce((s, r) => s + parseFloat(r.currentBatchStockKg), 0).toFixed(1)} kg
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-arrow-bar-right" /> Sales &amp; exits from this lot</div>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                    {lotExitsQ.data?.total ?? 0} record{(lotExitsQ.data?.total ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                {lotExitsQ.isLoading && <div className="empty">Loading…</div>}
                {!lotExitsQ.isLoading && (lotExitsQ.data?.data ?? []).length === 0 && (
                  <div className="empty">No exits recorded from this lot yet.</div>
                )}
                {!lotExitsQ.isLoading && (lotExitsQ.data?.data ?? []).length > 0 && (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Recipient / client</th>
                        <th>Bag type</th>
                        <th className="right">Qty / kg</th>
                        <th className="right">Amount</th>
                        <th>Logged by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(lotExitsQ.data?.data ?? []).map((e: any) => {
                        const isRaw = !!e.lotId
                        const qty = isRaw
                          ? `${parseFloat(e.kgQuantity ?? '0').toFixed(1)} kg`
                          : `${e.quantity}`
                        const typeLabel = ({
                          walk_in: 'Walk-in sale',
                          order: 'Order',
                          sample: 'Sample',
                          gift: 'Gift',
                          internal: 'Internal',
                          client_bags_fill: 'Fill client',
                        } as Record<string, string>)[e.exitType] ?? e.exitType
                        return (
                          <tr key={e.id}>
                            <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text2)' }}>
                              {fmtDate(e.date)}
                            </td>
                            <td>
                              <span className={`badge ${e.exitType === 'walk_in' ? 'badge-amber' : e.exitType === 'order' ? 'badge-blue' : 'badge-gray'}`}>
                                {typeLabel}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text2)' }}>{e.recipient ?? '—'}</td>
                            <td style={{ color: 'var(--text2)' }}>{isRaw ? <span className="badge badge-gray">By kg</span> : (e.bagType?.name ?? '—')}</td>
                            <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 500 }}>{qty}</td>
                            <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", color: e.amount ? 'var(--accent)' : 'var(--text3)' }}>
                              {e.amount ? `$${parseFloat(e.amount).toFixed(2)}` : '—'}
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--text3)' }}>{e.loggedBy?.name ?? '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--surface2)' }}>
                        <td colSpan={4} style={{ padding: '10px 18px', fontWeight: 600, fontSize: 13 }}>Total</td>
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>
                          {(() => {
                            // Unbounded server totals (lotFlowQ), not a reduce over the
                            // page-limited lotExitsQ list — a lot with more than 200
                            // exits would otherwise silently undercount here.
                            const flow = lotFlowQ.data
                            if (!flow) return '—'
                            const kg = parseFloat(flow.rawMaterialExitsKg) + parseFloat(flow.packedBagSalesKg)
                            return `${kg.toFixed(1)} kg`
                          })()}
                        </td>
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>
                          {(() => {
                            const total = parseFloat(lotFlowQ.data?.totalExitAmount ?? '0')
                            return total > 0 ? `$${total.toFixed(2)}` : '—'
                          })()}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast show">
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}

      {/* New adjustment modal */}
      {adjModalOpen && (() => {
        const activeLots = adjustmentLots.filter(l => l.status === 'active')
        const selectedAdjLot = activeLots.find(l => l.id === adjLotId)
        const qtyAfterNum = parseFloat(adjQtyAfter)
        const diff = selectedAdjLot && !isNaN(qtyAfterNum) ? qtyAfterNum - selectedAdjLot.remainKg : null
        return (
          <div className="modal-overlay open" onClick={() => setAdjModalOpen(false)}>
            <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
              <div className="modal-head">
                <span className="modal-title">New stock adjustment</span>
                <button className="panel-close" onClick={() => setAdjModalOpen(false)}><i className="ti ti-x" /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Lot</label>
                  <select
                    className="form-input"
                    value={adjLotId}
                    onChange={e => { setAdjLotId(e.target.value); setAdjQtyAfter('') }}
                  >
                    {activeLots.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.charcoalType} · Grade {l.grade} — {l.remainKg.toLocaleString()} kg remaining
                      </option>
                    ))}
                    {activeLots.length === 0 && <option value="">No active lots</option>}
                  </select>
                </div>
                {selectedAdjLot && (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 14 }}>
                    Current system qty: <strong>{selectedAdjLot.remainKg.toLocaleString()} kg</strong>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Actual quantity (kg)</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Enter the real counted quantity…"
                    value={adjQtyAfter}
                    onChange={e => setAdjQtyAfter(e.target.value)}
                    style={{ fontFamily: "'IBM Plex Mono',monospace" }}
                  />
                  {diff !== null && (
                    <div style={{ marginTop: 6, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", color: diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--accent)' : 'var(--text3)' }}>
                      Difference: {diff > 0 ? '+' : ''}{diff.toFixed(1)} kg {diff < 0 ? '(loss)' : diff > 0 ? '(gain)' : '(no change)'}
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Reason (required)</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="e.g. dust loss, moisture, scale calibration…"
                    value={adjReason}
                    onChange={e => setAdjReason(e.target.value)}
                  />
                </div>
                {adjError && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{adjError}</div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setAdjModalOpen(false)}>Cancel</button>
                <button
                  className="btn primary"
                  disabled={createAdj.isPending}
                  onClick={() => {
                    if (!adjLotId) { setAdjError('Select a lot'); return }
                    if (!adjQtyAfter || isNaN(parseFloat(adjQtyAfter))) { setAdjError('Enter actual quantity'); return }
                    if (!adjReason.trim()) { setAdjError('Reason is required'); return }
                    setAdjError('')
                    const lot = lots.find(l => l.id === adjLotId)
                    if (!lot) return
                    createAdj.mutate(
                      {
                        adjustmentType: 'lot',
                        lotId: adjLotId,
                        qtyBefore: lot.remainKg.toFixed(3),
                        qtyAfter: parseFloat(adjQtyAfter).toFixed(3),
                        reason: adjReason.trim(),
                        date: toDateOnlyString(new Date()),
                      },
                      {
                        onSuccess: (res: any) => {
                          setAdjModalOpen(false)
                          showToast(
                            res?.status === 'pending'
                              ? 'Adjustment submitted — awaiting owner approval, stock not yet changed'
                              : 'Adjustment logged — stock updated',
                          )
                        },
                        onError: (err: any) => setAdjError(err?.error ?? 'Failed to save'),
                      }
                    )
                  }}
                >
                  <i className="ti ti-check" style={{ fontSize: 13 }} />
                  {createAdj.isPending ? 'Saving…' : 'Save adjustment'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Edit adjustment modal */}
      {editAdj && (
        <div className="modal-overlay open" onClick={() => setEditAdj(null)}>
          <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">Edit adjustment</span>
              <button className="panel-close" onClick={() => setEditAdj(null)}><i className="ti ti-x" /></button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 14 }}>
                <strong>{editAdj.lot?.charcoalType ?? 'Lot'} · Grade {editAdj.lot?.grade ?? '—'}</strong>
                <div style={{ color: 'var(--text3)', marginTop: 2 }}>
                  Original: {parseFloat(editAdj.qtyBefore).toLocaleString()} kg → {parseFloat(editAdj.qtyAfter).toLocaleString()} kg
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">New actual quantity (kg)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={editAdjQty}
                  onChange={e => setEditAdjQty(e.target.value)}
                  style={{ fontFamily: "'IBM Plex Mono',monospace" }}
                />
                {editAdjQty && !isNaN(parseFloat(editAdjQty)) && (() => {
                  const newDiff = parseFloat(editAdjQty) - parseFloat(editAdj.qtyBefore)
                  return (
                    <div style={{ marginTop: 6, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", color: newDiff < 0 ? 'var(--red)' : newDiff > 0 ? 'var(--accent)' : 'var(--text3)' }}>
                      Difference: {newDiff > 0 ? '+' : ''}{newDiff.toFixed(1)} kg
                    </div>
                  )
                })()}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Reason</label>
                <input
                  className="form-input"
                  type="text"
                  value={editAdjReason}
                  onChange={e => setEditAdjReason(e.target.value)}
                  placeholder="Reason for adjustment…"
                />
              </div>
              {editAdjError && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{editAdjError}</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditAdj(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={updateAdj.isPending}
                onClick={() => {
                  if (!editAdjQty || isNaN(parseFloat(editAdjQty))) { setEditAdjError('Enter a valid quantity'); return }
                  if (!editAdjReason.trim()) { setEditAdjError('Reason is required'); return }
                  setEditAdjError('')
                  updateAdj.mutate(
                    { id: editAdj.id, body: { qtyAfter: parseFloat(editAdjQty).toFixed(3), reason: editAdjReason.trim() } },
                    {
                      onSuccess: () => { setEditAdj(null); showToast('Adjustment updated') },
                      onError: (err: any) => setEditAdjError(err?.error ?? 'Failed to update'),
                    }
                  )
                }}
              >
                <i className="ti ti-check" style={{ fontSize: 13 }} />
                {updateAdj.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
