import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import {
  useContainer,
  useAddExpense,
  useUpdateExpense,
  useDeleteExpense,
  useUpsertDiscount,
  useUpdateContainer,
  useDeleteContainer,
  useAddProductLine,
  useUpdateProductLine,
  useDeleteProductLine,
  useContainerTracking,
  useRefreshTracking,
  useCarriers,
  useFinalizeContainer,
} from '../hooks/useContainers'
import { useSuppliers } from '../hooks/useSuppliers'
import type { ContainerStatus, ContainerProductLine } from '../types/api'
import { formatUsd } from '../lib/money'
import { formatDate, formatDateTime } from '../lib/date'

type CtrStepKey = 'created' | 'port' | 'transit' | 'arrived'

const STATUS_STEPS: { key: CtrStepKey; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'port', label: 'At port' },
  { key: 'transit', label: 'In transit' },
  { key: 'arrived', label: 'Arrived' },
]

const GRADES = ['A', 'B', 'C']

// Statuses selectable from the "Edit container" modal — only reachable while the
// container hasn't arrived yet. Selecting "Arrived" here goes through the same
// backend transition as "Mark arrived" (creates the warehouse stock lots); once a
// container has arrived, status is locked — the API has no logic to unwind stock
// lots, so reverting away from "arrived" is not offered anywhere in the UI.
const EDITABLE_STATUSES: { key: ContainerStatus; label: string }[] = [
  { key: 'port', label: 'At port' },
  { key: 'transit', label: 'In transit' },
  { key: 'arrived', label: 'Arrived' },
]

interface LineForm {
  charcoalType: string
  grade: string
  supplierId: string
  paidBags: number
  giftBags: number
  kgPerBag: number
  pricePerTon: number
}

const EMPTY_LINE_FORM: LineForm = {
  charcoalType: '',
  grade: 'A',
  supplierId: '',
  paidBags: 0,
  giftBags: 0,
  kgPerBag: 10,
  pricePerTon: 0,
}

const STATUS_BADGE: Record<ContainerStatus, { label: string; cls: string }> = {
  port: { label: 'At port', cls: 'badge-amber' },
  transit: { label: 'In transit', cls: 'badge-blue' },
  arrived: { label: 'Arrived', cls: 'badge-green' },
}


export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const rawId = id ? decodeURIComponent(id) : ''

  // Live container detail + mutations.
  const containerQ = useContainer(rawId)
  const addExpenseM = useAddExpense()
  const updateExpenseM = useUpdateExpense()
  const deleteExpenseM = useDeleteExpense()
  const upsertDiscountM = useUpsertDiscount()
  const updateContainerM = useUpdateContainer()
  const deleteContainerM = useDeleteContainer()
  const addProductLineM = useAddProductLine()
  const updateProductLineM = useUpdateProductLine()
  const deleteProductLineM = useDeleteProductLine()
  const finalizeContainerM = useFinalizeContainer()
  const suppliersQ = useSuppliers({ limit: 100 })
  const suppliers = suppliersQ.data?.data ?? []
  const ctr = containerQ.data
  // Finalization: locks financial/identity info. Independent of `status` —
  // a finalized container's status is always 'arrived', but finalization
  // never changes status itself. See backend ContainersService.finalize().
  const isFinalized = Boolean(ctr?.finalizedAt)

  // Shipment tracking (Traqo) — independent of container status/cost.
  const trackingQ = useContainerTracking(rawId)
  const refreshTrackingM = useRefreshTracking()
  const [trackingError, setTrackingError] = useState('')
  const tracking = trackingQ.data
  const timelineRef = useRef<HTMLDivElement>(null)
  function scrollToTimeline() {
    timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [discount, setDiscount] = useState(0)
  const [showArrival, setShowArrival] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showFinalize, setShowFinalize] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')
  const [showFinalizedNotice, setShowFinalizedNotice] = useState(false)
  const [newExpDesc, setNewExpDesc] = useState('')
  const [newExpAmount, setNewExpAmount] = useState('')
  const [expError, setExpError] = useState('')

  // Edit-container modal
  const [showEditContainer, setShowEditContainer] = useState(false)
  const [editNumber, setEditNumber] = useState('')
  const [editSupplierId, setEditSupplierId] = useState('')
  const [editStatus, setEditStatus] = useState<ContainerStatus>('port')
  const [editNotes, setEditNotes] = useState('')
  const [editContainerError, setEditContainerError] = useState('')
  const [editSealine, setEditSealine] = useState('')
  const [editSealineName, setEditSealineName] = useState('')
  const [carrierQuery, setCarrierQuery] = useState('')
  const [carrierDropdownOpen, setCarrierDropdownOpen] = useState(false)
  const carriersQ = useCarriers(carrierQuery, showEditContainer)
  const carrierOptions = carriersQ.data ?? []

  // Add/edit product-line modal (editingLineId null = add mode)
  const [showLineModal, setShowLineModal] = useState(false)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [lineForm, setLineForm] = useState<LineForm>(EMPTY_LINE_FORM)
  const [lineError, setLineError] = useState('')

  // Delete product-line confirm
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null)

  // Inline expense edit
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [editExpDesc, setEditExpDesc] = useState('')
  const [editExpAmount, setEditExpAmount] = useState('')
  const [editExpError, setEditExpError] = useState('')

  // Delete expense confirm
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null)

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

  // Stock received/remaining for the Finalize confirmation summary — real
  // values from the already-fetched StockLots, never fabricated.
  const stockLots = ctr?.stockLots ?? []
  const stockReceivedKg = stockLots.reduce((s, l) => s + parseFloat(l.kgReceived), 0)
  const stockRemainingKg = stockLots.reduce((s, l) => s + parseFloat(l.kgRemaining), 0)

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
  function openEditExpense(exp: { id: string; description: string; amount: string }) {
    setEditingExpenseId(exp.id)
    setEditExpDesc(exp.description)
    setEditExpAmount(exp.amount)
    setEditExpError('')
  }
  function cancelEditExpense() {
    setEditingExpenseId(null)
    setEditExpError('')
  }
  function saveExpenseEdit() {
    if (!ctr || !editingExpenseId) return
    if (!editExpDesc.trim()) { setEditExpError('Description is required'); return }
    if (!(parseFloat(editExpAmount) > 0)) { setEditExpError('Amount must be greater than 0'); return }
    setEditExpError('')
    updateExpenseM.mutate(
      {
        containerId: ctr.id,
        expenseId: editingExpenseId,
        body: { description: editExpDesc.trim(), amount: parseFloat(editExpAmount).toFixed(2) },
      },
      {
        onSuccess: () => setEditingExpenseId(null),
        onError: (err: any) => setEditExpError(err?.error ?? 'Failed to update expense'),
      },
    )
  }
  function confirmDeleteExpense() {
    if (!ctr || !deleteExpenseId) return
    deleteExpenseM.mutate(
      { containerId: ctr.id, expenseId: deleteExpenseId },
      { onSuccess: () => setDeleteExpenseId(null) },
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
  function confirmFinalize() {
    if (!ctr) return
    setFinalizeError('')
    finalizeContainerM.mutate(ctr.id, {
      onSuccess: () => { setShowFinalize(false); setShowFinalizedNotice(true) },
      onError: (err: any) => setFinalizeError(err?.error ?? 'Failed to finalize container'),
    })
  }

  function openEditContainer() {
    if (!ctr) return
    setEditNumber(ctr.number)
    setEditSupplierId(ctr.supplierId)
    setEditStatus(ctr.status === 'arrived' ? 'port' : ctr.status)
    setEditNotes(ctr.notes ?? '')
    setEditSealine(ctr.sealine ?? '')
    setEditSealineName(ctr.sealineName ?? '')
    setCarrierQuery('')
    setCarrierDropdownOpen(false)
    setEditContainerError('')
    setShowEditContainer(true)
  }
  function saveContainerEdit() {
    if (!ctr) return
    if (!isFinalized) {
      if (!editNumber.trim()) { setEditContainerError('Container number is required'); return }
      if (!editSupplierId) { setEditContainerError('Supplier is required'); return }
    }
    setEditContainerError('')
    updateContainerM.mutate(
      {
        id: ctr.id,
        body: {
          notes: editNotes.trim() || null,
          // Finalized containers: number/supplier/carrier/status are all
          // locked server-side (CONTAINER_FINALIZED) — omitted here so a
          // notes-only save on a finalized container never even attempts to
          // resend the (unchanged) identity fields and get rejected for it.
          ...(!isFinalized ? {
            number: editNumber.trim(),
            supplierId: editSupplierId,
            ...(ctr.status !== 'arrived' ? { status: editStatus } : {}),
            ...(editSealine ? { sealine: editSealine, sealineName: editSealineName } : {}),
          } : {}),
        },
      },
      {
        onSuccess: () => setShowEditContainer(false),
        onError: (err: any) => setEditContainerError(err?.error ?? 'Failed to update container'),
      },
    )
  }
  function selectCarrier(c: { scac: string; name: string }) {
    setEditSealine(c.scac)
    setEditSealineName(c.name)
    setCarrierQuery(`${c.name} (${c.scac})`)
    setCarrierDropdownOpen(false)
  }
  function submitRefreshTracking() {
    if (!ctr) return
    setTrackingError('')
    refreshTrackingM.mutate(ctr.id, {
      onError: (err: any) => setTrackingError(err?.error ?? 'Failed to refresh tracking'),
    })
  }

  function openAddLine() {
    if (!ctr) return
    setEditingLineId(null)
    setLineForm({ ...EMPTY_LINE_FORM, supplierId: ctr.supplierId })
    setLineError('')
    setShowLineModal(true)
  }
  function openEditLine(l: ContainerProductLine) {
    setEditingLineId(l.id)
    setLineForm({
      charcoalType: l.charcoalType,
      grade: l.grade,
      supplierId: l.supplierId,
      paidBags: l.paidBags,
      giftBags: l.giftBags,
      kgPerBag: parseFloat(l.kgPerBag),
      pricePerTon: parseFloat(l.pricePerTon),
    })
    setLineError('')
    setShowLineModal(true)
  }
  function saveLine() {
    if (!ctr) return
    if (!lineForm.charcoalType.trim()) { setLineError('Charcoal type is required'); return }
    if (!lineForm.supplierId) { setLineError('Supplier is required'); return }
    if (!(lineForm.paidBags > 0)) { setLineError('Paid bags must be greater than 0'); return }
    if (!(lineForm.kgPerBag > 0)) { setLineError('Kg/bag must be greater than 0'); return }
    if (!(lineForm.pricePerTon > 0)) { setLineError('$/ton must be greater than 0'); return }
    setLineError('')
    const body = {
      charcoalType: lineForm.charcoalType.trim(),
      grade: lineForm.grade,
      supplierId: lineForm.supplierId,
      paidBags: lineForm.paidBags,
      giftBags: lineForm.giftBags,
      kgPerBag: lineForm.kgPerBag.toFixed(2),
      pricePerTon: lineForm.pricePerTon.toFixed(2),
    }
    if (editingLineId) {
      updateProductLineM.mutate(
        { containerId: ctr.id, lineId: editingLineId, body },
        { onSuccess: () => setShowLineModal(false), onError: (err: any) => setLineError(err?.error ?? 'Failed to update product line') },
      )
    } else {
      addProductLineM.mutate(
        { id: ctr.id, body },
        { onSuccess: () => setShowLineModal(false), onError: (err: any) => setLineError(err?.error ?? 'Failed to add product line') },
      )
    }
  }
  function confirmDeleteLine() {
    if (!ctr || !deleteLineId) return
    deleteProductLineM.mutate(
      { containerId: ctr.id, lineId: deleteLineId },
      { onSuccess: () => setDeleteLineId(null) },
    )
  }

  if (containerQ.isLoading) {
    return (
      <>
        <Topbar title="Container" back={{ label: 'All containers', to: '/containers' }} />
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
        <Topbar title="Container" back={{ label: 'All containers', to: '/containers' }} />
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
      <Topbar title={ctr.number} back={{ label: 'All containers', to: '/containers' }}>
        <button className="btn" onClick={openEditContainer}>
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
        {ctr.status === 'arrived' && !isFinalized && (
          <button className="btn primary" onClick={() => setShowFinalize(true)}>
            <i className="ti ti-lock" style={{ fontSize: 15 }} /> Finalize Container
          </button>
        )}
      </Topbar>
      <div className="content">

        {/* Page header */}
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{ctr.number}</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-building-store" /> {ctr.supplier.name} · {ctr.supplier.country}</span>
              <span className="meta-row"><i className="ti ti-calendar" /> created {formatDate(ctr.createdAt)}</span>
              <span className="meta-row"><i className="ti ti-clock" /> ETA {formatDate(ctr.arrivalDate)}</span>
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

        {/* Finalized banner — clean, not alarming. Financial/identity fields are
            locked server-side regardless of this banner; this is purely informational. */}
        {isFinalized && ctr.finalizedAt && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', marginBottom: 14, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <i className="ti ti-lock" style={{ fontSize: 16, color: 'var(--text2)' }} />
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Finalized — Financial information locked</span>
              <span style={{ color: 'var(--text3)', fontSize: 12.5, marginLeft: 8 }}>
                Finalized on {formatDate(ctr.finalizedAt)}{ctr.finalizedBy ? ` by ${ctr.finalizedBy.name}` : ''}
              </span>
            </div>
          </div>
        )}

        {/* Shipment tracking — compact summary, near the top so it's visible without
            scrolling. Reuses the same trackingQ/refreshTrackingM state as the detailed
            timeline card lower on the page; never a second data source. */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <div className="card-title"><i className="ti ti-map-pin" /> Shipment tracking</div>
            {ctr.sealine && (
              <button className="card-action" onClick={submitRefreshTracking} disabled={refreshTrackingM.isPending}>
                <i className="ti ti-refresh" style={{ fontSize: 13 }} />{' '}
                {refreshTrackingM.isPending ? 'Updating tracking…' : 'Refresh tracking'}
              </button>
            )}
          </div>

          {!ctr.sealine && isFinalized && (
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Carrier not set</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 3 }}>
                This container is finalized — carrier configuration is locked and can no longer be set.
              </div>
            </div>
          )}

          {!ctr.sealine && !isFinalized && (
            <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Carrier not set</div>
                <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 3 }}>
                  Select a carrier to enable live shipment tracking for this container.
                </div>
              </div>
              <button className="btn primary" onClick={openEditContainer}>
                <i className="ti ti-ship" style={{ fontSize: 14 }} /> Set carrier
              </button>
            </div>
          )}

          {ctr.sealine && trackingQ.isLoading && (
            <div style={{ padding: '14px 18px' }}>
              <div className="skeleton" style={{ width: '60%', height: 16, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '40%', height: 16 }} />
            </div>
          )}

          {ctr.sealine && !trackingQ.isLoading && !tracking && (
            <div className="empty">
              Not tracked yet. Click "Refresh tracking" to fetch the latest status from {ctr.sealineName ?? ctr.sealine}.
            </div>
          )}

          {ctr.sealine && tracking && (
            <>
              {tracking.lastError && (
                <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)', borderBottom: '1px solid var(--border)' }}>
                  Last refresh failed: {tracking.lastError} — showing the last known data below.
                </div>
              )}
              {/* Our arrival status and Traqo's own tracking lifecycle are
                  deliberately two separate states (see the multi-account
                  tracking architecture) — a container can be arrived on our
                  side while Traqo is still actively tracking the shipment,
                  or Traqo may have already confirmed it's done. This makes
                  that distinction explicit rather than reading as a bug. */}
              {ctr.status === 'arrived' && (
                tracking.isActive === false || tracking.closedAt !== null ? (
                  <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    <i className="ti ti-circle-check" style={{ fontSize: 13, marginRight: 4 }} />
                    Tracking ended — Traqo has released this shipment. The information below is the last known state.
                  </div>
                ) : (
                  <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    <i className="ti ti-info-circle" style={{ fontSize: 13, marginRight: 4 }} />
                    Container arrived — Traqo is still tracking this shipment.
                  </div>
                )
              )}
              <div
                style={{
                  padding: '14px 18px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '14px 18px',
                }}
              >
                {(tracking.sealineName ?? ctr.sealineName) && (
                  <div>
                    <div className="tracking-field-label">Carrier</div>
                    <div className="tracking-field-value">{tracking.sealineName ?? ctr.sealineName}</div>
                  </div>
                )}
                {tracking.status && (
                  <div>
                    <div className="tracking-field-label">Status</div>
                    <div style={{ marginTop: 2 }}><span className="badge badge-blue">{tracking.status}</span></div>
                  </div>
                )}
                {tracking.vessel && (
                  <div>
                    <div className="tracking-field-label">Vessel</div>
                    <div className="tracking-field-value">{tracking.vessel}</div>
                  </div>
                )}
                {tracking.voyage && (
                  <div>
                    <div className="tracking-field-label">Voyage</div>
                    <div className="tracking-field-value">{tracking.voyage}</div>
                  </div>
                )}
                {tracking.origin && (
                  <div>
                    <div className="tracking-field-label">Origin</div>
                    <div className="tracking-field-value">{tracking.origin}</div>
                  </div>
                )}
                {tracking.destination && (
                  <div>
                    <div className="tracking-field-label">Destination</div>
                    <div className="tracking-field-value">{tracking.destination}</div>
                  </div>
                )}
                {tracking.currentLocation && (
                  <div>
                    <div className="tracking-field-label">Latest location</div>
                    <div className="tracking-field-value">{tracking.currentLocation}</div>
                  </div>
                )}
                {tracking.eta && (
                  <div>
                    <div className="tracking-field-label">ETA</div>
                    <div className="tracking-field-value">{formatDate(tracking.eta)}</div>
                  </div>
                )}
                <div>
                  <div className="tracking-field-label">Last updated</div>
                  <div className="tracking-field-value" style={{ color: 'var(--text3)' }}>{formatDateTime(tracking.lastFetchedAt)}</div>
                </div>
              </div>

              {tracking.events.length > 0 && (
                <div style={{ padding: '0 18px 12px' }}>
                  <button
                    onClick={scrollToTimeline}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <i className="ti ti-list" style={{ fontSize: 13 }} /> View full timeline ({tracking.events.length} events) <i className="ti ti-chevron-down" style={{ fontSize: 12 }} />
                  </button>
                </div>
              )}
            </>
          )}

          {trackingError && (
            <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)', borderTop: '1px solid var(--border)' }}>
              {trackingError}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

          {/* LEFT COLUMN */}
          <div className="stack">

            {/* Product lines */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-package" /> Product lines</div>
                <button className="card-action" onClick={openAddLine} disabled={ctr.status === 'arrived'} title={ctr.status === 'arrived' ? 'Container has arrived — product lines are locked' : undefined}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add line
                </button>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Charcoal</th>
                      <th className="right">Paid bags</th>
                      <th className="right">Kg/bag</th>
                      <th className="right">$/ton</th>
                      <th className="right">Tonnage</th>
                      <th className="right">All-in $/kg</th>
                      {ctr.status !== 'arrived' && <th className="right">Actions</th>}
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
                          {ctr.status !== 'arrived' && (
                            <td className="right">
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button className="icon-btn" title="Edit line" onClick={() => openEditLine(l)}>
                                  <i className="ti ti-edit" style={{ fontSize: 14 }} />
                                </button>
                                <button className="icon-btn" title="Delete line" onClick={() => setDeleteLineId(l.id)}>
                                  <i className="ti ti-trash" style={{ fontSize: 14 }} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                    {productLines.length === 0 && (
                      <tr><td colSpan={ctr.status !== 'arrived' ? 7 : 6} className="empty">No product lines.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
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
              <div className="exp-row" style={{ gridTemplateColumns: '1fr 110px 64px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '7px 18px' }}>
                <span>Description</span>
                <span style={{ textAlign: 'right', paddingRight: 8 }}>Amount (USD)</span>
                <span />
              </div>
              {expenses.map(exp => (
                editingExpenseId === exp.id ? (
                  <div className="exp-row" style={{ gridTemplateColumns: '1fr 110px 64px', background: 'var(--surface2)' }} key={exp.id}>
                    <input
                      className="input"
                      value={editExpDesc}
                      onChange={e => { setEditExpDesc(e.target.value); setEditExpError('') }}
                      onKeyDown={e => e.key === 'Enter' && saveExpenseEdit()}
                      style={{ fontSize: 13 }}
                    />
                    <input
                      className="input num"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editExpAmount}
                      onChange={e => { setEditExpAmount(e.target.value); setEditExpError('') }}
                      onKeyDown={e => e.key === 'Enter' && saveExpenseEdit()}
                      style={{ fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="icon-btn" title="Save" onClick={saveExpenseEdit} disabled={updateExpenseM.isPending}>
                        <i className="ti ti-check" style={{ fontSize: 13 }} />
                      </button>
                      <button className="icon-btn" title="Cancel" onClick={cancelEditExpense}>
                        <i className="ti ti-x" style={{ fontSize: 13 }} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="exp-row" style={{ gridTemplateColumns: '1fr 110px 64px' }} key={exp.id}>
                    <span style={{ padding: '6px 8px', fontSize: 13 }}>{exp.description}</span>
                    <span className="num" style={{ padding: '6px 8px', fontSize: 13 }}>{formatUsd(parseFloat(exp.amount))}</span>
                    {!isFinalized && (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="icon-btn" title="Edit expense" onClick={() => openEditExpense(exp)}>
                          <i className="ti ti-edit" style={{ fontSize: 13 }} />
                        </button>
                        <button className="icon-btn" title="Delete expense" onClick={() => setDeleteExpenseId(exp.id)}>
                          <i className="ti ti-trash" style={{ fontSize: 13 }} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              ))}
              {editExpError && (
                <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)', borderTop: '1px solid var(--border)' }}>
                  {editExpError}
                </div>
              )}
              {expenses.length === 0 && <div className="empty">No expenses logged.</div>}
              {!isFinalized && (
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
              )}
              {expError && (
                <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)', borderTop: '1px solid var(--border)' }}>
                  {expError}
                </div>
              )}
              <div style={{ padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {isFinalized ? 'Locked — finalized containers cannot have expenses added or changed' : 'Fill in description and amount, then press + or Enter'}
                </span>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600 }}>
                  Total: <span style={{ color: 'var(--red)' }}>{formatUsd(totalExp)}</span>
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
                  <input className="input num" type="number" value={effectiveDiscount} disabled={isFinalized} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
                </div>
                {isFinalized ? (
                  <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
                    Locked — finalized containers cannot have their discount changed
                  </p>
                ) : (
                  <>
                    <button className="btn" style={{ marginTop: 8, fontSize: 12.5 }} onClick={saveDiscount} disabled={upsertDiscountM.isPending}>
                      <i className="ti ti-check" style={{ fontSize: 13 }} /> {upsertDiscountM.isPending ? 'Saving…' : 'Save discount'}
                    </button>
                    <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
                      applied to whole container, split across product lines proportionally by tonnage
                    </p>
                  </>
                )}
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
                <span className="cost-value">{formatUsd(productCost)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">+ Expenses ({expenses.length} items)</span>
                <span className="cost-value red">+ {formatUsd(totalExp)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">− Discount</span>
                <span className="cost-value green">− {formatUsd(effectiveDiscount)}</span>
              </div>
              <div className="cost-row total">
                <span className="cost-label">All-in cost</span>
                <span className="cost-value">{formatUsd(allIn)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Avg cost / ton</span>
                <span className="cost-value">{totalTons > 0 ? formatUsd(allIn / totalTons) : '$0.00'}</span>
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

        {/* Tracking timeline — detailed event history, lower on the page. The compact
            summary card near the top links here via "View full timeline". */}
        {ctr.sealine && tracking && tracking.events.length > 0 && (
          <div className="card" style={{ marginTop: 14 }} ref={timelineRef}>
            <div className="card-head">
              <div className="card-title"><i className="ti ti-route" /> Tracking timeline</div>
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{tracking.referenceNumber}</span>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tracking.events.map(ev => (
                <div key={ev.id} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 500 }}>{ev.description}</div>
                    <div style={{ color: 'var(--text3)', fontSize: 11.5 }}>
                      {[ev.location, ev.occurredAt ? formatDateTime(ev.occurredAt) : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit container modal */}
      {showEditContainer && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowEditContainer(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-edit" style={{ marginRight: 8 }} />Edit container</div>
                <div className="modal-sub">{ctr.number}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setShowEditContainer(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="field-label">Container number</label>
                <input
                  className="input"
                  style={{ fontFamily: "'IBM Plex Mono',monospace" }}
                  value={editNumber}
                  disabled={isFinalized}
                  onChange={e => setEditNumber(e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="field-label">Supplier</label>
                <select className="select" value={editSupplierId} disabled={isFinalized} onChange={e => setEditSupplierId(e.target.value)}>
                  {suppliers.length === 0 && <option value="">{suppliersQ.isLoading ? 'Loading…' : 'No suppliers'}</option>}
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} — {s.country}</option>)}
                </select>
              </div>
              {isFinalized ? (
                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="field-label">Status</label>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>
                    Finalized — locked. This container's status can no longer be changed.
                  </div>
                </div>
              ) : ctr.status === 'arrived' ? (
                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="field-label">Status</label>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>
                    Arrived — locked. Status changes after arrival aren't supported.
                  </div>
                </div>
              ) : (
                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="field-label">Status</label>
                  <select className="select" value={editStatus} onChange={e => setEditStatus(e.target.value as ContainerStatus)}>
                    {EDITABLE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  {editStatus === 'arrived' ? (
                    <p style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 6, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
                      saving will create {productLines.length} stock lot{productLines.length === 1 ? '' : 's'} in the warehouse and lock the container — this cannot be undone
                    </p>
                  ) : (
                    <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
                      once saved as "Arrived", status can no longer be changed
                    </p>
                  )}
                </div>
              )}
              <div className="field" style={{ marginBottom: 12, position: 'relative' }}>
                <label className="field-label">Carrier (for shipment tracking)</label>
                <input
                  className="input"
                  disabled={isFinalized}
                  value={carrierDropdownOpen ? carrierQuery : (editSealineName ? `${editSealineName} (${editSealine})` : '')}
                  onChange={e => { setCarrierQuery(e.target.value); setCarrierDropdownOpen(true); setEditSealine(''); setEditSealineName('') }}
                  onFocus={() => { if (!isFinalized) { setCarrierQuery(''); setCarrierDropdownOpen(true) } }}
                  onBlur={() => setTimeout(() => setCarrierDropdownOpen(false), 150)}
                  placeholder="Search carrier — e.g. Maersk, MSC…"
                />
                {!isFinalized && carrierDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                    {carriersQ.isLoading && <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text3)' }}>Loading carriers…</div>}
                    {!carriersQ.isLoading && carrierOptions.length === 0 && (
                      <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text3)' }}>No carriers found.</div>
                    )}
                    {carrierOptions.map(c => (
                      <div
                        key={c.scac}
                        onMouseDown={() => selectCarrier(c)}
                        style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {c.name} <span style={{ color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5 }}>{c.scac}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
                  {isFinalized
                    ? 'Locked — carrier can no longer be changed on a finalized container'
                    : editSealine ? `selected: ${editSealineName} (${editSealine})` : 'optional — required only to enable shipment tracking'}
                </p>
              </div>
              <div className="field">
                <label className="field-label">Notes</label>
                <textarea className="textarea" value={editNotes} onChange={e => setEditNotes(e.target.value)} />
              </div>
              {editContainerError && (
                <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{editContainerError}</div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowEditContainer(false)}>Cancel</button>
              <button className="btn primary" onClick={saveContainerEdit} disabled={updateContainerM.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {updateContainerM.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit product line modal */}
      {showLineModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowLineModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-package" style={{ marginRight: 8 }} />{editingLineId ? 'Edit product line' : 'Add product line'}</div>
                <div className="modal-sub">{ctr.number}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setShowLineModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="grid-2c">
                <div className="field">
                  <label className="field-label">Charcoal type</label>
                  <input
                    className="input"
                    value={lineForm.charcoalType}
                    onChange={e => setLineForm(f => ({ ...f, charcoalType: e.target.value }))}
                    placeholder="e.g. BBQ Hardwood"
                  />
                </div>
                <div className="field">
                  <label className="field-label">Grade</label>
                  <select className="select" value={lineForm.grade} onChange={e => setLineForm(f => ({ ...f, grade: e.target.value }))}>
                    {GRADES.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="field-label">Supplier</label>
                <select className="select" value={lineForm.supplierId} onChange={e => setLineForm(f => ({ ...f, supplierId: e.target.value }))}>
                  {suppliers.length === 0 && <option value="">{suppliersQ.isLoading ? 'Loading…' : 'No suppliers'}</option>}
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid-2c" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="field-label">Paid bags</label>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    value={lineForm.paidBags || ''}
                    onChange={e => setLineForm(f => ({ ...f, paidBags: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Gift bags</label>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    value={lineForm.giftBags || ''}
                    onChange={e => setLineForm(f => ({ ...f, giftBags: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="grid-2c" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="field-label">Kg / bag</label>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    step="0.1"
                    value={lineForm.kgPerBag || ''}
                    onChange={e => setLineForm(f => ({ ...f, kgPerBag: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="field">
                  <label className="field-label">$ / ton</label>
                  <input
                    className="input num"
                    type="number"
                    min="0"
                    value={lineForm.pricePerTon || ''}
                    onChange={e => setLineForm(f => ({ ...f, pricePerTon: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              {lineError && (
                <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{lineError}</div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowLineModal(false)}>Cancel</button>
              <button className="btn primary" onClick={saveLine} disabled={addProductLineM.isPending || updateProductLineM.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} />{' '}
                {addProductLineM.isPending || updateProductLineM.isPending ? 'Saving…' : editingLineId ? 'Save changes' : 'Add line'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete product line confirmation modal */}
      {deleteLineId && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setDeleteLineId(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-trash" style={{ marginRight: 8 }} />Delete product line</div>
                <div className="modal-sub">{ctr.number}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setDeleteLineId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                This will permanently remove this product line from the container. This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setDeleteLineId(null)}>Cancel</button>
              <button className="btn danger" onClick={confirmDeleteLine} disabled={deleteProductLineM.isPending}>
                <i className="ti ti-trash" style={{ fontSize: 14 }} /> {deleteProductLineM.isPending ? 'Deleting…' : 'Delete line'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete expense confirmation modal */}
      {deleteExpenseId && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setDeleteExpenseId(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-trash" style={{ marginRight: 8 }} />Delete expense</div>
                <div className="modal-sub">{ctr.number}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setDeleteExpenseId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                This will permanently remove this expense from the container and recalculate cost/kg. This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setDeleteExpenseId(null)}>Cancel</button>
              <button className="btn danger" onClick={confirmDeleteExpense} disabled={deleteExpenseM.isPending}>
                <i className="ti ti-trash" style={{ fontSize: 14 }} /> {deleteExpenseM.isPending ? 'Deleting…' : 'Delete expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDelete && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowDelete(false)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-trash" style={{ marginRight: 8 }} />Delete container</div>
                <div className="modal-sub">{ctr.number} · {ctr.supplier.name}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setShowDelete(false)}>✕</button>
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
              <button className="close-btn" aria-label="Close" onClick={() => setShowArrival(false)}>✕</button>
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

      {/* Finalize container modal — real values only, no fabricated fields */}
      {showFinalize && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowFinalize(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-lock" style={{ marginRight: 8 }} />Finalize container</div>
                <div className="modal-sub">{ctr.number} · {ctr.supplier.name}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setShowFinalize(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="cost-row">
                <span className="cost-label">Container</span>
                <span className="cost-value" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{ctr.number}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Supplier</span>
                <span className="cost-value">{ctr.supplier.name}</span>
              </div>
              {ctr.arrivalDate && (
                <div className="cost-row">
                  <span className="cost-label">Arrival</span>
                  <span className="cost-value">{formatDate(ctr.arrivalDate)}</span>
                </div>
              )}
              <div className="cost-row total">
                <span className="cost-label">Total weight</span>
                <span className="cost-value">{totalTons.toFixed(2)} t</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Product cost</span>
                <span className="cost-value">{formatUsd(productCost)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Expenses</span>
                <span className="cost-value red">+ {formatUsd(totalExp)}</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Discount</span>
                <span className="cost-value green">− {formatUsd(effectiveDiscount)}</span>
              </div>
              <div className="cost-row total">
                <span className="cost-label">Total cost</span>
                <span className="cost-value">{formatUsd(allIn)}</span>
              </div>
              <div className="cost-row" style={{ background: 'var(--accent-bg)' }}>
                <span className="cost-label" style={{ color: 'var(--accent)', fontWeight: 500 }}>Cost / kg</span>
                <span className="cost-value" style={{ color: 'var(--accent)', fontWeight: 600 }}>${avgKg.toFixed(2)}</span>
              </div>
              {stockLots.length > 0 && (
                <>
                  <div className="cost-row">
                    <span className="cost-label">Stock received</span>
                    <span className="cost-value">{stockReceivedKg.toLocaleString()} kg</span>
                  </div>
                  <div className="cost-row">
                    <span className="cost-label">Stock remaining</span>
                    <span className="cost-value">{stockRemainingKg.toLocaleString()} kg</span>
                  </div>
                </>
              )}
              <p style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.55, marginTop: 14 }}>
                Finalizing locks this container's financial information. Expenses, discounts, supplier, carrier, product information and cost can no longer be changed.
              </p>
              {finalizeError && (
                <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{finalizeError}</div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowFinalize(false)}>Cancel</button>
              <button className="btn primary" onClick={confirmFinalize} disabled={finalizeContainerM.isPending}>
                <i className="ti ti-lock" style={{ fontSize: 14 }} /> {finalizeContainerM.isPending ? 'Finalizing…' : 'Finalize Container'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finalized success notice */}
      {showFinalizedNotice && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowFinalizedNotice(false)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-circle-check" style={{ marginRight: 8, color: 'var(--accent)' }} />Container finalized</div>
                <div className="modal-sub">{ctr.number}</div>
              </div>
              <button className="close-btn" aria-label="Close" onClick={() => setShowFinalizedNotice(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>
                This container's financial information is now locked and it has moved to Container History.
              </p>
              {ctr.finalizedAt && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text3)' }}>
                  Finalized on {formatDate(ctr.finalizedAt)}{ctr.finalizedBy ? ` by ${ctr.finalizedBy.name}` : ''}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={() => setShowFinalizedNotice(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
