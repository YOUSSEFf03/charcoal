import { useState, useRef } from 'react'
import Topbar from '../components/layout/Topbar'
import {
  useWorkers,
  useCreateWorker,
  useLogWorkerPayment,
  useUpdateWorker,
  useDeleteWorker,
  useWorkerAttendance,
  useMarkAttendance,
  useUnmarkAttendance,
} from '../hooks/useWorkers'
import { useBagTypes } from '../hooks/useBagTypes'
import { usePackingSessions } from '../hooks/usePacking'
import type { Worker } from '../types/api'

type View = 'list' | 'worker'

const _now = new Date()
const _firstOfMonth = new Date(_now.getFullYear(), _now.getMonth(), 1)
const MONTH_LABEL = _now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const MONTH_KEY   = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`
const MAY_START_PAD = _firstOfMonth.getDay()
const MAY_DAYS = new Date(_now.getFullYear(), _now.getMonth() + 1, 0).getDate()
const TODAY_DAY = _now.getDate()

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export default function Employees() {
  const [view, setView] = useState<View>('list')

  const workersQ    = useWorkers()
  const bagTypesQ   = useBagTypes()
  const createWorker = useCreateWorker()
  const updateWorker = useUpdateWorker()
  const deleteWorker = useDeleteWorker()
  const logPayment   = useLogWorkerPayment()
  const markAttend   = useMarkAttendance()
  const unmarkAttend = useUnmarkAttendance()

  const workers = workersQ.data ?? []
  const bagTypeNameById = new Map((bagTypesQ.data ?? []).map(b => [b.id, b.name]))

  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payAmt, setPayAmt]     = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [addEmpOpen, setAddEmpOpen]   = useState(false)
  const [editEmpOpen, setEditEmpOpen] = useState(false)
  const [editName, setEditName]   = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [empName, setEmpName]   = useState('')
  const [empPhone, setEmpPhone] = useState('')
  const [empRate, setEmpRate]   = useState('')

  // Daily rate input — local while editing, saved on blur
  const [dailyRateInput, setDailyRateInput] = useState('')
  const dailyRateSaved = useRef(false)

  // Attendance query for selected worker
  const attendanceQ = useWorkerAttendance(selectedWorker?.id, MONTH_KEY)
  const attendedDates = new Set((attendanceQ.data ?? []).map(r => r.date))

  // Packing sessions for the selected worker (auto-detected session days)
  const workerSessionsQ = usePackingSessions(
    selectedWorker ? { workerEntityId: selectedWorker.id, limit: 365 } : undefined
  )
  const sessionDays = new Set<number>(
    (workerSessionsQ.data?.data ?? [])
      .filter(s => {
        const d = new Date(s.date)
        return d.getMonth() === _now.getMonth() && d.getFullYear() === _now.getFullYear()
      })
      .map(s => new Date(s.date).getDate())
  )

  // Build set of all "worked" days for display: session days + attendance days
  const attendedDayNums = new Set<number>(
    Array.from(attendedDates)
      .filter(dateStr => {
        const d = new Date(dateStr)
        return d.getMonth() === _now.getMonth() && d.getFullYear() === _now.getFullYear()
      })
      .map(dateStr => new Date(dateStr).getDate())
  )
  const workerDays = new Set([...sessionDays, ...attendedDayNums])

  // Worker financials from API (include daily earnings)
  const WORKER_OWED    = selectedWorker ? parseFloat(selectedWorker.totalOwed)   : 0
  const workerEarned   = selectedWorker ? parseFloat(selectedWorker.totalEarned) : 0
  const workerPaid     = selectedWorker ? parseFloat(selectedWorker.totalPaid)   : 0
  const pieceEarned    = selectedWorker ? parseFloat(selectedWorker.pieceEarned  ?? '0') : 0
  const dailyEarned    = selectedWorker ? parseFloat(selectedWorker.dailyEarned  ?? '0') : 0

  const payAmtNum = parseFloat(payAmt) || 0
  const diffVal   = payAmtNum - WORKER_OWED
  const diffPct   = WORKER_OWED > 0 ? Math.min(100, (payAmtNum / WORKER_OWED) * 100) : 0
  const barClass  = payAmtNum === 0 ? 'none' : payAmtNum >= WORKER_OWED ? 'ok' : 'short'

  function openWorker(w: Worker) {
    setSelectedWorker(w)
    setDailyRateInput(parseFloat(w.dailyRate ?? '0').toString())
    dailyRateSaved.current = true
    setView('worker')
  }

  function submitNewWorker() {
    if (!empName.trim()) return
    createWorker.mutate(
      { name: empName.trim(), phone: empPhone || null },
      { onSuccess: () => { setAddEmpOpen(false); setEmpName(''); setEmpPhone(''); setEmpRate('') } },
    )
  }

  function submitWorkerPayment() {
    if (!selectedWorker || payAmtNum <= 0) return
    logPayment.mutate(
      { id: selectedWorker.id, body: { amount: payAmtNum.toFixed(2), date: new Date().toISOString().slice(0, 10) } },
      {
        onSuccess: async () => {
          setPayModalOpen(false)
          setPayAmt('')
          const result = await workersQ.refetch()
          const updated = (result.data ?? []).find(w => w.id === selectedWorker?.id)
          if (updated) setSelectedWorker(updated)
        },
      },
    )
  }

  function toggleWorkerDay(d: number) {
    if (!selectedWorker || d > TODAY_DAY) return
    if (sessionDays.has(d)) return // session days are read-only
    const dateStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (attendedDayNums.has(d)) {
      unmarkAttend.mutate({ workerId: selectedWorker.id, date: dateStr })
    } else {
      markAttend.mutate({ workerId: selectedWorker.id, date: dateStr })
    }
  }

  function saveDailyRate() {
    if (!selectedWorker) return
    const rate = parseFloat(dailyRateInput) || 0
    if (rate.toFixed(2) === parseFloat(selectedWorker.dailyRate ?? '0').toFixed(2)) return
    updateWorker.mutate(
      { id: selectedWorker.id, body: { dailyRate: rate.toFixed(2) } },
      {
        onSuccess: updated => {
          setSelectedWorker(updated)
          dailyRateSaved.current = true
        },
      },
    )
  }

  function renderCalendar(days: Set<number>, toggle: (d: number) => void, sessionDaysSet?: Set<number>) {
    const cells = []
    for (let i = 0; i < MAY_START_PAD; i++) {
      cells.push(<div key={`pad-${i}`} className="day-cell" style={{ background: 'transparent', border: 'none', cursor: 'default' }} />)
    }
    for (let d = 1; d <= MAY_DAYS; d++) {
      const worked    = days.has(d)
      const isSession = sessionDaysSet?.has(d) ?? false
      const isToday   = d === TODAY_DAY
      const isFuture  = d > TODAY_DAY
      let cls = 'day-cell'
      if (isFuture)      cls += ' future'
      else if (isSession) cls += ' worked session-day'
      else if (worked)   cls += ' worked manual-day'
      if (isToday) cls += ' today'
      cells.push(
        <div
          key={d}
          className={cls}
          onClick={() => toggle(d)}
          title={isSession ? 'Packing session recorded' : undefined}
          style={isSession ? { cursor: 'default', opacity: 0.85 } : {}}
        >
          {d}
          {isSession && <span style={{ display: 'block', fontSize: 7, lineHeight: 1, marginTop: 1, color: 'var(--accent)', fontWeight: 700 }}>●</span>}
        </div>
      )
    }
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{MONTH_LABEL}</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
            {days.size} days worked
            {sessionDaysSet && sessionDaysSet.size > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace" }}>· {sessionDaysSet.size} packing sessions</span>
            )}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 6 }}>
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", paddingBottom: 4 }}>{d}</div>
          ))}
        </div>
        <div className="days-grid">{cells}</div>
      </div>
    )
  }

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
            const totalBags = (w.totalBagsPacked ?? []).reduce((acc, b) => acc + b.count, 0)
            return (
              <div key={w.id} className="emp-list-card" style={{ cursor: 'pointer' }} onClick={() => openWorker(w)}>
                <div className="emp-big-avatar" style={{ background: 'var(--accent)', color: '#fff' }}>{initials(w.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{w.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Warehouse worker · {totalBags.toLocaleString()} bags packed</div>
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
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input className="form-input" type="tel" placeholder="+961 3 000 000" value={empPhone} onChange={e => setEmpPhone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rate per bag ($)</label>
                    <input className="form-input" type="number" placeholder="0.20" step="0.01" value={empRate} onChange={e => setEmpRate(e.target.value)} />
                  </div>
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
        <button className="btn primary" onClick={() => setPayModalOpen(true)}>
          <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay employee
        </button>
      </Topbar>
      <div className="content">
        <button className="back-btn" onClick={() => setView('list')}>
          <i className="ti ti-arrow-left" /> Back to employees
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
          {/* Left column */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <div className="emp-big-avatar" style={{ background: 'var(--accent)', color: '#fff', width: 56, height: 56, fontSize: 20 }}>{initials(selectedWorker?.name ?? '')}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{selectedWorker?.name ?? '—'}</div>
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>
                  Warehouse worker · Per-bag rate
                  {selectedWorker?.phone && <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono',monospace" }}>{selectedWorker.phone}</span>}
                </div>
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

            {renderCalendar(workerDays, toggleWorkerDay, sessionDays)}

            {/* Per-bag breakdown */}
            <div style={{ marginTop: 24, fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Per-bag breakdown</div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text3)', fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 500 }}>Bag type</th>
                  <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>Bags</th>
                  <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>Rate</th>
                  <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>Earned</th>
                </tr>
              </thead>
              <tbody>
                {(selectedWorker?.totalBagsPacked ?? []).map(b => {
                  const rate = parseFloat(selectedWorker?.ratesPerBagType.find(r => r.bagTypeId === b.bagTypeId)?.ratePerBag ?? '0')
                  return (
                    <tr key={b.bagTypeId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0' }}>{bagTypeNameById.get(b.bagTypeId) ?? b.bagTypeId.slice(0, 8)}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', fontFamily: "'IBM Plex Mono', monospace" }}>{b.count}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text3)' }}>${rate.toFixed(3)}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>${(b.count * rate).toFixed(2)}</td>
                    </tr>
                  )
                })}
                {(selectedWorker?.totalBagsPacked?.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="empty">No bags packed yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Earnings sidebar */}
          <div style={{ position: 'sticky', top: 24 }}>
            <div className="earn-breakdown">
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Earnings summary</div>

              {/* Daily rate input — saved on blur */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.4px' }}>Daily rate</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text3)' }}>$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={dailyRateInput}
                    onChange={e => { setDailyRateInput(e.target.value); dailyRateSaved.current = false }}
                    onBlur={saveDailyRate}
                    placeholder="0.00"
                    style={{ width: '100%', fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--surface2)', color: 'var(--text)' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>/ day</span>
                </div>
              </div>

              <div className="eb-row">
                <span>Days worked</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{selectedWorker?.attendanceDays ?? workerDays.size}</span>
              </div>
              {dailyEarned > 0 && (
                <div className="eb-row" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  <span>Days salary</span><span>${dailyEarned.toFixed(2)}</span>
                </div>
              )}
              {pieceEarned > 0 && (
                <div className="eb-row">
                  <span>Bag earnings</span><span>${pieceEarned.toFixed(2)}</span>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

              <div className="eb-row" style={{ fontWeight: 600 }}>
                <span>Total earned</span><span>${workerEarned.toFixed(2)}</span>
              </div>
              <div className="eb-row" style={{ color: 'var(--text3)' }}>
                <span>Paid out</span><span>-${workerPaid.toFixed(2)}</span>
              </div>
              <div className="eb-row" style={{ color: WORKER_OWED > 0 ? 'var(--red)' : 'var(--accent)', fontWeight: 700, fontSize: 16, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <span>Owed</span><span>${WORKER_OWED.toFixed(2)}</span>
              </div>
              <button className="btn primary" style={{ width: '100%', marginTop: 16, justifyContent: 'center' }} onClick={() => setPayModalOpen(true)}>
                <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay ${WORKER_OWED.toFixed(2)}
              </button>
            </div>
          </div>
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
                Their payment history will also be deleted. This cannot be undone.
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
                <div style={{ display: 'flex', gap: 8 }}>
                  {['cash','whish','omt','bank'].map(m => (
                    <button key={m} className={`method-pill${payMethod === m ? ' sel' : ''}`} onClick={() => setPayMethod(m)}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
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
    </>
  )
}
