import { useState } from 'react'
import { useDriverTrips, useStartTrip, useCompleteTrip } from '../hooks/useDriverTrips'
import { useShipments, useConfirmDelivery, useLogActualWeight } from '../hooks/useShipments'
import { useBagTypes } from '../hooks/useBagTypes'
import { useRate } from '../context/RateContext'
import type { ShipmentStatus } from '../types/api'

type Screen = 'login' | 'trip' | 'confirm' | 'success' | 'expenses'

const mono = "'IBM Plex Mono', monospace"
const sans = "'IBM Plex Sans', sans-serif"

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}
function shipBadge(s: ShipmentStatus): string {
  return s === 'delivered' ? 'Delivered' : s === 'loaded' ? 'Next stop' : s === 'returned' ? 'Returned' : 'Pending'
}

interface Expense { id: number; desc: string; amount: string }

export default function DriverMobile() {
  const [screen, setScreen] = useState<Screen>('login')
  const [driver, setDriver] = useState<{ initials: string; name: string; id: string } | null>(null)
  const rateCtx = useRate()

  // Live trips + shipments + mutations.
  const tripsQ = useDriverTrips({ limit: 100 })
  const shipmentsQ = useShipments({ limit: 100 })
  const bagTypesQ = useBagTypes()
  const bagTypeNameById = new Map((bagTypesQ.data ?? []).map(b => [b.id, b.name]))
  const startTripM = useStartTrip()
  const completeTripM = useCompleteTrip()
  const confirmDeliveryM = useConfirmDelivery()
  const logActualWeightM = useLogActualWeight()

  const trips = tripsQ.data?.data ?? []
  const allShipments = shipmentsQ.data?.data ?? []

  // Login list: one row per driver trip (driverId is the only identity the API carries).
  const DRIVERS = trips.map(t => ({
    initials: initials(t.driverId.slice(0, 2)),
    name: t.driverId.slice(0, 8),
    stops: allShipments.filter(s => s.tripId === t.id).length,
    avBg: 'var(--blue-bg)',
    avColor: 'var(--blue)',
    tripId: t.id,
  }))

  // Stops for the active driver's trip, mapped to the stop view-model.
  const driverTrip = trips.find(t => t.driverId.slice(0, 8) === driver?.name) ?? trips[0]
  const STOPS = allShipments
    .filter(s => driverTrip && s.tripId === driverTrip.id)
    .map((s, idx) => ({
      n: idx + 1,
      id: s.id,
      client: s.address,
      addr: s.address,
      bags: s.bags.map(b => `${b.quantity}×${bagTypeNameById.get(b.bagTypeId) ?? b.bagTypeId.slice(0, 4)}`),
      kgNom: `${parseFloat(s.nominalKg).toFixed(0)} kg nom.`,
      inv: s.displayId ?? s.id.slice(0, 8),
      state: s.status === 'delivered' ? 'done' : s.status === 'loaded' ? 'active' : 'pending',
      badge: shipBadge(s.status),
      invId: s.id,
    }))
  const [payUsd, setPayUsd] = useState('')
  const [payLbp, setPayLbp] = useState('')
  const [onAccount, setOnAccount] = useState(false)
  const [method, setMethod] = useState('Cash')
  const [actualKg, setActualKg] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([{ id: 1, desc: 'Fuel', amount: '' }, { id: 2, desc: '', amount: '' }])
  const [nextExpId, setNextExpId] = useState(3)

  // TODO: derive from shipment's order invoice total (backend sub-task)
  const INVOICE_TOTAL = 0
  const usd = parseFloat(payUsd) || 0
  const lbp = parseFloat(payLbp) || 0
  const lbpAsUsd = lbp / (parseInt(rateCtx.rate.replace(/,/g, ''), 10) || 89550)
  const totalPay = usd + lbpAsUsd
  const payDiff = totalPay - INVOICE_TOTAL
  const expTotal = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
  // TODO: sum payment_amounts from completed shipments in this trip (backend sub-task)
  const collected = 0

  function go(s: Screen) { setScreen(s); window.scrollTo(0, 0) }

  function startTrip(d: typeof DRIVERS[number]) {
    setDriver({ initials: d.initials, name: d.name, id: d.tripId })
    // Mark the trip in-progress if it has not started yet.
    const t = trips.find(tr => tr.id === d.tripId)
    if (t && t.status === 'planned') startTripM.mutate(d.tripId)
    go('trip')
  }

  // The shipment currently being confirmed (first active stop).
  const activeStop = STOPS.find(s => s.state === 'active')

  // Confirm delivery of the active stop with the collected payment + actual weight.
  function confirmActiveDelivery() {
    if (!activeStop) { go('success'); return }
    if (actualKg) logActualWeightM.mutate({ id: activeStop.id, body: { actualKg } })
    confirmDeliveryM.mutate(
      {
        id: activeStop.id,
        body: {
          actualKg: actualKg || undefined,
          paymentAmount: onAccount ? undefined : (usd + lbp / (parseInt(rateCtx.rate.replace(/,/g, ''), 10) || 89550)).toFixed(2),
        },
      },
      { onSuccess: () => go('success') },
    )
  }

  // Complete the whole trip (from the expenses screen) with logged fuel/other costs.
  function completeTrip() {
    if (driverTrip) {
      const fuel = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
      completeTripM.mutate({ id: driverTrip.id, body: { fuelCost: fuel.toFixed(2) } })
    }
    go('trip')
  }

  function addExpense() {
    setExpenses(p => [...p, { id: nextExpId, desc: '', amount: '' }])
    setNextExpId(p => p + 1)
  }

  function removeExpense(id: number) { setExpenses(p => p.filter(e => e.id !== id)) }
  function updateExpense(id: number, field: 'desc' | 'amount', val: string) {
    setExpenses(p => p.map(e => e.id === id ? { ...e, [field]: val } : e))
  }

  const payBarState = totalPay === 0 ? 'none' : totalPay >= INVOICE_TOTAL ? 'ok' : 'short'
  const payBarStyles = {
    none:  { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text3)' },
    ok:    { background: 'var(--accent-bg)', border: '1px solid #a7f3d0', color: 'var(--accent)' },
    short: { background: 'var(--accent2-bg)', border: '1px solid #fcd34d', color: 'var(--accent2)' },
  }
  const payBarLabel = totalPay === 0 ? 'Enter amount received' : totalPay >= INVOICE_TOTAL ? (payDiff > 0 ? `Over by $${payDiff.toFixed(2)}` : 'Full payment ✓') : `$${(INVOICE_TOTAL - totalPay).toFixed(2)} will go on account`

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      <div style={{ width: '100%', maxWidth: 420, minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* ══ LOGIN ══ */}
        {screen === 'login' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '32px 24px' }}>
            <div style={{ width: 60, height: 60, background: 'var(--text)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <i className="ti ti-flame" style={{ color: '#fff', fontSize: 30 }} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, marginBottom: 4 }}>Farah Driver</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 32, textAlign: 'center' }}>Select your name to start your shift</div>
            <div style={{ width: '100%' }}>
              {tripsQ.isLoading && [0, 1].map(i => (
                <div key={i} style={{ padding: '14px 16px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 10 }}>
                  <div className="skeleton" style={{ width: '50%', height: 14, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: '30%', height: 12 }} />
                </div>
              ))}
              {tripsQ.isError && (
                <div className="empty">Failed to load trips.<div><button className="btn" style={{ marginTop: 10 }} onClick={() => tripsQ.refetch()}>Retry</button></div></div>
              )}
              {!tripsQ.isLoading && !tripsQ.isError && DRIVERS.length === 0 && (
                <div className="empty">No trips scheduled.</div>
              )}
              {DRIVERS.map(d => (
                <div key={d.initials} onClick={() => startTrip(d)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 10, cursor: 'pointer' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: d.avBg, color: d.avColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{d.initials}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: mono }}>driver · {d.stops} stops today</div>
                  </div>
                  <i className="ti ti-arrow-right" style={{ color: 'var(--text3)' }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ TRIP ══ */}
        {screen === 'trip' && (
          <>
            <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 18px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>{driver?.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: mono }}>Thursday 21 May 2026</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div onClick={() => go('expenses')} style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Log expenses">
                  <i className="ti ti-gas-station" style={{ fontSize: 16, color: 'var(--text2)' }} />
                </div>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue-bg)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{driver?.initials}</div>
              </div>
            </div>
            <div style={{ padding: 18, flex: 1 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontFamily: mono, color: 'var(--text3)' }}>TRP-0091</span>
                  <span className="badge badge-blue">In progress</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[{ val: '3', lbl: 'Stops', color: undefined }, { val: '1', lbl: 'Done', color: 'var(--accent)' }, { val: '890 kg', lbl: 'Total load', color: undefined }].map(s => (
                    <div key={s.lbl} style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1, marginBottom: 3, color: s.color }}>{s.val}</div>
                      <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase' }}>{s.lbl}</div>
                    </div>
                  ))}
                </div>
                <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 100, overflow: 'hidden', marginTop: 12 }}>
                  <div style={{ height: '100%', borderRadius: 100, background: 'var(--accent)', width: '33%' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: mono, color: 'var(--text3)' }}>
                  <span>1 of 3 delivered</span><span>33%</span>
                </div>
              </div>

              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Delivery stops</p>

              {STOPS.map(s => (
                <div key={s.n} onClick={() => s.state === 'active' ? go('confirm') : undefined} style={{ background: 'var(--surface)', border: `2px solid ${s.state === 'active' ? 'var(--blue)' : s.state === 'done' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12, cursor: s.state === 'active' ? 'pointer' : 'default', opacity: s.state === 'done' ? 0.7 : 1, boxShadow: s.state === 'active' ? '0 0 0 3px rgba(29,78,216,0.1)' : 'none' }}>
                  <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0, marginTop: 1, ...(s.state === 'done' ? { background: 'var(--accent)', color: '#fff' } : s.state === 'active' ? { background: 'var(--blue)', color: '#fff' } : { background: 'var(--surface2)', color: 'var(--text3)', border: '1.5px solid var(--border)' }) }}>
                      {s.state === 'done' ? <i className="ti ti-check" style={{ fontSize: 12 }} /> : s.n}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{s.client}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}><i className="ti ti-map-pin" style={{ fontSize: 11 }} /> {s.addr}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.bags.map(b => <span key={b} style={{ fontSize: 11, fontFamily: mono, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px', color: 'var(--text2)' }}>{b}</span>)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span className={`badge ${s.state === 'done' ? 'badge-green' : s.state === 'active' ? 'badge-blue' : 'badge-gray'}`}>{s.badge}</span>
                      <div style={{ fontSize: 12, fontFamily: mono, color: 'var(--text2)', marginTop: 4 }}>{s.kgNom}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: mono, marginTop: 2 }}>{s.inv}</div>
                    </div>
                  </div>
                  {s.state === 'done' && (
                    <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--accent)' }}>
                      <i className="ti ti-check-circle" style={{ fontSize: 15 }} />
                      Delivered 08:52 · Receipt printed · $840 cash collected
                    </div>
                  )}
                  {s.state === 'active' && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--blue-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>Tap to confirm delivery</span>
                      <button onClick={() => go('confirm')} style={{ padding: '8px 16px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: sans, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ti ti-truck" style={{ fontSize: 14 }} /> Deliver
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ══ CONFIRM ══ */}
        {screen === 'confirm' && (
          <>
            <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 18px 12px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 10 }}>
              <div onClick={() => go('trip')} style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <i className="ti ti-arrow-left" style={{ fontSize: 16, color: 'var(--text2)' }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Confirm delivery</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: mono }}>Stop 2 of 3</div>
              </div>
            </div>
            <div style={{ padding: 18, flex: 1, paddingBottom: 100 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 3 }}>Chez Michel</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <i className="ti ti-map-pin" style={{ fontSize: 13 }} /> Achrafieh, Beirut
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: mono, marginTop: 4 }}>INV-0339 · 50×2kg bag + 10×5kg bag</div>
              </div>

              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Items to deliver</p>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 14 }}>
                {[{ name: '2 kg bag', type: 'BBQ Hardwood Grade A', qty: '50 bags', total: '$140.00' }, { name: '5 kg bag', type: 'BBQ Hardwood Grade A', qty: '10 bags', total: '$140.00' }].map((line, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{line.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{line.type}</div>
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 12, color: 'var(--text2)' }}>{line.qty}</div>
                    <div style={{ fontFamily: mono, fontWeight: 600 }}>{line.total}</div>
                  </div>
                ))}
                <div style={{ padding: '10px 16px', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}>
                  <span>Invoice total</span><span style={{ fontFamily: mono }}>$280.00</span>
                </div>
              </div>

              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Actual weight loaded</p>
              <div style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Weigh the load before delivery</div>
                <input type="number" value={actualKg} onChange={e => setActualKg(e.target.value)} placeholder="0" inputMode="decimal" style={{ fontSize: 42, fontWeight: 600, fontFamily: mono, letterSpacing: -2, lineHeight: 1, width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'center', color: 'var(--text)' }} />
                <div style={{ fontSize: 14, color: 'var(--text3)', textAlign: 'center', marginTop: 4 }}>kilograms</div>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>Nominal: 150 kg (50×2 + 10×5)</div>
              </div>

              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Payment collected</p>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 14 }}>
                <div style={{ padding: '12px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <i className="ti ti-cash" style={{ fontSize: 14, color: 'var(--text2)' }} /> Amount received — USD, LBP, or split
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)' }}>
                    <span>Invoice total</span><span style={{ fontFamily: mono, fontWeight: 600 }}>$280.00</span>
                  </div>
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 12 }}>
                    {[{ label: 'USD', value: payUsd, onChange: setPayUsd, placeholder: '0.00', curr: '$', eq: usd > 0 ? `=$${usd.toFixed(2)}` : '' }, { label: 'LBP', value: payLbp, onChange: setPayLbp, placeholder: '0', curr: 'LL', eq: lbp > 0 ? `≈$${lbpAsUsd.toFixed(2)}` : '', opt: true }].map((row, i) => (
                      <div key={row.label}>
                        {i === 1 && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text3)', padding: '2px 0' }}>+ optional</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i === 0 ? 0 : 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, minWidth: 40 }}>{row.label}</span>
                          <input type="number" value={row.value} onChange={e => row.onChange(e.target.value)} placeholder={row.placeholder} inputMode="decimal" style={{ flex: 1, padding: '10px 12px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 16, fontFamily: mono, textAlign: 'right', outline: 'none', background: 'var(--surface)' }} />
                          <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: mono, minWidth: 28 }}>{row.curr}</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: mono, minWidth: 70, textAlign: 'right' }}>{row.eq}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderRadius: 'var(--radius)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, fontSize: 13, ...payBarStyles[payBarState] }}>
                    <span>{payBarLabel}</span>
                    <span style={{ fontFamily: mono, fontWeight: 600 }}>{totalPay > 0 ? `$${totalPay.toFixed(2)}` : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 0 }}>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text2)' }}>Goes on account (pay later)</span>
                    <div onClick={() => setOnAccount(p => !p)} style={{ width: 40, height: 22, borderRadius: 100, background: onAccount ? 'var(--accent)' : 'var(--border)', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
                      <div style={{ position: 'absolute', top: 3, left: onAccount ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.15s' }} />
                    </div>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Payment method</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {['Cash', 'Whish', 'OMT'].map(m => (
                  <div key={m} onClick={() => setMethod(m)} style={{ flex: 1, padding: '10px 8px', border: `1.5px solid ${method === m ? 'var(--text)' : 'var(--border)'}`, borderRadius: 'var(--radius)', textAlign: 'center', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: method === m ? 'var(--text)' : 'var(--surface)', color: method === m ? '#fff' : 'var(--text2)' }}>
                    {m}
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Receipt preview</p>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 14 }}>
                <div style={{ padding: 18, fontFamily: mono, fontSize: 12, lineHeight: 1.8, background: '#fff' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center', marginBottom: 2 }}>FARAH CHARCOAL</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginBottom: 12 }}>Delivery Receipt</div>
                  <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
                  {[['Date', '21 May 2026 09:41'], ['Receipt #', 'INV-0339'], ['Client', 'Chez Michel'], ['Address', 'Achrafieh, Beirut'], ['Driver', driver?.name || '']].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '1px 0' }}><span>{k}</span><span>{v}</span></div>
                  ))}
                  <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>50 × 2kg bag</span><span>$140.00</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>10 × 5kg bag</span><span>$140.00</span></div>
                  <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 12, borderTop: '1px dashed var(--border)', paddingTop: 6, marginTop: 4 }}><span>TOTAL</span><span>$280.00</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)', fontWeight: 600 }}>
                    <span>COLLECTED</span>
                    <span>{onAccount ? '$0.00' : totalPay > 0 ? `$${totalPay.toFixed(2)}` : '—'}</span>
                  </div>
                  {(onAccount || (!onAccount && totalPay < INVOICE_TOTAL && totalPay > 0)) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent2)' }}>
                      <span>ON ACCOUNT</span>
                      <span>${onAccount ? '280.00' : (INVOICE_TOTAL - totalPay).toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text3)' }}>
                    <div style={{ borderTop: '1px solid var(--text3)', marginTop: 20, paddingTop: 3 }}>Client signature</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                  <button onClick={confirmActiveDelivery} disabled={confirmDeliveryM.isPending} style={{ flex: 1, padding: 10, borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: sans, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--text)', color: '#fff', border: '1.5px solid var(--text)' }}>
                    <i className="ti ti-printer" style={{ fontSize: 15 }} /> {confirmDeliveryM.isPending ? 'Confirming…' : 'Print & confirm'}
                  </button>
                  <button onClick={confirmActiveDelivery} disabled={confirmDeliveryM.isPending} style={{ flex: 1, padding: 10, borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, fontFamily: sans, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--surface)', color: 'var(--text2)', border: '1.5px solid var(--border)' }}>
                    Skip print
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══ SUCCESS ══ */}
        {screen === 'success' && (
          <>
            <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 18px 12px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 10 }}>
              <div onClick={() => go('trip')} style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <i className="ti ti-arrow-left" style={{ fontSize: 16, color: 'var(--text2)' }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Delivery confirmed</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 24px' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--accent-bg)', border: '2px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)' }}>
                <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 36 }} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Stop 2 confirmed</div>
              <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 28 }}>Chez Michel — Achrafieh · Receipt printed</div>
              <div style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 24 }}>
                {[{ label: 'Bags delivered', val: '60 bags' }, { label: 'Actual weight', val: actualKg ? `${actualKg} kg` : '148 kg' }, { label: 'Collected', val: totalPay > 0 ? `$${totalPay.toFixed(2)} collected` : 'On account', color: 'var(--accent)' }].map((r, i) => (
                  <div key={r.label} style={{ padding: '12px 16px', borderBottom: i < 2 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text2)' }}>{r.label}</span>
                    <span style={{ fontFamily: mono, fontWeight: 600, color: r.color }}>{r.val}</span>
                  </div>
                ))}
              </div>
              <div style={{ width: '100%', background: 'var(--accent-bg)', border: '1px solid #a7f3d0', borderRadius: 'var(--radius-lg)', padding: 14, marginBottom: 24, fontSize: 13, color: 'var(--accent)' }}>
                <strong>1 stop remaining</strong> — Cedar Grill House, Jdeideh
              </div>
              <button onClick={() => go('trip')} style={{ width: '100%', padding: 15, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-lg)', fontSize: 15, fontWeight: 600, fontFamily: sans, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <i className="ti ti-arrow-right" style={{ fontSize: 15 }} /> Continue to next stop
              </button>
              <style>{`@keyframes popIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
            </div>
          </>
        )}

        {/* ══ EXPENSES ══ */}
        {screen === 'expenses' && (
          <>
            <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 18px 12px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 10 }}>
              <div onClick={() => go('trip')} style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <i className="ti ti-arrow-left" style={{ fontSize: 16, color: 'var(--text2)' }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Trip expenses</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: mono }}>Kept from cash collected</div>
              </div>
            </div>
            <div style={{ padding: 18, flex: 1, paddingBottom: 100 }}>
              <p style={{ fontSize: 11, fontFamily: mono, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Fuel &amp; road costs</p>
              {expenses.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <input type="text" value={e.desc} onChange={ev => updateExpense(e.id, 'desc', ev.target.value)} placeholder="Description" style={{ flex: 1, padding: '10px 12px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, fontFamily: sans, outline: 'none', background: 'var(--surface)' }} />
                  <input type="number" value={e.amount} onChange={ev => updateExpense(e.id, 'amount', ev.target.value)} placeholder="0" style={{ width: 90, padding: '10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 14, fontFamily: mono, textAlign: 'right', outline: 'none', background: 'var(--surface)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>$</span>
                  <button onClick={() => removeExpense(e.id)} style={{ width: 34, height: 42, borderRadius: 'var(--radius)', border: '1.5px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexShrink: 0 }}>
                    <i className="ti ti-x" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
              <button onClick={addExpense} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontFamily: sans, fontWeight: 500, marginBottom: 20 }}>
                <i className="ti ti-plus" style={{ fontSize: 15 }} /> Add expense
              </button>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                {[{ label: 'Total collected today', val: `$${collected.toFixed(2)}`, color: 'var(--accent)', border: true }, { label: 'Total expenses', val: `$${expTotal.toFixed(2)}`, color: 'var(--accent2)', border: true }, { label: 'To hand over', val: `$${(collected - expTotal).toFixed(2)}`, color: 'var(--text)', bold: true }].map((r, i) => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: i === 2 ? 14 : 13, padding: '5px 0', borderBottom: r.border ? '1px solid var(--border)' : 'none', paddingTop: i === 2 ? 8 : 5, marginTop: i === 2 ? 4 : 0, borderTop: i === 2 ? '1px solid var(--border)' : 'none', fontWeight: r.bold ? 600 : 400 }}>
                    <span style={{ color: 'var(--text2)' }}>{r.label}</span>
                    <span style={{ fontFamily: mono, fontWeight: 600, color: r.color }}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px 18px', background: 'var(--surface)', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0 }}>
              <button onClick={completeTrip} disabled={completeTripM.isPending} style={{ width: '100%', padding: 15, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-lg)', fontSize: 15, fontWeight: 600, fontFamily: sans, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <i className="ti ti-check" style={{ fontSize: 15 }} /> {completeTripM.isPending ? 'Saving…' : 'Save expenses & complete trip'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
