import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClients, useCreateClient } from '../hooks/useClients'

type FillClient = {
  id: string; initials: string; color: string; name: string; nameAr: string
  statusCls: string; statusLabel: string; balance: number; balCls: string
  bagsYTD: number; profitYTD: number; topCls: string; isActive: boolean
}

type Tab = 'all' | 'active' | 'balance' | 'historic'

const CLIENT_TYPES = ['restaurant', 'catering', 'corporate', 'export', 'wholesale', 'hotel', 'other']
const COLORS = ['', 'green', 'blue', 'amber']

function makeInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

type NewForm = {
  name: string; nameAr: string; type: string; currency: 'USD' | 'LBP'; color: string
  contactName: string; contactRole: string; contactPhone: string
  notes: string
}

const EMPTY_FORM: NewForm = {
  name: '', nameAr: '', type: 'catering', currency: 'USD', color: '',
  contactName: '', contactRole: '', contactPhone: '',
  notes: '',
}

export default function FillClients() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState<NewForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof NewForm, string>>>({})
  const [toast, setToast] = useState('')

  // Live clients sourced for the fill-client grid (no fill-specific API; map the
  // shared Client list into the card view-model gracefully).
  const { data: clientsResp, isLoading, isError, refetch } = useClients({ search: search || undefined, limit: 100, type: 'fill_client' })
  const createClient = useCreateClient()
  const clients: FillClient[] = (clientsResp?.data ?? []).map(c => {
    const bal = parseFloat(c.balance)
    const active = (c as any).isActive !== false
    return {
      id: c.id,
      initials: makeInitials(c.name),
      color: '',
      name: c.name,
      nameAr: c.type,
      statusCls: !active ? 'gray' : c.isOverdue ? 'amber' : 'green',
      statusLabel: !active ? 'inactive' : c.isOverdue ? 'overdue' : 'active',
      balance: bal,
      balCls: bal > 0 ? 'amber' : 'zero',
      bagsYTD: 0,
      profitYTD: 0,
      topCls: !active ? 'dormant' : '',
      isActive: active,
    }
  })

  const filtered = clients.filter(c => {
    if (tab === 'active') return c.isActive
    if (tab === 'balance') return c.balance > 0
    if (tab === 'historic') return !c.isActive
    return true
  })

  function openNew() {
    setForm(EMPTY_FORM)
    setErrors({})
    setShowNew(true)
  }

  function setF<K extends keyof NewForm>(k: K, v: NewForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
    if (errors[k]) setErrors(e => { const n = { ...e }; delete n[k]; return n })
  }

  function validate(): boolean {
    const e: Partial<Record<keyof NewForm, string>> = {}
    if (!form.name.trim()) e.name = 'Client name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function save() {
    if (!validate()) return
    createClient.mutate(
      {
        name: form.name.trim(),
        type: 'fill_client',
        currency: form.currency as any,
        notes: form.notes.trim() || null,
        phones: form.contactPhone.trim()
          ? [{ number: form.contactPhone.trim(), label: 'mobile', isActive: true, dateAdded: new Date().toISOString() }]
          : [],
      },
      {
        onSuccess: (created) => {
          setShowNew(false)
          setToast(`Fill client "${form.name.trim()}" created`)
          setTimeout(() => setToast(''), 2800)
          navigate(`/fill-clients/${created.id}`)
        },
        onError: (err: any) => {
          setToast(err?.error ?? 'Failed to create client')
          setTimeout(() => setToast(''), 3000)
        },
      }
    )
  }

  return (
    <>
      <Topbar title="Fill clients">
        <span className="page-sub" style={{ color: 'var(--text3)' }}>companies that bring their own bags</span>
        <button className="btn" style={{ marginLeft: 'auto' }}><i className="ti ti-download" style={{ fontSize: 15 }} /> Export</button>
        <button className="btn primary" onClick={openNew}><i className="ti ti-plus" style={{ fontSize: 15 }} /> New fill client</button>
      </Topbar>
      <div className="content">

        {/* KPIs */}
        <div className="kpi-row">
          <div className="kpi-tile">
            <div className="kpi-tile-label">Fill clients</div>
            <div className="kpi-tile-value">{isLoading ? '…' : clients.length}</div>
            <div className="kpi-tile-sub">registered</div>
          </div>
          <div className="kpi-tile">
            <div className="kpi-tile-label">Bags filled this month</div>
            <div className="kpi-tile-value">—</div>
            <div className="kpi-tile-sub">no fill jobs yet</div>
          </div>
          <div className="kpi-tile green">
            <div className="kpi-tile-label">Profit this month</div>
            <div className="kpi-tile-value">—</div>
            <div className="kpi-tile-sub">no fill jobs yet</div>
          </div>
          <div className="kpi-tile amber">
            <div className="kpi-tile-label">Outstanding</div>
            <div className="kpi-tile-value">${clients.filter(c => c.balance > 0).reduce((s, c) => s + c.balance, 0).toFixed(2)}</div>
            <div className="kpi-tile-sub">{clients.filter(c => c.balance > 0).length} clients owe us</div>
          </div>
        </div>

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
          <div className="search-wrap">
            <i className="ti ti-search" />
            <input type="text" placeholder="Search fill clients…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="seg">
            {([
              { key: 'all',     label: 'All',          count: clients.length },
              { key: 'active',  label: 'Active',        count: clients.filter(c => c.isActive).length },
              { key: 'balance', label: 'With balance',  count: clients.filter(c => c.balance > 0).length },
              { key: 'historic',label: 'Historic',      count: clients.filter(c => !c.isActive).length },
            ] as { key: Tab; label: string; count: number }[]).map(t => (
              <div key={t.key}
                className={`seg-opt${tab === t.key ? ' sel' : ''}`}
                onClick={() => setTab(t.key)}
                style={{ cursor: 'pointer' }}>
                {t.label}
                {t.count > 0 && <span style={{ color: 'var(--text3)', marginLeft: 4 }}>{t.count}</span>}
              </div>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>sort: most recent activity</div>
        </div>

        {/* Grid */}
        {isError && (
          <div className="empty">Failed to load clients.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => refetch()}>Retry</button></div></div>
        )}
        <div className="square-grid">
          {isLoading && [0, 1, 2].map(i => (
            <div key={i} className="sq"><div className="skeleton" style={{ width: '60%', height: 16, marginBottom: 10 }} /><div className="skeleton" style={{ width: '40%', height: 12 }} /></div>
          ))}
          {!isLoading && filtered.map(c => (
            <a key={c.id} className={`sq ${c.topCls}`} onClick={() => navigate(`/fill-clients/${c.id}`)} style={{ cursor: 'pointer' }}>
              <div className="sq-head">
                <div className={`sq-mono ${c.color}`}>{c.initials}</div>
                <span className={`sq-status ${c.statusCls}`}>
                  {c.statusCls === 'active' && <i className="ti ti-stack-2" style={{ fontSize: 10 }} />}
                  {c.statusCls === 'amber' && <i className="ti ti-alert-circle" style={{ fontSize: 10 }} />}
                  {c.statusLabel}
                </span>
              </div>
              <div>
                <div className={`sq-name ${c.topCls === 'dormant' ? 'sq-name' : ''}`} style={c.topCls === 'dormant' ? { color: 'var(--text2)' } : {}}>
                  {c.name}
                </div>
                {c.nameAr && (
                  <div className="sq-name-ar" dir={c.nameAr.includes('·') ? undefined : 'rtl'}
                    style={{ fontFamily: c.nameAr.match(/[؀-ۿ]/) ? "'Noto Sans Arabic',sans-serif" : undefined }}>
                    {c.nameAr}
                  </div>
                )}
              </div>
              <div className="sq-balance">
                <span className="sq-balance-label">balance</span>
                <span className={`sq-balance-val ${c.balCls}`}>${c.balance.toFixed(2)}</span>
              </div>
              <div className="sq-stats">
                <div>
                  <div className="sq-stat-k">Bags filled YTD</div>
                  <div className="sq-stat-v" style={c.topCls === 'dormant' ? { color: 'var(--text3)' } : {}}>{c.bagsYTD.toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="sq-stat-k">Profit YTD</div>
                  <div className={`sq-stat-v ${c.topCls === 'dormant' ? '' : 'green'}`} style={c.topCls === 'dormant' ? { color: 'var(--text3)' } : {}}>${c.profitYTD}</div>
                </div>
              </div>
            </a>
          ))}

          {/* Add new */}
          <div className="sq add" onClick={openNew} style={{ cursor: 'pointer' }}>
            <div className="add-icon"><i className="ti ti-plus" /></div>
            <div className="add-label">New fill client</div>
            <div className="add-hint">company that brings own bags</div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textAlign: 'center', padding: 10 }}>
          {clients.length} fill client{clients.length !== 1 ? 's' : ''}
        </div>

      </div>

      {/* NEW FILL CLIENT MODAL */}
      {showNew && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowNew(false)}>
          <div className="modal" style={{ width: 640, maxWidth: '96vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* Dark header */}
            <div className="compose-head">
              <div>
                <div className="compose-title">New fill client</div>
                <div className="compose-sub">company that supplies its own bags for filling</div>
              </div>
              <button className="compose-close" aria-label="Close" onClick={() => setShowNew(false)}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>

              {/* SECTION 1 — Identity */}
              <div className="compose-section">
                <div className="step-num">1</div>
                <div className="stitle">Client identity</div>
                <div className="ssub">Name, type, and display settings</div>
              </div>
              <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-grid">
                  <div className="field">
                    <span className="field-label">Client name <span style={{ color: 'var(--red)' }}>*</span></span>
                    <input
                      className={`input${errors.name ? ' input-err' : ''}`}
                      value={form.name}
                      onChange={e => setF('name', e.target.value)}
                      placeholder="e.g. Al Sahha Catering"
                      autoFocus
                    />
                    {errors.name && <span style={{ fontSize: 11, color: 'var(--red)', marginTop: 3 }}>{errors.name}</span>}
                  </div>
                  <div className="field">
                    <span className="field-label">Arabic name <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>(optional)</span></span>
                    <input
                      className="input"
                      value={form.nameAr}
                      onChange={e => setF('nameAr', e.target.value)}
                      placeholder="الاسم بالعربي"
                      dir="rtl"
                      style={{ fontFamily: "'Noto Sans Arabic',sans-serif" }}
                    />
                  </div>
                  <div className="field">
                    <span className="field-label">Type / category</span>
                    <select className="select" value={form.type} onChange={e => setF('type', e.target.value)}>
                      {CLIENT_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <span className="field-label">Currency</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['USD', 'LBP'] as const).map(c => (
                        <div key={c} onClick={() => setF('currency', c)}
                          style={{ flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 'var(--radius)', border: '1px solid', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: "'IBM Plex Mono',monospace",
                            background: form.currency === c ? 'var(--text)' : 'transparent',
                            color: form.currency === c ? '#fff' : 'var(--text2)',
                            borderColor: form.currency === c ? 'var(--text)' : 'var(--border)' }}>
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">Avatar color</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {COLORS.map(c => (
                        <div key={c || 'default'} onClick={() => setF('color', c)}
                          style={{ width: 32, height: 32, borderRadius: 8, cursor: 'pointer', border: `2px solid ${form.color === c ? 'var(--text)' : 'var(--border)'}`,
                            background: c === 'green' ? 'var(--accent-bg)' : c === 'blue' ? 'var(--blue-bg)' : c === 'amber' ? 'var(--accent2-bg)' : 'var(--surface2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600,
                            color: c === 'green' ? 'var(--accent)' : c === 'blue' ? 'var(--blue)' : c === 'amber' ? 'var(--accent2)' : 'var(--text2)' }}>
                          {(makeInitials(form.name) || 'AB').slice(0, 2)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2 — Contact */}
              <div className="compose-section">
                <div className="step-num">2</div>
                <div className="stitle">Primary contact</div>
                <div className="ssub">optional — can add more contacts in the client detail page</div>
              </div>
              <div style={{ padding: '16px 22px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  <div className="field">
                    <span className="field-label">Name</span>
                    <input className="input" value={form.contactName} onChange={e => setF('contactName', e.target.value)} placeholder="e.g. Bassam Younes" />
                  </div>
                  <div className="field">
                    <span className="field-label">Role</span>
                    <input className="input" value={form.contactRole} onChange={e => setF('contactRole', e.target.value)} placeholder="operations manager" />
                  </div>
                  <div className="field">
                    <span className="field-label">Phone</span>
                    <input className="input" type="tel" value={form.contactPhone} onChange={e => setF('contactPhone', e.target.value)} placeholder="+961 70 000 000" style={{ fontFamily: "'IBM Plex Mono',monospace" }} />
                  </div>
                </div>
              </div>

              {/* SECTION 3 — Notes */}
              <div className="compose-section">
                <div className="step-num">3</div>
                <div className="stitle">Notes</div>
                <div className="ssub">delivery instructions, preferences, special arrangements</div>
              </div>
              <div style={{ padding: '16px 22px 24px' }}>
                <textarea
                  className="textarea"
                  value={form.notes}
                  onChange={e => setF('notes', e.target.value)}
                  placeholder="e.g. Bring their own bags for 2kg. Only Grade A charcoal. Prefer morning pickup."
                  style={{ minHeight: 72, width: '100%' }}
                />
              </div>

            </div>

            {/* Footer */}
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                bag specs &amp; pricing added later via fill jobs
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
                <button className="btn primary" onClick={save}>
                  <i className="ti ti-check" style={{ fontSize: 14 }} /> Create fill client
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: '#fff', padding: '10px 20px', borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {toast}
        </div>
      )}
    </>
  )
}
