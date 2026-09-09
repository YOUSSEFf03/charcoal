import { useState, useRef } from 'react'
import Topbar from '../components/layout/Topbar'
import { usePackingSessions, usePackingSession, useCreatePackingSession, useUpdatePackingSession } from '../hooks/usePacking'
import { useStockLots } from '../hooks/useWarehouse'
import { useBagTypes } from '../hooks/useBagTypes'
import { useWorkers } from '../hooks/useWorkers'
import type { PackingSession } from '../lib/types'
import { toDateOnlyString } from '../lib/date'

// ── constants ──────────────────────────────────────────────────────────────

const MAX_CHAR_ROWS = 4

// ── types ──────────────────────────────────────────────────────────────────

interface CharRow { id: string; lotIdx: number; kg: string }

interface Entry {
  id: string
  time: string
  bagTypeIdx: number
  bagQty: number
  /** Bag type label, but only when every bagsOutput line agrees — null means "mixed". */
  bagTypeUniformLabel: string | null
  charcoal: { lotId: string; label: string; kg: number }[]
  charIn: number
  bagOut: number
  waste: number
  workerName: string
  cogs: number
  bagCost: number
  workerCost: number
}

interface HistDay {
  date: string; dnum: string; dow: string; note: string
  counts: number[]
  empty?: boolean
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, digits = 0): string {
  if (Math.abs(n - Math.round(n)) < 0.05) return Math.round(n).toString()
  return n.toFixed(digits)
}

let rowCounter = 0
function newRow(): CharRow { return { id: String(rowCounter++), lotIdx: -1, kg: '' } }

/**
 * Finished-weight ÷ charcoal-consumed, as a percentage. Pure re-framing of the
 * existing kgOutputTotal/kgConsumed fields already on PackingSession — no new
 * accounting concept, same inputs the waste % has always used.
 */
export function computeYieldPct(kgOutputTotal: number, kgConsumed: number): number {
  if (kgConsumed <= 0) return 0
  return (kgOutputTotal / kgConsumed) * 100
}

/**
 * A session's bagsOutput can legitimately contain more than one bag type
 * (CreatePackingSessionDto.bagsOutput is an array). A compact summary chip
 * has room for only one label — this returns the single bag type's label
 * ONLY when every line in bagsOutput agrees, and null when the session
 * produced more than one bag type, so a caller can fall back to a "Mixed" /
 * "N bag types" badge instead of silently naming just the first one.
 * Mirrors the uniformBagType/uniformCharcoal guard already proven correct in
 * WarehouseSales.tsx's sales-log rows.
 */
export function uniformBagTypeLabel(
  bagsOutput: { bagTypeId: string }[],
  typeLabelById: Map<string, string>,
): string | null {
  if (bagsOutput.length === 0) return null
  const first = bagsOutput[0].bagTypeId
  if (!bagsOutput.every(b => b.bagTypeId === first)) return null
  return typeLabelById.get(first) ?? null
}

/**
 * Every charcoal lot a session consumed, as separate rows — never blended
 * into one label. Source: PackingSessionLot (junction table), one row per
 * DISTINCT lot, each carrying its own charcoalType/grade/kgUsed.
 */
export function mapSessionCharcoal(
  sessionLots: { lotId: string; kgUsed: string; lot?: { charcoalType: string; grade: string; costPerKg?: string | null } | null }[],
): { lotId: string; charcoalType: string; grade: string; kg: number; costPerKg: number }[] {
  return sessionLots.map(sl => ({
    lotId: sl.lotId,
    charcoalType: sl.lot?.charcoalType ?? sl.lotId.slice(0, 8) + '…',
    grade: sl.lot?.grade ?? '',
    kg: parseFloat(sl.kgUsed),
    costPerKg: parseFloat(sl.lot?.costPerKg ?? '0'),
  }))
}

/**
 * Charcoal cost (COGS), bag cost, and worker cost for one session — the
 * single definition used by both the compact "today"/"history" rows
 * (toEntry()) and the full detail panel, so the two views can never drift
 * apart on the same formula.
 *   - Charcoal cost = Σ(kgUsed × lot.costPerKg) across every DISTINCT lot the
 *     session consumed — correctly weighted per lot, never one blended rate.
 *   - Bag cost = Σ(qty × bagType.costPerBag) — packaging cost, not charcoal.
 *   - Worker cost = session.sessionEarnings — backend-snapshotted at session
 *     creation/edit time (packing-sessions.service.ts), never recomputed from
 *     a bag type's CURRENT workerRate, so a later rate change can never
 *     silently reprice a historical session's displayed cost.
 */
export function computeSessionCosts(
  sessionLots: { kgUsed: string; lot?: { costPerKg?: string | null } | null }[],
  bagsOutput: { bagTypeId: string; qty: number }[],
  bagTypeCostMap: Map<string, { costPerBag: number; workerRate: number }>,
  sessionEarnings: string | null | undefined,
): { charcoalCost: number; bagCost: number; workerCost: number; totalCost: number } {
  const charcoalCost = sessionLots.reduce(
    (total, sl) => total + parseFloat(sl.kgUsed) * parseFloat(sl.lot?.costPerKg ?? '0'),
    0,
  )
  const bagCost = bagsOutput.reduce((sum, b) => {
    const info = bagTypeCostMap.get(b.bagTypeId)
    return sum + b.qty * (info?.costPerBag ?? 0)
  }, 0)
  const workerCost = parseFloat(sessionEarnings ?? '0')
  return { charcoalCost, bagCost, workerCost, totalCost: charcoalCost + bagCost + workerCost }
}

// ── component ──────────────────────────────────────────────────────────────

export default function Packing() {
  // Live reference data + session list.
  const bagTypesQ = useBagTypes()
  const stockLotsQ = useStockLots({ hasStock: true, limit: 100 })
  const sessionsQ = usePackingSessions({ limit: 100 })
  const workersQ = useWorkers()
  const createSession = useCreatePackingSession()
  const WORKERS = workersQ.data ?? []

  // Bag-type dropdown options derived from the API bag types.
  const TYPES = (bagTypesQ.data ?? []).map(b => ({ id: b.id, kg: parseFloat(b.nominalKg), label: b.name, ref: b.nominalKg }))
  const typeLabelById = new Map(TYPES.map(t => [t.id, t.label]))
  // Charcoal-lot dropdown options derived from in-stock lots.
  const LOTS = (stockLotsQ.data?.data ?? []).map(l => ({
    id: l.id,
    displayId: l.displayId,
    label: `${l.charcoalType} · ${l.grade}`,
    supplier: l.supplier?.name ?? l.supplierId,
    available: parseFloat(l.kgRemaining),
  }))

  function sumKg(counts: number[]): number { return counts.reduce((s, n, i) => s + n * (TYPES[i]?.kg ?? 0), 0) }
  function sumBags(counts: number[]): number { return counts.reduce((s, n) => s + n, 0) }

  // Shared day-key derivation — used to both bucket sessions into `historyDays`
  // AND to later filter "which sessions belong to the day the user selected"
  // (dayEntries, below). Keeping this in one place is what guarantees a
  // session is never classified into the wrong day between the two views.
  function dayKeyOf(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }

  // Group sessions by calendar date for the history view.
  const historyDays: HistDay[] = (() => {
    const byDate = new Map<string, number[]>()
    for (const s of sessionsQ.data?.data ?? []) {
      const key = dayKeyOf(s.date)
      const counts = byDate.get(key) ?? TYPES.map(() => 0)
      for (const b of s.bagsOutput) {
        const idx = TYPES.findIndex(t => t.id === b.bagTypeId)
        if (idx >= 0) counts[idx] += b.qty
      }
      byDate.set(key, counts)
    }
    return Array.from(byDate.entries()).map(([date, counts]) => {
      const [dnum] = date.split(' ')
      return { date, dnum, dow: '', note: `${sumBags(counts)} bags`, counts }
    })
  })()

  // Today's entries derived from packing sessions (newest first).
  const bagTypeCostMap = new Map((bagTypesQ.data ?? []).map(b => [b.id, {
    costPerBag: parseFloat(b.costPerBag ?? '0'),
    workerRate: parseFloat(b.workerRate ?? '0'),
  }]))

  // Shared PackingSession -> Entry mapping — used for both "today" and the
  // selected history day's entries, so the two views can never drift apart.
  function toEntry(s: PackingSession): Entry {
    const bagQty = s.bagsOutput.reduce((acc, b) => acc + b.qty, 0)
    const firstBagTypeId = s.bagsOutput[0]?.bagTypeId
    const bagTypeIdx = TYPES.findIndex(t => t.id === firstBagTypeId)
    const charIn = parseFloat(s.kgConsumed)
    const bagOut = parseFloat(s.kgOutputTotal)

    const { charcoalCost, bagCost, workerCost } = computeSessionCosts(
      s.sessionLots ?? [], s.bagsOutput, bagTypeCostMap, s.sessionEarnings,
    )

    return {
      id: s.id,
      time: new Date(s.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      bagTypeIdx: bagTypeIdx >= 0 ? bagTypeIdx : 0,
      bagQty,
      // Not necessarily one uniform bag type — see uniformBagTypeLabel(), used
      // by the table/list rows to decide whether TYPES[bagTypeIdx] is safe to
      // show alone or must fall back to a "mixed" badge.
      bagTypeUniformLabel: uniformBagTypeLabel(s.bagsOutput, typeLabelById),
      charcoal: mapSessionCharcoal(s.sessionLots ?? []).map(c => ({
        lotId: c.lotId,
        label: `${c.charcoalType} · ${c.grade}`,
        kg: c.kg,
      })),
      charIn,
      bagOut,
      waste: parseFloat(s.varianceKg),
      workerName: s.workerEntity?.name ?? s.worker?.name ?? s.workerId.slice(0, 8),
      cogs: charcoalCost,
      bagCost,
      workerCost,
    }
  }

  const todayIso = toDateOnlyString(new Date())
  const entries: Entry[] = (sessionsQ.data?.data ?? []).filter(s => (s.date ?? '').slice(0, 10) === todayIso).map(toEntry)

  const updateSession = useUpdatePackingSession()

  const [view, setView]           = useState<'today' | 'history' | 'day'>('today')
  const [bagTypeIdx, setBagTypeIdx] = useState(-1)
  const [bagQty, setBagQty]       = useState('')
  const [charRows, setCharRows]   = useState<CharRow[]>([newRow()])
  const [selectedWorkerId, setSelectedWorkerId] = useState('')
  const [selDay, setSelDay]       = useState<HistDay | null>(null)
  const [toast, setToast]         = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout>>()

  // Sessions belonging to the selected history day — same dayKeyOf() bucketing
  // as historyDays, so a session can never land under the wrong day between
  // the two views. Reuses toEntry() so the row shape (and every computed
  // field: cogs, waste, worker name, …) is identical to "today"'s entries.
  const dayEntries: Entry[] = selDay
    ? (sessionsQ.data?.data ?? []).filter(s => dayKeyOf(s.date) === selDay.date).map(toEntry)
    : []

  // ── detail / edit panel state ────────────────────────────────────────────
  const [detailId, setDetailId]     = useState<string | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editBagTypeIdx, setEditBagTypeIdx] = useState(-1)
  const [editBagQty, setEditBagQty] = useState('')
  const [editCharRows, setEditCharRows] = useState<CharRow[]>([newRow()])
  const [editWorkerId, setEditWorkerId] = useState('')
  const [editNotes, setEditNotes]   = useState('')
  const [editVarianceNote, setEditVarianceNote] = useState('')

  // Fetched by ID (GET /packing-sessions/:id) rather than looked up in the
  // capped `sessionsQ` list (limit: 100) — a history entry can be outside
  // that window even though the day it belongs to is still reachable. Also
  // gives real loading/error state instead of an indefinite "Loading…".
  const detailSessionQ = usePackingSession(detailId ?? '')
  const detailSession = detailSessionQ.data ?? null

  // ── derived ──────────────────────────────────────────────────────────────

  const bagOutKg  = bagTypeIdx >= 0 && Number(bagQty) > 0 ? Number(bagQty) * TYPES[bagTypeIdx].kg : 0
  const charInKg  = charRows.reduce((s, r) => s + (r.lotIdx >= 0 && r.kg !== '' ? Number(r.kg) : 0), 0)
  const waste     = charInKg - bagOutKg
  const wastePct  = charInKg > 0 ? (waste / charInKg) * 100 : 0
  const wasteNeutral = charInKg === 0 && bagOutKg === 0
  const wasteBad  = !wasteNeutral && (waste < 0 || wastePct > 5)
  // Worker attribution is mandatory for every NEW session (backend now rejects a
  // missing/invalid workerEntityId outright — this mirrors that requirement on the
  // client so the user is stopped before the request, not after a raw API error).
  // Scoped to the CREATE form only — the separate edit-panel state (editWorkerId,
  // editCanSave, saveEdit()) is untouched, so legacy sessions with no worker
  // attributed remain fully editable without this constraint applying to them.
  const workerMissing = !selectedWorkerId
  const canAdd    = bagTypeIdx >= 0 && Number(bagQty) > 0 && charRows.some(r => r.lotIdx >= 0 && Number(r.kg) > 0) && !workerMissing

  // edit form derived values
  const editBagOutKg = editBagTypeIdx >= 0 && Number(editBagQty) > 0 ? Number(editBagQty) * TYPES[editBagTypeIdx].kg : 0
  const editCharInKg = editCharRows.reduce((s, r) => s + (r.lotIdx >= 0 && r.kg !== '' ? Number(r.kg) : 0), 0)
  const editWaste    = editCharInKg - editBagOutKg
  const editWastePct = editCharInKg > 0 ? (editWaste / editCharInKg) * 100 : 0
  const editWasteNeutral = editCharInKg === 0 && editBagOutKg === 0
  const editWasteBad = !editWasteNeutral && (editWaste < 0 || editWastePct > 5)
  const editCanSave  = editBagTypeIdx >= 0 && Number(editBagQty) > 0 && editCharRows.some(r => r.lotIdx >= 0 && Number(r.kg) > 0)

  // today's table aggregates
  const dayTotals = TYPES.map((_, i) => entries.reduce((s, e) => s + (e.bagTypeIdx === i ? e.bagQty : 0), 0))
  const dayBagsTotal = dayTotals.reduce((s, n) => s + n, 0)
  const dayKgOut     = entries.reduce((s, e) => s + e.bagOut, 0)
  const dayCharIn    = entries.reduce((s, e) => s + e.charIn, 0)
  const dayWaste     = dayCharIn - dayKgOut
  const dayWastePct  = dayCharIn > 0 ? (dayWaste / dayCharIn) * 100 : 0

  // ── handlers ─────────────────────────────────────────────────────────────

  function closeDetail() { setDetailId(null); setIsEditMode(false) }

  function openEditMode() {
    if (!detailSession) return
    const firstBag = detailSession.bagsOutput[0]
    if (firstBag) {
      const idx = TYPES.findIndex(t => t.id === firstBag.bagTypeId)
      setEditBagTypeIdx(idx >= 0 ? idx : -1)
      setEditBagQty(String(firstBag.qty))
    } else {
      setEditBagTypeIdx(-1); setEditBagQty('')
    }
    const sessionLots = detailSession.sessionLots ?? []
    const rows: CharRow[] = sessionLots.length > 0
      ? sessionLots.map(sl => {
          const lotIdx = LOTS.findIndex(l => l.id === sl.lotId)
          return { id: String(rowCounter++), lotIdx, kg: sl.kgUsed }
        })
      : [newRow()]
    setEditCharRows(rows.length > 0 ? rows : [newRow()])
    setEditWorkerId(detailSession.workerEntityId ?? '')
    setEditNotes(detailSession.notes ?? '')
    setEditVarianceNote(detailSession.varianceNote ?? '')
    setIsEditMode(true)
  }

  function updateEditCharRow(id: string, patch: Partial<CharRow>) {
    setEditCharRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function addEditCharRow() { if (editCharRows.length < MAX_CHAR_ROWS) setEditCharRows(prev => [...prev, newRow()]) }
  function removeEditCharRow(id: string) { if (editCharRows.length > 1) setEditCharRows(prev => prev.filter(r => r.id !== id)) }

  function saveEdit() {
    if (!editCanSave || !detailId) return
    // Resolve to REAL lotId; drop any row whose index no longer maps to a live lot.
    const validRows = editCharRows.filter(r => r.lotIdx >= 0 && Number(r.kg) > 0 && LOTS[r.lotIdx])
    if (validRows.length === 0) return
    const primaryLot = LOTS[validRows[0].lotIdx]
    const selectedBagType = TYPES[editBagTypeIdx]
    if (!selectedBagType || !primaryLot) return
    updateSession.mutate(
      {
        id: detailId,
        data: {
          lotInputs: validRows.map(r => ({ lotId: LOTS[r.lotIdx].id, kg: Number(r.kg).toFixed(3) })),
          bagsOutput: [{ bagTypeId: selectedBagType.id, qty: Number(editBagQty) }],
          // Always sent, even empty — packing-sessions.service.ts distinguishes
          // omitted (dto.field === undefined → keep existing) from an explicit ''
          // (→ clear the field). Omitting on empty meant a user clearing the
          // notes/variance-note box and saving silently left the old value in place.
          varianceNote: editVarianceNote,
          notes: editNotes,
          workerEntityId: editWorkerId,
        },
      },
      {
        onSuccess: () => {
          showToast('Entry updated')
          closeDetail()
        },
      },
    )
  }

  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 2400)
  }

  function clearCompose() {
    setBagTypeIdx(-1); setBagQty(''); setCharRows([newRow()]); setSelectedWorkerId('')
  }

  function addEntry() {
    // Belt-and-suspenders: the Add button is already disabled whenever canAdd is
    // false, so this normally can't fire via a real click — but keep an explicit,
    // user-visible reason here too rather than a silent no-op, in case it's ever
    // reached another way. The backend remains the final, authoritative check.
    if (workerMissing) { showToast('Please select a worker'); return }
    if (!canAdd) return
    // Resolve each row to its REAL lotId (LOTS[idx].id), not the transient array index.
    // Guard against a stale index (LOTS may have refetched/reordered since selection).
    const lotInputs = charRows
      .filter(r => r.lotIdx >= 0 && Number(r.kg) > 0 && LOTS[r.lotIdx])
      .map(r => ({ lotId: LOTS[r.lotIdx].id, kg: Number(r.kg).toFixed(3) }))
    if (lotInputs.length === 0) return
    const selectedBagType = TYPES[bagTypeIdx]
    if (!selectedBagType || Number(bagQty) <= 0) return
    createSession.mutate(
      {
        lotInputs,
        bagsOutput: [{ bagTypeId: selectedBagType.id, qty: Number(bagQty) }],
        date: toDateOnlyString(new Date()),
        // Always sent, never omitted/blank — canAdd (and the guard above) already
        // guarantee selectedWorkerId is non-empty by this point.
        workerEntityId: selectedWorkerId,
      },
      {
        onSuccess: () => {
          showToast(`Entry added · ${bagQty} × ${TYPES[bagTypeIdx]?.label ?? ''} · ${fmt(waste, 1)} kg waste`)
          clearCompose()
        },
        onError: (err: any) => showToast(err?.error ?? 'Failed to save. Try again.'),
      },
    )
  }

  function updateCharRow(id: string, patch: Partial<CharRow>) {
    setCharRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function addCharRow() { if (charRows.length < MAX_CHAR_ROWS) setCharRows(prev => [...prev, newRow()]) }
  function removeCharRow(id: string) { if (charRows.length > 1) setCharRows(prev => prev.filter(r => r.id !== id)) }

  const viewSub = view === 'today' ? "enter today's bags · by type"
                : view === 'history' ? 'past days · click any to drill in'
                : 'per-bag breakdown'

  // ── detail panel ─────────────────────────────────────────────────────────

  function renderDetailContent() {
    if (!detailSession) return null
    const s = detailSession
    const dateStr  = new Date(s.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const timeStr  = new Date(s.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const workerName = s.workerEntity?.name ?? s.worker?.name ?? s.workerId.slice(0, 8)
    const charIn   = parseFloat(s.kgConsumed)
    const bagOut   = parseFloat(s.kgOutputTotal)
    const variance = parseFloat(s.varianceKg)
    const vPct     = charIn > 0 ? (variance / charIn) * 100 : 0
    const vColor   = variance < 0 || vPct > 5 ? 'var(--red)' : 'var(--accent2)'
    const yieldPct = computeYieldPct(bagOut, charIn)
    const totalBags = s.bagsOutput.reduce((a, b) => a + b.qty, 0)

    const { charcoalCost, bagCost, workerCost, totalCost } = computeSessionCosts(
      s.sessionLots ?? [], s.bagsOutput, bagTypeCostMap, s.sessionEarnings,
    )

    // Every charcoal lot the session consumed, kept as separate rows — never
    // collapsed into one label, and never used to infer a grade for the
    // output below (bagsOutput has no per-lot breakdown; see mapSessionCharcoal
    // doc comment). Output and input are deliberately two independent lists.
    const charcoalUsed = mapSessionCharcoal(s.sessionLots ?? [])

    // A session legitimately has room for more than one bag type; only show
    // the "Output Details" section when it actually does, to avoid restating
    // the single bag type the headline already shows.
    const bagTypeUniform = uniformBagTypeLabel(s.bagsOutput, typeLabelById)
    const hasMultipleBagTypes = bagTypeUniform === null && s.bagsOutput.length > 0

    return (
      <>
        <div className="pd-head">
          <div>
            <div className="pd-head-title">Packing Entry · {timeStr}</div>
            <div className="pd-head-sub">{dateStr}</div>
          </div>
          <button className="close-btn" aria-label="Close" onClick={closeDetail}><i className="ti ti-x" /></button>
        </div>

        <div className="pd-body">

          {/* PRODUCTION SUMMARY — what a business owner needs in 5 seconds:
              how much came out, of what, packed by whom, when. */}
          <div className="pd-headline">
            <div className="pd-headline-main">
              <span className="pd-headline-qty">{totalBags.toLocaleString()}</span> bags
              <span className="pd-headline-sep">·</span>
              <span className="pd-headline-qty">{fmt(bagOut, 1)}</span> kg
            </div>
            <div className="pd-headline-sub">
              {bagTypeUniform ?? `${s.bagsOutput.length} bag types`}
            </div>
          </div>

          <div className="pd-section-label">Production summary</div>
          <div className="pd-row"><span className="pd-label">Worker</span><span className="pd-value">{workerName}</span></div>
          <div className="pd-row"><span className="pd-label">Date</span><span className="pd-value">{dateStr}</span></div>
          <div className="pd-row"><span className="pd-label">Time</span><span className="pd-value">{timeStr}</span></div>
          <div className="pd-row"><span className="pd-label">Mode</span><span className="pd-value" style={{ textTransform: 'capitalize' }}>{s.mode}</span></div>

          {/* CHARCOAL USED (input) — every lot/grade listed separately, on
              purpose: a session can draw from more than one lot, and the
              finished output below is never attributed to just one of them. */}
          <div className="pd-section-label">Charcoal used</div>
          {charcoalUsed.map((inp, i) => (
            <div key={i} className="pd-row">
              <div className="pd-label">
                <div style={{ fontWeight: 500, color: 'var(--text)' }}>{inp.charcoalType}</div>
                {inp.grade && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>Grade {inp.grade}</div>}
              </div>
              <span className="pd-value">{fmt(inp.kg, 1)} kg</span>
            </div>
          ))}
          <div className="pd-row"><span className="pd-label">Total material used</span><span className="pd-value">{fmt(charIn, 1)} kg</span></div>

          {/* PRODUCTION RESULT — reconciles input vs finished output vs loss,
              in one place, so nothing needs to be mentally cross-referenced. */}
          <div className="pd-section-label">Production result</div>
          <div className="pd-waste-bar pd-waste-bar-4">
            <div className="pd-wc">
              <div className="wl">Material used</div>
              <div className="wv">{fmt(charIn, 0)} kg</div>
              <div className="ws">{charcoalUsed.length} lot{charcoalUsed.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="pd-wc">
              <div className="wl">Finished product</div>
              <div className="wv" style={{ color: 'var(--accent)' }}>{fmt(bagOut, 1)} kg</div>
              <div className="ws">{totalBags} bags</div>
            </div>
            <div className="pd-wc">
              <div className="wl">Waste / loss</div>
              <div className="wv" style={{ color: vColor }}>{fmt(Math.abs(variance), 1)} kg</div>
              <div className="ws" style={{ color: vColor }}>{vPct.toFixed(1)}%</div>
            </div>
            <div className="pd-wc">
              <div className="wl">Yield</div>
              <div className="wv" style={{ color: vColor }}>{yieldPct.toFixed(1)}%</div>
              <div className="ws">of material in</div>
            </div>
          </div>
          {s.varianceNote && (
            <div className="pd-row"><span className="pd-label">Variance note</span><span style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'right' }}>{s.varianceNote}</span></div>
          )}

          {/* COST BREAKDOWN — plain business labels; COGS spelled out once. */}
          <div className="pd-section-label">Cost breakdown</div>
          <div className="pd-cost-grid">
            {[
              { label: 'Charcoal cost (COGS)', value: charcoalCost > 0 ? `$${charcoalCost.toFixed(2)}` : '—', color: charcoalCost > 0 ? 'var(--red)' : undefined },
              { label: 'Bag cost', value: bagCost > 0 ? `$${bagCost.toFixed(2)}` : '—', color: bagCost > 0 ? 'var(--accent2)' : undefined },
              { label: 'Worker cost', value: workerCost > 0 ? `$${workerCost.toFixed(2)}` : '—', color: workerCost > 0 ? 'var(--accent)' : undefined },
              { label: 'Total production cost', value: totalCost > 0 ? `$${totalCost.toFixed(2)}` : '—', color: undefined },
            ].map(c => (
              <div key={c.label} className="pd-cost-cell">
                <div className="cl">{c.label}</div>
                <div className="cv" style={{ color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* OUTPUT DETAILS — only when the session actually produced more
              than one bag type; the headline above already covers the common
              single-type case, so this avoids restating it. */}
          {hasMultipleBagTypes && (
            <>
              <div className="pd-section-label">Output details</div>
              {s.bagsOutput.map((b, i) => {
                const bt = TYPES.find(t => t.id === b.bagTypeId)
                return (
                  <div key={i} className="pd-row">
                    <span className="pd-label">{bt?.label ?? b.bagTypeId.slice(0, 8)}</span>
                    <span className="pd-value">{b.qty} bags · {bt ? fmt(b.qty * bt.kg, 1) : '?'} kg</span>
                  </div>
                )
              })}
            </>
          )}

          {s.notes && (
            <>
              <div className="pd-section-label">Notes</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, paddingBottom: 4 }}>{s.notes}</div>
            </>
          )}
        </div>

        <div className="pd-footer">
          <button className="btn" onClick={openEditMode}>
            <i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit entry
          </button>
          <button className="btn-clear" onClick={closeDetail}>Close</button>
        </div>
      </>
    )
  }

  function renderEditForm() {
    if (!detailSession) return null
    return (
      <>
        <div className="pd-head">
          <div>
            <div className="pd-head-title">Edit Packing Entry</div>
            <div className="pd-head-sub">changes will update stock, packed bags, and worker earnings</div>
          </div>
          <button className="close-btn" aria-label="Back" onClick={() => setIsEditMode(false)}><i className="ti ti-arrow-left" /></button>
        </div>

        <div className="pd-body">

          {/* Worker */}
          <div className="pd-section-label">Worker</div>
          <div className="pd-edit-field">
            <label className="pd-edit-label">Select worker</label>
            <select className="row-select" value={editWorkerId} onChange={e => setEditWorkerId(e.target.value)}>
              <option value="">— no worker —</option>
              {WORKERS.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {/* Bag produced */}
          <div className="pd-section-label">Bag Produced</div>
          <div className="pd-edit-row">
            <div className="pd-edit-field">
              <label className="pd-edit-label">Bag type</label>
              <select className="row-select" value={editBagTypeIdx} onChange={e => setEditBagTypeIdx(parseInt(e.target.value))}>
                <option value={-1} disabled>Select bag type…</option>
                {TYPES.map((t, i) => <option key={i} value={i}>{t.label} bag</option>)}
              </select>
            </div>
            <div className="pd-edit-field">
              <label className="pd-edit-label">Quantity</label>
              <div className="qty-shell">
                <input className="row-qty" type="number" min={0} placeholder="0" value={editBagQty} onChange={e => setEditBagQty(e.target.value)} />
                <span className="unit">bags</span>
              </div>
            </div>
          </div>
          {editBagTypeIdx >= 0 && Number(editBagQty) > 0 && (
            <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 4, marginBottom: 8 }}>
              → {fmt(editBagOutKg, 1)} kg bag output
            </div>
          )}

          {/* Charcoal used */}
          <div className="pd-section-label">Charcoal Used</div>
          <div className="compose-rows">
            {editCharRows.map((row, idx) => {
              const lot = row.lotIdx >= 0 ? LOTS[row.lotIdx] : null
              const stockAfter = lot && row.kg !== '' ? lot.available - Number(row.kg) : null
              return (
                <div key={row.id} className="compose-row" style={{ marginBottom: 6 }}>
                  <div className="row-index">{idx + 1}</div>
                  <div className="row-field">
                    <select className="row-select" value={row.lotIdx} onChange={e => updateEditCharRow(row.id, { lotIdx: parseInt(e.target.value) })}>
                      <option value={-1} disabled>Select charcoal lot…</option>
                      {LOTS.map((l, i) => <option key={l.id} value={i}>{l.label} · {l.supplier}</option>)}
                    </select>
                  </div>
                  <div className="row-field">
                    <div className="qty-shell">
                      <input className="row-qty" type="number" min={0} step={1} placeholder="0" value={row.kg} onChange={e => updateEditCharRow(row.id, { kg: e.target.value })} />
                      <span className="unit">kg</span>
                    </div>
                  </div>
                  <div className="row-field">
                    <div className={`row-out stock ${!lot ? 'stock-empty' : ''}`}>
                      <span className="o-lbl">{lot ? 'after' : 'pick lot'}</span>
                      <span className="o-val">{stockAfter !== null ? `${fmt(stockAfter, 0)} kg` : '—'}</span>
                    </div>
                  </div>
                  <button className="row-remove" title="Remove" disabled={editCharRows.length === 1} onClick={() => removeEditCharRow(row.id)}>
                    <i className="ti ti-x" style={{ fontSize: 15 }} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="compose-expand">
            <button className="btn-expand" disabled={editCharRows.length >= MAX_CHAR_ROWS} onClick={addEditCharRow}>
              <i className="ti ti-plus" style={{ fontSize: 15 }} /> Add another lot
              <span className="max-hint">{editCharRows.length} of {MAX_CHAR_ROWS}</span>
            </button>
          </div>

          {/* Waste summary */}
          {!editWasteNeutral && (
            <div className="waste-bar" style={{ marginTop: 12, marginBottom: 0 }}>
              <div className="waste-cell in">
                <span className="wlbl">Charcoal in</span>
                <span className="wval">{fmt(editCharInKg, 0)} kg</span>
              </div>
              <div className="waste-cell out">
                <span className="wlbl">Bag output</span>
                <span className="wval">{fmt(editBagOutKg, 1)} kg</span>
              </div>
              <div className={`waste-cell waste ${editWasteBad ? 'bad' : ''}`}>
                <span className="wlbl">Waste</span>
                <span className="wval">{editWaste < 0 ? '−' : ''}{fmt(Math.abs(editWaste), 1)} kg</span>
                {editCharInKg > 0 && <span className="wsub"><span className="waste-pct">{Math.abs(editWastePct).toFixed(1)}%</span></span>}
              </div>
            </div>
          )}

          {/* Variance note (shown when waste is negative) */}
          {editWaste < 0 && (
            <div className="pd-edit-field" style={{ marginTop: 12 }}>
              <label className="pd-edit-label">Variance note <span style={{ color: 'var(--red)' }}>*required</span></label>
              <input
                className="row-qty"
                style={{ width: '100%', padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}
                type="text"
                placeholder="Explain negative variance…"
                value={editVarianceNote}
                onChange={e => setEditVarianceNote(e.target.value)}
              />
            </div>
          )}

          {/* Notes */}
          <div className="pd-section-label">Notes</div>
          <div className="pd-edit-field">
            <textarea
              className="row-qty"
              style={{ width: '100%', padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 72, resize: 'vertical' }}
              placeholder="Optional notes…"
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
            />
          </div>

        </div>

        <div className="pd-footer">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-add" disabled={!editCanSave || updateSession.isPending} onClick={saveEdit}>
              <i className="ti ti-check" style={{ fontSize: 15 }} /> {updateSession.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button className="btn-clear" onClick={() => setIsEditMode(false)}>Cancel</button>
          </div>
          {updateSession.isError && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
              {/* api.ts's response interceptor normalizes every failed request to
                  { status, error, code, details } — there is no .response on the
                  rejected value, so this always fell through to the generic
                  message and the real reason (WORKER_NOT_FOUND, EDIT_BLOCKED,
                  negative-variance-requires-note, etc.) was never shown. */}
              {(updateSession.error as any)?.error ?? 'Failed to save. Try again.'}
            </div>
          )}
        </div>
      </>
    )
  }

  // ── today view ────────────────────────────────────────────────────────────

  function renderToday() {
    return (
      <>
        <div className="compose">
          <div className="compose-head">
            <h2>
              <i className="ti ti-package" style={{ fontSize: 18 }} />
              Add packing entry
              <small>pick the bag · list the charcoal lots used · we'll compute the waste</small>
            </h2>
            <span className="pack-stamp">Thu 22 May · 14:42</span>
          </div>

          {/* Worker selector */}
          <div className="compose-section">
            <div className="section-head">
              <span className="stitle"><span className="step-num" style={{ background: 'var(--accent)' }}>W</span> Worker</span>
              <span className="ssub">who packed the bags</span>
            </div>
            <div className="compose-row">
              <div className="row-index">W</div>
              <div className="row-field" style={{ flex: 2 }}>
                <span className="row-lbl">Select worker</span>
                <select
                  className="row-select"
                  value={selectedWorkerId}
                  onChange={e => setSelectedWorkerId(e.target.value)}
                >
                  <option value="">— select worker —</option>
                  {WORKERS.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {workerMissing && (
                  <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--red)' }}>
                    Please select a worker.
                  </span>
                )}
              </div>
              <div />
            </div>
          </div>

          {/* Step 1 — Bag produced */}
          <div className="compose-section">
            <div className="section-head">
              <span className="stitle"><span className="step-num">1</span> Bag produced</span>
              <span className="ssub">what came out of packing</span>
            </div>
            <div className="compose-row">
              <div className="row-index">B</div>
              <div className="row-field">
                <span className="row-lbl">Bag type</span>
                <select className="row-select" value={bagTypeIdx} onChange={e => setBagTypeIdx(parseInt(e.target.value))}>
                  <option value={-1} disabled>Select bag type…</option>
                  {TYPES.map((t, i) => <option key={i} value={i}>{t.label} bag</option>)}
                </select>
              </div>
              <div className="row-field">
                <span className="row-lbl">Quantity</span>
                <div className="qty-shell">
                  <input className="row-qty" type="number" min={0} placeholder="0" value={bagQty} onChange={e => setBagQty(e.target.value)} />
                  <span className="unit">bags</span>
                </div>
              </div>
              <div className="row-field">
                <span className="row-lbl">Bag output</span>
                <div className={`row-out ${bagOutKg === 0 ? 'zero' : ''}`}>
                  <span className="o-lbl">{bagTypeIdx >= 0 ? `${TYPES[bagTypeIdx].kg} kg × ${bagQty || 0}` : 'waiting'}</span>
                  <span className="o-val">{fmt(bagOutKg, 1)} kg</span>
                </div>
              </div>
              <div />
            </div>
          </div>

          {/* Step 2 — Charcoal used */}
          <div className="compose-section">
            <div className="section-head">
              <span className="stitle">
                <span className="step-num">2</span> Charcoal used
                <span style={{ fontWeight: 400, color: 'var(--text3)', textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>· deducted from warehouse</span>
              </span>
              <span className="ssub">one row per lot · enter weight in kg</span>
            </div>
            <div className="compose-rows">
              {charRows.map((row, idx) => {
                const lot = row.lotIdx >= 0 ? LOTS[row.lotIdx] : null
                const stockAfter = lot && row.kg !== '' ? lot.available - Number(row.kg) : null
                return (
                  <div key={row.id} className="compose-row">
                    <div className="row-index">{idx + 1}</div>
                    <div className="row-field">
                      {idx === 0 && <span className="row-lbl">Charcoal lot · grade</span>}
                      <select className="row-select" value={row.lotIdx} onChange={e => updateCharRow(row.id, { lotIdx: parseInt(e.target.value) })}>
                        <option value={-1} disabled>Select charcoal lot…</option>
                        {LOTS.map((l, i) => <option key={l.id} value={i}>{l.label} · {l.supplier}</option>)}
                      </select>
                    </div>
                    <div className="row-field">
                      {idx === 0 && <span className="row-lbl">Weight used</span>}
                      <div className="qty-shell">
                        <input className="row-qty" type="number" min={0} step={1} placeholder="0" value={row.kg} onChange={e => updateCharRow(row.id, { kg: e.target.value })} />
                        <span className="unit">kg</span>
                      </div>
                    </div>
                    <div className="row-field">
                      {idx === 0 && <span className="row-lbl">Stock left</span>}
                      <div className={`row-out stock ${!lot ? 'stock-empty' : ''}`}>
                        <span className="o-lbl">{lot ? 'after this entry' : 'pick a lot'}</span>
                        <span className="o-val">{stockAfter !== null ? `${fmt(stockAfter, 0)} kg` : '—'}</span>
                      </div>
                    </div>
                    <button className="row-remove" disabled={charRows.length === 1} onClick={() => removeCharRow(row.id)} title="Remove">
                      <i className="ti ti-x" style={{ fontSize: 15 }} />
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="compose-expand">
              <button className="btn-expand" disabled={charRows.length >= MAX_CHAR_ROWS} onClick={addCharRow}>
                <i className="ti ti-plus" style={{ fontSize: 15 }} />
                Add another charcoal type
                <span className="max-hint">{charRows.length} of {MAX_CHAR_ROWS}</span>
              </button>
            </div>
          </div>

          {/* Waste bar */}
          <div className="waste-bar">
            <div className="waste-cell in">
              <span className="wlbl"><i className="ti ti-arrow-down-right" style={{ fontSize: 13 }} /> Charcoal in</span>
              <span className="wval">{charInKg === 0 ? '0 kg' : `${fmt(charInKg, 0)} kg`}</span>
              <span className="wsub">{charRows.filter(r => r.lotIdx >= 0 && Number(r.kg) > 0).length > 0 ? `${charRows.filter(r => r.lotIdx >= 0 && Number(r.kg) > 0).length} lot(s)` : 'from warehouse'}</span>
            </div>
            <div className="waste-cell out">
              <span className="wlbl"><i className="ti ti-arrow-up-right" style={{ fontSize: 13 }} /> Bag output</span>
              <span className="wval">{fmt(bagOutKg, 1)} kg</span>
              <span className="wsub">{Number(bagQty) > 0 ? `${bagQty} bag${Number(bagQty) === 1 ? '' : 's'} packed` : '0 bags packed'}</span>
            </div>
            <div className={`waste-cell waste ${wasteNeutral ? 'neutral' : wasteBad ? 'bad' : ''}`}>
              <span className="wlbl"><i className="ti ti-trash" style={{ fontSize: 13 }} /> Waste / loss</span>
              <span className="wval">{wasteNeutral ? '— kg' : `${waste < 0 ? '−' : ''}${fmt(Math.abs(waste), 1)} kg`}</span>
              <span className="wsub">
                {!wasteNeutral && charInKg > 0 && (
                  <span className="waste-pct">{(waste >= 0 ? '' : '−') + Math.abs(wastePct).toFixed(1)}% loss</span>
                )}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="compose-foot">
            <div className="compose-summary">
              <div>
                entry total
                <span className="sv">{bagQty || 0} <small style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 400 }}>bags</small></span>
              </div>
              <div>
                weight out
                <span className="sv green">{fmt(bagOutKg, 1)} kg</span>
              </div>
            </div>
            <div className="compose-actions">
              <button className="btn-clear" onClick={clearCompose}>Clear</button>
              <button className="btn-add" disabled={!canAdd || createSession.isPending} onClick={addEntry}>
                <i className="ti ti-plus" style={{ fontSize: 16 }} /> {createSession.isPending ? 'Adding…' : 'Add entry'}
              </button>
            </div>
          </div>
        </div>

        {/* Today's table */}
        <div className="card">
          <div className="today-head">
            <h3>
              <i className="ti ti-list" style={{ fontSize: 16, color: 'var(--text2)' }} />
              Today's entries
              <span className="day">THURSDAY 22 MAY 2026</span>
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>newest first</span>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 74 }}>Time</th>
                  <th style={{ width: 160 }}>Bag produced</th>
                  <th>Charcoal used</th>
                  <th style={{ width: 110 }}>Worker</th>
                  <th className="right" style={{ width: 90 }}>In</th>
                  <th className="right" style={{ width: 90 }}>Out</th>
                  <th className="right" style={{ width: 100 }}>Waste</th>
                  <th className="right" style={{ width: 90 }}>COGS</th>
                  <th className="right" style={{ width: 80 }}>Bags $</th>
                  <th className="right" style={{ width: 80 }}>Worker $</th>
                  <th style={{ width: 46 }} />
                </tr>
              </thead>
              <tbody>
                {sessionsQ.isLoading ? (
                  <tr><td colSpan={11}><div className="skeleton" style={{ width: '100%', height: 40, margin: '8px 0' }} /></td></tr>
                ) : sessionsQ.isError ? (
                  <tr><td colSpan={11}><div className="empty">Failed to load packing sessions.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => sessionsQ.refetch()}>Retry</button></div></div></td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={11}>
                    <div className="pack-empty">
                      <i className="ti ti-package" />
                      <div className="t">No entries yet</div>
                      <div className="s">Add your first batch above</div>
                    </div>
                  </td></tr>
                ) : entries.map(e => {
                  const wpct = e.charIn > 0 ? (e.waste / e.charIn) * 100 : 0
                  const wcolor = e.waste < 0 || wpct > 5 ? 'var(--red)' : 'var(--accent2)'
                  return (
                    <tr key={e.id} className="entry-clickable" onClick={() => setDetailId(e.id)} title="Click to view details">
                      <td className="mono" style={{ color: 'var(--text2)' }}>{e.time}</td>
                      <td>
                        <span className="qty-chip" style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}>
                          <span className="q">{e.bagQty}</span>
                          <span className="t">
                            {e.bagTypeUniformLabel ? `× ${e.bagTypeUniformLabel}` : 'mixed bag types'}
                          </span>
                        </span>
                      </td>
                      <td>
                        {e.charcoal.length > 0 ? (
                          <div className="qty-chips">
                            {e.charcoal.map((c, i) => (
                              <span key={i} className="qty-chip">
                                <span className="q">{fmt(c.kg, 0)}</span>
                                <span className="t">kg · {c.label}</span>
                              </span>
                            ))}
                          </div>
                        ) : <span style={{ color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>— not recorded</span>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{e.workerName}</td>
                      <td className="right num" style={{ fontWeight: 500, color: 'var(--text2)' }}>{fmt(e.charIn, 0)} kg</td>
                      <td className="right num" style={{ color: 'var(--accent)', fontWeight: 500 }}>{fmt(e.bagOut, 1)} kg</td>
                      <td className="right num">
                        <span style={{ color: wcolor, fontWeight: 600 }}>{fmt(e.waste, 1)} kg</span>
                        {e.charIn > 0 && <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 400, marginTop: 1 }}>{wpct.toFixed(1)}%</div>}
                      </td>
                      <td className="right num" style={{ color: 'var(--red)', fontSize: 12 }}>
                        {e.cogs > 0 ? `$${e.cogs.toFixed(2)}` : <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td className="right num" style={{ color: 'var(--accent2)', fontSize: 12 }}>
                        {e.bagCost > 0 ? `$${e.bagCost.toFixed(2)}` : <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td className="right num" style={{ color: 'var(--accent)', fontSize: 12 }}>
                        {e.workerCost > 0 ? `$${e.workerCost.toFixed(2)}` : <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td className="right" />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer rollup */}
          {entries.length > 0 && (
            <div className="today-foot" style={{ gridTemplateColumns: `repeat(${TYPES.length}, minmax(0, 1fr)) auto` }}>
              {TYPES.map((t, i) => (
                <div key={t.label} className="fc">
                  <div className="flbl" title={t.label}>{t.label}</div>
                  <div className="fv">{dayTotals[i] || 0}</div>
                </div>
              ))}
              <div className="fc total" style={{ minWidth: 200, borderLeft: '1px solid var(--border)' }}>
                <div className="flbl">Day total</div>
                <div className="fv">{dayBagsTotal} bags <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>· {fmt(dayKgOut, 1)} kg</span></div>
                {dayCharIn > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>
                    {fmt(dayCharIn, 0)} kg in · <span style={{ color: 'var(--accent2)', fontWeight: 600 }}>{fmt(dayWaste, 1)} kg waste ({dayWastePct.toFixed(1)}%)</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cost summary card */}
        {entries.length > 0 && (() => {
          const totalCogs   = entries.reduce((s, e) => s + e.cogs, 0)
          const totalBagCost = entries.reduce((s, e) => s + e.bagCost, 0)
          const totalWorker = entries.reduce((s, e) => s + e.workerCost, 0)
          const totalCost   = totalCogs + totalBagCost + totalWorker
          const costPerKgOut = dayKgOut > 0 ? totalCost / dayKgOut : 0
          return (
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-head">
                <div className="card-title"><i className="ti ti-calculator" /> Cost breakdown — today</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr) 1px repeat(2,1fr)', background: 'var(--border)', gap: 1 }}>
                {[
                  { label: 'Cost of goods (COGS)', value: totalCogs > 0 ? `$${totalCogs.toFixed(2)}` : '—', sub: `charcoal at cost/kg`, color: 'var(--red)' },
                  { label: 'Bag cost',              value: totalBagCost > 0 ? `$${totalBagCost.toFixed(2)}` : '—', sub: 'packaging material',  color: 'var(--accent2)' },
                  { label: 'Worker cost',           value: totalWorker > 0 ? `$${totalWorker.toFixed(2)}` : '—', sub: 'per-bag earnings',      color: 'var(--accent)' },
                  { label: 'Total cost',            value: totalCost > 0 ? `$${totalCost.toFixed(2)}` : '—',    sub: 'COGS + bags + worker',  color: 'var(--text)' },
                  null,
                  { label: 'Cost / kg output',      value: costPerKgOut > 0 ? `$${costPerKgOut.toFixed(3)}` : '—', sub: `${fmt(dayKgOut, 1)} kg packed`,   color: undefined },
                  { label: 'Bags packed today',     value: String(dayBagsTotal),                             sub: `${TYPES.length} bag type${TYPES.length !== 1 ? 's' : ''}`, color: undefined },
                ].map((c, i) => {
                  if (!c) return <div key={i} style={{ background: 'var(--border)' }} />
                  return (
                    <div key={i} style={{ background: 'var(--surface)', padding: '14px 18px' }}>
                      <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{c.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5, color: c.color }}>{c.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{c.sub}</div>
                    </div>
                  )
                })}
              </div>
              {totalCogs === 0 && (
                <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--accent2)', background: 'var(--accent2-bg)', borderTop: '1px solid var(--border)' }}>
                  <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
                  COGS shows — when the lot has no cost/kg set. Set it in the Container detail page.
                </div>
              )}
            </div>
          )
        })()}

        <div className="view-history-row">
          <button className="btn-history" onClick={() => setView('history')}>
            <i className="ti ti-history" style={{ fontSize: 18 }} />
            View packing history
            <span className="hcount">{historyDays.length} days</span>
          </button>
        </div>
      </>
    )
  }

  // ── history view ──────────────────────────────────────────────────────────

  function renderDayRow(d: HistDay) {
    const bags = sumBags(d.counts)
    const kg   = sumKg(d.counts)
    if (d.empty) {
      return (
        <div key={d.date} className="day-row empty-day">
          <span className="dnum">{d.dnum}</span>
          <span className="dlabel">{d.dow} {d.date} <small>{d.note}</small></span>
          <span /><span /><span />
        </div>
      )
    }
    return (
      <div key={d.date} className="day-row" onClick={() => { setSelDay(d); setView('day') }}>
        <span className="dnum">{d.dnum}</span>
        <span className="dlabel">{d.dow} {d.date} <small>{d.note}</small></span>
        <span className="dqty">{bags} <small>bags</small></span>
        <span className="dkg">{fmt(kg, 1)} <small>kg</small></span>
        <i className="ti ti-chevron-right chev" style={{ fontSize: 18 }} />
      </div>
    )
  }

  function renderHistory() {
    return (
      <>
        <div className="view-header">
          <button className="pack-back" onClick={() => setView('today')}>
            <i className="ti ti-chevron-left" style={{ fontSize: 18 }} />
          </button>
          <div>
            <h1>Packing history</h1>
            <span className="vsub">tap any day to see the bag-by-bag breakdown</span>
          </div>
        </div>
        <div className="card">
          <div className="month-bar">
            <span>Recent sessions</span>
            <span className="month-totals"><strong>{sessionsQ.data?.total ?? historyDays.length} sessions</strong></span>
          </div>
          {historyDays.length === 0 && <div className="empty">No packing history yet.</div>}
          {historyDays.map(renderDayRow)}
        </div>
      </>
    )
  }

  // ── day detail view ───────────────────────────────────────────────────────

  function renderDay() {
    if (!selDay) return null
    const totalBags = sumBags(selDay.counts)
    const totalKg   = sumKg(selDay.counts)
    const maxCount  = Math.max(...selDay.counts, 1)

    return (
      <>
        <div className="view-header">
          <button className="pack-back" onClick={() => setView('history')}>
            <i className="ti ti-chevron-left" style={{ fontSize: 18 }} />
          </button>
          <div>
            <h1>{selDay.dow} {selDay.date} 2026</h1>
            <span className="vsub">{selDay.note}</span>
          </div>
        </div>

        <div className="detail-kpis">
          {TYPES.map((t, i) => (
            <div key={t.label} className={`dkc ${selDay.counts[i] > 0 ? 'green' : ''}`}>
              <div className="dklbl" title={t.label}>{t.label}</div>
              <div className="dkv">{selDay.counts[i] || 0}</div>
              <div className="dksub">{fmt((selDay.counts[i] || 0) * t.kg, 1)} kg</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="today-head">
            <h3><i className="ti ti-chart-bar" style={{ fontSize: 16, color: 'var(--text2)' }} /> Bags by type</h3>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>how many of each bag size</span>
          </div>
          {TYPES.map((t, i) => {
            const qty = selDay.counts[i] || 0
            return (
              <div key={t.label} className={`breakdown-row ${qty === 0 ? 'zero' : ''}`}>
                <span className="btype" title={t.label}>
                  <span className="btype-name">{t.label}</span>
                  <small>· {t.ref}</small>
                </span>
                <span className="bqty">{qty.toLocaleString()} <small>×</small></span>
                <div className="bbar"><div className="bfill" style={{ width: `${(qty / maxCount) * 100}%` }} /></div>
                <span className="bkg">{fmt(qty * t.kg, 1)} kg</span>
              </div>
            )
          })}
          <div className="breakdown-row btotal">
            <span className="btype" style={{ color: 'var(--text)' }}>Total</span>
            <span className="bqty">{totalBags}</span>
            <div />
            <span className="bkg" style={{ fontSize: 16 }}>{fmt(totalKg, 1)} kg</span>
          </div>
        </div>

        <div className="card">
          <div className="today-head">
            <h3><i className="ti ti-clock" style={{ fontSize: 16, color: 'var(--text2)' }} /> Entries that day</h3>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>click any entry for full details</span>
          </div>
          <div className="entries-list">
            {dayEntries.length === 0 ? (
              <div className="pack-empty">
                <i className="ti ti-archive" />
                <div className="t">No entries recorded</div>
                <div className="s">this day has no packing sessions</div>
              </div>
            ) : (
              <>
                <div className="entry-row ehead">
                  <span>Time</span><span>Bag &amp; charcoal</span><span>Worker</span><span style={{ textAlign: 'right' }}>Waste</span>
                </div>
                {dayEntries.map((e) => {
                  const wpct = e.charIn > 0 ? (e.waste / e.charIn) * 100 : 0
                  const wcolor = e.waste < 0 || wpct > 5 ? 'var(--red)' : 'var(--accent2)'
                  return (
                    <div key={e.id} className="entry-row clickable" onClick={() => setDetailId(e.id)} title="Click to view details">
                      <span className="etime">{e.time}</span>
                      <span className="entry-main">
                        <div className="echips">
                          <span className="qty-chip" title={e.bagTypeUniformLabel ?? undefined}>
                            <span className="q">{e.bagQty}</span>
                            <span className="t">
                              {e.bagTypeUniformLabel ? `× ${e.bagTypeUniformLabel}` : 'mixed bag types'}
                            </span>
                          </span>
                          {e.charcoal.map((c, i) => (
                            <span key={i} className="qty-chip" title={c.label}>
                              <span className="q">{fmt(c.kg, 0)}</span>
                              <span className="t">kg · {c.label}</span>
                            </span>
                          ))}
                        </div>
                      </span>
                      <span className="eworker" title={e.workerName}>{e.workerName}</span>
                      <span className="ewaste" style={{ color: wcolor }}>{fmt(e.waste, 1)} kg</span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </>
    )
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Topbar title="Packing">
        <span className="page-sub" style={{ color: 'var(--text3)' }}>{viewSub}</span>
        <button className="btn" style={{ marginLeft: 'auto' }}><i className="ti ti-download" style={{ fontSize: 15 }} /> Export CSV</button>
      </Topbar>
      <div className="content">
        {view === 'today'   && renderToday()}
        {view === 'history' && renderHistory()}
        {view === 'day'     && renderDay()}
      </div>

      {/* Detail / edit slide panel */}
      <div className={`panel-overlay ${detailId ? 'open' : ''}`}>
        <div className="panel-backdrop" onClick={closeDetail} />
        <div className="slide-panel pack-detail-panel">
          {!detailId ? null : detailSessionQ.isLoading ? (
            <div style={{ padding: 24, color: 'var(--text3)' }}>Loading…</div>
          ) : detailSessionQ.isError ? (
            <div style={{ padding: 24 }}>
              <div style={{ color: 'var(--red)', marginBottom: 12 }}>
                {(detailSessionQ.error as any)?.response?.status === 404
                  ? 'Packing entry not found.'
                  : 'Failed to load packing entry.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => detailSessionQ.refetch()}>Retry</button>
                <button className="btn-clear" onClick={closeDetail}>Close</button>
              </div>
            </div>
          ) : detailSession ? (
            isEditMode ? renderEditForm() : renderDetailContent()
          ) : null}
        </div>
      </div>

      <div className={`toast ${toast ? 'show' : ''}`}>
        <i className="ti ti-check-circle" style={{ fontSize: 16 }} />
        {toast}
      </div>
    </>
  )
}
