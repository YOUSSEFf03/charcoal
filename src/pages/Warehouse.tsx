import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useStockLots, usePackedStockSummary, useWarehouseSummary, useStockAdjustments, useCreateStockAdjustment, useUpdateStockAdjustment, useDeleteStockAdjustment, useStockExits } from '../hooks/useWarehouse'
import { usePackingSessions } from '../hooks/usePacking'
import { useSuppliers } from '../hooks/useSuppliers'

type WTab = 'raw' | 'packed' | 'adj'

interface LotVM {
  id: string
  supplier: string
  arrival: string
  rawKg: number
  packedKg: number
  remainKg: number
  costPerKg: number
  status: string
  charcoalType: string
  grade: string
  source: string
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Warehouse() {
  const [tab, setTab] = useState<WTab>('raw')
  const [lotPanelOpen, setLotPanelOpen] = useState(false)
  const [selectedLot, setSelectedLot] = useState<LotVM | null>(null)
  const [countModalOpen, setCountModalOpen] = useState(false)
  const [countValues, setCountValues] = useState<Record<string, string>>({})
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'depleted'>('all')
  const [filterSearch, setFilterSearch] = useState('')
  const [adjModalOpen, setAdjModalOpen] = useState(false)
  const [adjLotId, setAdjLotId] = useState('')
  const [adjQtyAfter, setAdjQtyAfter] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjError, setAdjError] = useState('')
  const [toast, setToast] = useState('')

  const stockLotsQ = useStockLots({ limit: 100 })
  const packedQ = usePackedStockSummary()
  const sessionsQ = usePackingSessions({ limit: 100 })
  const summaryQ = useWarehouseSummary()
  const adjQ = useStockAdjustments({ limit: 100 })
  const lotExitsQ = useStockExits(selectedLot ? { lotId: selectedLot.id, limit: 200 } : undefined)
  const createAdj = useCreateStockAdjustment()
  const updateAdj = useUpdateStockAdjustment()
  const deleteAdj = useDeleteStockAdjustment()
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
      supplier: supplierNameById.get(l.supplierId) ?? l.supplierId,
      arrival: fmtDate(l.dateReceived),
      rawKg: received,
      packedKg: received - remaining,
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

  function getCountDiff(lotId: string, systemQty: number) {
    const val = parseFloat(countValues[lotId] || '')
    if (isNaN(val)) return null
    return val - systemQty
  }

  const packedCards = packedSummary.map(p => ({
    size: p.bagTypeName,
    bags: p.totalBags,
    totalKg: parseFloat(p.totalNominalKg),
    lots: 0,
  }))
  const totalPackedKg = packedCards.reduce((s, c) => s + c.totalKg, 0) || 1

  const adjustments = adjQ.data?.data ?? []

  const tabCounts = {
    raw: lots.filter(l => l.status === 'active').length,
    packed: packedCards.length,
    adj: adjQ.data?.total ?? 0,
  }

  return (
    <>
      <Topbar title="Warehouse">
        <button className="btn danger" onClick={() => setCountModalOpen(true)}>
          <i className="ti ti-clipboard-check" style={{ fontSize: 15 }} /> Physical count
        </button>
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
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text3)' }}>
                            {lot.id.slice(0, 8).toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{lot.charcoalType}</div>
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
                            {(s.sessionLots?.[0]?.lotId ?? s.workerId).slice(0, 8).toUpperCase()}
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
                    <strong>
                      {a.adjustmentType === 'lot'
                        ? `${a.lot?.charcoalType ?? 'Lot'} · Grade ${a.lot?.grade ?? '—'}`
                        : `Packed stock`}
                    </strong>
                    <div className="adj-meta">
                      {new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}Before: {parseFloat(a.qtyBefore).toLocaleString()} kg
                      {' · '}After: {parseFloat(a.qtyAfter).toLocaleString()} kg
                      {a.reason && ` · ${a.reason}`}
                    </div>
                  </div>
                  <div className="adj-diff" style={{ color: isLoss ? 'var(--red)' : 'var(--accent)', marginRight: 8 }}>
                    {diff > 0 ? '+' : ''}{diff.toFixed(0)} kg
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
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
                        if (confirm('Delete this adjustment? The stock quantity will be reversed.')) {
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
      {lotPanelOpen && selectedLot && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Topbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 56, borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn" onClick={() => setLotPanelOpen(false)}>
                <i className="ti ti-arrow-left" style={{ fontSize: 14 }} /> Back to warehouse
              </button>
              <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
              <div>
                <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', marginRight: 8 }}>
                  {selectedLot.id.slice(0, 8).toUpperCase()}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{selectedLot.charcoalType} · Grade {selectedLot.grade}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 8 }}>{selectedLot.supplier} · {selectedLot.arrival}</span>
              </div>
            </div>
            <span className={`badge ${selectedLot.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{selectedLot.status}</span>
          </div>

          {/* Body */}
          <div style={{ padding: '24px', flex: 1 }}>

            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Received', value: `${selectedLot.rawKg.toLocaleString()} kg`, color: '' },
                { label: 'Packed / sold', value: `${selectedLot.packedKg.toLocaleString()} kg`, color: 'var(--red)' },
                { label: 'Remaining', value: `${selectedLot.remainKg.toLocaleString()} kg`, color: 'var(--accent)' },
                { label: 'Cost / kg', value: `$${selectedLot.costPerKg.toFixed(3)}`, color: '' },
              ].map(k => (
                <div key={k.label} className="kpi-tile">
                  <div className="kpi-tile-label">{k.label}</div>
                  <div className="kpi-tile-value" style={k.color ? { color: k.color } : {}}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 24 }}>
              <div className="bar-track" style={{ height: 10 }}>
                <div className="bar-fill bar-high" style={{ width: `${selectedLot.rawKg > 0 ? (selectedLot.remainKg / selectedLot.rawKg) * 100 : 0}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }}>
                <span>0 kg</span>
                <span>{selectedLot.rawKg > 0 ? ((selectedLot.remainKg / selectedLot.rawKg) * 100).toFixed(1) : 0}% remaining · lot value ${Math.round(selectedLot.remainKg * selectedLot.costPerKg).toLocaleString()}</span>
                <span>{selectedLot.rawKg.toLocaleString()} kg</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>

              {/* Left: lot info + packing sessions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="card">
                  <div className="card-head"><div className="card-title">Lot details</div></div>
                  {[
                    ['Source', selectedLot.source === 'container' ? 'Container' : 'Direct'],
                    ['Date received', selectedLot.arrival],
                    ['Lot value (remaining)', `$${Math.round(selectedLot.remainKg * selectedLot.costPerKg).toLocaleString()}`],
                  ].map(([l, v]) => (
                    <div key={l} className="panel-row" style={{ padding: '7px 18px' }}>
                      <span className="panel-row-label">{l}</span>
                      <span className="panel-row-value">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="card">
                  <div className="card-head"><div className="card-title"><i className="ti ti-tools" /> Packing sessions</div></div>
                  {sessions.filter(s => s.sessionLots?.some(sl => sl.lotId === selectedLot.id)).map(s => {
                    const bagCount = s.bagsOutput.reduce((acc, b) => acc + b.qty, 0)
                    return (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 18px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--text2)' }}>{fmtDate(s.date)} · {bagCount} bags</span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{parseFloat(s.kgOutputTotal).toFixed(0)} kg</span>
                      </div>
                    )
                  })}
                  {sessions.filter(s => s.sessionLots?.some(sl => sl.lotId === selectedLot.id)).length === 0 && (
                    <div className="empty">No packing sessions.</div>
                  )}
                </div>
              </div>

              {/* Right: exits / orders / sales table */}
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
                            const data = lotExitsQ.data?.data ?? []
                            const kg = data.reduce((s: number, e: any) => {
                              if (e.lotId) return s + parseFloat(e.kgQuantity ?? '0')
                              return s + (e.bagType ? parseFloat(e.bagType.nominalKg) * (e.quantity ?? 0) : 0)
                            }, 0)
                            return `${kg.toFixed(1)} kg`
                          })()}
                        </td>
                        <td className="right" style={{ padding: '10px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>
                          {(() => {
                            const total = (lotExitsQ.data?.data ?? []).reduce((s: number, e: any) => s + (e.amount ? parseFloat(e.amount) : 0), 0)
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
      )}

      {/* Toast */}
      {toast && (
        <div className="toast show">
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}

      {/* New adjustment modal */}
      {adjModalOpen && (() => {
        const activeLots = lots.filter(l => l.status === 'active')
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
                        date: new Date().toISOString().slice(0, 10),
                      },
                      {
                        onSuccess: () => {
                          setAdjModalOpen(false)
                          showToast('Adjustment logged')
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

      {/* Physical count modal */}
      {countModalOpen && (
        <div className="modal-overlay open" onClick={() => setCountModalOpen(false)}>
          <div
            className="modal"
            style={{ width: 500, maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">Physical stock count</div>
                <div className="modal-sub">Enter counted quantities — differences will be flagged for approval</div>
              </div>
              <button className="panel-close" onClick={() => setCountModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Raw lots
              </div>
              {lots.filter(l => l.status === 'active').map(lot => {
                const diff = getCountDiff(lot.id, lot.remainKg)
                return (
                  <div key={lot.id} className="count-row">
                    <div className="count-name">
                      {lot.charcoalType} · Grade {lot.grade}
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{lot.id.slice(0, 8).toUpperCase()} · {lot.supplier}</div>
                    </div>
                    <div className="count-system">System: {lot.remainKg.toLocaleString()} kg</div>
                    <input
                      type="number"
                      className="count-input"
                      placeholder="0"
                      value={countValues[lot.id] || ''}
                      onChange={e => setCountValues(prev => ({ ...prev, [lot.id]: e.target.value }))}
                    />
                    <div
                      className="count-diff"
                      style={{
                        color: diff === null
                          ? 'var(--text3)'
                          : diff === 0
                          ? 'var(--accent)'
                          : diff < 0
                          ? 'var(--red)'
                          : 'var(--accent2)',
                      }}
                    >
                      {diff === null ? '—' : diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                    </div>
                  </div>
                )
              })}
              {lots.filter(l => l.status === 'active').length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>No active lots to count.</div>
              )}
              <div className="form-group" style={{ marginTop: 18 }}>
                <label className="form-label">Reason / notes (required if any difference found)</label>
                <input className="form-input" type="text" placeholder="e.g. dust loss, damaged bags, scale error…" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setCountModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => setCountModalOpen(false)}>Submit count</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
