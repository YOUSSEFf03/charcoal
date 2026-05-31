import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useBagTypes } from '../hooks/useBagTypes'
import { useBagPurchases, useCreateBagPurchase } from '../hooks/useBagPurchases'

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BagPurchases() {
  const bagTypesQ = useBagTypes()
  const purchasesQ = useBagPurchases()
  const createPurchase = useCreateBagPurchase()

  const bagTypes = bagTypesQ.data ?? []
  const allPurchases = purchasesQ.data?.data ?? []

  // ── Section 1: quick-add by brand/name ──────────────────────────────────
  const [brandName, setBrandName] = useState('')
  const [brandQty, setBrandQty] = useState('')
  const [brandPrice, setBrandPrice] = useState('')
  const [brandDate, setBrandDate] = useState(new Date().toISOString().slice(0, 10))
  const [brandNotes, setBrandNotes] = useState('')
  const [brandError, setBrandError] = useState('')

  // ── Section 2: per bag-type add ──────────────────────────────────────────
  const [addBagTypeId, setAddBagTypeId] = useState('')
  const [addQty, setAddQty] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10))
  const [addNotes, setAddNotes] = useState('')
  const [addError, setAddError] = useState('')

  const [toast, setToast] = useState('')
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2400) }

  // Get distinct brand names from past purchases (for datalist autocomplete)
  const knownBrands = [...new Set(allPurchases.map((p: any) => p.notes).filter(Boolean))]

  function submitBrand() {
    if (!brandName.trim()) { setBrandError('Enter brand / company name'); return }
    if (!brandQty || parseInt(brandQty) <= 0) { setBrandError('Enter quantity'); return }
    if (!brandPrice || parseFloat(brandPrice) <= 0) { setBrandError('Enter price per bag'); return }
    // We store the brand name in `notes` since the DTO doesn't have a vendor field.
    // Bag type defaults to the first bag type unless specified.
    if (bagTypes.length === 0) { setBrandError('Add at least one bag type in Settings first'); return }
    setBrandError('')
    createPurchase.mutate(
      {
        bagTypeId: bagTypes[0].id,  // default to first type; user assigns via Section 2
        quantity: parseInt(brandQty),
        unitCost: parseFloat(brandPrice).toFixed(4),
        date: brandDate,
        notes: brandName.trim(),
      },
      {
        onSuccess: () => {
          setBrandName(''); setBrandQty(''); setBrandPrice(''); setBrandNotes('')
          showToast('Purchase logged')
        },
        onError: (err: any) => setBrandError(err?.error ?? 'Failed'),
      }
    )
  }

  function submitForType() {
    if (!addBagTypeId) { setAddError('Select a bag type'); return }
    if (!addQty || parseInt(addQty) <= 0) { setAddError('Enter quantity'); return }
    if (!addPrice || parseFloat(addPrice) <= 0) { setAddError('Enter price per bag'); return }
    setAddError('')
    createPurchase.mutate(
      {
        bagTypeId: addBagTypeId,
        quantity: parseInt(addQty),
        unitCost: parseFloat(addPrice).toFixed(4),
        date: addDate,
        notes: addNotes.trim() || null,
      },
      {
        onSuccess: () => {
          setAddQty(''); setAddPrice(''); setAddNotes('')
          showToast('Purchase logged')
        },
        onError: (err: any) => setAddError(err?.error ?? 'Failed'),
      }
    )
  }

  // Group all purchases by bag type for the per-type cards
  const purchasesByType = new Map<string, any[]>()
  for (const bt of bagTypes) purchasesByType.set(bt.id, [])
  for (const p of allPurchases) {
    const arr = purchasesByType.get((p as any).bagTypeId)
    if (arr) arr.push(p)
  }

  return (
    <>
      <Topbar title="Bag purchases" />

      <div className="content">

        {/* ── SECTION 1: Brand / company purchases ─────────────────────── */}
        <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Brand / company purchases
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          {/* Add row */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Brand / company name</label>
              <input
                className="form-input"
                placeholder="e.g. Al Amin Packaging"
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitBrand()}
                list="brand-names"
              />
              <datalist id="brand-names">
                {knownBrands.map((b, i) => <option key={i} value={String(b)} />)}
              </datalist>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Quantity (bags)</label>
              <input
                className="form-input"
                type="number" min="1" placeholder="e.g. 2000"
                value={brandQty}
                onChange={e => setBrandQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitBrand()}
                style={{ fontFamily: "'IBM Plex Mono',monospace" }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>
                Price / bag ($)
                {brandQty && brandPrice && parseFloat(brandQty) > 0 && parseFloat(brandPrice) > 0 && (
                  <span style={{ marginLeft: 6, color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace" }}>
                    = ${(parseFloat(brandQty) * parseFloat(brandPrice)).toFixed(2)}
                  </span>
                )}
              </label>
              <input
                className="form-input"
                type="number" min="0" step="0.0001" placeholder="0.0400"
                value={brandPrice}
                onChange={e => setBrandPrice(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitBrand()}
                style={{ fontFamily: "'IBM Plex Mono',monospace" }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Date</label>
              <input className="form-input" type="date" value={brandDate} onChange={e => setBrandDate(e.target.value)} />
            </div>
            <button
              className="btn primary"
              onClick={submitBrand}
              disabled={createPurchase.isPending}
              style={{ padding: '8px 16px' }}
            >
              <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add
            </button>
          </div>
          {brandError && (
            <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)' }}>{brandError}</div>
          )}

          {/* Purchase history */}
          {allPurchases.length === 0 && !purchasesQ.isLoading && (
            <div className="empty">No purchases yet — add the first one above.</div>
          )}
          {purchasesQ.isLoading && <div className="empty">Loading…</div>}
          {allPurchases.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Brand / company</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit price</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {allPurchases.map((p: any) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.notes ?? '—'}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{fmtDate(p.date)}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }}>{p.quantity.toLocaleString()}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', color: 'var(--text3)' }}>${parseFloat(p.unitCost).toFixed(4)}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', color: 'var(--accent)' }}>${parseFloat(p.totalCost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── SECTION 2: Per bag type ───────────────────────────────────── */}
        <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Add purchase by bag type
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          {/* Add row with bag type dropdown */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Bag type</label>
              <select
                className="form-input"
                value={addBagTypeId}
                onChange={e => setAddBagTypeId(e.target.value)}
              >
                <option value="">— select bag type —</option>
                {bagTypes.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {parseFloat(b.nominalKg).toFixed(2)} kg
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Quantity (bags)</label>
              <input
                className="form-input"
                type="number" min="1" placeholder="e.g. 1000"
                value={addQty}
                onChange={e => setAddQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitForType()}
                style={{ fontFamily: "'IBM Plex Mono',monospace" }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>
                Price / bag ($)
                {addQty && addPrice && parseFloat(addQty) > 0 && parseFloat(addPrice) > 0 && (
                  <span style={{ marginLeft: 6, color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace" }}>
                    = ${(parseFloat(addQty) * parseFloat(addPrice)).toFixed(2)}
                  </span>
                )}
              </label>
              <input
                className="form-input"
                type="number" min="0" step="0.0001" placeholder="0.0400"
                value={addPrice}
                onChange={e => setAddPrice(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitForType()}
                style={{ fontFamily: "'IBM Plex Mono',monospace" }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }}>Date</label>
              <input className="form-input" type="date" value={addDate} onChange={e => setAddDate(e.target.value)} />
            </div>
            <button
              className="btn primary"
              onClick={submitForType}
              disabled={createPurchase.isPending || !addBagTypeId}
              style={{ padding: '8px 16px' }}
            >
              <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add
            </button>
          </div>
          {addError && (
            <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)' }}>{addError}</div>
          )}

          {/* Per-type purchase history */}
          {bagTypes.map(bt => {
            const rows = purchasesByType.get(bt.id) ?? []
            if (rows.length === 0) return null
            const typeTotal = rows.reduce((s, p) => s + parseFloat(p.totalCost), 0)
            return (
              <div key={bt.id}>
                <div style={{ padding: '8px 18px', background: 'var(--surface2)', borderTop: '1px solid var(--border)', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{bt.name}</span>
                  <span style={{ color: 'var(--accent)' }}>${typeTotal.toFixed(2)} total</span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Unit price</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p: any) => (
                      <tr key={p.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{fmtDate(p.date)}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }}>{p.quantity.toLocaleString()}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', color: 'var(--text3)' }}>${parseFloat(p.unitCost).toFixed(4)}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', color: 'var(--accent)' }}>${parseFloat(p.totalCost).toFixed(2)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{p.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
          {bagTypes.every(bt => (purchasesByType.get(bt.id) ?? []).length === 0) && (
            <div className="empty">No bag-type purchases yet — use the form above to add one.</div>
          )}
        </div>

      </div>

      {toast && (
        <div className="toast show">
          <i className="ti ti-check-circle" /> <span>{toast}</span>
        </div>
      )}
    </>
  )
}
