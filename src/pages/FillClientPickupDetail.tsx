import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useStockExit, useUpdateStockExit } from '../hooks/useWarehouse'
import { useMe } from '../hooks/useMe'
import { formatUsd } from '../lib/money'
import { formatDateTime } from '../lib/date'

/**
 * Pickup detail — a StockExit row (exitType='client_bags_fill'). There is no
 * separate Pickup model, no displayId, and no status field on this model
 * (see the audit notes in FillClientDetail.tsx / fill-jobs.service.ts), so
 * this page never fabricates any of those; it titles by date instead of an
 * invented reference number.
 *
 * Editing is limited to exactly what StockExitsController.updateExit()
 * supports (amount, recipient) and exactly who it's gated to (owner,
 * sales_rep) — no wider edit surface than the backend actually offers.
 */
export default function FillClientPickupDetail() {
  const { clientId, pickupId } = useParams<{ clientId: string; pickupId: string }>()

  const clientQ = useClient(clientId ?? '')
  const client = clientQ.data
  const pickupQ = useStockExit(pickupId ?? '')
  const pickup = pickupQ.data
  const meQ = useMe()
  const canEdit = meQ.data?.role === 'owner' || meQ.data?.role === 'sales_rep'
  const updateExit = useUpdateStockExit()

  const [editing, setEditing] = useState(false)
  const [editAmount, setEditAmount] = useState('')
  const [editRecipient, setEditRecipient] = useState('')
  const [saving, setSaving] = useState(false)

  function openEdit() {
    setEditAmount(pickup?.amount ? String(pickup.amount) : '')
    setEditRecipient(pickup?.recipient ?? '')
    setEditing(true)
  }

  async function saveEdit() {
    if (!pickupId) return
    setSaving(true)
    try {
      await updateExit.mutateAsync({
        id: pickupId,
        amount: editAmount.trim() ? parseFloat(editAmount) : undefined,
        recipient: editRecipient.trim() || undefined,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  let bags: { qty: number; size?: number; charcoal?: string }[] = []
  if (pickup?.reason) {
    try { bags = JSON.parse(pickup.reason) } catch { /* legacy free-text reason */ }
  }
  const bagCount = bags.reduce((s, b) => s + b.qty, 0)

  if (pickupQ.isLoading) {
    return (
      <>
        <Topbar title="Pickup" back={{ label: 'Pickups', to: `/fill-clients/${clientId}/pickups` }} />
        <div className="content"><div className="empty">Loading…</div></div>
      </>
    )
  }
  if (pickupQ.isError || !pickup) {
    return (
      <>
        <Topbar title="Pickup" back={{ label: 'Pickups', to: `/fill-clients/${clientId}/pickups` }} />
        <div className="content"><div className="empty">Pickup not found.</div></div>
      </>
    )
  }

  return (
    <>
      <Topbar title={`Pickup — ${formatDateTime(pickup.date, { day: '2-digit' })}`} back={{ label: 'Pickups', to: `/fill-clients/${clientId}/pickups` }}>
        {canEdit && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={openEdit}>
            <i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit
          </button>
        )}
      </Topbar>
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>Pickup</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-user" /> {client?.name ?? '—'}</span>
              <span className="meta-row"><i className="ti ti-calendar" /> {formatDateTime(pickup.date, { day: '2-digit' })}</span>
              {pickup.recipient && <span className="meta-row"><i className="ti ti-truck" /> {pickup.recipient}</span>}
            </div>
          </div>
          <div className="kpi-strip">
            <div className="kpi-tile">
              <div className="kpi-tile-label">Bags picked up</div>
              <div className="kpi-tile-value">{bagCount || '—'}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Amount</div>
              <div className="kpi-tile-value">{pickup.amount ? formatUsd(pickup.amount) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-package" /> Bags picked up</div></div>
          {bags.length === 0 ? (
            <div className="empty">No bag breakdown recorded.</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Bag spec</th><th className="right">Qty</th></tr></thead>
                <tbody>
                  {bags.map((b, i) => (
                    <tr key={i}>
                      <td>{b.size ?? '?'} kg {b.charcoal ? `· ${b.charcoal}` : ''}</td>
                      <td className="right num" style={{ fontWeight: 600 }}>{b.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-info-circle" /> Details</div></div>
          <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 13 }}>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Logged by</div>{pickup.loggedBy?.name ?? '—'}</div>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Logged at</div>{formatDateTime(pickup.createdAt, { day: '2-digit' })}</div>
            {pickup.invoice && (
              <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Linked invoice</div>{pickup.invoice.displayId ?? pickup.invoice.id}</div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditing(false)}>
          <div className="modal" style={{ width: 420, maxWidth: '96vw' }}>
            <div className="compose-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}><i className="ti ti-edit" style={{ marginRight: 8 }} />Edit pickup</div>
              <button className="icon-btn" aria-label="Cancel edit" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => setEditing(false)}><i className="ti ti-x" /></button>
            </div>
            <div className="compose-section" style={{ borderBottom: 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label className="field-label">Amount</label>
                  <input className="input" type="number" min={0} step={0.01} value={editAmount} onChange={e => setEditAmount(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Recipient</label>
                  <input className="input" value={editRecipient} onChange={e => setEditRecipient(e.target.value)} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                  Only amount and recipient can be changed here. Bag quantities and dates are immutable after creation.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn green" disabled={saving} onClick={saveEdit}>
                {saving ? <><i className="ti ti-loader-2" style={{ fontSize: 15 }} /> Saving…</> : <><i className="ti ti-check" style={{ fontSize: 15 }} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
