import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useContainer, useAddExpense, useUpsertDiscount, useUpdateContainer, useDeleteContainer } from '../hooks/useContainers'
import type { ContainerStatus } from '../types/api'

type CtrStepKey = 'created' | 'port' | 'transit' | 'arrived'

const STATUS_STEPS: { key: CtrStepKey; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'port', label: 'At port' },
  { key: 'transit', label: 'In transit' },
  { key: 'arrived', label: 'Arrived' },
]

const STATUS_BADGE: Record<ContainerStatus, { label: string; cls: string }> = {
  port: { label: 'At port', cls: 'badge-amber' },
  transit: { label: 'In transit', cls: 'badge-blue' },
  arrived: { label: 'Arrived', cls: 'badge-green' },
}

function money(n: number) {
  return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const rawId = id ? decodeURIComponent(id) : ''

  // Live container detail + mutations.
  const containerQ = useContainer(rawId)
  const addExpenseM = useAddExpense()
  const upsertDiscountM = useUpsertDiscount()
  const updateContainerM = useUpdateContainer()
  const deleteContainerM = useDeleteContainer()
  const ctr = containerQ.data

  const [discount, setDiscount] = useState(0)
  const [showArrival, setShowArrival] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [newExpDesc, setNewExpDesc] = useState('')
  const [newExpAmount, setNewExpAmount] = useState('')
  const [expError, setExpError] = useState('')

  // Derived totals from the API product lines (computed cost block when present).
  const productLines = ctr?.productLines ?? []
  const expenses = ctr?.expenses ?? []
  const apiDiscount = ctr?.discount ? parseFloat(ctr.discount.amount) : 0
  const effectiveDiscount = discount || apiDiscount

  const totalTons = productLines.reduce((s, l) => s + (l.paidBags * parseFloat(l.kgPerBag)) / 1000, 0)
  const productCost = productLines.reduce((s, l) => s + (l.paidBags * parseFloat(l.kgPerBag) * parseFloat(l.pricePerTon)) / 1000, 0)
  const totalExp = expenses.reduce((s, e) => s + parseFloat(e.amount), 0)
  const allIn = productCost + totalExp - effectiveDiscount
  const avgKg = totalTons > 0 ? allIn / (totalTons * 1000) : 0

  const statusIdx = ctr ? STATUS_STEPS.findIndex(s => s.key === ctr.status) : -1
  const badge = ctr ? STATUS_BADGE[ctr.status] : { label: '', cls: 'badge-gray' }

  function submitExpense() {
    if (!ctr) return
    if (!newExpDesc.trim()) { setExpError('Description is required'); return }
    if (!(parseFloat(newExpAmount) > 0)) { setExpError('Amount must be greater than 0'); return }
    setExpError('')
    addExpenseM.mutate(
      { id: ctr.id, body: { description: newExpDesc.trim(), amount: parseFloat(newExpAmount).toFixed(2) } },
      {
        onSuccess: () => { setNewExpDesc(''); setNewExpAmount('') },
        onError: (err: any) => setExpError(err?.error ?? 'Failed to add expense'),
      },
    )
  }
  function saveDiscount() {
    if (!ctr) return
    upsertDiscountM.mutate({ id: ctr.id, body: { amount: effectiveDiscount.toFixed(2) } })
  }
  function confirmArrival() {
    if (!ctr) return
    updateContainerM.mutate(
      { id: ctr.id, body: { status: 'arrived' } },
      { onSuccess: () => setShowArrival(false) },
    )
  }
  function confirmDelete() {
    if (!ctr) return
    deleteContainerM.mutate(ctr.id, {
      onSuccess: () => navigate('/containers'),
    })
  }

  if (containerQ.isLoading) {
    return (
      <>
        <Topbar title="Container" />
        <div className="content">
          <div className="skeleton" style={{ width: '40%', height: 28, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 240 }} />
        </div>
      </>
    )
  }
  if (containerQ.isError || !ctr) {
    return (
      <>
        <Topbar title="Container" />
        <div className="content">
          <div className="empty">
            Failed to load container.
            <div><button className="btn" style={{ marginTop: 10 }} onClick={() => containerQ.refetch()}>Retry</button></div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar title={ctr.number}>
        <button className="btn" onClick={() => {}}>
          <i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit
        </button>
        <button className="btn" onClick={() => {}}>
          <i className="ti ti-copy" style={{ fontSize: 15 }} /> Duplicate
        </button>
        {ctr.status !== 'arrived' && (
          <>
            <button className="btn primary" onClick={() => setShowArrival(true)}>
              <i className="ti ti-anchor" style={{ fontSize: 15 }} /> Mark arrived
            </button>
            <button className="btn danger" onClick={() => setShowDelete(true)}>
              <i className="ti ti-trash" style={{ fontSize: 15 }} /> Delete
            </button>
          </>
        )}
      </Topbar>
      <div className="content">

        {/* Page header */}
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button className="back-link" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => navigate('/containers')}>
                <i className="ti ti-chevron-left" /> All containers
              </button>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{ctr.number}</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-building-store" /> {ctr.supplier.name} · {ctr.supplier.country}</span>
              <span className="meta-row"><i className="ti ti-calendar" /> created {fmtDate(ctr.createdAt)}</span>
              <span className="meta-row"><i className="ti ti-clock" /> ETA {fmtDate(ctr.arrivalDate)}</span>
              <span className={`badge ${badge.cls}`}>{badge.label}</span>
            </div>
            <div className="status-track">
              {STATUS_STEPS.map((s, i) => {
                const cls = i < statusIdx ? 'done' : i === statusIdx ? 'current' : ''
                return (
                  <span key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
                    {i > 0 && <div className="status-arrow" />}
                    <div className={`status-step ${cls}`}>
                      <span className="dot" />{s.label}
                    </div>
                  </span>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minWidth: 300 }}>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Total weight</div>
              <div className="kpi-tile-value">{totalTons.toFixed(2)}<span style={{ fontSize: 14, color: 'var(--text3)', fontWeight: 400 }}>&nbsp;tons</span></div>
              <div className="kpi-tile-sub">{productLines.reduce((s, l) => s + l.paidBags, 0).toLocaleString()} paid bags</div>
            </div>
            <div className="kpi-tile green">
              <div className="kpi-tile-label">Avg cost / kg</div>
              <div className="kpi-tile-value">${avgKg.toFixed(2)}</div>
              <div className="kpi-tile-sub">all-in, with expenses</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

          {/* LEFT COLUMN */}
          <div className="stack">

            {/* Product lines */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-package" /> Product lines</div>
                <button className="card-action"><i className="ti ti-plus" style={{ fontSize: 13 }} /> Add line</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Charcoal</th>
                    <th className="right">Paid bags</th>
                    <th className="right">Kg/bag</th>
                    <th className="right">$/ton</th>
                    <th className="right">Tonnage</th>
                    <th className="right">All-in $/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {productLines.map((l) => {
                    const kgPerBag = parseFloat(l.kgPerBag)
                    const pricePerTon = parseFloat(l.pricePerTon)
                    const lineTons = (l.paidBags * kgPerBag) / 1000
                    const lineCost = (l.paidBags * kgPerBag * pricePerTon) / 1000
                    const lineTotalExp = totalTons > 0 ? (totalExp * (lineTons / totalTons)) : 0
                    const lineDisc = totalTons > 0 ? (effectiveDiscount * (lineTons / totalTons)) : 0
                    const lineAllIn = lineCost + lineTotalExp - lineDisc
                    // Prefer the server-computed cost/kg when present (cost-aware roles).
                    const lineKg = l.computed ? parseFloat(l.computed.allInCostPerKg) : (lineTons > 0 ? lineAllIn / (lineTons * 1000) : 0)
                    return (
                      <tr key={l.id}>
                        <td>
                          <div className="product-cell">
                            <span className="name">{l.charcoalType}</span>
                            <span className="meta">Grade {l.grade} · +{l.giftBags} gift bags</span>
                          </div>
                        </td>
                        <td className="right num">{l.paidBags.toLocaleString()}</td>
                        <td className="right num" style={{ color: 'var(--text3)' }}>{kgPerBag.toFixed(1)}</td>
                        <td className="right num">${pricePerTon.toFixed(0)}</td>
                        <td className="right num">{lineTons.toFixed(2)}</td>
                        <td className="right num" style={{ color: 'var(--accent)', fontWeight: 600 }}>${lineKg.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                  {productLines.length === 0 && (
                    <tr><td colSpan={6} className="empty">No product lines.</td></tr>
                  )}
                </tbody>
              </table>
              <div style={{ padding: '10px 18px', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', fontFamily: "'IBM Plex Mono',monospace" }}>
                <span>{productLines.length} product lines · {productLines.reduce((s, l) => s + l.paidBags, 0).toLocaleString()} bags · {totalTons.toFixed(2)} t paid weight</span>
                <span>kg/bag is reference only, not used in cost</span>
              </div>
            </div>

            {/* Expenses */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-receipt-tax" /> Expenses</div>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>split by tonnage</span>
              </div>
              <div className="exp-row" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '7px 18px' }}>
                <span>Description</span>
                <span style={{ textAlign: 'right', paddingRight: 8 }}>Amount (USD)</span>
                <span />
              </div>
              {expenses.map(exp => (
                <div className="exp-row" key={exp.id}>
                  <span style={{ padding: '6px 8px', fontSize: 13 }}>{exp.description}</span>
                  <span className="num" style={{ padding: '6px 8px', fontSize: 13 }}>{money(parseFloat(exp.amount))}</span>
                  <span />
                </div>
              ))}
              {expenses.length === 0 && <div className="empty">No expenses logged.</div>}
              <div className="exp-row" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <input
                  className="input"
                  value={newExpDesc}
                  onChange={e => { setNewExpDesc(e.target.value); setExpError('') }}
                  onKeyDown={e => e.key === 'Enter' && submitExpense()}
                  style={{ fontSize: 13 }}
                  placeholder="Expense description…"
                />
                <input
                  className="input num"
                  value={newExpAmount}
                  type="number"
                  min="0"
                  step="0.01"
                  onChange={e => { setNewExpAmount(e.target.value); setExpError('') }}
                  onKeyDown={e => e.key === 'Enter' && submitExpense()}
                  style={{ fontSize: 13 }}
                  placeholder="0.00"
                />
                <button
                  className="btn primary"
                  style={{ padding: '6px 8px', fontSize: 12 }}
                  onClick={submitExpense}
                  disabled={addExpenseM.isPending}
                  title="Add expense"
                >
                  <i className="ti ti-plus" style={{ fontSize: 14 }} />
                </button>
              </div>
              {expError && (
                <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)', borderTop: '1px solid var(--border)' }}>
                  {expError}
                </div>
              )}
              <div style={{ padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Fill in description and amount, then press + or Enter</span>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600 }}>
                  Total: <span style={{ color: 'var(--red)' }}>{money(totalExp)}</span>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div className="stack">

            {/* Discount */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-discount" /> Supplier discount</div>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <div className="input-prefix">
                  <span className="input-prefix-text">$</span>
                  <input className="input num" type="number" value={effectiveDiscount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
                </div>
                <button className="btn" style={{ marginTop: 8, fontSize: 12.5 }} onClick={saveDiscount} disabled={upsertDiscountM.isPending}>
                  <i className="ti ti-check" style={{ fontSize: 13 }} /> {upsertDiscountM.isPending ? 'Saving…' : 'Save discount'}
                </button>
                <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
                  applied to whole container, split across product lines proportionally by tonnage
                </p>
              </div>
            </div>

            {/* Cost summary */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-calculator" /> Cost summary</div>
                <span className="badge badge-gray">live</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Total weight</span>
                <span className="cost-value">{totalTons.toFixed(2)} t</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Product cost</span>
                <span className="cost-value">{money(productCost)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">+ Expenses ({expenses.length} items)</span>
                <span className="cost-value red">+ {money(totalExp)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">− Discount</span>
                <span className="cost-value green">− {money(effectiveDiscount)}</span>
              </div>
              <div className="cost-row total">
                <span className="cost-label">All-in cost</span>
                <span className="cost-value">{money(allIn)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Avg cost / ton</span>
                <span className="cost-value">{totalTons > 0 ? money(allIn / totalTons) : '$0.00'}</span>
              </div>
              <div className="cost-row" style={{ background: 'var(--accent-bg)' }}>
                <span className="cost-label" style={{ color: 'var(--accent)', fontWeight: 500 }}>Avg cost / kg</span>
                <span className="cost-value" style={{ color: 'var(--accent)', fontWeight: 600 }}>${avgKg.toFixed(2)}</span>
              </div>
            </div>

            {/* Arrival preview */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-anchor" /> On arrival — preview</div>
              </div>
              <div style={{ padding: '12px 18px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5, borderBottom: '1px solid var(--border)' }}>
                Marking this container as arrived will create <strong style={{ color: 'var(--text)' }}>{productLines.length} stock lots</strong> in the warehouse with the cost/kg shown below.
              </div>
              {productLines.map((l) => {
                const kgPerBag = parseFloat(l.kgPerBag)
                const pricePerTon = parseFloat(l.pricePerTon)
                const lineTons = (l.paidBags * kgPerBag) / 1000
                const lineCost = (l.paidBags * kgPerBag * pricePerTon) / 1000
                const lineTotalExp = totalTons > 0 ? (totalExp * (lineTons / totalTons)) : 0
                const lineDisc = totalTons > 0 ? (effectiveDiscount * (lineTons / totalTons)) : 0
                const lineAllIn = lineCost + lineTotalExp - lineDisc
                const lineKg = l.computed ? parseFloat(l.computed.allInCostPerKg) : (lineTons > 0 ? lineAllIn / (lineTons * 1000) : 0)
                return (
                  <div className="cost-row" key={l.id}>
                    <span className="cost-label">{l.charcoalType} · {l.grade}</span>
                    <span className="cost-value">{(lineTons * 1000).toFixed(0)} kg @ ${lineKg.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDelete && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowDelete(false)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-trash" style={{ marginRight: 8 }} />Delete container</div>
                <div className="modal-sub">{ctr.number} · {ctr.supplier.name}</div>
              </div>
              <button className="close-btn" onClick={() => setShowDelete(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                This will permanently delete this container and all its product lines. This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowDelete(false)}>Cancel</button>
              <button className="btn danger" onClick={confirmDelete} disabled={deleteContainerM.isPending}>
                <i className="ti ti-trash" style={{ fontSize: 14 }} /> {deleteContainerM.isPending ? 'Deleting…' : 'Delete container'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark arrived modal */}
      {showArrival && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowArrival(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-anchor" style={{ marginRight: 8 }} />Mark container as arrived</div>
                <div className="modal-sub">{ctr.number} · {ctr.supplier.name}</div>
              </div>
              <button className="close-btn" onClick={() => setShowArrival(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55, marginBottom: 14 }}>
                This will create <strong>{productLines.length} stock lots</strong> in the warehouse and lock the cost calculations.
              </p>
              <div style={{ background: 'var(--accent-bg)', border: '1px solid #a7f3d0', borderRadius: 'var(--radius)', padding: '11px 14px', fontSize: 12.5, color: 'var(--accent)' }}>
                <strong>Avg cost / kg will be locked at ${avgKg.toFixed(2)}</strong>
                <div style={{ color: 'var(--text3)', marginTop: 3, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>late expenses can still be added and will update cost/kg</div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>this action cannot be undone</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowArrival(false)}>Cancel</button>
                <button className="btn green" onClick={confirmArrival} disabled={updateContainerM.isPending}>
                  <i className="ti ti-check" style={{ fontSize: 15 }} /> {updateContainerM.isPending ? 'Saving…' : 'Confirm arrival'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
