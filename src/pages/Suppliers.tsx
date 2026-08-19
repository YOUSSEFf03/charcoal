import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useSuppliers, useCreateSupplier, useUpdateSupplier } from '../hooks/useSuppliers'
import type { Supplier, ContactPerson, SupplierCharcoalType, CreateSupplierDto } from '../types/api'

// Derive 2-letter initials from a supplier name for the avatar tile.
function initialsOf(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// Cycle a deterministic accent colour per supplier so cards stay visually varied.
const AVATAR_COLORS = ['var(--accent)', 'var(--accent2)', 'var(--blue)']
function colorOf(idx: number) {
  return AVATAR_COLORS[idx % AVATAR_COLORS.length]
}

type NewTypeRow = { name: string; grade: string; price: string }

export default function Suppliers() {
  const navigate = useNavigate()
  const { data: suppliersResp, isLoading, isError, refetch } = useSuppliers()
  const createSupplier = useCreateSupplier()
  const updateSupplier = useUpdateSupplier()
  const suppliers = suppliersResp?.data ?? []
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'info' | 'contacts' | 'types' | 'bank' | 'history'>('info')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [typeRows, setTypeRows] = useState<NewTypeRow[]>([{ name: '', grade: 'Premium', price: '' }])
  const [copied, setCopied] = useState('')
  const [toast, setToast] = useState('')
  // New-supplier form fields wired to useCreateSupplier.
  const [newName, setNewName] = useState('')
  const [newCountry, setNewCountry] = useState('Nigeria')
  // Edit-supplier form fields, wired to useUpdateSupplier — seeded from the
  // selected supplier each time the Edit modal is opened (see the Edit button).
  const [editName, setEditName] = useState('')
  const [editCountry, setEditCountry] = useState('')
  const [editLeadTimeDays, setEditLeadTimeDays] = useState('')
  const [editPaymentTerms, setEditPaymentTerms] = useState('Net 30')
  const [editNotes, setEditNotes] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function openPanel(s: Supplier) {
    setSelectedSupplier(s)
    setPanelTab('info')
    setPanelOpen(true)
  }

  function submitNewSupplier() {
    if (!newName.trim()) return
    const body: CreateSupplierDto = {
      name: newName.trim(),
      country: newCountry,
      charcoalTypes: typeRows
        .filter(r => r.name.trim())
        .map<SupplierCharcoalType>(r => ({ type: r.name.trim(), grade: r.grade })),
    }
    createSupplier.mutate(body, {
      onSuccess: () => {
        setNewModalOpen(false)
        setNewName('')
        showToast('Supplier added')
      },
    })
  }

  function saveSupplierEdit() {
    if (!sup || !editName.trim()) return
    updateSupplier.mutate(
      {
        id: sup.id,
        body: {
          name: editName.trim(),
          country: editCountry.trim(),
          leadTimeDays: editLeadTimeDays.trim() ? parseInt(editLeadTimeDays, 10) : null,
          paymentTerms: editPaymentTerms,
          notes: editNotes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setEditModalOpen(false)
          showToast(`${editName.trim()} updated`)
        },
        onError: (err: any) => showToast(err?.error ?? 'Failed to update supplier'),
      },
    )
  }

  function addTypeRow() {
    setTypeRows(r => [...r, { name: '', grade: 'Standard', price: '' }])
  }

  function removeTypeRow(i: number) {
    setTypeRows(r => r.filter((_, idx) => idx !== i))
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(''), 1500)
  }

  const sup = selectedSupplier

  return (
    <>
      <Topbar title="Suppliers">
        <button className="btn primary" onClick={() => setNewModalOpen(true)}>
          <i className="ti ti-plus" /> New Supplier
        </button>
      </Topbar>

      <div className="content">
        {isLoading && (
          <div className="supplier-grid">
            {[0, 1, 2].map(i => (
              <div key={i} className="sup-card" style={{ opacity: 0.5 }}>
                <div style={{ height: 44, background: 'var(--surface2)', borderRadius: 10, marginBottom: 14 }} />
                <div style={{ height: 14, width: '60%', background: 'var(--surface2)', borderRadius: 4, marginBottom: 8 }} />
                <div style={{ height: 40, background: 'var(--surface2)', borderRadius: 4 }} />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
            <i className="ti ti-alert-circle" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: 'var(--red)' }} />
            <div>Failed to load suppliers.</div>
            <button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetch()}>Retry</button>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="supplier-grid">
            {suppliers.map((s, idx) => {
              const outstanding = parseFloat(s.outstandingUsd ?? '0')
              const paid        = parseFloat(s.totalPaidUsd   ?? '0')
              return (
              <div key={s.id} className="sup-card" onClick={() => navigate('/suppliers/' + s.id)} style={{ cursor: 'pointer' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 9, flexShrink: 0,
                    background: colorOf(idx), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.9rem', fontFamily: 'IBM Plex Mono, monospace',
                  }}>{initialsOf(s.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{s.country}{s.paymentTerms ? ` · ${s.paymentTerms}` : ''}</div>
                  </div>
                </div>

                {/* Balance — the main focus */}
                <div style={{
                  background: outstanding > 0 ? 'var(--accent2-bg)' : 'var(--surface2)',
                  borderRadius: 8, padding: '12px 14px', marginBottom: 12,
                  border: `1px solid ${outstanding > 0 ? 'var(--accent2)' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize: 11, color: outstanding > 0 ? 'var(--accent2)' : 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
                    Inventory cost outstanding
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, letterSpacing: -0.5, color: outstanding > 0 ? 'var(--accent2)' : 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                    {outstanding > 0 ? `$${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </div>
                  {paid > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3, fontFamily: "'IBM Plex Mono',monospace" }}>
                      ${paid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid
                    </div>
                  )}
                </div>

                {/* Charcoal types */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                  {s.charcoalTypes.slice(0, 3).map((t, j) => (
                    <span key={j} style={{
                      fontSize: '0.71rem', padding: '2px 7px', borderRadius: 4,
                      background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)',
                    }}>{t.type} · {t.grade}</span>
                  ))}
                  {s.charcoalTypes.length > 3 && (
                    <span style={{ fontSize: '0.71rem', color: 'var(--text3)' }}>+{s.charcoalTypes.length - 3} more</span>
                  )}
                </div>

                {/* Footer stats */}
                <div style={{ display: 'flex', gap: 16, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text3)' }}>
                  <span><i className="ti ti-truck-delivery" style={{ fontSize: 12, marginRight: 3 }} />{s.leadTimeDays != null ? `${s.leadTimeDays}d lead` : '—'}</span>
                  {s.charcoalTypes.length > 0 && <span><i className="ti ti-flame" style={{ fontSize: 12, marginRight: 3 }} />{s.charcoalTypes.length} type{s.charcoalTypes.length !== 1 ? 's' : ''}</span>}
                </div>
              </div>
            )})}

            {suppliers.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 24px', color: 'var(--text3)' }}>
                <i className="ti ti-truck" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                <div>No suppliers yet</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Supplier Panel */}
      {panelOpen && sup && (
        <div className="panel-overlay" onClick={() => setPanelOpen(false)}>
          <div className="sup-panel" onClick={e => e.stopPropagation()}>
            <div className="panel-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 9,
                  background: 'var(--accent)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace'
                }}>{initialsOf(sup.name)}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>{sup.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{sup.country}</div>
                </div>
              </div>
              <button className="btn" onClick={() => setPanelOpen(false)}><i className="ti ti-x" /></button>
            </div>

            {/* Quick stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'Lead Time', value: sup.leadTimeDays != null ? `${sup.leadTimeDays}d` : '—' },
                { label: 'Terms', value: sup.paymentTerms ?? '—' },
                { label: 'Types', value: sup.charcoalTypes.length },
              ].map(stat => (
                <div key={stat.label} style={{ background: 'var(--surface)', padding: '12px 16px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', fontFamily: 'IBM Plex Mono, monospace' }}>{stat.value}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="panel-tabs" style={{ overflowX: 'auto' }}>
              {(['info', 'contacts', 'types', 'bank', 'history'] as const).map(t => (
                <button key={t} className={`panel-tab${panelTab === t ? ' active' : ''}`} onClick={() => setPanelTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div className="panel-body">
              {panelTab === 'info' && (
                <div className="panel-section">
                  <div className="panel-row"><span className="panel-section-label">Country</span><span>{sup.country}</span></div>
                  <div className="panel-row"><span className="panel-section-label">Terms</span><span>{sup.paymentTerms ?? '—'}</span></div>
                  <div className="panel-row"><span className="panel-section-label">Lead time</span><span>{sup.leadTimeDays != null ? `${sup.leadTimeDays} days` : '—'}</span></div>
                  {sup.notes && (
                    <div style={{ marginTop: 16 }}>
                      <div className="panel-section-label" style={{ marginBottom: 6 }}>Notes</div>
                      <div className="arabic-display" dir="rtl">{sup.notes}</div>
                    </div>
                  )}
                </div>
              )}

              {panelTab === 'contacts' && (
                <div className="panel-section">
                  {sup.contactPersons.length === 0 ? (
                    <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '32px 0', fontSize: '0.87rem' }}>No contacts added</div>
                  ) : sup.contactPersons.map((c: ContactPerson, i) => (
                    <div key={i} className="contact-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: 'var(--surface2)', color: 'var(--text2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 600, fontSize: '0.85rem'
                      }}>{c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>{c.phone}</div>
                      </div>
                      <span className="badge badge-gray">{c.role}</span>
                    </div>
                  ))}
                </div>
              )}

              {panelTab === 'types' && (
                <div className="panel-section">
                  {sup.charcoalTypes.length === 0 ? (
                    <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '32px 0', fontSize: '0.87rem' }}>No charcoal types configured</div>
                  ) : sup.charcoalTypes.map((t: SupplierCharcoalType, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{t.type}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>{t.grade}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {panelTab === 'bank' && (
                <div className="panel-section">
                  {!sup.bankDetails ? (
                    <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '32px 0', fontSize: '0.87rem' }}>No bank details added</div>
                  ) : (
                    <>
                      <div className="bank-row panel-row">
                        <span className="panel-section-label">Bank</span>
                        <span>{sup.bankDetails.bank_name}</span>
                      </div>
                      <div className="bank-row panel-row" style={{ alignItems: 'center' }}>
                        <span className="panel-section-label">Account</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: '0.82rem' }}>{sup.bankDetails.account_number}</span>
                          <button className="copy-btn" onClick={() => copyText(sup.bankDetails!.account_number, 'account')}>
                            <i className={`ti ti-${copied === 'account' ? 'check' : 'copy'}`} />
                          </button>
                        </div>
                      </div>
                      <div className="bank-row panel-row" style={{ alignItems: 'center' }}>
                        <span className="panel-section-label">IBAN</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: '0.82rem' }}>{sup.bankDetails.iban}</span>
                          <button className="copy-btn" onClick={() => copyText(sup.bankDetails!.iban, 'iban')}>
                            <i className={`ti ti-${copied === 'iban' ? 'check' : 'copy'}`} />
                          </button>
                        </div>
                      </div>
                      <div className="bank-row panel-row" style={{ alignItems: 'center' }}>
                        <span className="panel-section-label">SWIFT</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: '0.82rem' }}>{sup.bankDetails.swift}</span>
                          <button className="copy-btn" onClick={() => copyText(sup.bankDetails!.swift, 'swift')}>
                            <i className={`ti ti-${copied === 'swift' ? 'check' : 'copy'}`} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {panelTab === 'history' && (
                <div className="panel-section">
                  <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '32px 0', fontSize: '0.87rem' }}>
                    Open the supplier detail page for full purchase history
                  </div>
                </div>
              )}
            </div>

            <div className="panel-footer">
              <button className="panel-btn pbtn-ghost" onClick={() => {
                if (!sup) return
                setEditName(sup.name)
                setEditCountry(sup.country)
                setEditLeadTimeDays(sup.leadTimeDays != null ? String(sup.leadTimeDays) : '')
                setEditPaymentTerms(sup.paymentTerms ?? 'Net 30')
                setEditNotes(sup.notes ?? '')
                setEditModalOpen(true)
              }}><i className="ti ti-edit" /> Edit</button>
              <button className="panel-btn pbtn-primary" onClick={() => { setPanelOpen(false); navigate('/orders') }}>
                <i className="ti ti-package" /> New Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Supplier Modal */}
      {newModalOpen && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setNewModalOpen(false)}>
          <div className="modal" style={{ width: 560, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <div className="modal-title">New Supplier</div>
              <button className="panel-close-btn" onClick={() => setNewModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Basic info */}
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Basic Info</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Supplier Name</label>
                  <input type="text" className="form-input" placeholder="Company name" value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <select className="form-input" value={newCountry} onChange={e => setNewCountry(e.target.value)}>
                    <option>Nigeria</option>
                    <option>Indonesia</option>
                    <option>Venezuela</option>
                    <option>Lebanon</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Lead Time (days)</label>
                  <input type="number" className="form-input" placeholder="14" />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Terms</label>
                  <select className="form-input">
                    <option>Net 30</option>
                    <option>Net 45</option>
                    <option>Net 60</option>
                    <option>Prepaid</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" placeholder="supplier@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input type="tel" className="form-input" placeholder="+963 11 555 0000" />
                </div>
              </div>

              <div className="form-divider" style={{ margin: '20px 0', borderTop: '1px solid var(--border)' }} />

              {/* Charcoal types */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Charcoal Types</div>
                <button className="btn btn-sm btn-ghost" onClick={addTypeRow}><i className="ti ti-plus" /> Add</button>
              </div>
              {typeRows.map((row, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <input type="text" className="form-input" placeholder="e.g. BBQ Hardwood A" value={row.name}
                    onChange={e => setTypeRows(r => r.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                  <select className="form-input" style={{ width: 110 }} value={row.grade}
                    onChange={e => setTypeRows(r => r.map((x, idx) => idx === i ? { ...x, grade: e.target.value } : x))}>
                    <option>Premium</option>
                    <option>Standard</option>
                    <option>Economy</option>
                  </select>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: 10, color: 'var(--text3)', fontSize: '0.85rem' }}>$</span>
                    <input type="number" className="form-input" placeholder="0" style={{ width: 90, paddingLeft: 22 }} value={row.price}
                      onChange={e => setTypeRows(r => r.map((x, idx) => idx === i ? { ...x, price: e.target.value } : x))} />
                  </div>
                  {typeRows.length > 1 && (
                    <button className="btn" style={{ padding: '6px 8px', color: 'var(--red)' }} onClick={() => removeTypeRow(i)}>
                      <i className="ti ti-trash" />
                    </button>
                  )}
                </div>
              ))}

              <div className="form-divider" style={{ margin: '20px 0', borderTop: '1px solid var(--border)' }} />

              {/* Contact person */}
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Contact Person</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input type="text" className="form-input" placeholder="Full name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <input type="text" className="form-input" placeholder="e.g. Owner" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input type="tel" className="form-input" placeholder="+963 …" />
                </div>
              </div>

              <div className="form-divider" style={{ margin: '20px 0', borderTop: '1px solid var(--border)' }} />

              {/* Bank details */}
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                Bank Details <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text3)' }}>(optional)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Bank Name</label>
                  <input type="text" className="form-input" placeholder="Bank of Syria" />
                </div>
                <div className="form-group">
                  <label className="form-label">Branch</label>
                  <input type="text" className="form-input" placeholder="Damascus Main" />
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Account Number / IBAN</label>
                  <input type="text" className="form-input mono" placeholder="SY12 0000 0000 0000 …" />
                </div>
                <div className="form-group">
                  <label className="form-label">SWIFT Code</label>
                  <input type="text" className="form-input mono" placeholder="BKSYSYDA" />
                </div>
              </div>

              <div className="form-divider" style={{ margin: '20px 0', borderTop: '1px solid var(--border)' }} />

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} placeholder="Any additional notes…" dir="auto" style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)' }}>
              <button className="btn" onClick={() => setNewModalOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitNewSupplier} disabled={createSupplier.isPending}>
                <i className="ti ti-check" /> {createSupplier.isPending ? 'Adding…' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SUPPLIER MODAL */}
      {editModalOpen && sup && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditModalOpen(false)}>
          <div className="modal" style={{ width: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-title">Edit supplier</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{sup.name}</div>
              </div>
              <button className="panel-close-btn" onClick={() => setEditModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Supplier name</label>
                <input className="form-input" type="text" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <input className="form-input" type="text" value={editCountry} onChange={e => setEditCountry(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Lead time (days)</label>
                  <input className="form-input" type="number" value={editLeadTimeDays} onChange={e => setEditLeadTimeDays(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Payment terms</label>
                  <select className="form-input" value={editPaymentTerms} onChange={e => setEditPaymentTerms(e.target.value)}>
                    <option>Net 30</option><option>Net 45</option><option>Net 60</option><option>Prepaid</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Types</label>
                  <input className="form-input" type="text" defaultValue={sup.charcoalTypes.map(t => `${t.type} ${t.grade}`).join(', ')} disabled />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={editNotes} onChange={e => setEditNotes(e.target.value)} dir="auto" style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditModalOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={updateSupplier.isPending || !editName.trim()} onClick={saveSupplierEdit}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {updateSupplier.isPending ? 'Saving…' : 'Save changes'}
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
