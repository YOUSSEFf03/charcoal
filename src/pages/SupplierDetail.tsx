import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useSupplier } from '../hooks/useSuppliers'
import { useContainers } from '../hooks/useContainers'

function initialsOf(name?: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

function money(n: number) { return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

/* ── component ─────────────────────────────────────── */
export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Real supplier data from the API.
  const supplierQuery = useSupplier(id ?? '')
  const supplier = supplierQuery.data

  // Containers for this supplier from the API.
  const containersQ = useContainers({ supplierId: id ?? '', limit: 20 })

  // Activity feed derived from real supplier fields.
  const activity = supplier
    ? [
        { kind: 'blue', ic: 'ti-ship', text: `<strong>${supplier.containerCount}</strong> container${supplier.containerCount === 1 ? '' : 's'} received from this supplier`, when: 'all time' },
        { kind: 'green', ic: 'ti-cash', text: `Total spent <strong>$${Number(supplier.totalSpentUsd).toLocaleString()}</strong>`, when: 'all time' },
        { kind: 'amber', ic: 'ti-package', text: `<strong>${supplier.activeLotCount}</strong> active stock lot${supplier.activeLotCount === 1 ? '' : 's'} on hand`, when: 'current' },
        ...(supplier.contactPersons.length > 0
          ? [{ kind: '', ic: 'ti-users', text: `<strong>${supplier.contactPersons.length}</strong> contact${supplier.contactPersons.length === 1 ? '' : 's'} on file`, when: '' }]
          : []),
        { kind: '', ic: 'ti-edit', text: `Supplier record created`, when: new Date(supplier.createdAt).toLocaleDateString() },
      ]
    : []

  const [shownCont, setShownCont] = useState(5)
  const [payOpen, setPayOpen] = useState(false)
  const [payAmt, setPayAmt] = useState('')
  const [payMethod, setPayMethod] = useState('bank transfer')
  const [payDate, setPayDateVal] = useState(new Date().toISOString().slice(0, 10))
  const [payRef, setPayRef] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  function copyText(s: string) {
    navigator.clipboard?.writeText(s).then(() => showToast(`copied "${s}"`))
  }

  function savePay() {
    const amt = parseFloat(payAmt)
    if (!amt || amt <= 0) { showToast('Enter amount'); return }
    setPayOpen(false)
    showToast(`Payment ${money(amt)} recorded`)
    setPayAmt('')
  }

  const containers = containersQ.data?.data ?? []

  if (supplierQuery.isLoading) {
    return (
      <>
        <Topbar title="Supplier" />
        <div className="content">
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
            <i className="ti ti-loader" style={{ fontSize: 22 }} /> Loading supplier…
          </div>
        </div>
      </>
    )
  }

  if (supplierQuery.isError) {
    return (
      <>
        <Topbar title="Supplier" />
        <div className="content">
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 22 }} /> Couldn't load this supplier.
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar title={supplier?.name ?? 'Supplier'}>
        <button className="btn"><i className="ti ti-edit" style={{ fontSize: 15 }} /> Change info</button>
        <button className="btn primary" onClick={() => setPayOpen(true)}>
          <i className="ti ti-cash" style={{ fontSize: 15 }} /> Pay supplier
        </button>
      </Topbar>
      <div className="content">

        {/* HERO */}
        <div className="page-header" style={{ flexWrap: 'wrap', gap: 18 }}>
          <div className="sup-hero">
            <div className="sup-mono" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{initialsOf(supplier?.name)}</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{supplier?.name ?? '—'}</h1>
              {supplier?.notes && (
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{supplier.notes}</div>
              )}
              <div className="page-header-meta">
                {supplier?.country && (
                  <span className="badge badge-gray">{supplier.country}</span>
                )}
                {supplier?.paymentTerms && (
                  <span className="meta-row"><i className="ti ti-calendar" /> {supplier.paymentTerms}</span>
                )}
                {supplier?.leadTimeDays != null && (
                  <span className="meta-row"><i className="ti ti-truck-delivery" /> {supplier.leadTimeDays}d lead time</span>
                )}
              </div>
            </div>
          </div>
          <div className="kpi-strip" style={{ minWidth: 0 }}>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Containers received</div>
              <div className="kpi-tile-value">{supplier?.containerCount ?? '—'}</div>
              <div className="kpi-tile-sub">all time</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Total spent</div>
              <div className="kpi-tile-value">{supplier ? `$${Number(supplier.totalSpentUsd).toLocaleString()}` : '—'}</div>
              <div className="kpi-tile-sub">all time</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Active lots</div>
              <div className="kpi-tile-value">{supplier?.activeLotCount ?? '—'}</div>
              <div className="kpi-tile-sub">in warehouse</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">We owe them</div>
              <div className="kpi-tile-value">—</div>
              <div className="kpi-tile-sub">not tracked</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Avg price / kg</div>
              <div className="kpi-tile-value">—</div>
              <div className="kpi-tile-sub">not tracked</div>
            </div>
          </div>
        </div>

        {/* BALANCE CARD */}
        <div className="balance-card">
          <div className="bcell">
            <span className="lbl">Money we still owe</span>
            <span className="v">—</span>
            <span className="sub">not tracked in this version</span>
          </div>
          <div className="vline" />
          <div className="bcell">
            <span className="lbl">Money paid this year</span>
            <span className="v">—</span>
            <span className="sub">not tracked in this version</span>
          </div>
          <div className="vline" />
          <div className="bcell">
            <span className="lbl">Average wait to pay</span>
            <span className="v">—</span>
            <span className="sub">not tracked</span>
          </div>
          <div className="vline" />
          <div className="pay-action">
            <button className="btn green" onClick={() => setPayOpen(true)} style={{ height: 42, fontSize: 14, fontWeight: 600, justifyContent: 'center' }}>
              <i className="ti ti-cash" style={{ fontSize: 16 }} /> Pay supplier
            </button>
            <span style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', fontFamily: "'IBM Plex Mono',monospace" }}>USD · LBP · wire · cash</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

          {/* LEFT */}
          <div className="stack">

            {/* Charcoal types */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-flame" /> What we buy
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{supplier?.charcoalTypes.length ?? 0} types</span>
                </div>
              </div>
              {(supplier?.charcoalTypes ?? []).length === 0 ? (
                <div className="empty">No charcoal types recorded for this supplier</div>
              ) : (
                <>
                  <div className="ctype-row head">
                    <span>Charcoal type</span><span>Grade</span>
                  </div>
                  {(supplier?.charcoalTypes ?? []).map((t, i) => {
                    const gradeCls = `grade-${t.grade}` as 'grade-A' | 'grade-B' | 'grade-C'
                    return (
                      <div className="ctype-row" key={i}>
                        <span className="type-name">{t.type}</span>
                        <span><span className={`grade-pill ${gradeCls}`}>Grade {t.grade}</span></span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>

            {/* Containers received */}
            <div className="card">
              <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div className="card-title"><i className="ti ti-ship" /> Shipments we got
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>
                    {containersQ.isLoading ? '…' : `${containersQ.data?.total ?? 0} shipments`}
                  </span>
                </div>
                <button className="card-action" onClick={() => navigate('/containers')}>View all containers</button>
              </div>
              {containersQ.isLoading && (
                <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6 }} />)}
                </div>
              )}
              {!containersQ.isLoading && containers.length === 0 && (
                <div className="empty">
                  No containers found for this supplier.
                  <div style={{ marginTop: 8 }}>
                    <button className="btn" style={{ fontSize: 12 }} onClick={() => navigate('/containers')}>View Containers page</button>
                  </div>
                </div>
              )}
              {!containersQ.isLoading && containers.length > 0 && (
                <>
                  <div className="cont-sup-row head">
                    <span>Arrived</span><span>Container #</span><span>Status</span><span />
                  </div>
                  {containers.slice(0, shownCont).map(c => (
                    <div className="cont-sup-row" key={c.id} onClick={() => navigate('/containers/' + c.id)}>
                      <span className="cdate">{c.arrivalDate ?? '—'}</span>
                      <span className="cid">{c.number}</span>
                      <span><span className="badge badge-green">{c.status}</span></span>
                      <span className="row-actions" onClick={e => e.stopPropagation()}>
                        <button className="icon-btn" onClick={() => navigate('/containers/' + c.id)}><i className="ti ti-arrow-up-right" /></button>
                      </span>
                    </div>
                  ))}
                  <div className="more-foot">
                    <span>showing {Math.min(shownCont, containers.length)} of {containersQ.data?.total ?? containers.length} containers</span>
                    {containers.length > 5 && (
                      <button className="btn-more" onClick={() => setShownCont(n => n >= containers.length ? 5 : n + 5)}>
                        <i className={`ti ti-chevron-${shownCont >= containers.length ? 'up' : 'down'}`} style={{ fontSize: 14 }} />
                        {shownCont >= containers.length ? ' Show less' : ' Show more'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Price history */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-trending-up" /> Price changes over time</div>
              </div>
              <div style={{ padding: '18px', color: 'var(--text3)', fontSize: 13 }}>
                Price history not tracked — changes recorded on container product lines.
              </div>
            </div>

            {/* Payments history */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-cash" /> Money we sent</div>
              </div>
              <div style={{ padding: '18px', color: 'var(--text3)', fontSize: 13 }}>
                Supplier payments not tracked in this version.
              </div>
            </div>

          </div>

          {/* RIGHT */}
          <div className="stack">

            {/* Contacts */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-users" /> People to talk to</div>
                <button className="card-action"><i className="ti ti-plus" style={{ fontSize: 13 }} /> Add</button>
              </div>
              {(supplier?.contactPersons ?? []).length === 0 && (
                <div className="empty">No contacts on file</div>
              )}
              {(supplier?.contactPersons ?? []).map((c, i) => (
                <div className="info-row" key={i}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface2)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initialsOf(c.name)}</div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.role}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: 'var(--text2)' }}>{c.phone}</span>
                </div>
              ))}
            </div>

            {/* Bank details */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-building-bank" /> Bank details</div>
                <button className="card-action">Edit</button>
              </div>
              {supplier?.bankDetails == null ? (
                <div className="empty">No bank details on file</div>
              ) : (
                [
                  { lbl: 'Bank', val: supplier.bankDetails.bank_name },
                  { lbl: 'Account #', val: supplier.bankDetails.account_number },
                  { lbl: 'IBAN', val: supplier.bankDetails.iban },
                  { lbl: 'SWIFT', val: supplier.bankDetails.swift },
                ].map(row => (
                  <div className="info-row" key={row.lbl}>
                    <span className="lbl">{row.lbl}</span>
                    <span className="val">{row.val}</span>
                    <button className="copy" onClick={() => copyText(row.val)}>copy</button>
                  </div>
                ))
              )}
            </div>

            {/* Activity */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-activity" /> What happened recently</div>
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {activity.map((a, i) => (
                  <div className="act-row" key={i}>
                    <div className={`act-icon ${a.kind}`}><i className={`ti ${a.ic}`} /></div>
                    <div>
                      <div className="act-text" dangerouslySetInnerHTML={{ __html: a.text }} />
                      <div className="act-time">{a.when}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-notes" /> Notes</div>
                <button className="card-action">Edit</button>
              </div>
              <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.55 }}>
                {supplier?.notes ?? 'No notes.'}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Pay modal */}
      {payOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setPayOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title"><i className="ti ti-cash" style={{ marginRight: 8 }} />Pay {supplier?.name ?? 'Supplier'}</div>
              </div>
              <button className="close-btn" onClick={() => setPayOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div>
                  <span className="field-label">When you paid</span>
                  <input className="input" type="date" value={payDate} onChange={e => setPayDateVal(e.target.value)} />
                </div>
                <div>
                  <span className="field-label">How you paid</span>
                  <select className="select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                    {['bank transfer', 'cash', 'whish', 'omt', 'cheque'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="field-label">Which shipment / bill is this for</span>
                  <select className="select">
                    <option>— not for a specific bill —</option>
                  </select>
                </div>
                <div>
                  <span className="field-label">How much</span>
                  <input className="input num" type="number" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <span className="field-label">Currency</span>
                  <select className="select"><option>USD</option><option>EUR</option><option>LBP</option></select>
                </div>
                <div>
                  <span className="field-label">Who sent the money</span>
                  <select className="select"><option>Khalil Abi Nader (owner)</option><option>Rita Salameh (accounts)</option></select>
                </div>
                <div>
                  <span className="field-label">From which account</span>
                  <select className="select"><option>BLOM Bank · main USD</option><option>Bank Audi · LBP</option><option>Petty cash</option></select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="field-label">Note or reference (optional)</span>
                  <input className="input" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. wire ref, cheque number" />
                </div>
              </div>
              <div style={{ marginTop: 14, padding: '11px 14px', background: 'var(--accent-bg)', border: '1px solid #a7f3d0', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--accent)' }}>
                  <strong>Balance not tracked in this version</strong>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>record payment for reference only</div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 22, fontWeight: 700, color: 'var(--text3)' }}>
                  —
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>payment log</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setPayOpen(false)}>Cancel</button>
                <button className="btn green" onClick={savePay}><i className="ti ti-check" style={{ fontSize: 15 }} /> Save payment</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`toast ${toast ? 'show' : ''}`}>
        <i className="ti ti-check-circle" />
        <span>{toast}</span>
      </div>
    </>
  )
}
