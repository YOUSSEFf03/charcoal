import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import {
  useWorkers,
  useCreateWorker,
  useLogWorkerPayment,
  useUpdateWorker,
  useDeleteWorker,
  useWorkerPayments,
  useWorkerEarnings,
  useCreateWorkerEarning,
} from '../hooks/useWorkers'
import { usePackingSessions } from '../hooks/usePacking'
import type { Worker, WorkerCostCategory, PaymentMethod } from '../types/api'

type View = 'list' | 'worker'
type HistoryFilter = 'all' | 'earnings' | 'payments' | 'this_month' | 'last_month'

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// Business-language labels — the underlying model is WorkerCost, but factory
// staff never see the word "cost": this records what a worker earned, not a
// business expense.
const CATEGORY_LABEL: Record<WorkerCostCategory, string> = {
  daily_wage: 'Daily wage',
  weekly_wage: 'Weekly wage',
  monthly_salary: 'Monthly salary',
  bonus: 'Bonus',
  deduction: 'Deduction',
  fuel: 'Fuel',
  food: 'Food',
  transport: 'Transport',
  advance: 'Advance',
  correction: 'Correction',
  other: 'Other',
}
const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL) as WorkerCostCategory[]

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash', whish: 'Whish', omt: 'OMT', bank_transfer: 'Bank', cheque: 'Cheque',
}
const PAYMENT_METHODS = Object.keys(METHOD_LABEL) as PaymentMethod[]

const HISTORY_FILTERS: [HistoryFilter, string][] = [
  ['all', 'All'],
  ['earnings', 'Earnings'],
  ['payments', 'Payments'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
]

interface HistoryRow {
  id: string
  date: string
  label: string
  sub?: string
  amount: number // signed — earnings/sessions positive, payments negative
  icon: string
  color: 'green' | 'red' | 'blue'
  isPayment: boolean
}

function dayLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Employees() {
  const [view, setView] = useState<View>('list')

  const workersQ      = useWorkers()
  const createWorker   = useCreateWorker()
  const updateWorker   = useUpdateWorker()
  const deleteWorker   = useDeleteWorker()
  const logPayment     = useLogWorkerPayment()
  const createEarning  = useCreateWorkerEarning()

  const workers = workersQ.data ?? []

  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [addEmpOpen, setAddEmpOpen]     = useState(false)
  const [editEmpOpen, setEditEmpOpen]   = useState(false)
  const [editName, setEditName]         = useState('')
  const [editPhone, setEditPhone]       = useState('')
  const [empName, setEmpName]           = useState('')
  const [empPhone, setEmpPhone]         = useState('')

  const [payModalOpen, setPayModalOpen]   = useState(false)
  const [payAmt, setPayAmt]               = useState('')
  const [payMethod, setPayMethod]         = useState<PaymentMethod>('cash')
  const [payReference, setPayReference]   = useState('')

  const [earnModalOpen, setEarnModalOpen] = useState(false)
  const [earnAmt, setEarnAmt]             = useState('')
  const [earnCategory, setEarnCategory]   = useState<WorkerCostCategory>('daily_wage')
  const [earnDate, setEarnDate]           = useState(() => new Date().toISOString().slice(0, 10))
  const [earnNotes, setEarnNotes]         = useState('')

  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')

  const earningsQ = useWorkerEarnings(selectedWorker?.id)
  const paymentsQ = useWorkerPayments(selectedWorker?.id)
  // Packing sessions appear read-only in the same timeline — still calculated
  // from PackingSession.sessionEarnings, untouched by this redesign; they're
  // just another earning event from the user's point of view.
  const sessionsQ = usePackingSessions(
    selectedWorker ? { workerEntityId: selectedWorker.id, limit: 50 } : undefined
  )

  const WORKER_OWED   = selectedWorker ? parseFloat(selectedWorker.totalOwed)   : 0
  const workerEarned  = selectedWorker ? parseFloat(selectedWorker.totalEarned) : 0
  const workerPaid    = selectedWorker ? parseFloat(selectedWorker.totalPaid)   : 0

  const payAmtNum = parseFloat(payAmt) || 0
  const diffVal   = payAmtNum - WORKER_OWED
  const diffPct   = WORKER_OWED > 0 ? Math.min(100, (payAmtNum / WORKER_OWED) * 100) : 0
  const barClass  = payAmtNum === 0 ? 'none' : payAmtNum >= WORKER_OWED ? 'ok' : 'short'

  function openWorker(w: Worker) {
    setSelectedWorker(w)
    setHistoryFilter('all')
    setView('worker')
  }

  function refetchSelectedWorker() {
    return workersQ.refetch().then(result => {
      const updated = (result.data ?? []).find(w => w.id === selectedWorker?.id)
      if (updated) setSelectedWorker(updated)
    })
  }

  function submitNewWorker() {
    if (!empName.trim()) return
    createWorker.mutate(
      { name: empName.trim(), phone: empPhone || null },
      { onSuccess: () => { setAddEmpOpen(false); setEmpName(''); setEmpPhone('') } },
    )
  }

  function submitWorkerPayment() {
    if (!selectedWorker || payAmtNum <= 0) return
    logPayment.mutate(
      {
        id: selectedWorker.id,
        body: {
          amount: payAmtNum.toFixed(2),
          method: payMethod,
          referenceNumber: payReference || null,
          date: new Date().toISOString().slice(0, 10),
        },
      },
      {
        onSuccess: async () => {
          setPayModalOpen(false)
          setPayAmt(''); setPayMethod('cash'); setPayReference('')
          await refetchSelectedWorker()
        },
      },
    )
  }

  function submitEarning() {
    if (!selectedWorker) return
    const amt = parseFloat(earnAmt) || 0
    if (amt <= 0) return
    createEarning.mutate(
      {
        id: selectedWorker.id,
        body: { amount: amt.toFixed(2), category: earnCategory, date: earnDate, notes: earnNotes || null },
      },
      {
        onSuccess: async () => {
          setEarnModalOpen(false)
          setEarnAmt(''); setEarnCategory('daily_wage'); setEarnDate(new Date().toISOString().slice(0, 10)); setEarnNotes('')
          await refetchSelectedWorker()
        },
      },
    )
  }

  // ── Merge earnings + payments + packing sessions into one timeline ──────
  const historyRows: HistoryRow[] = [
    ...(earningsQ.data ?? []).map(e => ({
      id: `earning-${e.id}`,
      date: e.date,
      label: CATEGORY_LABEL[e.category],
      sub: e.notes ?? undefined,
      amount: parseFloat(e.amount),
      icon: 'ti-plus',
      color: 'green' as const,
      isPayment: false,
    })),
    ...(paymentsQ.data ?? []).map(p => ({
      id: `payment-${p.id}`,
      date: p.date,
      label: 'Payment',
      sub: p.referenceNumber ? `${METHOD_LABEL[p.method]} · ${p.referenceNumber}` : METHOD_LABEL[p.method],
      amount: -parseFloat(p.amount),
      icon: 'ti-cash',
      color: 'red' as const,
      isPayment: true,
    })),
    ...(sessionsQ.data?.data ?? []).map(s => ({
      id: `session-${s.id}`,
      date: s.date,
      label: 'Packing session',
      sub: undefined,
      amount: parseFloat(s.sessionEarnings ?? '0'),
      icon: 'ti-box',
      color: 'blue' as const,
      isPayment: false,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const now = new Date()
  const thisMonth = monthKey(now)
  const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  const filteredRows = historyRows.filter(r => {
    if (historyFilter === 'earnings' && r.isPayment) return false
    if (historyFilter === 'payments' && !r.isPayment) return false
    if (historyFilter === 'this_month' && !r.date.startsWith(thisMonth)) return false
    if (historyFilter === 'last_month' && !r.date.startsWith(lastMonth)) return false
    return true
  })

  const groupedRows: { date: string; rows: HistoryRow[] }[] = []
  for (const row of filteredRows) {
    const last = groupedRows[groupedRows.length - 1]
    if (last && last.date === row.date) last.rows.push(row)
    else groupedRows.push({ date: row.date, rows: [row] })
  }

  const historyLoading = earningsQ.isLoading || paymentsQ.isLoading || sessionsQ.isLoading

  // ── LIST VIEW ────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <>
        <Topbar title="Employees">
          <button className="btn primary" onClick={() => setAddEmpOpen(true)}>
            <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add employee
          </button>
        </Topbar>
        <div className="content">
          {workersQ.isLoading && [0, 1, 2].map(i => (
            <div className="emp-list-card" key={i}>
              <div className="emp-big-avatar" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} /></div>
              <div style={{ flex: 1 }}><div className="skeleton" style={{ width: '40%', height: 14, marginBottom: 6 }} /><div className="skeleton" style={{ width: '60%', height: 12 }} /></div>
            </div>
          ))}
          {workersQ.isError && (
            <div className="empty">Failed to load employees.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => workersQ.refetch()}>Retry</button></div></div>
          )}
          {!workersQ.isLoading && !workersQ.isError && workers.map(w => {
            const owed = parseFloat(w.totalOwed)
            return (
              <div key={w.id} className="emp-list-card" style={{ cursor: 'pointer' }} onClick={() => openWorker(w)}>
                <div className="emp-big-avatar" style={{ background: 'var(--accent)', color: '#fff' }}>{initials(w.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{w.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Warehouse worker</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: owed > 0 ? 'var(--red)' : 'var(--accent)', fontSize: 15 }}>${owed.toFixed(2)} owed</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>earned ${parseFloat(w.totalEarned).toFixed(2)}</div>
                </div>
                <button
                  className="btn"
                  style={{ marginLeft: 8, padding: '5px 8px', background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5', flexShrink: 0 }}
                  onClick={e => {
                    e.stopPropagation()
                    if (confirm(`Remove ${w.name} permanently?`)) {
                      deleteWorker.mutate(w.id)
                    }
                  }}
                >
                  <i className="ti ti-trash" style={{ fontSize: 13 }} />
                </button>
                <i className="ti ti-chevron-right" style={{ color: 'var(--text3)', marginLeft: 4 }} />
              </div>
            )
          })}
          {!workersQ.isLoading && !workersQ.isError && workers.length === 0 && (
            <div className="empty">No employees yet. Use "Add employee" to create one.</div>
          )}
        </div>

        {addEmpOpen && (
          <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAddEmpOpen(false)}>
            <div className="modal" style={{ width: 460 }}>
              <div className="modal-head">
                <div className="modal-title">Add employee</div>
                <button className="panel-close-btn" onClick={() => setAddEmpOpen(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full name</label>
                  <input className="form-input" type="text" placeholder="e.g. Ali Karimi" value={empName} onChange={e => setEmpName(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Phone</label>
                  <input className="form-input" type="tel" placeholder="+961 3 000 000" value={empPhone} onChange={e => setEmpPhone(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setAddEmpOpen(false)}>Cancel</button>
                <button className="btn primary" onClick={submitNewWorker} disabled={createWorker.isPending}>
                  <i className="ti ti-check" style={{ fontSize: 14 }} /> {createWorker.isPending ? 'Adding…' : 'Add employee'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── WORKER DETAIL VIEW ───────────────────────────────────────────────
  return (
    <>
      <Topbar title="Employees">
        <button className="btn" onClick={() => setEarnModalOpen(true)}>
          <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add earnings
        </button>
        <button className="btn primary" onClick={() => setPayModalOpen(true)}>
          <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay worker
        </button>
      </Topbar>
      <div className="content">
        <button className="back-btn" onClick={() => setView('list')}>
          <i className="ti ti-arrow-left" /> Back to employees
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div className="emp-big-avatar" style={{ background: 'var(--accent)', color: '#fff', width: 56, height: 56, fontSize: 20 }}>{initials(selectedWorker?.name ?? '')}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{selectedWorker?.name ?? '—'}</div>
            {selectedWorker?.phone && <div style={{ fontSize: 13, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{selectedWorker.phone}</div>}
          </div>
          <button className="btn" onClick={() => {
            setEditName(selectedWorker?.name ?? '')
            setEditPhone(selectedWorker?.phone ?? '')
            setEditEmpOpen(true)
          }}>
            <i className="ti ti-edit" style={{ fontSize: 14 }} /> Edit
          </button>
          <button
            className="btn"
            style={{ background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' }}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <i className="ti ti-trash" style={{ fontSize: 14 }} /> Remove
          </button>
        </div>

        {/* Summary strip */}
        <div className="earn-breakdown" style={{ marginBottom: 20 }}>
          <div className="eb-row" style={{ fontWeight: 700, fontSize: 16, color: WORKER_OWED > 0 ? 'var(--red)' : 'var(--accent)' }}>
            <span>Outstanding balance</span><span>${WORKER_OWED.toFixed(2)}</span>
          </div>
          <div className="eb-row"><span>Total earned</span><span>${workerEarned.toFixed(2)}</span></div>
          <div className="eb-row" style={{ borderBottom: 'none' }}><span>Total paid</span><span>-${workerPaid.toFixed(2)}</span></div>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEarnModalOpen(true)}>
            <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add earnings
          </button>
          <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPayModalOpen(true)}>
            <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay ${WORKER_OWED.toFixed(2)}
          </button>
        </div>

        {/* History */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>History</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {HISTORY_FILTERS.map(([key, label]) => (
            <button
              key={key}
              className="btn"
              style={{
                padding: '5px 12px', fontSize: 12,
                background: historyFilter === key ? 'var(--text)' : undefined,
                color: historyFilter === key ? '#fff' : undefined,
                borderColor: historyFilter === key ? 'var(--text)' : undefined,
              }}
              onClick={() => setHistoryFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {historyLoading && <div className="empty">Loading…</div>}
          {!historyLoading && groupedRows.length === 0 && (
            <div className="empty">No earnings or payments recorded yet.</div>
          )}
          {!historyLoading && groupedRows.map(group => (
            <div key={group.date}>
              <div style={{ padding: '8px 18px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", background: 'var(--surface2)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {dayLabel(group.date)}
              </div>
              {group.rows.map(row => (
                <div key={row.id} className="activity-row">
                  <div className={`act-icon ${row.color}`}><i className={`ti ${row.icon}`} /></div>
                  <div className="act-body">
                    <div className="act-text">{row.label}</div>
                    {row.sub && <div className="act-time">{row.sub}</div>}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: row.isPayment ? 'var(--text3)' : 'var(--accent)' }}>
                    {row.isPayment ? '-' : '+'}${Math.abs(row.amount).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Confirm delete modal */}
      {confirmDeleteOpen && selectedWorker && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setConfirmDeleteOpen(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-head">
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)' }}>
                <i className="ti ti-alert-triangle" style={{ marginRight: 8 }} />Remove employee
              </div>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                Are you sure you want to permanently remove <strong>{selectedWorker.name}</strong>?
                Their earnings and payment history will also be deleted. This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDeleteOpen(false)}>Cancel</button>
              <button
                className="btn"
                style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}
                disabled={deleteWorker.isPending}
                onClick={() => {
                  deleteWorker.mutate(selectedWorker.id, {
                    onSuccess: () => {
                      setConfirmDeleteOpen(false)
                      setView('list')
                      setSelectedWorker(null)
                    },
                  })
                }}
              >
                <i className="ti ti-trash" style={{ fontSize: 14 }} />
                {deleteWorker.isPending ? 'Removing…' : 'Remove permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit employee modal */}
      {editEmpOpen && selectedWorker && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditEmpOpen(false)}>
          <div className="modal" style={{ width: 400 }}>
            <div className="modal-head">
              <div className="modal-title">Edit — {selectedWorker.name}</div>
              <button className="panel-close-btn" onClick={() => setEditEmpOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input
                  className="form-input"
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Worker name"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Phone</label>
                <input
                  className="form-input"
                  type="tel"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  placeholder="+961 3 000 000"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditEmpOpen(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={updateWorker.isPending || !editName.trim()}
                onClick={() => {
                  updateWorker.mutate(
                    { id: selectedWorker.id, body: { name: editName.trim(), phone: editPhone.trim() || null } },
                    {
                      onSuccess: updated => {
                        setSelectedWorker(updated)
                        setEditEmpOpen(false)
                      },
                    }
                  )
                }}
              >
                <i className="ti ti-check" style={{ fontSize: 14 }} />
                {updateWorker.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay modal */}
      {payModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayModalOpen(false)}>
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <div className="modal-title">Pay {selectedWorker?.name ?? 'worker'}</div>
              <button className="panel-close-btn" onClick={() => setPayModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Amount owed</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>${WORKER_OWED.toFixed(2)}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Amount to pay (USD)</label>
                <input
                  type="number"
                  className="pay-big-input"
                  placeholder="0.00"
                  value={payAmt}
                  onChange={e => setPayAmt(e.target.value)}
                />
              </div>
              <div className={`diff-bar ${barClass}`} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span>{barClass === 'ok' ? 'Full payment' : barClass === 'short' ? 'Partial payment' : 'Enter amount'}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    {diffVal >= 0 ? `+$${diffVal.toFixed(2)} over` : `-$${Math.abs(diffVal).toFixed(2)} short`}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${diffPct}%`, height: '100%', background: barClass === 'ok' ? 'var(--green)' : barClass === 'short' ? 'var(--amber)' : 'var(--bg3)', borderRadius: 3, transition: 'width 0.2s' }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Method</label>
                <div className="method-pills">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m} className={`method-pill${payMethod === m ? ' sel' : ''}`} onClick={() => setPayMethod(m)}>
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
              {payMethod !== 'cash' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Reference # (receipt, transfer, cheque)</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="e.g. CHQ-00214"
                    value={payReference}
                    onChange={e => setPayReference(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPayModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitWorkerPayment} disabled={logPayment.isPending || payAmtNum <= 0}>
                {logPayment.isPending ? 'Saving…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add earnings modal */}
      {earnModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEarnModalOpen(false)}>
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <div className="modal-title">Add earnings — {selectedWorker?.name ?? 'worker'}</div>
              <button className="panel-close-btn" onClick={() => setEarnModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Amount (USD)</label>
                <input
                  type="number"
                  className="pay-big-input"
                  placeholder="0.00"
                  value={earnAmt}
                  onChange={e => setEarnAmt(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-input"
                  value={earnCategory}
                  onChange={e => setEarnCategory(e.target.value as WorkerCostCategory)}
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={earnDate}
                  onChange={e => setEarnDate(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. half day, left early"
                  value={earnNotes}
                  onChange={e => setEarnNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEarnModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitEarning} disabled={createEarning.isPending || (parseFloat(earnAmt) || 0) <= 0}>
                {createEarning.isPending ? 'Saving…' : 'Save earnings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
