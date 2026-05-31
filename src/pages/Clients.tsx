import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClients, useCreateClient, useAddPhone } from '../hooks/useClients'
import { useOverdueClients } from '../hooks/useClients'
import { useCreatePayment } from '../hooks/usePayments'
import type { Client, ClientType, Currency, PhoneLabel, PaymentMethod } from '../types/api'
import { useRate } from '../context/RateContext'

type ClientTab = 'all' | 'alerts' | 'debit'

// Map a client type enum to a badge colour class.
function typeBadgeClass(t: ClientType): string {
  switch (t) {
    case 'restaurant': return 'badge-blue'
    case 'wholesale': return 'badge-purple'
    case 'export': return 'badge-amber'
    case 'shop': return 'badge-green'
    default: return 'badge-gray'
  }
}

// Format a Decimal-string money figure as USD with 2 decimals.
function fmtUsd(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Clients() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<ClientTab>('all')
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [addPhoneOpen, setAddPhoneOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fType, setFType] = useState('All types')
  const [fBalance, setFBalance] = useState('Any balance')
  const [payMethod, setPayMethod] = useState('Cash')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [usdAmt, setUsdAmt] = useState('')
  const [lbpAmt, setLbpAmt] = useState('')
  const rateCtx = useRate()
  const [newRate, setNewRate] = useState(rateCtx.rate.replace(/,/g, ''))
  const RATE = parseInt(rateCtx.rate.replace(/,/g, '')) || 89550
  const [toast, setToast] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPhoneType, setNewPhoneType] = useState('Mobile')
  const [newClientName, setNewClientName] = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [newClientType, setNewClientType] = useState<ClientType>('restaurant')
  const [newClientCurrency] = useState<Currency>('USD')
  const [errName, setErrName] = useState(false)
  const [errPhone, setErrPhone] = useState(false)
  // Client selected for the pay / add-phone modals.
  const [activeClient, setActiveClient] = useState<Client | null>(null)

  // Debounce the free-text search by 300ms before it hits the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Live client list — server-side search + pagination.
  const { data: clientsResp, isLoading, isError, refetch } = useClients({
    search: debouncedSearch || undefined,
    page: 1,
    limit: 100,
  })
  const overdueQ = useOverdueClients()
  const createClient = useCreateClient()
  const addPhone = useAddPhone()
  const createPayment = useCreatePayment()

  const allClients = (clientsResp?.data ?? []).filter(c => c.type !== 'fill_client')
  const totalClients = clientsResp?.total ?? allClients.length
  const overdueClients = overdueQ.data ?? []
  const balanceClients = allClients.filter(c => parseFloat(c.balance) > 0)

  // Client-side type / balance filters layered on top of the searched result set.
  const filteredClients = allClients.filter(c => {
    const matchType = fType === 'All types' || c.type === fType.toLowerCase().replace('-', '_')
    const bal = parseFloat(c.balance)
    const matchBalance = fBalance === 'Any balance' ||
      (fBalance === 'Has balance' && bal > 0) ||
      (fBalance === 'Clear' && bal === 0) ||
      (fBalance === 'Overdue' && c.isOverdue)
    return matchType && matchBalance
  })
  const displayedClients = showAll ? filteredClients : filteredClients.slice(0, 5)

  const usd = parseFloat(usdAmt) || 0
  const lbp = parseFloat(lbpAmt) || 0
  const lbpAsUsd = lbp / RATE
  const totalPay = usd + lbpAsUsd
  const outstanding = activeClient ? parseFloat(activeClient.balance) : 0
  const remaining = outstanding - totalPay

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function submitNewClient() {
    const nameOk = newClientName.trim() !== ''
    const phoneOk = newClientPhone.trim() !== ''
    setErrName(!nameOk)
    setErrPhone(!phoneOk)
    if (!nameOk || !phoneOk) return
    createClient.mutate(
      {
        name: newClientName.trim(),
        type: newClientType,
        currency: newClientCurrency,
        phones: [{ number: newClientPhone.trim(), label: 'mobile', isActive: true, dateAdded: new Date().toISOString() }],
      },
      {
        onSuccess: () => {
          setNewClientOpen(false)
          setNewClientName('')
          setNewClientPhone('')
          showToast('Client added successfully')
        },
      },
    )
  }

  function submitAddPhone() {
    if (!activeClient || !newPhone.trim()) return
    const label = newPhoneType.toLowerCase() === 'whatsapp' ? 'whatsapp' : newPhoneType.toLowerCase() === 'office' ? 'office' : 'mobile'
    addPhone.mutate(
      { id: activeClient.id, body: { number: newPhone.trim(), label: label as PhoneLabel } },
      {
        onSuccess: () => {
          setAddPhoneOpen(false)
          setNewPhone('')
          showToast('Phone number added')
        },
      },
    )
  }

  function submitPayment() {
    if (!activeClient || totalPay <= 0) return
    const method = payMethod.toLowerCase() as PaymentMethod
    createPayment.mutate(
      {
        clientId: activeClient.id,
        amount: usd.toFixed(2),
        currency: 'USD',
        method,
        date: payDate,
      },
      {
        onSuccess: () => {
          setPayModalOpen(false)
          setUsdAmt('')
          setLbpAmt('')
          setPayDate(new Date().toISOString().slice(0, 10))
          showToast(`Payment logged for ${activeClient.name}`)
        },
      },
    )
  }

  return (
    <>
      <Topbar title="Clients">
        <button className="btn amber-btn" onClick={() => setTab('alerts')}>
          <i className="ti ti-bell-ringing" style={{ fontSize: 15 }} /> {overdueClients.length} CRM alerts
        </button>
        <button className="btn primary" onClick={() => setNewClientOpen(true)}>
          <i className="ti ti-plus" style={{ fontSize: 15 }} /> New client
        </button>
      </Topbar>

      {/* Exchange rate bar */}
      <div className="rate-bar">
        <i className="ti ti-currency-dollar" style={{ fontSize: 14, color: 'var(--accent)' }} />
        <span>Exchange rate (owner-controlled):</span>
        <span className="rate-val">$1 = {RATE.toLocaleString()} LBP</span>
        <span className="rate-edit" onClick={() => setRateOpen(true)} style={{ cursor: 'pointer' }}>Update rate</span>
      </div>

      <div className="tabs">
        {([
          { key: 'all' as ClientTab, icon: 'ti-users', label: 'All clients', count: String(totalClients), countCls: '' },
          { key: 'alerts' as ClientTab, icon: 'ti-bell', label: 'CRM alerts', count: String(overdueClients.length), countCls: 'red' },
          { key: 'debit' as ClientTab, icon: 'ti-credit-card', label: 'Balances', count: String(balanceClients.length), countCls: '' },
        ]).map(t => (
          <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} /> {t.label}
            <span className={`tab-count ${t.countCls}`}>{t.count}</span>
          </div>
        ))}
      </div>

      <div className="content">

        {/* ALL CLIENTS */}
        {tab === 'all' && (
          <div className="fade-up">
            <div className="filters">
              <div className="filter-input">
                <i className="ti ti-search" />
                <input type="text" placeholder="Search name, phone…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="filter-select" value={fType} onChange={e => setFType(e.target.value)}>
                <option>All types</option>
                <option>Restaurant</option><option>Shop</option><option>Wholesale</option>
                <option>Walk-in</option><option>Corporate</option><option>Export</option>
              </select>
              <select className="filter-select" value={fBalance} onChange={e => setFBalance(e.target.value)}>
                <option>Any balance</option>
                <option>Has balance</option><option>Clear</option><option>Overdue</option>
              </select>
              <div className="filter-sep" />
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>{filteredClients.length} clients</span>
            </div>
            <div className="card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th><th>Type</th><th>Last order</th><th>Avg order</th>
                    <th>Balance (USD equiv.)</th><th>Currency</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && [0, 1, 2].map(i => (
                    <tr key={i}>
                      <td><div className="skeleton" style={{ width: '70%', height: 13, marginBottom: 4 }} /><div className="skeleton" style={{ width: '45%', height: 11 }} /></td>
                      <td><div className="skeleton" style={{ width: 60, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 70, height: 13 }} /></td>
                      <td><div className="skeleton" style={{ width: 50, height: 13 }} /></td>
                      <td><div className="skeleton" style={{ width: 80, height: 13 }} /></td>
                      <td><div className="skeleton" style={{ width: 40, height: 13 }} /></td>
                      <td><div className="skeleton" style={{ width: 60, height: 16 }} /></td>
                      <td></td>
                    </tr>
                  ))}
                  {isError && (
                    <tr>
                      <td colSpan={8} className="empty">
                        Failed to load clients.
                        <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetch()}>Retry</button></div>
                      </td>
                    </tr>
                  )}
                  {!isLoading && !isError && displayedClients.map(c => (
                    <tr key={c.id} onClick={() => navigate('/clients/' + c.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.phones.find(p => p.isActive)?.number ?? c.phones[0]?.number ?? '—'}</div>
                      </td>
                      <td><span className={`badge ${typeBadgeClass(c.type)}`}>{c.type}</span></td>
                      <td style={{ color: 'var(--text2)' }}>{fmtDate(c.lastOrderDate)}</td>
                      <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{c.avgOrderDays ? `${Math.round(parseFloat(c.avgOrderDays))} days` : '—'}</td>
                      <td>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: parseFloat(c.balance) > 0 ? (c.isOverdue ? 'var(--red)' : 'var(--accent2)') : 'var(--text)' }}>{fmtUsd(c.balance)}</div>
                      </td>
                      <td><span className="badge badge-gray">{c.currency}</span></td>
                      <td><span className={`badge ${c.isOverdue ? 'badge-red' : parseFloat(c.balance) > 0 ? 'badge-gray' : 'badge-green'}`}>{c.isOverdue ? 'Overdue' : parseFloat(c.balance) > 0 ? 'On account' : 'Clear'}</span></td>
                      <td><i className="ti ti-chevron-right" style={{ color: 'var(--text3)' }} /></td>
                    </tr>
                  ))}
                  {!isLoading && !isError && filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text3)' }}>
                        <i className="ti ti-users" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                        <div>No clients match your search</div>
                        <button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => { setSearch(''); setFType('All types'); setFBalance('Any balance') }}>Clear filters</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {displayedClients.length} of {filteredClients.length} clients</span>
                <button style={{ fontSize: 12, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowAll(s => !s)}>
                  {showAll ? 'Show less ↑' : 'Show all →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CRM ALERTS */}
        {tab === 'alerts' && (
          <div className="fade-up">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Clients overdue for an order</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>Sorted by most overdue first. Click to view full profile — no action taken from here.</div>
              </div>
            </div>
            {overdueQ.isLoading && [0, 1, 2].map(i => (
              <div className="alert-card" key={i}>
                <div className="alert-inner">
                  <div className="alert-stripe" style={{ background: 'var(--border)' }} />
                  <div className="alert-av" style={{ background: 'var(--surface2)' }}><div className="skeleton" style={{ width: 24, height: 24, borderRadius: 6 }} /></div>
                  <div className="alert-body"><div className="skeleton" style={{ width: '40%', height: 14, marginBottom: 6 }} /><div className="skeleton" style={{ width: '60%', height: 12 }} /></div>
                </div>
              </div>
            ))}
            {overdueQ.isError && (
              <div className="empty">
                Failed to load CRM alerts.
                <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => overdueQ.refetch()}>Retry</button></div>
              </div>
            )}
            {!overdueQ.isLoading && !overdueQ.isError && overdueClients.length === 0 && (
              <div className="empty">No clients are overdue right now.</div>
            )}
            {!overdueQ.isLoading && !overdueQ.isError && overdueClients.map(a => {
              const initials = a.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
              const pref = a.preferredTypes[0] ? `${a.preferredTypes[0].charcoalType} · ${a.preferredTypes[0].grade}` : null
              return (
                <div className="alert-card" key={a.id} onClick={() => navigate('/clients/' + a.id)} style={{ cursor: 'pointer' }}>
                  <div className="alert-inner">
                    <div className="alert-stripe" style={{ background: 'var(--accent2)' }} />
                    <div className="alert-av" style={{ background: 'var(--accent2-bg)', color: 'var(--accent2)' }}>{initials}</div>
                    <div className="alert-body">
                      <div className="alert-name2">{a.name}</div>
                      <div className="alert-meta2">
                        <span className={`badge ${typeBadgeClass(a.type)}`}>{a.type}</span>
                        <span>Last order: <strong>{fmtDate(a.lastOrderDate)}</strong></span>
                        {a.avgOrderDays && <span>Avg: every <strong>{Math.round(parseFloat(a.avgOrderDays))} days</strong></span>}
                      </div>
                      {pref && (
                        <div style={{ marginTop: 6 }}>
                          <span className="pref-tag" style={{ fontSize: 11 }}>
                            <i className="ti ti-flame" style={{ fontSize: 11, color: 'var(--accent2)' }} /> {pref}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="alert-right">
                      <div className="alert-days2" style={{ color: 'var(--accent2)' }}>overdue</div>
                      <div className="alert-days-lbl">CRM alert</div>
                      <div className="alert-bal" style={{ color: 'var(--accent2)' }}>owes {fmtUsd(a.balance)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* BALANCES */}
        {tab === 'debit' && (
          <div className="fade-up">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
              {(() => {
                const totalOwed = balanceClients.reduce((acc, c) => acc + parseFloat(c.balance), 0)
                const overdueOwed = overdueClients.reduce((acc, c) => acc + parseFloat(c.balance), 0)
                const cards = [
                  { label: 'TOTAL OWED', val: fmtUsd(String(totalOwed)), vColor: 'var(--accent2)', sub: `${balanceClients.length} clients` },
                  { label: 'OVERDUE', val: fmtUsd(String(overdueOwed)), vColor: 'var(--red)', sub: `${overdueClients.length} clients` },
                  { label: 'IN LBP EQUIV.', val: Math.round(totalOwed * RATE).toLocaleString(), vSize: 18, sub: `at ${RATE.toLocaleString()} rate` },
                  { label: 'RATE', val: parseInt(newRate).toLocaleString(), vSize: 22, sub: 'Click to update →', subColor: 'var(--accent)', click: true },
                ] as { label: string; val: string; vColor?: string; vSize?: number; sub: string; subColor?: string; click?: boolean }[]
                return cards.map((s, i) => (
                  <div key={i} onClick={s.click ? () => setRateOpen(true) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', cursor: s.click ? 'pointer' : undefined }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: s.vSize ?? 24, fontWeight: 600, letterSpacing: -1, color: s.vColor }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: s.subColor ?? 'var(--text3)', marginTop: 2 }}>{s.sub}</div>
                  </div>
                ))
              })()}
            </div>
            <div className="card">
              <table className="data-table">
                <thead><tr><th>Client</th><th>Type</th><th>Currency</th><th>Balance USD</th><th>Balance LBP</th><th>Status</th></tr></thead>
                <tbody>
                  {isLoading && [0, 1, 2].map(i => (
                    <tr key={i}><td colSpan={6}><div className="skeleton" style={{ width: '100%', height: 16 }} /></td></tr>
                  ))}
                  {isError && (
                    <tr><td colSpan={6} className="empty">Failed to load balances.<div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetch()}>Retry</button></div></td></tr>
                  )}
                  {!isLoading && !isError && balanceClients.map(c => (
                    <tr key={c.id} onClick={() => navigate('/clients/' + c.id)} style={{ cursor: 'pointer' }}>
                      <td><div style={{ fontWeight: 500 }}>{c.name}</div></td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{c.type}</td>
                      <td><span className="badge badge-gray">{c.currency}</span></td>
                      <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: c.isOverdue ? 'var(--red)' : 'var(--text)' }}>{fmtUsd(c.balance)}</td>
                      <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text2)' }}>{Math.round(parseFloat(c.balance) * RATE).toLocaleString()} LL</td>
                      <td><span className={`badge ${c.isOverdue ? 'badge-red' : 'badge-gray'}`}>{c.isOverdue ? 'Overdue' : 'On account'}</span></td>
                    </tr>
                  ))}
                  {!isLoading && !isError && balanceClients.length === 0 && (
                    <tr><td colSpan={6} className="empty">No outstanding balances.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* LOG PAYMENT MODAL */}
      {payModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayModalOpen(false)}>
          <div className="modal" style={{ width: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Log payment{activeClient ? ` — ${activeClient.name}` : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  Outstanding: <strong style={{ color: 'var(--red)' }}>{fmtUsd(String(outstanding))}</strong>
                  &nbsp;·&nbsp; Rate: <strong>{parseInt(newRate).toLocaleString()} LL/$</strong>
                </div>
              </div>
              <button className="close-btn" onClick={() => setPayModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Payment date</label>
                <input className="form-input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount — enter USD, LBP, or both</label>
                <div className="split-box">
                  <div className="split-row">
                    <span className="split-label">USD</span>
                    <input className="split-input" type="number" placeholder="0.00" value={usdAmt} onChange={e => setUsdAmt(e.target.value)} />
                    <span className="split-curr">$</span>
                    <span className="split-eq">{usd > 0 ? `= $${usd.toFixed(2)}` : ''}</span>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text3)', padding: '2px 0' }}>+ (optional)</div>
                  <div className="split-row">
                    <span className="split-label">LBP</span>
                    <input className="split-input" type="number" placeholder="0" value={lbpAmt} onChange={e => setLbpAmt(e.target.value)} />
                    <span className="split-curr">LL</span>
                    <span className="split-eq">{lbp > 0 ? `≈ $${lbpAsUsd.toFixed(2)}` : ''}</span>
                  </div>
                </div>
                {totalPay > 0 && (
                  <>
                    <div className="total-bar">
                      <span className="total-label">Total received (USD equivalent)</span>
                      <span className="total-value">${totalPay.toFixed(2)}</span>
                    </div>
                    <div style={{ marginTop: 6, padding: '8px 12px', background: remaining <= 0 ? 'var(--accent-bg)' : 'var(--accent2-bg)', borderRadius: 'var(--radius)', fontSize: 12, color: remaining <= 0 ? 'var(--accent)' : 'var(--accent2)', fontFamily: "'IBM Plex Mono', monospace", display: 'flex', justifyContent: 'space-between' }}>
                      <span>Remaining after this payment</span>
                      <span>{remaining > 0 ? `$${remaining.toFixed(2)} still owed` : 'Fully paid ✓'}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Method</label>
                <div className="method-pills">
                  {['Cash', 'Whish', 'OMT'].map(m => (
                    <div key={m} className={`method-pill ${payMethod === m ? 'sel' : ''}`} onClick={() => setPayMethod(m)}>{m}</div>
                  ))}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" type="text" placeholder="e.g. paid by Georges at warehouse" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPayModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitPayment} disabled={createPayment.isPending || totalPay <= 0}>
                {createPayment.isPending ? 'Saving…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW CLIENT MODAL */}
      {newClientOpen && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) { setNewClientOpen(false); setErrName(false); setErrPhone(false) } }}>
          <div className="modal" style={{ width: 520, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <div className="modal-title">New client</div>
              <button className="panel-close-btn" onClick={() => { setNewClientOpen(false); setErrName(false); setErrPhone(false) }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Client name</label>
                <input className="form-input" type="text" placeholder="Restaurant, company, or person name…" value={newClientName} onChange={e => { setNewClientName(e.target.value); setErrName(false) }} />
                {errName && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>Name is required</div>}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={newClientType} onChange={e => setNewClientType(e.target.value as ClientType)}>
                    <option value="restaurant">Restaurant</option><option value="shop">Shop</option><option value="wholesale">Wholesale</option>
                    <option value="walk_in">Walk-in</option><option value="corporate">Corporate</option><option value="export">Export</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Payment terms</label>
                  <select className="form-input">
                    <option>Net 14 days</option><option>Net 30 days</option><option>On delivery</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Primary phone</label>
                <input className="form-input" type="tel" placeholder="+961 3 000 000" value={newClientPhone} onChange={e => { setNewClientPhone(e.target.value); setErrPhone(false) }} />
                {errPhone && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>Phone is required</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Preferred payment</label>
                <div className="method-pills">
                  {['Cash', 'Whish', 'OMT'].map(m => (
                    <div key={m} className={`method-pill ${payMethod === m ? 'sel' : ''}`} onClick={() => setPayMethod(m)}>{m}</div>
                  ))}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes (optional)</label>
                <input className="form-input" type="text" placeholder="Delivery instructions, contacts…" />
              </div>
            </div>
            <div className="modal-footer" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)' }}>
              <button className="btn" onClick={() => { setNewClientOpen(false); setErrName(false); setErrPhone(false) }}>Cancel</button>
              <button className="btn primary" onClick={submitNewClient} disabled={createClient.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {createClient.isPending ? 'Adding…' : 'Add client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPDATE RATE MODAL */}
      {rateOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setRateOpen(false)}>
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <div className="modal-title">Update exchange rate</div>
              <button className="panel-close-btn" onClick={() => setRateOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>This rate is used to convert LBP payments to USD across all clients and invoices.</div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">New rate (LL per $1 USD)</label>
                <input className="form-input" type="number" value={newRate} onChange={e => setNewRate(e.target.value)} />
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Current: {parseInt(newRate).toLocaleString()} LL / $1
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setRateOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={() => { rateCtx.setRate(parseInt(newRate).toLocaleString()); setRateOpen(false); showToast(`Rate updated to ${parseInt(newRate).toLocaleString()} LL/$`) }}><i className="ti ti-check" style={{ fontSize: 14 }} /> Save rate</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD PHONE MODAL */}
      {addPhoneOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAddPhoneOpen(false)}>
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Add phone number</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{activeClient?.name ?? ''}</div>
              </div>
              <button className="panel-close-btn" onClick={() => setAddPhoneOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Phone number</label>
                <input className="form-input" type="tel" placeholder="+961 3 000 000" value={newPhone} onChange={e => setNewPhone(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Mobile', 'WhatsApp', 'Office', 'Other'].map(t => (
                    <div key={t} className="stop-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', background: newPhoneType === t ? 'var(--text)' : 'transparent', color: newPhoneType === t ? '#fff' : 'var(--text2)', borderColor: newPhoneType === t ? 'var(--text)' : 'var(--border)', padding: '6px 0', borderRadius: 'var(--radius)', border: '1px solid', fontSize: 12 }} onClick={() => setNewPhoneType(t)}>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAddPhoneOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitAddPhone} disabled={addPhone.isPending || !newPhone.trim()}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {addPhone.isPending ? 'Adding…' : 'Add number'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
