import { useState } from 'react'
import Topbar from '../components/layout/Topbar'
import { useBagTypes } from '../hooks/useBagTypes'
import { useBagPurchases, useCreateBagPurchase } from '../hooks/useBagPurchases'
import { formatDate, toDateOnlyString } from '../lib/date'

function fmtDate(iso: string) { return formatDate(iso) }

/**
 * Logs a bag purchase against a bag type's EXISTING Settings-configured price
 * (BagType.costPerBag — Settings → Bag types → "Cost/bag ($)"), never a
 * price the user types or that this page calculates from qty/type. This page
 * previously had two separate add-forms, both with a free-typed "Price/bag"
 * field and a qty×price preview computed from that typed value — a second,
 * invented pricing system living alongside Settings' own. One of the two
 * forms didn't even let you pick a bag type (silently defaulted to the
 * first one), which the backend requires (CreateBagPurchaseDto.bagTypeId is
 * mandatory) — fixing that turns both forms into the same shape, so they're
 * one form now instead of two overlapping ones.
 *
 * unitCost is still a real, independent field on BagPurchase server-side
 * (BagPurchasesService.create() never reads bagType.costPerBag — a purchase
 * genuinely can cost something other than the Settings figure some other
 * page defaults to, e.g. a supplier price change). That backend behavior is
 * untouched. What changed is only where THIS page's submitted unitCost comes
 * from: the selected bag type's current costPerBag, read-only — never a
 * manually typed or qty-derived value.
 */
export default function BagPurchases() {
  const bagTypesQ = useBagTypes()
  const purchasesQ = useBagPurchases()
  const createPurchase = useCreateBagPurchase()

  const bagTypes = bagTypesQ.data ?? []
  const purchases = purchasesQ.data?.data ?? []

  const [bagTypeId, setBagTypeId] = useState('')
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(toDateOnlyString(new Date()))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const [toast, setToast] = useState('')
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2400) }

  // Past notes (brand/vendor names etc.) offered as autocomplete — a UI
  // convenience over free text, not a pricing mechanism.
  const knownNotes = [...new Set(purchases.map(p => p.notes).filter(Boolean))]

  const selectedBagType = bagTypes.find(b => b.id === bagTypeId) ?? null
  // The ONLY source for price on this page. null covers both "not configured
  // in Settings yet" and "hidden for this role" (BagTypesService strips
  // costPerBag for sales_rep/worker) — either way, there is no price to use,
  // and this page must never invent one to fill the gap.
  const settingsPrice = selectedBagType?.costPerBag ? parseFloat(selectedBagType.costPerBag) : null
  const qtyNum = parseInt(qty, 10)
  const total = settingsPrice != null && qtyNum > 0 ? qtyNum * settingsPrice : null

  function submit() {
    if (!bagTypeId) { setError('Select a bag type'); return }
    if (!qty || qtyNum <= 0) { setError('Enter quantity'); return }
    if (settingsPrice == null) { setError('This bag type has no price configured in Settings — set it there first'); return }
    setError('')
    createPurchase.mutate(
      {
        bagTypeId,
        quantity: qtyNum,
        unitCost: settingsPrice.toFixed(4),
        date,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          setQty(''); setNotes('')
          showToast('Purchase logged')
        },
        onError: (err: any) => setError(err?.error ?? 'Failed'),
      },
    )
  }

  return (
    <>
      <Topbar title="Bag purchases" />

      <div className="content">

        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 1fr 1fr 1.2fr auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <label className="form-label" style={{ fontSize: 11 }} htmlFor="bag-purchase-type">Bag type</label>
              <select
                id="bag-purchase-type"
                className="form-input"
                value={bagTypeId}
                onChange={e => { setBagTypeId(e.target.value); setError('') }}
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
              <label className="form-label" style={{ fontSize: 11 }} htmlFor="bag-purchase-qty">Quantity (bags)</label>
              <input
                id="bag-purchase-qty"
                className="form-input"
                type="number" min="1" placeholder="e.g. 1000"
                value={qty}
                onChange={e => setQty(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                style={{ fontFamily: "'IBM Plex Mono',monospace" }}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }} htmlFor="bag-purchase-price">Price / bag (Settings)</label>
              <input
                id="bag-purchase-price"
                className="form-input"
                readOnly
                value={settingsPrice != null ? `$${settingsPrice.toFixed(4)}` : (bagTypeId ? 'Not set in Settings' : '—')}
                style={{ fontFamily: "'IBM Plex Mono',monospace", color: settingsPrice != null ? 'var(--text)' : 'var(--text3)', background: 'var(--surface2)', cursor: 'not-allowed' }}
                title="From Settings → Bag types → Cost/bag — not editable here"
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }} htmlFor="bag-purchase-date">Date</label>
              <input id="bag-purchase-date" className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: 11 }} htmlFor="bag-purchase-notes-input">Notes (optional)</label>
              <input
                id="bag-purchase-notes-input"
                className="form-input"
                placeholder="e.g. Al Amin Packaging"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                list="bag-purchase-notes"
              />
              <datalist id="bag-purchase-notes">
                {knownNotes.map((n, i) => <option key={i} value={String(n)} />)}
              </datalist>
            </div>
            <button
              className="btn primary"
              onClick={submit}
              disabled={createPurchase.isPending}
              style={{ padding: '8px 16px' }}
            >
              <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add
            </button>
          </div>
          {total != null && (
            <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
              {qtyNum.toLocaleString()} × ${settingsPrice!.toFixed(4)} = <strong style={{ color: 'var(--accent)' }}>${total.toFixed(2)}</strong>
            </div>
          )}
          {error && (
            <div style={{ padding: '6px 18px', fontSize: 12, color: 'var(--red)', background: 'var(--red-bg)' }}>{error}</div>
          )}

          {/* Purchase history — one table, every purchase, newest first (matches the API's own ordering) */}
          {purchasesQ.isLoading && <div className="empty">Loading…</div>}
          {!purchasesQ.isLoading && purchases.length === 0 && (
            <div className="empty">No purchases yet — add the first one above.</div>
          )}
          {purchases.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bag type</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit price</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.bagType?.name ?? '—'}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{fmtDate(p.date)}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right' }}>{p.quantity.toLocaleString()}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', color: 'var(--text3)' }}>${parseFloat(p.unitCost).toFixed(4)}</td>
                    <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, textAlign: 'right', color: 'var(--accent)' }}>${parseFloat(p.totalCost).toFixed(2)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text3)' }}>{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
