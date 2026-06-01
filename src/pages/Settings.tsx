import React, { useState, useEffect } from 'react'
import Topbar from '../components/layout/Topbar'
import { useUsers, useUpdateUserRole } from '../hooks/useUsers'
import { useBagTypes, useCreateBagType, useUpdateBagType, useDeleteBagType } from '../hooks/useBagTypes'
import { useReceivers } from '../hooks/useReceivers'
import { useRate } from '../context/RateContext'
import { useWorkers } from '../hooks/useWorkers'
import type { User, Role } from '../types/api'

type Section = 'company' | 'currency' | 'bagtypes' | 'workerrates' | 'driverrates' | 'receivers' | 'users' | 'preferences' | 'danger'

interface PrefToggle { label: string; desc: string; on: boolean }

const INIT_PREFS: PrefToggle[] = [
  { label: 'CRM alerts — overdue client notifications', desc: "Show alert when a client hasn't ordered past their average order interval", on: true },
  { label: 'Low stock warnings', desc: 'Alert on dashboard when a raw lot falls below 20% remaining', on: true },
  { label: 'Auto-generate invoice on delivery', desc: 'Invoice is created automatically when driver confirms delivery', on: true },
  { label: 'Require variance explanation below zero', desc: 'Worker must enter a note if packing output exceeds input kg', on: true },
  { label: 'Show LBP equivalent on all USD amounts', desc: 'Display LBP equivalent below every USD amount using current rate', on: true },
]
// Role → display label + badge styling (API returns the raw `Role` enum).
const ROLE_META: Record<Role, { label: string; badgeClass: string; badgeStyle: React.CSSProperties; avBg: string; avColor: string }> = {
  owner: { label: 'Owner', badgeClass: '', badgeStyle: { background: 'var(--text)', color: '#fff' }, avBg: 'var(--text)', avColor: '#fff' },
  accountant: { label: 'Accountant', badgeClass: 'badge-amber', badgeStyle: {}, avBg: 'var(--accent2-bg)', avColor: 'var(--accent2)' },
  sales_rep: { label: 'Sales rep', badgeClass: 'badge-blue', badgeStyle: {}, avBg: 'var(--blue-bg)', avColor: 'var(--blue)' },
  worker: { label: 'Worker', badgeClass: 'badge-green', badgeStyle: {}, avBg: 'var(--accent-bg)', avColor: 'var(--accent)' },
  driver:   { label: 'Driver',   badgeClass: 'badge-gray',  badgeStyle: {}, avBg: 'var(--blue-bg)',    avColor: 'var(--blue)' },
  receiver: { label: 'Receiver', badgeClass: 'badge-green', badgeStyle: {}, avBg: 'var(--accent2-bg)', avColor: 'var(--accent2)' },
}

const ROLE_OPTIONS: Role[] = ['owner', 'accountant', 'sales_rep', 'worker', 'driver', 'receiver']

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || parts[0] === '') return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type NavItem = { section: Section; label: string; icon: string; group?: string; danger?: boolean }
const NAV: NavItem[] = [
  { section: 'company', label: 'Company info', icon: 'ti-building', group: 'Business' },
  { section: 'currency', label: 'Currency & rate', icon: 'ti-currency-dollar' },
  { section: 'bagtypes',    label: 'Bag types',    icon: 'ti-box',   group: 'Stock' },
  { section: 'workerrates', label: 'Worker rates', icon: 'ti-tools', group: 'Employees' },
  { section: 'driverrates', label: 'Driver rates', icon: 'ti-truck' },
  { section: 'receivers', label: 'Money receivers', icon: 'ti-cash', group: 'Finance' },
  { section: 'users', label: 'Users & roles', icon: 'ti-users', group: 'Access' },
  { section: 'preferences', label: 'Preferences', icon: 'ti-adjustments', group: 'System' },
  { section: 'danger', label: 'Danger zone', icon: 'ti-alert-triangle', danger: true },
]

export default function Settings() {
  const usersQuery = useUsers()
  const updateUserRole = useUpdateUserRole()
  const rateCtx = useRate()
  const bagTypesQ = useBagTypes()
  const createBagType = useCreateBagType()
  const updateBagType = useUpdateBagType()
  const deleteBagType = useDeleteBagType()
  const workersQ = useWorkers()
  const driversQ = useUsers({ role: 'driver' })

  const [section, setSection] = useState<Section>('company')
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('Changes saved')
  const [newRate, setNewRate] = useState('')
  const [prefs, setPrefs] = useState<PrefToggle[]>(INIT_PREFS)
  const { receivers, add: addReceiver, remove: removeReceiver, update: updateReceiver } = useReceivers()
  const [newReceiverName, setNewReceiverName] = useState('')
  const [newReceiverRole, setNewReceiverRole] = useState('')
  const [editReceiver, setEditReceiver] = useState<{ id: string; name: string; role: string } | null>(null)
  const [newBag, setNewBag] = useState({ name: '', nominalKg: '', costPerBag: '', workerRate: '', note: '' })
  const [showAddBag, setShowAddBag] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [editUserOpen, setEditUserOpen] = useState(false)
  const [deleteUserOpen, setDeleteUserOpen] = useState(false)
  const [dangerModalOpen, setDangerModalOpen] = useState<'reset' | 'clear' | 'export' | null>(null)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editingRole, setEditingRole] = useState<Role>('accountant')
  const [workerDailyRate, setWorkerDailyRate] = useState('15.00')
  const [driverRates, setDriverRates] = useState<Record<string, string>>({})
  const [company, setCompany] = useState({ name: 'Farah Charcoal', phone: '+961 1 234 567', address: 'Beirut, Lebanon', addressAr: 'بيروت، لبنان', taxNo: '', email: 'contact@farahcharcoal.lb', footer: '' })

  useEffect(() => {
    const r = workersQ.data?.[0]?.dailyRate
    if (r) setWorkerDailyRate(parseFloat(r).toFixed(2))
  }, [workersQ.data])

  function showToast(msg?: string) {
    setToastMsg(msg || 'Changes saved')
    setToast(true)
    setTimeout(() => setToast(false), 2500)
  }
  function updateRate() {
    const val = parseInt(newRate.replace(/,/g, ''), 10)
    if (!val || isNaN(val)) return
    rateCtx.setRate(val.toLocaleString()) // saves to backend via RateContext
    setNewRate('')
    showToast('Exchange rate updated — saved to backend')
  }
  function togglePref(i: number) { setPrefs(p => p.map((t, idx) => idx === i ? { ...t, on: !t.on } : t)) }

  const inp: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", color: 'var(--text)', outline: 'none', background: 'var(--surface)' }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 5, display: 'block' }
  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16 }
  const cardHd: React.CSSProperties = { padding: '13px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
  const cardTl: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }
  const saveBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--text)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif", cursor: 'pointer' }
  const ftr: React.CSSProperties = { padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'flex-end' }

  let lastGroup = ''
  return (
    <>
      <Topbar title="Settings" />
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Secondary nav */}
        <div style={{ width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)', padding: '24px 12px', flexShrink: 0, position: 'sticky', top: 56, height: 'calc(100vh - 56px)', overflowY: 'auto' as const }}>
          {NAV.map((n, i) => {
            const showGroup = n.group && n.group !== lastGroup
            if (n.group) lastGroup = n.group
            const active = section === n.section
            return (
              <div key={n.section}>
                {showGroup && <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: 1, padding: '0 10px', marginBottom: 4, marginTop: i === 0 ? 0 : 16 }}>{n.group}</div>}
                <div onClick={() => setSection(n.section)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: active ? 500 : 400, fontSize: 13, background: active ? 'var(--surface2)' : 'transparent', color: n.danger ? 'var(--red)' : active ? 'var(--text)' : 'var(--text2)', marginBottom: 2 }}>
                  <i className={`ti ${n.icon}`} style={{ fontSize: 15, color: n.danger ? 'var(--red)' : active ? 'var(--text)' : 'var(--text3)' }} />
                  {n.label}
                </div>
              </div>
            )
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '32px 36px', maxWidth: 760 }}>

          {section === 'company' && <>
            <SectionHeader title="Company info" desc="Appears on invoices, receipts, and printed documents" />
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-building" style={{ fontSize: 15, color: 'var(--text2)' }} /> Business details</div></div>
              <div style={{ padding: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div><label style={lbl}>Company name</label><input style={inp} value={company.name} onChange={e => setCompany(c => ({ ...c, name: e.target.value }))} /></div>
                  <div><label style={lbl}>Phone number</label><input style={inp} value={company.phone} onChange={e => setCompany(c => ({ ...c, phone: e.target.value }))} /></div>
                </div>
                <div style={{ marginBottom: 16 }}><label style={lbl}>Address <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(Arabic supported)</span></label><input style={inp} value={company.address} onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} /></div>
                <div style={{ marginBottom: 16 }}><label style={lbl}>Address in Arabic</label><input style={{ ...inp, direction: 'rtl', textAlign: 'right' }} value={company.addressAr} onChange={e => setCompany(c => ({ ...c, addressAr: e.target.value }))} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div><label style={lbl}>Tax / VAT number (optional)</label><input style={inp} value={company.taxNo} onChange={e => setCompany(c => ({ ...c, taxNo: e.target.value }))} placeholder="e.g. LB-1234567" /></div>
                  <div><label style={lbl}>Email</label><input style={inp} value={company.email} onChange={e => setCompany(c => ({ ...c, email: e.target.value }))} /></div>
                </div>
                <div><label style={lbl}>Invoice footer note (optional)</label><input style={inp} value={company.footer} onChange={e => setCompany(c => ({ ...c, footer: e.target.value }))} placeholder="e.g. Thank you for your business" /></div>
              </div>
              <div style={ftr}><button style={saveBtn} onClick={() => showToast()}><i className="ti ti-check" style={{ fontSize: 14 }} /> Save changes</button></div>
            </div>
          </>}

          {section === 'currency' && <>
            <SectionHeader title="Currency & exchange rate" desc="Controls how LBP amounts are converted to USD across all reports and balances" />
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-currency-dollar" style={{ fontSize: 15, color: 'var(--text2)' }} /> USD / LBP rate</div></div>
              <div style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>Current rate</div>
                    <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: -1, fontFamily: "'IBM Plex Mono',monospace" }}>{rateCtx.rate}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>LBP per $1 USD · updated 21 May 2026 by Khalil</div>
                  </div>
                  <span className="badge badge-green">Active</span>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={lbl}>Update rate</label>
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 5, display: 'block' }}>Changing this affects all future LBP conversions. Past transactions keep their original rate.</span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace", fontSize: 16 }} type="number" value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="Enter new rate" />
                    <button style={{ ...saveBtn, whiteSpace: 'nowrap' }} onClick={updateRate}><i className="ti ti-refresh" style={{ fontSize: 14 }} /> Update rate</button>
                  </div>
                </div>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)' }}>
                  <strong>Example:</strong> At rate {rateCtx.rate} — an invoice of $100 USD = {(parseInt(rateCtx.rate.replace(/,/g, '')) * 100).toLocaleString()} LBP
                </div>
              </div>
            </div>
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-history" style={{ fontSize: 15, color: 'var(--text2)' }} /> Rate history</div></div>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
                <thead><tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>{['Rate (LBP/$)', 'Date set', 'Set by'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 18px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', fontWeight: 400, textTransform: 'uppercase' as const, letterSpacing: 0.6 }}>{h}</th>)}</tr></thead>
                <tbody><tr><td colSpan={3} style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>Rate change history coming soon</td></tr></tbody>
              </table>
            </div>
          </>}

          {section === 'bagtypes' && <>
            <SectionHeader title="Bag types" desc="Define every bag size used. Nominal kg is used for all stock calculations." />
            <div style={card}>
              <div style={cardHd}>
                <div style={cardTl}><i className="ti ti-box" style={{ fontSize: 15, color: 'var(--text2)' }} /> Bag types</div>
                <button className="btn" onClick={() => setShowAddBag(true)}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add bag type
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.5fr auto', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Nominal kg', 'Cost/bag $', 'Worker rate $', 'Note', ''].map((h, i) => (
                  <div key={i} style={{ padding: '8px 10px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: 0.6 }}>{h}</div>
                ))}
              </div>
              {bagTypesQ.isLoading && (
                <div style={{ padding: '18px', fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
              )}
              {bagTypesQ.isError && (
                <div style={{ padding: '18px', fontSize: 13, color: 'var(--red)' }}>Failed to load bag types.</div>
              )}
              {(bagTypesQ.data ?? []).map(b => (
                <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.5fr auto', alignItems: 'center', padding: '11px 10px', borderBottom: '1px solid var(--border)', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, padding: '0 2px' }}>{b.name}</span>
                  <span style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', padding: '0 10px' }}>{parseFloat(b.nominalKg).toFixed(1)}</span>
                  <span style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', padding: '0 10px' }}>{b.costPerBag ? `$${parseFloat(b.costPerBag).toFixed(3)}` : '—'}</span>
                  <span style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', padding: '0 10px' }}>{b.workerRate ? `$${parseFloat(b.workerRate).toFixed(3)}` : '—'}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{b.note ?? ''}</span>
                  <button
                    onClick={() => deleteBagType.mutate(b.id, { onSuccess: () => showToast('Bag type deleted') })}
                    disabled={deleteBagType.isPending}
                    style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}
                  >
                    <i className="ti ti-trash" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
              {!bagTypesQ.isLoading && (bagTypesQ.data ?? []).length === 0 && (
                <div style={{ padding: '18px', fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>No bag types yet. Add one above.</div>
              )}
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Changes apply to all future packing sessions.</span>
              </div>
            </div>

            {/* Add bag type modal */}
            {showAddBag && (
              <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40, alignItems: 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setShowAddBag(false)}>
                <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Add bag type</div>
                    <button onClick={() => setShowAddBag(false)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>✕</button>
                  </div>
                  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div><label style={lbl}>Name</label><input style={inp} value={newBag.name} onChange={e => setNewBag(p => ({ ...p, name: e.target.value }))} placeholder="e.g. 10kg Bag" /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div><label style={lbl}>Nominal kg</label><input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace" }} type="number" step="0.1" value={newBag.nominalKg} onChange={e => setNewBag(p => ({ ...p, nominalKg: e.target.value }))} placeholder="10" /></div>
                      <div><label style={lbl}>Cost/bag ($)</label><input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace" }} type="number" step="0.01" value={newBag.costPerBag} onChange={e => setNewBag(p => ({ ...p, costPerBag: e.target.value }))} placeholder="0.40" /></div>
                      <div><label style={lbl}>Worker rate ($)</label><input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace" }} type="number" step="0.01" value={newBag.workerRate} onChange={e => setNewBag(p => ({ ...p, workerRate: e.target.value }))} placeholder="0.12" /></div>
                    </div>
                    <div><label style={lbl}>Note (optional)</label><input style={inp} value={newBag.note} onChange={e => setNewBag(p => ({ ...p, note: e.target.value }))} placeholder="Any notes about this bag type" /></div>
                  </div>
                  <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn" onClick={() => setShowAddBag(false)}>Cancel</button>
                    <button
                      className="btn"
                      style={{ background: 'var(--text)', color: '#fff', borderColor: 'var(--text)' }}
                      disabled={createBagType.isPending || !newBag.name.trim() || !newBag.nominalKg}
                      onClick={() => {
                        if (!newBag.name.trim() || !newBag.nominalKg) return
                        createBagType.mutate(
                          {
                            name: newBag.name.trim(),
                            nominalKg: parseFloat(newBag.nominalKg).toFixed(2),
                            costPerBag: newBag.costPerBag ? parseFloat(newBag.costPerBag).toFixed(4) : '0',
                            workerRate: newBag.workerRate ? parseFloat(newBag.workerRate).toFixed(4) : '0',
                            note: newBag.note.trim() || null,
                          },
                          {
                            onSuccess: () => {
                              setShowAddBag(false)
                              setNewBag({ name: '', nominalKg: '', costPerBag: '', workerRate: '', note: '' })
                              showToast('Bag type added')
                            },
                          }
                        )
                      }}
                    >
                      <i className="ti ti-check" style={{ fontSize: 14 }} /> {createBagType.isPending ? 'Adding…' : 'Add bag type'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>}



          {section === 'workerrates' && <WorkerRatesSection
            bagTypesQ={bagTypesQ}
            updateBagType={updateBagType}
            workerDailyRate={workerDailyRate}
            setWorkerDailyRate={setWorkerDailyRate}
            showToast={showToast}
            inp={inp} lbl={lbl} card={card} cardHd={cardHd} cardTl={cardTl} saveBtn={saveBtn} ftr={ftr}
          />}


          {section === 'driverrates' && <>
            <SectionHeader title="Driver rates" desc="Daily rate per driver. Each driver can have a different rate." />
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-truck" style={{ fontSize: 15, color: 'var(--text2)' }} /> Driver daily rates</div></div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {driversQ.isLoading && <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)' }}>Loading drivers…</div>}
                {(driversQ.data?.data ?? []).map(u => {
                  const init = u.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
                  return (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'var(--surface2)', borderRadius: 'var(--radius)' }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--blue-bg)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{init}</div>
                      <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>driver</div></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* TODO backend sub-task: persist driver daily rate */}
                        <input type="number" step={1} value={driverRates[u.id] ?? '35'} onChange={e => setDriverRates(p => ({ ...p, [u.id]: e.target.value }))} style={{ width: 80, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 16, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', outline: 'none', background: 'var(--surface)' }} />
                        <span style={{ fontSize: 12, color: 'var(--text2)' }}>$ / day</span>
                      </div>
                    </div>
                  )
                })}
                {!driversQ.isLoading && (driversQ.data?.data ?? []).length === 0 && (
                  <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>No driver users found. Add users with the driver role in Users &amp; Roles.</div>
                )}
              </div>
              <div style={ftr}><button style={saveBtn} onClick={() => showToast()}><i className="ti ti-check" style={{ fontSize: 14 }} /> Save rates</button></div>
            </div>
          </>}

          {section === 'receivers' && <>
            <SectionHeader title="Money receivers" desc="People who can receive payments on behalf of the business. Appears in warehouse sales and payment forms." />
            <div style={card}>
              <div style={cardHd}>
                <div style={cardTl}><i className="ti ti-cash" style={{ fontSize: 15, color: 'var(--text2)' }} /> Receivers list</div>
              </div>

              {/* Add new receiver form */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
                <div>
                  <label style={lbl}>Full name</label>
                  <input style={inp} value={newReceiverName} onChange={e => setNewReceiverName(e.target.value)} placeholder="e.g. Ahmad Khalil" onKeyDown={e => { if (e.key === 'Enter' && newReceiverName.trim()) { addReceiver(newReceiverName, newReceiverRole); setNewReceiverName(''); setNewReceiverRole('') } }} />
                </div>
                <div>
                  <label style={lbl}>Role / title</label>
                  <input style={inp} value={newReceiverRole} onChange={e => setNewReceiverRole(e.target.value)} placeholder="e.g. sales rep, driver" onKeyDown={e => { if (e.key === 'Enter' && newReceiverName.trim()) { addReceiver(newReceiverName, newReceiverRole); setNewReceiverName(''); setNewReceiverRole('') } }} />
                </div>
                <button
                  className="btn primary"
                  disabled={!newReceiverName.trim()}
                  onClick={() => { addReceiver(newReceiverName, newReceiverRole); setNewReceiverName(''); setNewReceiverRole('') }}
                >
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add
                </button>
              </div>

              {/* List */}
              {receivers.length === 0 && (
                <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
                  No receivers added yet. Add people who collect payments above.
                </div>
              )}
              {receivers.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: i < receivers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0, color: 'var(--text2)' }}>
                    {r.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</div>
                    {r.role && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 1 }}>{r.role}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setEditReceiver({ ...r })}>
                      <i className="ti ti-edit" style={{ fontSize: 13 }} />
                    </button>
                    <button className="btn" style={{ fontSize: 12, padding: '5px 10px', background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' }} onClick={() => removeReceiver(r.id)}>
                      <i className="ti ti-trash" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Edit modal */}
            {editReceiver && (
              <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40, alignItems: 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setEditReceiver(null)}>
                <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: 420, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Edit receiver</div>
                    <button onClick={() => setEditReceiver(null)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>✕</button>
                  </div>
                  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div><label style={lbl}>Full name</label><input style={inp} value={editReceiver.name} onChange={e => setEditReceiver(p => p ? { ...p, name: e.target.value } : p)} /></div>
                    <div><label style={lbl}>Role / title</label><input style={inp} value={editReceiver.role} onChange={e => setEditReceiver(p => p ? { ...p, role: e.target.value } : p)} /></div>
                  </div>
                  <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn" onClick={() => setEditReceiver(null)}>Cancel</button>
                    <button className="btn primary" disabled={!editReceiver.name.trim()} onClick={() => { updateReceiver(editReceiver.id, editReceiver.name, editReceiver.role); setEditReceiver(null); showToast('Receiver updated') }}>
                      <i className="ti ti-check" style={{ fontSize: 14 }} /> Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>}

          {section === 'users' && <>
            <SectionHeader title="Users & roles" desc="Manage who has access. Only the owner can add or remove users." />
            <div style={card}>
              <div style={cardHd}>
                <div style={cardTl}><i className="ti ti-users" style={{ fontSize: 15, color: 'var(--text2)' }} /> Team members</div>
                <button className="btn" style={{ background: 'var(--text)', color: '#fff', borderColor: 'var(--text)' }} onClick={() => setShowAddUser(true)}><i className="ti ti-plus" style={{ fontSize: 13 }} /> Add user</button>
              </div>
              {usersQuery.isLoading && (
                [0, 1, 2].map(i => (
                  <div key={`sk-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface2)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ width: 140, height: 12, background: 'var(--surface2)', borderRadius: 4, marginBottom: 6 }} />
                      <div style={{ width: 90, height: 10, background: 'var(--surface2)', borderRadius: 4 }} />
                    </div>
                    <div style={{ width: 64, height: 18, background: 'var(--surface2)', borderRadius: 100 }} />
                  </div>
                ))
              )}
              {usersQuery.isError && !usersQuery.isLoading && (
                <div style={{ padding: '18px', fontSize: 13, color: 'var(--red)' }}>Couldn't load users. Please try again.</div>
              )}
              {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.data ?? []).map((u, i, arr) => {
                const meta = ROLE_META[u.role]
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: meta.avBg, color: meta.avColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initialsOf(u.name)}</div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div><div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 1 }}>{u.email}</div></div>
                    <span className={`badge ${meta.badgeClass}`} style={meta.badgeStyle}>{meta.label}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => { setEditingUser(u); setEditingRole(u.role); setEditUserOpen(true) }}><i className="ti ti-edit" style={{ fontSize: 13 }} /></button>
                      <button className="btn" style={{ fontSize: 12, padding: '5px 10px', background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' }} onClick={() => { setEditingUser(u); setDeleteUserOpen(true) }}><i className="ti ti-trash" style={{ fontSize: 13 }} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-lock" style={{ fontSize: 15, color: 'var(--text2)' }} /> Role permissions</div></div>
              <div style={{ padding: '14px 18px', fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase' as const, paddingBottom: 8, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                  {['Feature', 'Owner', 'Accountant', 'Sales rep', 'Worker / Driver'].map(h => <span key={h}>{h}</span>)}
                </div>
                {[['See profit', '✓', '✗', '✗', '✗'], ['See cost/kg', '✓', '✓', '✗', '✗'], ['Create orders', '✓', '✓', '✓', '✗'], ['Add users', '✓', '✗', '✗', '✗'], ['Packing sessions', '✓', '✗', '✗', '✓ (worker)']].map(([feat, ...perms], i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '6px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ color: 'var(--text2)' }}>{feat}</span>
                    {perms.map((p, j) => <span key={j} style={{ color: p.startsWith('✓') ? 'var(--accent)' : 'var(--red)' }}>{p}</span>)}
                  </div>
                ))}
              </div>
            </div>
          </>}

          {section === 'preferences' && <>
            <SectionHeader title="Preferences" desc="System behaviour and notification settings" />
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-adjustments" style={{ fontSize: 15, color: 'var(--text2)' }} /> System preferences</div></div>
              {prefs.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: i < prefs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ flex: 1, marginRight: 16 }}><div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p.label}</div><div style={{ fontSize: 12, color: 'var(--text3)' }}>{p.desc}</div></div>
                  <div onClick={() => togglePref(i)} style={{ width: 40, height: 22, borderRadius: 100, background: p.on ? 'var(--accent)' : 'var(--border)', cursor: 'pointer', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'transform 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transform: p.on ? 'translateX(18px)' : 'none' }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={card}>
              <div style={cardHd}><div style={cardTl}><i className="ti ti-printer" style={{ fontSize: 15, color: 'var(--text2)' }} /> Print settings</div></div>
              <div style={{ padding: 18 }}>
                <div style={{ marginBottom: 16 }}><label style={lbl}>Receipt printer width</label><select style={inp}><option>58mm thermal roll</option><option>80mm thermal roll</option></select></div>
                <div><label style={lbl}>Default receipt language</label><select style={inp}><option>English</option><option>Arabic</option><option>English + Arabic</option></select></div>
              </div>
              <div style={ftr}><button style={saveBtn} onClick={() => showToast()}><i className="ti ti-check" style={{ fontSize: 14 }} /> Save preferences</button></div>
            </div>
          </>}

          {section === 'danger' && <>
            <SectionHeader title="Danger zone" desc="Irreversible actions. Proceed with caution." />
            <div style={{ border: '1px solid #fca5a5', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', background: 'var(--red-bg)', borderBottom: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ti ti-alert-triangle" style={{ color: 'var(--red)', fontSize: 16 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>These actions cannot be undone</span>
              </div>
              {[
                { label: 'Reset all stock adjustments', desc: 'Removes all physical count adjustment records. Stock quantities are not affected.', btn: 'Reset adjustments', danger: true, action: () => setDangerModalOpen('reset') },
                { label: 'Clear packing session history', desc: 'Removes all past packing session records. Current stock levels are not affected.', btn: 'Clear sessions', danger: true, action: () => setDangerModalOpen('clear') },
                { label: 'Export all data', desc: 'Download a full backup of all system data as JSON.', btn: 'Export backup', danger: false, action: () => setDangerModalOpen('export') },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: i < 2 ? '1px solid #fca5a5' : 'none' }}>
                  <div><div style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</div><div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{r.desc}</div></div>
                  <button className="btn" style={r.danger ? { background: 'var(--red-bg)', color: 'var(--red)', borderColor: '#fca5a5' } : {}} onClick={r.action}>{!r.danger && <i className="ti ti-download" style={{ fontSize: 13 }} />} {r.btn}</button>
                </div>
              ))}
            </div>
          </>}
        </div>
      </div>

      {/* Add user modal */}
      {showAddUser && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40, alignItems: 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setShowAddUser(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: 460, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Add team member</div>
              <button onClick={() => setShowAddUser(false)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 16 }}><label style={lbl}>Full name</label><input style={inp} type="text" placeholder="e.g. Samer Rahim" /></div>
              <div style={{ marginBottom: 16 }}><label style={lbl}>Username</label><input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace" }} type="text" placeholder="e.g. samer" /></div>
              <div style={{ marginBottom: 16 }}><label style={lbl}>Password</label><input style={inp} type="password" placeholder="Set initial password" /></div>
              <div><label style={lbl}>Role</label><select style={inp}><option>Accountant — financial access, no profit visibility</option><option>Sales rep — orders, clients, invoices, no costs</option><option>Worker — packing sessions only</option><option>Driver — delivery and trips only</option></select></div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowAddUser(false)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--text)', color: '#fff', borderColor: 'var(--text)' }} onClick={() => { setShowAddUser(false); showToast('User added') }}><i className="ti ti-user-plus" style={{ fontSize: 14 }} /> Add user</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUserOpen && editingUser && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40, alignItems: 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setEditUserOpen(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: 460, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Edit user — {editingUser.name}</div>
              <button onClick={() => setEditUserOpen(false)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 16 }}><label style={lbl}>Full name</label><input style={inp} type="text" defaultValue={editingUser.name} /></div>
              <div style={{ marginBottom: 16 }}><label style={lbl}>Email</label><input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace" }} type="text" defaultValue={editingUser.email} /></div>
              <div><label style={lbl}>Role</label>
                <select style={inp} value={editingRole} onChange={e => setEditingRole(e.target.value as Role)}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditUserOpen(false)}>Cancel</button>
              <button className="btn" disabled={updateUserRole.isPending} style={{ background: 'var(--text)', color: '#fff', borderColor: 'var(--text)', opacity: updateUserRole.isPending ? 0.6 : 1 }} onClick={() => {
                if (!editingUser) return
                updateUserRole.mutate(
                  { id: editingUser.id, role: editingRole },
                  { onSuccess: () => { setEditUserOpen(false); showToast('Role updated') } }
                )
              }}><i className="ti ti-check" style={{ fontSize: 14 }} /> Save changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete user confirm modal */}
      {deleteUserOpen && editingUser && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40, alignItems: 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setDeleteUserOpen(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: 420, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)' }}><i className="ti ti-alert-triangle" style={{ marginRight: 6 }} />Remove user</div>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, margin: 0 }}>
                Are you sure you want to remove <strong>{editingUser.name}</strong> ({ROLE_META[editingUser.role].label}) from the system? They will lose access immediately. This action cannot be undone.
              </p>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setDeleteUserOpen(false)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }} onClick={() => { setDeleteUserOpen(false); showToast(`${editingUser.name} removed`) }}><i className="ti ti-trash" style={{ fontSize: 14 }} /> Remove user</button>
            </div>
          </div>
        </div>
      )}

      {/* Danger zone modals */}
      {dangerModalOpen && (
        <div style={{ display: 'flex', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40, alignItems: 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setDangerModalOpen(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', width: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: dangerModalOpen === 'export' ? 'var(--text)' : 'var(--red)' }}>
                <i className={`ti ${dangerModalOpen === 'export' ? 'ti-download' : 'ti-alert-triangle'}`} style={{ marginRight: 6 }} />
                {dangerModalOpen === 'reset' ? 'Reset stock adjustments' : dangerModalOpen === 'clear' ? 'Clear packing history' : 'Export all data'}
              </div>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, margin: 0 }}>
                {dangerModalOpen === 'reset' && 'This will permanently delete all stock adjustment records. Physical stock levels will not be changed. This action cannot be undone.'}
                {dangerModalOpen === 'clear' && 'This will permanently delete all packing session history. Current stock quantities are not affected. This action cannot be undone.'}
                {dangerModalOpen === 'export' && 'This will generate a full JSON backup of all your data including clients, orders, invoices, stock, and settings. The file will be downloaded to your device.'}
              </p>
              {dangerModalOpen !== 'export' && (
                <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--red-bg)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--red)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <i className="ti ti-alert-circle" style={{ flexShrink: 0 }} />
                  Type <strong>CONFIRM</strong> to proceed.
                </div>
              )}
              {dangerModalOpen !== 'export' && (
                <input style={{ ...inp, marginTop: 10 }} type="text" placeholder="Type CONFIRM" />
              )}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setDangerModalOpen(null)}>Cancel</button>
              <button className="btn" style={dangerModalOpen === 'export' ? { background: 'var(--text)', color: '#fff' } : { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}
                onClick={() => { setDangerModalOpen(null); showToast(dangerModalOpen === 'reset' ? 'Adjustments reset' : dangerModalOpen === 'clear' ? 'Session history cleared' : 'farah_backup.json downloaded') }}>
                {dangerModalOpen === 'export' ? <><i className="ti ti-download" style={{ fontSize: 14 }} /> Download backup</> : <><i className="ti ti-check" style={{ fontSize: 14 }} /> Confirm</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--text)', color: '#fff', padding: '10px 18px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, zIndex: 50, transform: toast ? 'translateY(0)' : 'translateY(60px)', opacity: toast ? 1 : 0, transition: 'all 0.25s ease', pointerEvents: 'none' }}>
        <i className="ti ti-check" style={{ fontSize: 15 }} /> {toastMsg}
      </div>
    </>
  )
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>{desc}</div>
    </div>
  )
}

function WorkerRatesSection({ bagTypesQ, updateBagType, workerDailyRate, setWorkerDailyRate, showToast, inp, lbl, card, cardHd, cardTl, saveBtn, ftr }: any) {
  const [editedRates, setEditedRates] = React.useState<Record<string, string>>({})
  const bagTypes = bagTypesQ.data ?? []

  React.useEffect(() => {
    const initial: Record<string, string> = {}
    bagTypes.forEach((b: any) => { initial[b.id] = b.workerRate ?? '' })
    setEditedRates(initial)
  }, [bagTypesQ.data])

  function saveRates() {
    const changed = bagTypes.filter((b: any) => editedRates[b.id] !== undefined && editedRates[b.id] !== (b.workerRate ?? ''))
    Promise.all(changed.map((b: any) =>
      updateBagType.mutateAsync({ id: b.id, body: { workerRate: parseFloat(editedRates[b.id] || '0').toFixed(4) } })
    )).then(() => showToast('Rates saved'))
  }

  return (
    <>
      <SectionHeader title="Worker rates" desc="Per-bag rates paid to the worker for each bag type they pack." />
      <div style={card}>
        <div style={cardHd}>
          <div style={cardTl}><i className="ti ti-tools" style={{ fontSize: 15, color: 'var(--text2)' }} /> Daily rate</div>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Daily rate ($ per day worked)</label>
              <input style={{ ...inp, fontFamily: "'IBM Plex Mono',monospace", fontSize: 16 }} type="number" step={0.5} value={workerDailyRate} onChange={(e: any) => setWorkerDailyRate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, color: 'var(--text2)', width: '100%' }}>
                At 22 working days/month = <strong>${(parseFloat(workerDailyRate || '0') * 22).toFixed(0)}/month</strong> base wage
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={cardHd}>
          <div style={cardTl}><i className="ti ti-box" style={{ fontSize: 15, color: 'var(--text2)' }} /> Per-bag rates</div>
        </div>
        <div style={{ padding: '10px 18px', background: 'var(--surface2)', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6, display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 10, borderBottom: '1px solid var(--border)' }}>
          <span>Bag type</span><span style={{ textAlign: 'right' }}>Nominal kg</span><span style={{ textAlign: 'right' }}>Rate / bag ($)</span>
        </div>
        {bagTypesQ.isLoading && (
          <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)' }}>Loading bag types…</div>
        )}
        {bagTypes.map((b: any) => (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 10, alignItems: 'center', padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{b.name}</div>
              {b.note && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{b.note}</div>}
            </div>
            <div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', color: 'var(--text2)' }}>
              {parseFloat(b.nominalKg).toFixed(1)} kg
            </div>
            <input
              type="number"
              step={0.005}
              value={editedRates[b.id] ?? ''}
              onChange={(e: any) => setEditedRates((p: any) => ({ ...p, [b.id]: e.target.value }))}
              style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', outline: 'none', background: 'var(--surface)' }}
              placeholder="0.000"
            />
          </div>
        ))}
        {!bagTypesQ.isLoading && bagTypes.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
            No bag types defined yet. Add bag types in the <strong>Bag types</strong> section first.
          </div>
        )}
        <div style={ftr}>
          <button style={saveBtn} onClick={saveRates} disabled={updateBagType.isPending}>
            <i className="ti ti-check" style={{ fontSize: 14 }} /> {updateBagType.isPending ? 'Saving…' : 'Save rates'}
          </button>
        </div>
      </div>
    </>
  )
}
