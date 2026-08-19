import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Topbar from '../components/layout/Topbar'
import { useClient, useClientBalance, useUpdateClient } from '../hooks/useClients'
import { useReceivers } from '../hooks/useReceivers'
import { usePayments, useCreatePayment } from '../hooks/usePayments'
import { useWorkers } from '../hooks/useWorkers'
import { useUsers } from '../hooks/useUsers'
import { useFillJobs, useFillJobPriceStats, useCreateFillJob, useConfirmFillPickup, useFillJobYtdSummary } from '../hooks/useFillJobs'
import { useStockExits } from '../hooks/useWarehouse'
import { useClientLedger } from '../hooks/useReports'
import { formatUsd } from '../lib/money'
import { formatDate } from '../lib/date'
import { api } from '../lib/api'

interface BagSpec {
  id: string; size: number; charcoal: string; price: number; worker: number; ours: boolean; bagCost: number; stock: number
}
interface Contact { name: string; role: string; phone: string }

let _fjBagId = 1

const DRIVERS: string[] = []

interface PickupItem { id: string; qty: number; wasted: number }
interface PickupRecord { id: string; displayId?: string; date: string; driver: string; paid: boolean; items: PickupItem[] }
const PICKUPS: PickupRecord[] = []

function calcPickup(_p: PickupRecord) {
  return { bags: 0, revenue: 0, cost: 0, profit: 0, margin: 0, wasted: 0 }
}

function makeSpecKey(size: number, charcoal: string) {
  return `${size}_${charcoal}`
}

export default function FillClientDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  // Real data from API
  const clientQ = useClient(id ?? '')
  const client = clientQ.data
  const balanceQ = useClientBalance(id ?? '')
  const paymentsQ = usePayments({ clientId: id, limit: 100 })
  const realPayments = paymentsQ.data?.data ?? []
  const workersQ = useWorkers()
  const workersList = workersQ.data ?? []
  const usersQ = useUsers({ limit: 100 })
  const usersList = usersQ.data?.data ?? []
  const { receivers } = useReceivers()

  // Fill job data
  const fillJobsQ = useFillJobs(id ?? '')
  const fillJobs = fillJobsQ.data?.data ?? []
  const priceStatsQ = useFillJobPriceStats(id ?? '')
  const priceStats = priceStatsQ.data ?? {}
  const pickupsQ = useStockExits({ clientId: id, exitType: 'client_bags_fill', limit: 100 })
  const pickups = pickupsQ.data?.data ?? []
  const createFillJob = useCreateFillJob()
  const confirmPickup = useConfirmFillPickup()
  const createPayment = useCreatePayment()

  // Statement of account — reuses the same client-ledger endpoint/hook the
  // normal Client Statement uses. Backend folds Fill Client pickups
  // (StockExit, exitType='client_bags_fill') in as debit entries alongside
  // payment credits — see ReportsService.getClientLedger(). No separate
  // balance math here; this is purely a view over what the ledger returns.
  const ledgerQ = useClientLedger(id ?? '')
  const statement = ledgerQ.data?.entries ?? []
  const stmtOpening = parseFloat(ledgerQ.data?.openingBalance ?? '0')
  const stmtDebitTotal = statement.reduce((s, e) => s + parseFloat(e.debit), 0)
  const stmtCreditTotal = statement.reduce((s, e) => s + parseFloat(e.credit), 0)
  const stmtClosing = parseFloat(ledgerQ.data?.balance ?? String(stmtOpening))

  // Stock lots for fill job modal charcoal selector
  const stockLotsQ = useQuery({
    queryKey: ['stock-lots', 'available'],
    queryFn: async () => {
      const res = await api.get<{ data: any[] }>('/stock-lots', { params: { hasStock: true, limit: 200 } })
      return res.data.data
    },
  })
  const stockLots = stockLotsQ.data ?? []

  const clientName = client?.name ?? '—'
  const clientInitials = clientName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
  const clientBalance = balanceQ.data ? parseFloat(String(balanceQ.data.balance)) : (client ? parseFloat(String(client.balance ?? '0')) : 0)
  const clientPhones = client?.phones?.filter((p: any) => p.isActive) ?? []

  // Bags state — persisted to localStorage per client so pricing survives page reloads
  const storageKey = `fill-bags-${id ?? 'unknown'}`
  const [bags, setBagsRaw] = useState<BagSpec[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? (JSON.parse(saved) as BagSpec[]) : []
    } catch { return [] }
  })
  function setBags(update: BagSpec[] | ((prev: BagSpec[]) => BagSpec[])) {
    setBagsRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }

  function getBag(bagId: string) {
    return bags.find(b => b.id === bagId)
  }

  function updateBag(id: string, patch: Partial<BagSpec>) {
    setBags(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b))
  }

  // Total bags filled per specKey from fill job history
  const stockFromJobs = useMemo(() => {
    const map: Record<string, number> = {}
    for (const fj of fillJobs) {
      for (const out of fj.bagOutputs) {
        map[out.specKey] = (map[out.specKey] ?? 0) + out.qty
      }
    }
    return map
  }, [fillJobs])

  // Bags picked up per specKey — parsed from the JSON reason field of each pickup exit
  const pickedUpFromJobs = useMemo(() => {
    const map: Record<string, number> = {}
    for (const pk of pickups) {
      if (!pk.reason) continue
      try {
        const summary = JSON.parse(pk.reason) as { specKey?: string; size?: number; charcoal?: string; qty: number }[]
        for (const item of summary) {
          const key = item.specKey ?? makeSpecKey(item.size ?? 0, item.charcoal ?? '')
          map[key] = (map[key] ?? 0) + item.qty
        }
      } catch { /* ignore non-JSON reasons from old records */ }
    }
    return map
  }, [pickups])

  // Specs discovered from fill job history (so they appear even before manual editor entry)
  const specsFromJobs = useMemo(() => {
    const map = new Map<string, { specKey: string; size: number; charcoal: string }>()
    for (const fj of fillJobs) {
      for (const out of fj.bagOutputs) {
        if (!map.has(out.specKey)) {
          map.set(out.specKey, { specKey: out.specKey, size: out.size, charcoal: out.charcoal })
        }
      }
    }
    return Array.from(map.values())
  }, [fillJobs])

  // When fill jobs arrive (new or refetched), promote any NEW specs into bags
  // so they appear in the editor. Existing bag pricing is never overwritten.
  useEffect(() => {
    if (specsFromJobs.length === 0) return
    setBags(prev => {
      const existing = new Set(prev.map(b => makeSpecKey(b.size, b.charcoal)))
      const newSpecs = specsFromJobs.filter(s => !existing.has(s.specKey))
      if (newSpecs.length === 0) return prev
      return [
        ...prev,
        ...newSpecs.map(s => ({
          id: s.specKey,
          size: s.size,
          charcoal: s.charcoal,
          price: 0,
          worker: 0,
          ours: false,
          bagCost: 0,
          stock: 0,
        })),
      ]
    })
  }, [specsFromJobs])

  // allBags = local bag editor specs merged with fill-job-derived specs + net stock counts
  const allBags = useMemo(() => {
    const netStock = (specKey: string) =>
      Math.max(0, (stockFromJobs[specKey] ?? 0) - (pickedUpFromJobs[specKey] ?? 0))

    const result: BagSpec[] = bags.map(b => {
      const key = makeSpecKey(b.size, b.charcoal)
      return { ...b, stock: netStock(key) }
    })
    for (const spec of specsFromJobs) {
      if (!result.find(b => makeSpecKey(b.size, b.charcoal) === spec.specKey)) {
        result.push({
          id: spec.specKey,
          size: spec.size,
          charcoal: spec.charcoal,
          price: 0,
          worker: 0,
          ours: false,
          bagCost: 0,
          stock: netStock(spec.specKey),
        })
      }
    }
    return result
  }, [bags, stockFromJobs, pickedUpFromJobs, specsFromJobs])

  // YTD stats: cost from fill jobs, revenue from pickup amounts. Computed
  // server-side (FillJobsService.getYtdSummary()) — unbounded per client,
  // not derived from the limit:100-capped fillJobs/pickups lists above,
  // which would silently undercount for a client with >100 fill jobs or
  // pickups within the year. Same field names/formulas as before, just
  // sourced from the unbounded aggregate instead of a client-side reduce.
  const ytdSummaryQ = useFillJobYtdSummary(id ?? '')
  const ytdStats = {
    bagsYTD: ytdSummaryQ.data?.bagsYTD ?? 0,
    wasteKg: parseFloat(ytdSummaryQ.data?.wasteKg ?? '0'),
    wastePct: ytdSummaryQ.data?.wastePct ?? 0,
    revenueYTD: parseFloat(ytdSummaryQ.data?.revenueYTD ?? '0'),
    profitYTD: parseFloat(ytdSummaryQ.data?.profitYTD ?? '0'),
    marginYTD: ytdSummaryQ.data?.marginYTD ?? 0,
    hasData: ytdSummaryQ.data?.hasData ?? false,
  }

  // Modal state
  const updateClient = useUpdateClient()
  const [showBagEditor, setShowBagEditor] = useState(false)
  const [showPickup, setShowPickup] = useState(false)
  const [showFillJob, setShowFillJob] = useState(false)
  const [showPay, setShowPay] = useState(false)
  const [showPickupDetail, setShowPickupDetail] = useState<number | null>(null)
  const [showEditClient, setShowEditClient] = useState(false)
  const [editClientForm, setEditClientForm] = useState({ name: '', currency: 'USD', notes: '', paymentTerms: '' })
  const [editClientSaving, setEditClientSaving] = useState(false)

  // Pickup modal state
  const [puDate, setPuDate] = useState(new Date().toISOString().slice(0, 10))
  const [puDriver, setPuDriver] = useState('')
  const [puQty, setPuQty] = useState<Record<string, number>>({})
  const [puWaste, setPuWaste] = useState<Record<string, number>>({})
  const [puSaving, setPuSaving] = useState(false)

  // Fill job modal state
  const [fjDate, setFjDate] = useState(new Date().toISOString().slice(0, 10))
  const [fjWorker, setFjWorker] = useState('')
  const [fjBagRows, setFjBagRows] = useState([{ id: _fjBagId++, bagId: '', qty: 0 }])
  const [fjCharRows, setFjCharRows] = useState([{ id: _fjBagId++, lotId: '', kg: 0 }])
  const [fjNotes, setFjNotes] = useState('')
  const [fjSaving, setFjSaving] = useState(false)

  // Payment modal state
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('cash')
  const [payAmt, setPayAmt] = useState(0)
  const [payBy, setPayBy] = useState('')
  const [payRef, setPayRef] = useState('')
  const [paySaving, setPaySaving] = useState(false)

  // Contacts state
  const [contacts, setContacts] = useState<Contact[]>([])
  const [showContactEditor, setShowContactEditor] = useState<number | 'new' | null>(null)
  const [editContact, setEditContact] = useState<Contact>({ name: '', role: '', phone: '' })

  function openNewContact() {
    setEditContact({ name: '', role: '', phone: '' })
    setShowContactEditor('new')
  }
  function openEditContact(idx: number) {
    setEditContact({ ...contacts[idx] })
    setShowContactEditor(idx)
  }
  function saveContact() {
    if (showContactEditor === 'new') {
      setContacts(prev => [...prev, editContact])
    } else if (typeof showContactEditor === 'number') {
      setContacts(prev => prev.map((c, i) => i === showContactEditor ? editContact : c))
    }
    setShowContactEditor(null)
    showToast(showContactEditor === 'new' ? 'Contact added' : 'Contact saved')
  }

  // Notes state
  const [notes, setNotes] = useState({ ar: '', en: '' })
  const [editNotes, setEditNotes] = useState({ ar: '', en: '' })
  const [showNotesEditor, setShowNotesEditor] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)

  function openEditClient() {
    setEditClientForm({
      name: client?.name ?? '',
      currency: client?.currency ?? 'USD',
      notes: client?.notes ?? '',
      paymentTerms: client?.paymentTerms ?? '',
    })
    setShowEditClient(true)
  }

  async function saveEditClient() {
    if (!id || !editClientForm.name.trim()) return
    setEditClientSaving(true)
    try {
      await updateClient.mutateAsync({ id, body: {
        name: editClientForm.name.trim(),
        currency: editClientForm.currency as any,
        notes: editClientForm.notes.trim() || undefined,
        paymentTerms: editClientForm.paymentTerms.trim() || undefined,
      }})
      setShowEditClient(false)
      showToast('Client updated')
    } catch (e: any) {
      showToast(e?.error ?? 'Failed to update')
    } finally {
      setEditClientSaving(false)
    }
  }

  async function toggleActive() {
    if (!id || !client) return
    const nowActive = (client as any).isActive !== false
    try {
      await updateClient.mutateAsync({ id, body: { isActive: !nowActive } })
      showToast(nowActive ? 'Client deactivated' : 'Client reactivated')
    } catch (e: any) {
      showToast(e?.error ?? 'Failed to update')
    }
  }

  function openNotesEditor() {
    setEditNotes({ ...notes })
    setShowNotesEditor(true)
  }

  // Only the English side has a backend home (Client.notes is a single
  // field) — Arabic stays a local-only UI value, same limitation as before
  // this fix, not persisted anywhere. See saveEditClient() above for the
  // same mutation/try-catch/toast convention this mirrors.
  async function saveNotes() {
    if (!id || !client) return
    setNotesSaving(true)
    try {
      await updateClient.mutateAsync({ id, body: { notes: editNotes.en.trim() || undefined } })
      setNotes(editNotes)
      setShowNotesEditor(false)
      showToast('Notes saved')
    } catch (e: any) {
      showToast(e?.error ?? 'Failed to save notes')
    } finally {
      setNotesSaving(false)
    }
  }

  useEffect(() => {
    if (clientPhones.length > 0) {
      setContacts(clientPhones.map((p: any) => ({
        name: client?.name ?? '',
        role: p.label ?? 'contact',
        phone: p.number,
      })))
    }
  }, [client?.id])

  useEffect(() => {
    if (client?.notes) {
      setNotes(prev => ({ ...prev, en: client.notes ?? '' }))
    }
  }, [client?.id])

  // Toast
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  // Derived pickup summary (uses allBags so live stock counts are reflected)
  const puCalc = (() => {
    let bagCount = 0, revenue = 0, cost = 0
    allBags.forEach(b => {
      const q = puQty[b.id] ?? 0; const w = puWaste[b.id] ?? 0
      const specKey = makeSpecKey(b.size, b.charcoal)
      const avgFill = priceStats[specKey]?.avgFillPrice ?? 0
      bagCount += q
      // Revenue = selling price per bag (set manually in the bag editor)
      revenue += q * b.price
      // Cost = charcoal cost (avg from fill jobs) + worker pay + bag cost if we supply
      cost += q * avgFill
            + (q + w) * b.worker
            + (b.ours ? (q + w) * b.bagCost : 0)
    })
    const profit = revenue - cost
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0
    return { bags: bagCount, revenue, cost, profit, margin }
  })()

  // Fill job summary calculations
  const fjBagTotal = fjBagRows.reduce((s, r) => s + r.qty, 0)
  const fjBagWeight = fjBagRows.reduce((s, r) => {
    const b = allBags.find(x => x.id === r.bagId)
    return s + r.qty * (b?.size ?? 0)
  }, 0)
  const fjCharTotal = fjCharRows.reduce((s, r) => s + r.kg, 0)
  const fjWaste = Math.max(0, fjCharTotal - fjBagWeight)

  // Estimated total cost from selected lots
  const fjEstCost = fjCharRows.reduce((s, r) => {
    const lot = stockLots.find((l: any) => l.id === r.lotId)
    return s + r.kg * (lot ? parseFloat(lot.costPerKg) : 0)
  }, 0)
  const fjEstPricePerBag = fjBagTotal > 0 ? fjEstCost / fjBagTotal : 0

  async function savePickup() {
    if (!id) return
    const pickedBags = allBags.filter(b => (puQty[b.id] ?? 0) > 0)
    if (pickedBags.length === 0) {
      showToast('Enter at least one bag quantity to pick up')
      return
    }
    const bagSummary = pickedBags.map(b => ({
      specKey: makeSpecKey(b.size, b.charcoal),
      size: b.size,
      charcoal: b.charcoal,
      qty: puQty[b.id] ?? 0,
      unitPrice: b.price,
    }))
    const totalAmount = bagSummary.reduce((s, b) => s + b.qty * b.unitPrice, 0)
    setPuSaving(true)
    try {
      await confirmPickup.mutateAsync({
        clientId: id,
        date: puDate,
        totalAmount,
        recipient: puDriver || undefined,
        bagSummary,
      })
      setPuQty({})
      setPuWaste({})
      setShowPickup(false)
      showToast(`Pickup confirmed · ${pickedBags.reduce((s, b) => s + (puQty[b.id] ?? 0), 0)} bags collected`)
    } catch (e: any) {
      showToast(e?.error ?? 'Failed to confirm pickup')
    } finally {
      setPuSaving(false)
    }
  }

  async function saveFillJob() {
    if (!id) return
    const validBagRows = fjBagRows.filter(r => r.bagId && r.qty > 0)
    const validCharRows = fjCharRows.filter(r => r.lotId && r.kg > 0)
    if (validBagRows.length === 0 || validCharRows.length === 0) {
      showToast('Add at least one bag type and one charcoal lot')
      return
    }
    setFjSaving(true)
    try {
      const bagOutputs = validBagRows.map(r => {
        const b = allBags.find(x => x.id === r.bagId)!
        return {
          specKey: makeSpecKey(b.size, b.charcoal),
          size: b.size,
          charcoal: b.charcoal,
          qty: r.qty,
        }
      })
      await createFillJob.mutateAsync({
        clientId: id,
        date: fjDate,
        workerEntityId: fjWorker || undefined,
        charcoalInputs: validCharRows.map(r => ({ lotId: r.lotId, kg: r.kg })),
        bagOutputs,
        notes: fjNotes || undefined,
      })
      setShowFillJob(false)
      setFjBagRows([{ id: _fjBagId++, bagId: allBags[0]?.id ?? '', qty: 0 }])
      setFjCharRows([{ id: _fjBagId++, lotId: '', kg: 0 }])
      setFjNotes('')
      showToast('Fill job saved · prices updated')
    } catch (e: any) {
      showToast(e?.error ?? 'Failed to save fill job')
    } finally {
      setFjSaving(false)
    }
  }

  return (
    <>
      <Topbar title={clientName}>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => navigate('/fill-clients')}>
          <i className="ti ti-chevron-left" style={{ fontSize: 13 }} /> All fill clients
        </button>
        <button className="btn" onClick={openEditClient}><i className="ti ti-pencil" style={{ fontSize: 15 }} /> Edit</button>
        <button className="btn" onClick={toggleActive}
          style={{ color: (client as any)?.isActive === false ? 'var(--accent)' : 'var(--red)', borderColor: (client as any)?.isActive === false ? 'var(--accent)' : 'var(--red)' }}>
          <i className={`ti ${(client as any)?.isActive === false ? 'ti-player-play' : 'ti-ban'}`} style={{ fontSize: 15 }} />
          {(client as any)?.isActive === false ? ' Reactivate' : ' Deactivate'}
        </button>
        <button className="btn"><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print balance</button>
        <button className="btn" onClick={() => setShowPay(true)}><i className="ti ti-cash" style={{ fontSize: 15 }} /> Log payment</button>
        <button className="btn" onClick={() => setShowPickup(true)}><i className="ti ti-truck" style={{ fontSize: 15 }} /> Pickup goods</button>
        <button className="btn primary" onClick={() => setShowFillJob(true)}><i className="ti ti-plus" style={{ fontSize: 15 }} /> New fill job</button>
      </Topbar>
      <div className="content">

        {/* Hero */}
        <div className="page-header">
          <div className="fc-hero">
            <div className="fc-mono">{clientInitials || '?'}</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 10 }}>
                {clientName}
                {(client as any)?.isActive === false && (
                  <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace", padding: '3px 8px', borderRadius: 6, background: 'rgba(180,83,9,0.12)', color: 'var(--accent2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>inactive</span>
                )}
              </h1>
              {client?.notes && (
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{client.notes}</div>
              )}
              <div className="page-header-meta">
                {client?.type && <span className="badge badge-green">{client.type}</span>}
                <span className="badge badge-gray">{client?.currency ?? 'USD'}</span>
                {client?.paymentTerms && <span className="meta-row"><i className="ti ti-clock" /> {client.paymentTerms}</span>}
                {client?.createdAt && <span className="meta-row"><i className="ti ti-calendar" /> client since {new Date(client.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                <span className="meta-row"><i className="ti ti-stack-2" /> {allBags.reduce((s, b) => s + b.stock, 0)} bags in warehouse</span>
              </div>
            </div>
          </div>
          <div className="kpi-strip">
            <div className={`kpi-tile ${clientBalance > 0 ? 'amber' : ''}`}>
              <div className="kpi-tile-label">Balance</div>
              <div className="kpi-tile-value">${Math.abs(clientBalance).toFixed(2)}</div>
              <div className="kpi-tile-sub">{clientBalance > 0 ? 'outstanding' : clientBalance < 0 ? 'credit' : 'settled'}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Bags YTD</div>
              <div className="kpi-tile-value">{ytdStats.hasData ? ytdStats.bagsYTD : '—'}</div>
              <div className="kpi-tile-sub">{ytdStats.hasData ? `${fillJobs.length} fill job${fillJobs.length !== 1 ? 's' : ''}` : 'no fill jobs yet'}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">In warehouse</div>
              <div className="kpi-tile-value">{allBags.reduce((s, b) => s + b.stock, 0) || (fillJobsQ.isLoading ? '…' : '0')}</div>
              <div className="kpi-tile-sub">awaiting pickup</div>
            </div>
            <div className={`kpi-tile ${ytdStats.hasData && ytdStats.wastePct > 10 ? 'amber' : ''}`}>
              <div className="kpi-tile-label">Waste YTD</div>
              <div className="kpi-tile-value">
                {ytdStats.hasData ? `${ytdStats.wasteKg.toFixed(1)} kg` : '—'}
              </div>
              <div className="kpi-tile-sub">
                {ytdStats.hasData ? `${ytdStats.wastePct.toFixed(1)}% of charcoal in` : 'no fill jobs yet'}
              </div>
            </div>
            <div className={`kpi-tile ${ytdStats.revenueYTD > 0 && ytdStats.profitYTD >= 0 ? 'green' : ''}`}>
              <div className="kpi-tile-label">Profit YTD</div>
              <div className="kpi-tile-value" style={{ color: ytdStats.revenueYTD > 0 && ytdStats.profitYTD < 0 ? 'var(--red)' : undefined }}>
                {ytdStats.revenueYTD > 0 ? `$${ytdStats.profitYTD.toFixed(2)}` : '—'}
              </div>
              <div className="kpi-tile-sub">
                {ytdStats.revenueYTD > 0 ? `${ytdStats.marginYTD.toFixed(1)}% margin` : ytdStats.hasData ? 'set bag prices to track' : 'no fill jobs yet'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.65fr 1fr', gap: 14 }}>
          <div className="stack">

            {/* Statement of account — DEBIT / CREDIT / BALANCE only. Pickups
                (bag movement) and Fill jobs (production) below remain
                operational detail; this card is the single financial record. */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-file-invoice" /> Statement of account</div>
              </div>
              <div className="stmt-summary">
                <div className="stmt-cell"><div className="l">Opening balance</div><div className="v">{formatUsd(stmtOpening)}</div></div>
                <div className="stmt-cell"><div className="l">Total debit</div><div className="v amber">{formatUsd(stmtDebitTotal)}</div><div className="s">fill pickups</div></div>
                <div className="stmt-cell"><div className="l">Total credit</div><div className="v green">{formatUsd(stmtCreditTotal)}</div><div className="s">payments received</div></div>
                <div className="stmt-cell"><div className="l">Closing balance</div><div className={`v ${stmtClosing > 0 ? 'amber' : stmtClosing < 0 ? 'red' : 'green'}`}>{formatUsd(stmtClosing)}</div><div className="s">{stmtClosing > 0 ? 'owed by client' : stmtClosing < 0 ? 'in credit' : 'settled'}</div></div>
              </div>
              {ledgerQ.isLoading && <div className="empty">Loading…</div>}
              {!ledgerQ.isLoading && (
                <table className="data-table stmt-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="right">Debit</th>
                      <th className="right">Credit</th>
                      <th className="right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="opening">
                      <td className="mono"></td>
                      <td className="desc">Opening balance</td>
                      <td className="num"></td><td className="num"></td>
                      <td className="num">{formatUsd(stmtOpening)}</td>
                    </tr>
                    {statement.map((e, i) => {
                      const debit = parseFloat(e.debit)
                      const credit = parseFloat(e.credit)
                      const balance = parseFloat(e.runningBalance)
                      return (
                        <tr key={i}>
                          <td className="mono">{formatDate(e.date, { day: '2-digit' })}</td>
                          <td className="desc">{e.description}</td>
                          <td className="num dr">{debit ? formatUsd(debit) : ''}</td>
                          <td className="num cr">{credit ? formatUsd(credit) : ''}</td>
                          <td className={`num ${balance < 0 ? 'bal-neg' : 'bal-pos'}`} style={{ fontWeight: 600 }}>{formatUsd(balance)}</td>
                        </tr>
                      )
                    })}
                    {statement.length === 0 && (
                      <tr><td colSpan={5} className="empty">No fill pickups or payments recorded yet</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'right' }}>Totals</td>
                      <td className="num dr">{formatUsd(stmtDebitTotal)}</td>
                      <td className="num cr">{formatUsd(stmtCreditTotal)}</td>
                      <td className="num">{formatUsd(stmtClosing)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Bags & Pricing */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-package" /> Bags &amp; pricing <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>per-bag rates · stock on hand</span></div>
                <button className="card-action" onClick={() => setShowBagEditor(true)}><i className="ti ti-edit" style={{ fontSize: 13 }} /> Edit bags</button>
              </div>
              <div className="bags-grid">
                {allBags.length === 0 && !fillJobsQ.isLoading && (
                  <div style={{ padding: '18px', fontSize: 13, color: 'var(--text3)', fontStyle: 'italic', gridColumn: '1/-1' }}>
                    No bag specs yet — click "Edit bags" to add, or save a fill job to auto-populate.
                  </div>
                )}
                {allBags.map(b => {
                  const specKey = makeSpecKey(b.size, b.charcoal)
                  const stats = priceStats[specKey]
                  return (
                    <div className="bag-card" key={b.id}>
                      <div className="bag-size">{b.size}<small>kg</small></div>
                      <div className="bag-charcoal">{b.charcoal}</div>
                      <div className="bag-prices">
                        <div className="col">
                          <span className="plbl">Price/bag</span>
                          <span className="pval" style={{ color: b.price > 0 ? undefined : 'var(--text3)' }}>
                            {b.price > 0 ? `$${b.price.toFixed(2)}` : '—'}
                            <small style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400, marginLeft: 3 }}>/bag</small>
                          </span>
                        </div>
                        <div className="col">
                          <span className="plbl">Avg cost $</span>
                          <span className="pval" style={{ color: stats ? 'var(--accent2)' : 'var(--text3)' }}>
                            {stats ? `$${stats.avgFillPrice.toFixed(2)}` : '—'}
                            <small style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400, marginLeft: 3 }}>/bag</small>
                          </span>
                        </div>
                        <div className="col">
                          <span className="plbl">Worker pay</span>
                          <span className="pval worker">${b.worker.toFixed(2)}<small style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400, marginLeft: 3 }}>/bag</small></span>
                        </div>
                      </div>
                      <div className={`bag-supply ${b.ours ? 'ours' : 'theirs'}`}>
                        <span>{b.ours ? '✓ Our bag supplied' : 'Their own bag'}</span>
                        <span>{b.ours ? `+ $${b.bagCost.toFixed(2)}` : '—'}</span>
                      </div>
                      <div className="bag-stock">
                        <span className="slbl">In warehouse</span>
                        <span className={`sval ${b.stock === 0 ? 'zero' : ''}`}>{b.stock}<small>bags</small></span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Pickups */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-truck" /> Pickups</div>
                <button className="card-action" onClick={() => setShowPickup(true)}><i className="ti ti-plus" style={{ fontSize: 13 }} /> New pickup</button>
              </div>
              {pickupsQ.isLoading && <div className="empty">Loading…</div>}
              {!pickupsQ.isLoading && pickups.length === 0 && (
                <div className="empty">No pickups recorded yet.</div>
              )}
              {!pickupsQ.isLoading && pickups.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Driver / recipient</th>
                      <th>Bags</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pickups.map((pk: any) => {
                      let bagCount = 0
                      let bagDetail = ''
                      if (pk.reason) {
                        try {
                          const s = JSON.parse(pk.reason) as { specKey?: string; size?: number; charcoal?: string; qty: number }[]
                          bagCount = s.reduce((acc, i) => acc + i.qty, 0)
                          bagDetail = s.map(i => `${i.qty}× ${i.size ?? '?'}kg`).join(', ')
                        } catch { bagDetail = pk.reason }
                      }
                      return (
                        <tr key={pk.id}>
                          <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
                            {new Date(pk.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td style={{ color: 'var(--text2)' }}>{pk.recipient ?? '—'}</td>
                          <td>
                            <span style={{ fontWeight: 600 }}>{bagCount > 0 ? bagCount : '—'}</span>
                            {bagDetail && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{bagDetail}</span>}
                          </td>
                          <td className="right" style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: pk.amount ? 'var(--accent)' : 'var(--text3)' }}>
                            {pk.amount ? `$${parseFloat(pk.amount).toFixed(2)}` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td colSpan={2} style={{ padding: '9px 18px', fontWeight: 600, fontSize: 12 }}>Total pickups</td>
                      <td style={{ padding: '9px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>
                        {pickups.reduce((s: number, pk: any) => {
                          if (!pk.reason) return s
                          try { return s + (JSON.parse(pk.reason) as any[]).reduce((a, i) => a + i.qty, 0) } catch { return s }
                        }, 0)} bags
                      </td>
                      <td className="right" style={{ padding: '9px 18px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>
                        ${pickups.reduce((s: number, pk: any) => s + (pk.amount ? parseFloat(pk.amount) : 0), 0).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Fill jobs */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-list" /> Fill jobs</div>
                <button className="card-action" onClick={() => setShowFillJob(true)}><i className="ti ti-plus" style={{ fontSize: 13 }} /> New fill job</button>
              </div>
              {fillJobsQ.isLoading && <div className="empty">Loading…</div>}
              {!fillJobsQ.isLoading && fillJobs.length === 0 && (
                <div className="empty">No fill jobs recorded yet. Use "New fill job" to log one.</div>
              )}
              {!fillJobsQ.isLoading && fillJobs.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Worker</th>
                      <th className="right">Charcoal kg</th>
                      <th className="right">Bags</th>
                      <th className="right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fillJobs.map(fj => (
                      <tr key={fj.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{new Date(fj.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                        <td style={{ color: 'var(--text2)' }}>{fj.workerEntity?.name ?? '—'}</td>
                        <td className="right num">{parseFloat(fj.totalCharcoalKg).toFixed(1)} kg</td>
                        <td className="right num" style={{ fontWeight: 600 }}>{fj.totalBags}</td>
                        <td className="right num" style={{ color: 'var(--accent2)' }}>${parseFloat(fj.totalCost).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Payment history */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-cash" /> Payment history</div>
                <button className="card-action" onClick={() => setShowPay(true)}><i className="ti ti-plus" style={{ fontSize: 13 }} /> Log payment</button>
              </div>
              <div className="pay-kpis">
                {/* Total paid — all time, unbounded (stmtCreditTotal from ledgerQ),
                    NOT a sum over the limit:100-capped realPayments page. */}
                <div className="pay-kpi"><div className="lbl">Total paid</div><div className="val green">${stmtCreditTotal.toFixed(2)}</div></div>
                <div className="pay-kpi"><div className="lbl">Outstanding</div><div className={`val ${clientBalance > 0 ? 'amber' : 'green'}`}>${clientBalance.toFixed(2)}</div></div>
              </div>
              <table className="data-table">
                <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Currency</th></tr></thead>
                <tbody>
                  {paymentsQ.isLoading && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text3)', padding: '14px 0' }}>Loading…</td></tr>
                  )}
                  {!paymentsQ.isLoading && realPayments.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text3)', padding: '14px 0' }}>No payments recorded</td></tr>
                  )}
                  {!paymentsQ.isLoading && realPayments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{p.date}</td>
                      <td><span className="badge badge-gray">{p.method}</span></td>
                      <td className="right num" style={{ fontWeight: 600, color: 'var(--accent)' }}>+${parseFloat(p.amount).toFixed(2)}</td>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }}>{p.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>

          <div className="stack">
            {/* Activity */}
            <div className="card">
              <div className="card-head"><div className="card-title"><i className="ti ti-activity" /> Activity log</div></div>
              {(paymentsQ.isLoading || fillJobsQ.isLoading || pickupsQ.isLoading) && <div className="empty">Loading…</div>}
              {!paymentsQ.isLoading && !fillJobsQ.isLoading && !pickupsQ.isLoading && (() => {
                const events: { key: string; date: string; kind: 'payment' | 'filljob' | 'pickup'; data: any }[] = [
                  ...realPayments.map(p => ({ key: 'pay-' + p.id, date: p.date, kind: 'payment' as const, data: p })),
                  ...fillJobs.map(fj => ({ key: 'fj-' + fj.id, date: fj.date, kind: 'filljob' as const, data: fj })),
                  ...pickups.map(pk => ({ key: 'pk-' + pk.id, date: pk.date, kind: 'pickup' as const, data: pk })),
                ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

                if (events.length === 0) return <div className="empty">No activity yet.</div>

                return events.map(ev => {
                  if (ev.kind === 'payment') {
                    const p = ev.data
                    return (
                      <div className="act-row" key={ev.key}>
                        <div className="act-icon green"><i className="ti ti-cash" /></div>
                        <div>
                          <div className="act-text">Payment <strong>${parseFloat(p.amount).toFixed(2)}</strong> received via {p.method}</div>
                          <div className="act-time">{p.date}</div>
                        </div>
                      </div>
                    )
                  }
                  if (ev.kind === 'filljob') {
                    const fj = ev.data
                    return (
                      <div className="act-row" key={ev.key}>
                        <div className="act-icon" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}><i className="ti ti-package" /></div>
                        <div>
                          <div className="act-text">Fill job — <strong>{fj.totalBags} bags</strong> · {parseFloat(fj.totalCharcoalKg).toFixed(1)} kg charcoal</div>
                          <div className="act-time">{fj.date}{fj.workerEntity ? ` · ${fj.workerEntity.name}` : ''}</div>
                        </div>
                      </div>
                    )
                  }
                  // pickup
                  const pk = ev.data
                  let pkSummary = ''
                  let pkBags = 0
                  if (pk.reason) {
                    try {
                      const s = JSON.parse(pk.reason) as { qty: number; size?: number; charcoal?: string }[]
                      pkBags = s.reduce((a, i) => a + i.qty, 0)
                      pkSummary = s.map(i => `${i.qty}× ${i.size ?? '?'}kg`).join(', ')
                    } catch { pkSummary = pk.reason }
                  }
                  return (
                    <div className="act-row" key={ev.key}>
                      <div className="act-icon" style={{ background: 'rgba(251,146,60,0.1)', color: 'var(--accent2)' }}><i className="ti ti-truck" /></div>
                      <div>
                        <div className="act-text">
                          Pickup — <strong>{pkBags > 0 ? `${pkBags} bags` : 'bags'}</strong>
                          {pk.amount ? <> · <strong>${parseFloat(pk.amount).toFixed(2)}</strong></> : ''}
                          {pkSummary && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{pkSummary}</span>}
                        </div>
                        <div className="act-time">{pk.date}{pk.recipient ? ` · ${pk.recipient}` : ''}</div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>

            {/* Contacts */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-phone" /> Contacts</div>
                <button className="card-action" onClick={openNewContact}><i className="ti ti-plus" style={{ fontSize: 13 }} /> Add</button>
              </div>
              {contacts.map((c, idx) => (
                <div className="contact-row" key={idx} style={{ position: 'relative' }}>
                  <div className="contact-dot" />
                  <div style={{ flex: 1 }}>
                    <div className="contact-name">{c.name}</div>
                    <div className="contact-meta">{c.role}</div>
                  </div>
                  <div className="contact-phone">{c.phone}</div>
                  <button className="icon-btn" style={{ marginLeft: 6, flexShrink: 0 }} title="Edit contact" onClick={() => openEditContact(idx)}>
                    <i className="ti ti-pencil" style={{ fontSize: 13 }} />
                  </button>
                </div>
              ))}
              {contacts.length === 0 && (
                <div style={{ padding: '18px 18px', fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>No contacts yet — add one above.</div>
              )}
            </div>

            {/* Notes */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-notes" /> Notes</div>
                <button className="card-action" onClick={openNotesEditor}><i className="ti ti-pencil" style={{ fontSize: 13 }} /> Edit</button>
              </div>
              {(notes.ar || notes.en) ? (
                <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.6 }}>
                  {notes.ar && <div style={{ fontFamily: "'Noto Sans Arabic',sans-serif" }} dir="rtl">{notes.ar}</div>}
                  {notes.en && <div style={{ color: 'var(--text3)', fontStyle: 'italic', marginTop: notes.ar ? 6 : 0, fontSize: 12.5 }}>{notes.en}</div>}
                </div>
              ) : (
                <div style={{ padding: '18px 18px', fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>No notes yet — click Edit to add.</div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── Modal: Bag editor ── */}
      {showBagEditor && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowBagEditor(false)}>
          <div className="modal" style={{ width: 820, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-edit" style={{ marginRight: 8 }} />Edit bags &amp; pricing</div>
                <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>custom sizes · charcoal spec · worker pay · supply · fill price derived from fill jobs</div>
              </div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowBagEditor(false)}><i className="ti ti-x" /></button>
            </div>
            <div style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '3%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '6%' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '2px solid var(--border)' }}>
                    {['#', 'Charcoal spec', 'Size kg', 'Price/bag $', 'Worker $', 'Supply', 'Bag cost $', ''].map((h, i) => (
                      <th key={i} style={{ padding: '11px 12px', textAlign: i >= 2 && i <= 6 ? 'right' : 'left', fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bags.map((b, idx) => (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 12px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ padding: '7px 12px' }}>
                        <input className="input" value={b.charcoal}
                          onChange={e => updateBag(b.id, { charcoal: e.target.value })} />
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        <input className="input" type="number" min={0} step={0.001} value={b.size}
                          onChange={e => updateBag(b.id, { size: parseFloat(e.target.value) || 0 })}
                          style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text3)', pointerEvents: 'none', zIndex: 1 }}>$</span>
                          <input className="input" type="number" min={0} step={0.01} value={b.price}
                            onChange={e => updateBag(b.id, { price: parseFloat(e.target.value) || 0 })}
                            style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', paddingLeft: 18 }} />
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text3)', pointerEvents: 'none', zIndex: 1 }}>$</span>
                          <input className="input" type="number" min={0} step={0.01} value={b.worker}
                            onChange={e => updateBag(b.id, { worker: parseFloat(e.target.value) || 0 })}
                            style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', paddingLeft: 18 }} />
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        <select className="select" value={b.ours ? 'ours' : 'theirs'}
                          onChange={e => updateBag(b.id, { ours: e.target.value === 'ours' })}>
                          <option value="theirs">Their bag</option>
                          <option value="ours">We supply</option>
                        </select>
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text3)', pointerEvents: 'none', zIndex: 1 }}>$</span>
                          <input className="input" type="number" min={0} step={0.01} value={b.bagCost}
                            disabled={!b.ours}
                            onChange={e => updateBag(b.id, { bagCost: parseFloat(e.target.value) || 0 })}
                            style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', paddingLeft: 18, background: b.ours ? undefined : 'var(--surface2)', opacity: b.ours ? 1 : 0.45 }} />
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                        <button className="icon-btn danger" title="Delete row" disabled={bags.length === 1}
                          onClick={() => setBags(prev => prev.filter(r => r.id !== b.id))}>
                          <i className="ti ti-trash" style={{ fontSize: 14 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <button className="btn-add-bag"
                  onClick={() => setBags(prev => [...prev, { id: 'new-' + Date.now(), size: 0, charcoal: '', price: 0, worker: 0, ours: false, bagCost: 0, stock: 0 }])}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add bag type
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>fill price is auto-calculated from fill job history</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowBagEditor(false)}>Cancel</button>
                <button className="btn green" onClick={() => { setShowBagEditor(false); showToast('Bag pricing saved') }}><i className="ti ti-check" style={{ fontSize: 15 }} /> Save bags</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Pickup goods ── */}
      {showPickup && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowPickup(false)}>
          <div className="modal" style={{ width: 860, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-truck" style={{ marginRight: 8 }} />Pickup goods</div>
                <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>enter what's going out · waste comes out of stock too</div>
              </div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowPickup(false)}><i className="ti ti-x" /></button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div className="compose-section">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div className="step-num">1</div>
                  <div>
                    <div className="stitle">Logistics</div>
                    <div className="ssub">date and who's picking up</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
                  <div className="field">
                    <label className="field-label">Pickup date</label>
                    <input className="input" type="date" value={puDate} onChange={e => setPuDate(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Picked up by</label>
                    <input className="input" value={puDriver} onChange={e => setPuDriver(e.target.value)} placeholder="e.g. driver name or client rep" />
                  </div>
                </div>
              </div>

              <div className="compose-section">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div className="step-num">2</div>
                  <div>
                    <div className="stitle">Bag quantities</div>
                    <div className="ssub">set qty picked up and any wasted bags</div>
                  </div>
                </div>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allBags.length === 0 && (
                    <div style={{ padding: '16px', fontSize: 13, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center' }}>
                      No bags in warehouse yet — save a fill job first.
                    </div>
                  )}
                  {allBags.map(b => {
                    const q = puQty[b.id] ?? 0; const w = puWaste[b.id] ?? 0
                    const active = q > 0
                    const specKey = makeSpecKey(b.size, b.charcoal)
                    const avgFill = priceStats[specKey]?.avgFillPrice ?? 0
                    // Cost per bag = charcoal (avg from fill jobs) + worker + bag if ours
                    const costPerBag = avgFill + b.worker + (b.ours ? b.bagCost : 0)
                    const rowCost = q * costPerBag + w * (b.worker + (b.ours ? b.bagCost : 0))
                    // Revenue = selling price per bag set in the bag editor
                    const rowRevenue = q * b.price
                    const rowProfit = rowRevenue - rowCost
                    return (
                      <div key={b.id} style={{
                        display: 'grid', gridTemplateColumns: '1fr 56px 100px 100px 80px 80px 100px 100px',
                        gap: 8, alignItems: 'center', padding: '12px 14px',
                        background: active ? 'rgba(29,107,74,0.05)' : 'var(--surface)',
                        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)', transition: 'border-color 0.15s, background 0.15s'
                      }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{b.size} kg</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{b.charcoal}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Stock</div>
                          <div className={`stock-tag ${b.stock === 0 ? 'zero' : ''}`}>{b.stock}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Picked up</div>
                          <input className="input" type="number" min={0} max={b.stock} value={q || ''} placeholder="0"
                            onChange={e => setPuQty(prev => ({ ...prev, [b.id]: parseInt(e.target.value) || 0 }))}
                            style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Wasted</div>
                          <input className="input" type="number" min={0} value={w || ''} placeholder="0"
                            onChange={e => setPuWaste(prev => ({ ...prev, [b.id]: parseInt(e.target.value) || 0 }))}
                            style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Price/bag</div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', paddingTop: 9, fontSize: 13, color: b.price > 0 ? 'var(--accent)' : 'var(--text3)' }}>
                            {b.price > 0 ? `$${b.price.toFixed(2)}` : '—'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Cost/bag</div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', paddingTop: 9, fontSize: 12, color: 'var(--accent2)' }}>
                            {costPerBag > 0 ? `$${costPerBag.toFixed(2)}` : '—'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Subtotal</div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', paddingTop: 9, fontSize: 13, color: active ? 'var(--accent)' : 'var(--text3)' }}>
                            {active ? `$${rowRevenue.toFixed(2)}` : '—'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Profit</div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, textAlign: 'right', paddingTop: 9, fontSize: 14, color: active ? (rowProfit >= 0 ? 'var(--accent)' : 'var(--red)') : 'var(--text3)' }}>
                            {active ? `$${rowProfit.toFixed(2)}` : '—'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="waste-bar" style={{ gridTemplateColumns: 'repeat(5,1fr)', margin: '0 20px 20px', borderRadius: 'var(--radius)' }}>
                <div className="waste-cell">
                  <span className="wlbl">Total bags</span>
                  <span className="wval">{puCalc.bags}</span>
                </div>
                <div className="waste-cell">
                  <span className="wlbl">Revenue</span>
                  <span className="wval">${puCalc.revenue.toFixed(2)}</span>
                </div>
                <div className="waste-cell">
                  <span className="wlbl">Costs</span>
                  <span className="wval" style={{ color: 'var(--accent2)' }}>${puCalc.cost.toFixed(2)}</span>
                </div>
                <div className="waste-cell">
                  <span className="wlbl">Wasted bags</span>
                  <span className="wval">{Object.values(puWaste).reduce((a, v) => a + v, 0)}</span>
                </div>
                <div className="waste-cell">
                  <span className="wlbl">Profit</span>
                  <span className={`wval${puCalc.profit < 0 ? ' bad' : ''}`}>${puCalc.profit.toFixed(2)}</span>
                  <span className="wsub">{puCalc.margin.toFixed(1)}% margin</span>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                total: <strong>${puCalc.revenue.toFixed(2)}</strong> · adds to client balance
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowPickup(false)}>Cancel</button>
                <button className="btn green" disabled={puSaving || puCalc.bags === 0} onClick={savePickup}>
                  {puSaving
                    ? <><i className="ti ti-loader-2" style={{ fontSize: 15 }} /> Saving…</>
                    : <><i className="ti ti-check" style={{ fontSize: 15 }} /> Confirm pickup</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: New fill job ── */}
      {showFillJob && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowFillJob(false)}>
          <div className="modal" style={{ width: 680, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-tools" style={{ marginRight: 8 }} />New fill job</div>
                <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>log bags filled · charcoal from stock · price auto-calculated</div>
              </div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowFillJob(false)}><i className="ti ti-x" /></button>
            </div>

            <div className="compose-section">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div className="step-num">1</div>
                <div>
                  <div className="stitle">Job details</div>
                  <div className="ssub">date and assigned worker</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
                <div className="field">
                  <label className="field-label">Job date</label>
                  <input className="input" type="date" value={fjDate} onChange={e => setFjDate(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Worker</label>
                  <select className="select" value={fjWorker} onChange={e => setFjWorker(e.target.value)}>
                    <option value="">— select worker —</option>
                    {workersList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="compose-section">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div className="step-num">2</div>
                <div>
                  <div className="stitle">Bags filled</div>
                  <div className="ssub">bag type and quantity produced</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 36px', gap: '6px 10px', alignItems: 'center', padding: '0 0 8px', fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span />
                <span>Bag type</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span />
              </div>
              {fjBagRows.map((row, i) => (
                <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 36px', gap: '6px 10px', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', flexShrink: 0 }}>{i + 1}</span>
                  <select className="select" value={row.bagId}
                    onChange={e => setFjBagRows(prev => prev.map((r, ri) => ri === i ? { ...r, bagId: e.target.value } : r))}>
                    <option value="">— select bag type —</option>
                    {allBags.map(b => <option key={b.id} value={b.id}>{b.size} kg · {b.charcoal}</option>)}
                  </select>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input className="input" type="number" min={0} value={row.qty || ''} placeholder="0"
                      onChange={e => setFjBagRows(prev => prev.map((r, ri) => ri === i ? { ...r, qty: parseInt(e.target.value) || 0 } : r))}
                      style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', paddingRight: 36 }} />
                    <span style={{ position: 'absolute', right: 10, fontSize: 10, color: 'var(--text3)', pointerEvents: 'none', fontFamily: "'IBM Plex Mono',monospace" }}>bags</span>
                  </div>
                  <button className="icon-btn" style={{ width: 36, height: 36 }} disabled={fjBagRows.length === 1}
                    onClick={() => setFjBagRows(prev => prev.filter((_, ri) => ri !== i))}>
                    <i className="ti ti-x" style={{ fontSize: 13 }} />
                  </button>
                </div>
              ))}
              <button className="btn-add-bag" style={{ marginTop: 4 }}
                onClick={() => setFjBagRows(prev => [...prev, { id: _fjBagId++, bagId: '', qty: 0 }])}>
                <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add bag type
              </button>
            </div>

            <div className="compose-section">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div className="step-num">3</div>
                <div>
                  <div className="stitle">Charcoal used</div>
                  <div className="ssub">select stock lot · price fetched automatically</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 36px', gap: '6px 10px', alignItems: 'center', padding: '0 0 8px', fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span />
                <span>Stock lot</span>
                <span style={{ textAlign: 'right' }}>Kg</span>
                <span />
              </div>
              {fjCharRows.map((row, i) => {
                const selectedLot = stockLots.find((l: any) => l.id === row.lotId)
                return (
                  <div key={row.id} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 36px', gap: '6px 10px', alignItems: 'center' }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', flexShrink: 0 }}>{i + 1}</span>
                      <select className="select" value={row.lotId}
                        onChange={e => setFjCharRows(prev => prev.map((r, ri) => ri === i ? { ...r, lotId: e.target.value } : r))}>
                        <option value="">— select stock lot —</option>
                        {stockLotsQ.isLoading && <option disabled>Loading lots…</option>}
                        {stockLots.map((l: any) => (
                          <option key={l.id} value={l.id}>
                            {l.charcoalType} · {l.grade} · {parseFloat(l.kgRemaining).toFixed(0)} kg rem · ${parseFloat(l.costPerKg).toFixed(4)}/kg
                          </option>
                        ))}
                      </select>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input className="input" type="number" min={0} step={0.1} value={row.kg || ''} placeholder="0"
                          onChange={e => setFjCharRows(prev => prev.map((r, ri) => ri === i ? { ...r, kg: parseFloat(e.target.value) || 0 } : r))}
                          style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', paddingRight: 30 }} />
                        <span style={{ position: 'absolute', right: 10, fontSize: 10, color: 'var(--text3)', pointerEvents: 'none', fontFamily: "'IBM Plex Mono',monospace" }}>kg</span>
                      </div>
                      <button className="icon-btn" style={{ width: 36, height: 36 }} disabled={fjCharRows.length === 1}
                        onClick={() => setFjCharRows(prev => prev.filter((_, ri) => ri !== i))}>
                        <i className="ti ti-x" style={{ fontSize: 13 }} />
                      </button>
                    </div>
                    {selectedLot && row.kg > 0 && (
                      <div style={{ marginLeft: 34, marginTop: 4, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }}>
                        cost: ${(row.kg * parseFloat(selectedLot.costPerKg)).toFixed(2)} · ${parseFloat(selectedLot.costPerKg).toFixed(4)}/kg
                      </div>
                    )}
                  </div>
                )
              })}
              <button className="btn-add-bag" style={{ marginTop: 4 }}
                onClick={() => setFjCharRows(prev => [...prev, { id: _fjBagId++, lotId: '', kg: 0 }])}>
                <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add charcoal lot
              </button>
            </div>

            <div className="waste-bar" style={{ margin: '0 20px 20px', borderRadius: 'var(--radius)' }}>
              <div className="waste-cell">
                <span className="wlbl">Charcoal in</span>
                <span className="wval">{fjCharTotal.toFixed(1)} kg</span>
              </div>
              <div className="waste-cell">
                <span className="wlbl">Bag output</span>
                <span className="wval">{fjBagWeight.toFixed(1)} kg</span>
              </div>
              <div className="waste-cell">
                <span className="wlbl">Waste</span>
                <span className={`wval${fjCharTotal > 0 && (fjWaste / fjCharTotal) > 0.05 ? ' bad' : ''}`}>{fjWaste.toFixed(1)} kg</span>
                <span className="wsub">{fjCharTotal > 0 ? ((fjWaste / fjCharTotal) * 100).toFixed(1) : '0'}%</span>
              </div>
              <div className="waste-cell">
                <span className="wlbl">Total cost</span>
                <span className="wval">${fjEstCost.toFixed(2)}</span>
              </div>
              <div className="waste-cell">
                <span className="wlbl">Est. $/bag</span>
                <span className="wval" style={{ color: fjEstPricePerBag > 0 ? 'var(--accent)' : undefined }}>
                  {fjEstPricePerBag > 0 ? `$${fjEstPricePerBag.toFixed(4)}` : '—'}
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>stock increases · fill price updates on save</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowFillJob(false)}>Cancel</button>
                <button className="btn green" disabled={fjSaving} onClick={saveFillJob}>
                  {fjSaving ? <><i className="ti ti-loader-2" style={{ fontSize: 15 }} /> Saving…</> : <><i className="ti ti-check" style={{ fontSize: 15 }} /> Save fill job</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Log payment ── */}
      {showPay && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowPay(false)}>
          <div className="modal" style={{ width: 500, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-receipt" style={{ marginRight: 8 }} />Log payment</div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowPay(false)}><i className="ti ti-x" /></button>
            </div>

            <div style={{ background: 'rgba(180,83,9,0.07)', borderBottom: '1px solid rgba(180,83,9,0.18)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent2)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Outstanding balance</div>
                <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent2)', lineHeight: 1 }}>${clientBalance.toFixed(2)}</div>
              </div>
              <i className="ti ti-alert-triangle" style={{ fontSize: 32, color: 'var(--accent2)', opacity: 0.35 }} />
            </div>

            <div className="compose-section">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div className="step-num">1</div>
                <div className="stitle">Payment method</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                {[
                  { id: 'cash', label: 'Cash', icon: 'ti-cash' },
                  { id: 'whish', label: 'Whish', icon: 'ti-brand-mastercard' },
                  { id: 'omt', label: 'OMT', icon: 'ti-credit-card' },
                ].map(m => {
                  const sel = payMethod === m.id
                  return (
                    <button key={m.id} onClick={() => setPayMethod(m.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                        padding: '14px 8px', border: `2px solid ${sel ? 'var(--text)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)', cursor: 'pointer',
                        background: sel ? 'var(--text)' : 'var(--surface)',
                        color: sel ? '#fff' : 'var(--text2)', transition: 'all 0.15s',
                        fontFamily: 'inherit', fontSize: 'inherit'
                      }}>
                      <i className={`ti ${m.icon}`} style={{ fontSize: 22 }} />
                      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="compose-section">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div className="step-num">2</div>
                <div className="stitle">Amount</div>
              </div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 22, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--text3)', pointerEvents: 'none', zIndex: 1 }}>$</span>
                <input className="input" type="number" min={0} step={0.01} value={payAmt || ''} placeholder="0.00"
                  onChange={e => setPayAmt(parseFloat(e.target.value) || 0)}
                  style={{ fontSize: 28, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, paddingLeft: 40, paddingTop: 14, paddingBottom: 14, height: 'auto', lineHeight: 1.2 }} />
              </div>
              {payAmt > 0 && (
                <div style={{ marginTop: 10, fontSize: 12.5, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)' }}>
                  Remaining after this payment: <strong style={{ color: (clientBalance - payAmt) > 0 ? 'var(--accent2)' : 'var(--accent)' }}>${Math.max(0, clientBalance - payAmt).toFixed(2)}</strong>
                </div>
              )}
            </div>

            <div className="compose-section" style={{ borderBottom: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <div className="step-num">3</div>
                <div className="stitle">Details</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label className="field-label">Date</label>
                  <input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Received by</label>
                  <select className="select" value={payBy} onChange={e => setPayBy(e.target.value)}>
                    <option value="">— select receiver —</option>
                    {usersList.length > 0 && (
                      <optgroup label="Staff">
                        {usersList.map(u => (
                          <option key={u.id} value={u.name}>{u.name} · {u.role}</option>
                        ))}
                      </optgroup>
                    )}
                    {workersList.length > 0 && (
                      <optgroup label="Workers">
                        {workersList.map(w => (
                          <option key={w.id} value={w.name}>{w.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {receivers.length > 0 && (
                      <optgroup label="Receivers">
                        {receivers.map(r => (
                          <option key={r.id} value={r.name}>{r.name}{r.role ? ` · ${r.role}` : ''}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {usersList.length === 0 && workersList.length === 0 && receivers.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      Add receivers in <strong>Settings → Money receivers</strong>
                    </div>
                  )}
                </div>
                <div className="field" style={{ gridColumn: '1/-1' }}>
                  <label className="field-label">Reference / pickup</label>
                  <input className="input" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. PU-0035, whish ref #12345" />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                {payAmt > 0 ? `$${Math.max(0, clientBalance - payAmt).toFixed(2)} remaining after save` : `deducts from outstanding $${clientBalance.toFixed(2)}`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowPay(false)}>Cancel</button>
                <button className="btn green" disabled={paySaving || payAmt <= 0} onClick={async () => {
                  if (!id || payAmt <= 0) return
                  setPaySaving(true)
                  try {
                    const receiverId = usersList.find(u => u.name === payBy)?.id ?? receivers.find(r => r.name === payBy)?.id
                    await createPayment.mutateAsync({
                      clientId: id,
                      amount: payAmt.toFixed(2),
                      currency: (client?.currency ?? 'USD') as any,
                      method: payMethod as any,
                      date: payDate,
                      ...(receiverId ? { receiverId } : { receiverName: payBy || undefined }),
                      notes: payRef || undefined,
                    })
                    setShowPay(false)
                    setPayAmt(0)
                    setPayBy('')
                    setPayRef('')
                    showToast(`Payment $${payAmt.toFixed(2)} logged`)
                    paymentsQ.refetch()
                    balanceQ.refetch()
                    clientQ.refetch()
                  } catch (e: any) {
                    showToast(e?.error ?? 'Failed to log payment')
                  } finally {
                    setPaySaving(false)
                  }
                }}>
                  {paySaving
                    ? <><i className="ti ti-loader-2" style={{ fontSize: 15 }} /> Saving…</>
                    : <><i className="ti ti-check" style={{ fontSize: 15 }} /> Log payment</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Pickup detail ── */}
      {showPickupDetail !== null && (() => {
        const p = PICKUPS[showPickupDetail]
        const c = calcPickup(p)
        return (
          <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowPickupDetail(null)}>
            <div className="modal" style={{ width: 820, maxWidth: '96vw' }}>
              <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-truck" style={{ marginRight: 8 }} />{p.displayId ?? p.id}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>{p.date} · {p.driver}</div>
                  </div>
                  <span style={{
                    padding: '4px 11px', borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                    fontFamily: "'IBM Plex Mono',monospace", letterSpacing: '0.6px',
                    background: p.paid ? 'rgba(29,107,74,0.3)' : 'rgba(180,83,9,0.3)',
                    color: p.paid ? '#6EE7B7' : '#FCD34D'
                  }}>
                    {p.paid ? 'PAID' : 'UNPAID'}
                  </span>
                </div>
                <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowPickupDetail(null)}><i className="ti ti-x" /></button>
              </div>

              <div className="pd-kpis" style={{ borderBottom: '1px solid var(--border)' }}>
                {[
                  { label: 'Bags picked up', val: String(c.bags), sub: '', cls: '' },
                  { label: 'Revenue', val: `$${c.revenue.toFixed(2)}`, sub: '', cls: '' },
                  { label: 'Costs', val: `$${c.cost.toFixed(2)}`, sub: '', cls: 'cost' },
                  { label: 'Wasted bags', val: String(c.wasted), sub: c.wasted > 0 ? 'deducted from stock' : 'none', cls: 'waste' },
                  { label: 'Profit', val: `$${c.profit.toFixed(2)}`, sub: `${c.margin.toFixed(1)}% margin`, cls: 'profit' },
                ].map(k => (
                  <div key={k.label} className={`pd-kpi ${k.cls}`}>
                    <span className="lbl">{k.label}</span>
                    <span className="val">{k.val}</span>
                    {k.sub && <span className="sub">{k.sub}</span>}
                  </div>
                ))}
              </div>

              <div className="modal-footer">
                <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>driver: {p.driver}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setShowPickupDetail(null)}>Close</button>
                  <button className="btn"><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print invoice</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Modal: Contact editor ── */}
      {showContactEditor !== null && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowContactEditor(null)}>
          <div className="modal" style={{ width: 460, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}>
                  <i className={`ti ${showContactEditor === 'new' ? 'ti-user-plus' : 'ti-user-edit'}`} style={{ marginRight: 8 }} />
                  {showContactEditor === 'new' ? 'Add contact' : 'Edit contact'}
                </div>
                <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>
                  {showContactEditor === 'new' ? 'new person for this client' : 'update details for this contact'}
                </div>
              </div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowContactEditor(null)}>
                <i className="ti ti-x" />
              </button>
            </div>

            <div className="compose-section" style={{ borderBottom: 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label className="field-label">Full name</label>
                  <input className="input" value={editContact.name} placeholder="e.g. Bassam Younes"
                    onChange={e => setEditContact(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="field">
                  <label className="field-label">Role / title</label>
                  <input className="input" value={editContact.role} placeholder="e.g. operations manager"
                    onChange={e => setEditContact(p => ({ ...p, role: e.target.value }))} />
                </div>
                <div className="field">
                  <label className="field-label">Phone</label>
                  <input className="input" value={editContact.phone} placeholder="+961 XX XXX XXX"
                    onChange={e => setEditContact(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              {typeof showContactEditor === 'number' ? (
                <button className="btn" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={() => { setContacts(prev => prev.filter((_, i) => i !== showContactEditor)); setShowContactEditor(null); showToast('Contact removed') }}>
                  <i className="ti ti-trash" style={{ fontSize: 14 }} /> Remove
                </button>
              ) : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowContactEditor(null)}>Cancel</button>
                <button className="btn green" disabled={!editContact.name.trim()} onClick={saveContact}>
                  <i className="ti ti-check" style={{ fontSize: 15 }} /> {showContactEditor === 'new' ? 'Add contact' : 'Save contact'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Notes editor ── */}
      {showNotesEditor && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowNotesEditor(false)}>
          <div className="modal" style={{ width: 540, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-notes" style={{ marginRight: 8 }} />Edit notes</div>
                <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>internal notes · shown on client page only</div>
              </div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowNotesEditor(false)}>
                <i className="ti ti-x" />
              </button>
            </div>

            <div className="compose-section" style={{ borderBottom: 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="field">
                  <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Arabic
                    <span style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', fontWeight: 400 }}>rtl</span>
                  </label>
                  <textarea className="input" dir="rtl" rows={4} value={editNotes.ar}
                    onChange={e => setEditNotes(p => ({ ...p, ar: e.target.value }))}
                    style={{ fontFamily: "'Noto Sans Arabic',sans-serif", fontSize: 14, resize: 'vertical', lineHeight: 1.7 }}
                    placeholder="ملاحظات بالعربية..." />
                </div>
                <div className="field">
                  <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    English
                    <span style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', fontWeight: 400 }}>translation / additional info</span>
                  </label>
                  <textarea className="input" rows={3} value={editNotes.en}
                    onChange={e => setEditNotes(p => ({ ...p, en: e.target.value }))}
                    style={{ fontSize: 13, resize: 'vertical', lineHeight: 1.6 }}
                    placeholder="Notes in English..." />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>visible to your team only</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowNotesEditor(false)}>Cancel</button>
                <button className="btn green" disabled={notesSaving} onClick={saveNotes}>
                  {notesSaving ? <><i className="ti ti-loader-2" style={{ fontSize: 15 }} /> Saving…</> : <><i className="ti ti-check" style={{ fontSize: 15 }} /> Save notes</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Edit client ── */}
      {showEditClient && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowEditClient(false)}>
          <div className="modal" style={{ width: 500, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px' }}><i className="ti ti-user-edit" style={{ marginRight: 8 }} />Edit fill client</div>
                <div style={{ fontSize: 11, opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", marginTop: 3 }}>update client details</div>
              </div>
              <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setShowEditClient(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="compose-section" style={{ borderBottom: 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label className="field-label">Client name <span style={{ color: 'var(--red)' }}>*</span></label>
                  <input className="input" value={editClientForm.name} autoFocus
                    onChange={e => setEditClientForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="field">
                  <label className="field-label">Currency</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['USD', 'LBP'] as const).map(c => (
                      <button key={c} onClick={() => setEditClientForm(f => ({ ...f, currency: c }))}
                        style={{
                          flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', border: '1px solid',
                          cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace",
                          background: editClientForm.currency === c ? 'var(--text)' : 'transparent',
                          color: editClientForm.currency === c ? '#fff' : 'var(--text2)',
                          borderColor: editClientForm.currency === c ? 'var(--text)' : 'var(--border)',
                        }}>{c}</button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Payment terms</label>
                  <input className="input" value={editClientForm.paymentTerms} placeholder="e.g. Net 30"
                    onChange={e => setEditClientForm(f => ({ ...f, paymentTerms: e.target.value }))} />
                </div>
                <div className="field">
                  <label className="field-label">Notes</label>
                  <textarea className="input" rows={3} value={editClientForm.notes} placeholder="Internal notes…"
                    onChange={e => setEditClientForm(f => ({ ...f, notes: e.target.value }))}
                    style={{ resize: 'vertical', lineHeight: 1.6 }} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={toggleActive}>
                <i className={`ti ${(client as any)?.isActive === false ? 'ti-player-play' : 'ti-ban'}`} style={{ fontSize: 14 }} />
                {(client as any)?.isActive === false ? ' Reactivate' : ' Deactivate'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowEditClient(false)}>Cancel</button>
                <button className="btn green" disabled={editClientSaving || !editClientForm.name.trim()} onClick={saveEditClient}>
                  {editClientSaving ? <><i className="ti ti-loader-2" style={{ fontSize: 15 }} /> Saving…</> : <><i className="ti ti-check" style={{ fontSize: 15 }} /> Save changes</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>
        <i className="ti ti-check-circle" /><span>{toast}</span>
      </div>
    </>
  )
}
