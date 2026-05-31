import { useState, useRef } from 'react'
import Topbar from '../components/layout/Topbar'
import { useDailyPayments, useCashHandovers, useCreateCashHandover, useReceiverBalance, useAllBalances } from '../hooks/useCashHandover'
import { useStockExits } from '../hooks/useWarehouse'

function fmt2(n: number) { return `$${n.toFixed(2)}` }
function fmt0(n: number) { return `$${Math.round(n).toLocaleString()}` }
function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Expense { id: number; desc: string; amount: number }

export default function CashHandover() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [selectedReceiver, setSelectedReceiver] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [nextExpId, setNextExpId] = useState(1)
  const [handoverInput, setHandoverInput] = useState('')
  const [notes, setNotes] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // Live data
  const paymentsQ = useDailyPayments(selectedDate)
  const exitsQ = useStockExits({ dateFrom: selectedDate, dateTo: selectedDate, exitType: 'walk_in', limit: 200 })
  const historyQ = useCashHandovers({ dateFrom: selectedDate.slice(0, 7) + '-01', limit: 50 })
  const allBalancesQ = useAllBalances()
  const allBalances = allBalancesQ.data ?? []
  const createHandover = useCreateCashHandover()
  const receiverBalanceQ = useReceiverBalance(selectedReceiver)
  const receiverBalance = receiverBalanceQ.data

  // selectedReceiver is a User ID; look up name from balances list
  const selectedReceiverName = allBalances.find(b => b.userId === selectedReceiver)?.name ?? ''

  const dailyPayments = paymentsQ.data?.data ?? []
  const dailyExits = (exitsQ.data?.data ?? []).filter((e: any) => e.amount != null)

  // Cash collected = order payments + warehouse sale amounts
  // Payments tagged [ws] are auto-created from warehouse sales — already in saleCash via exits
  const orderCash = dailyPayments
    .filter(p => !((p.notes ?? '') as string).startsWith('[ws]'))
    .reduce((s, p) => s + parseFloat(p.amount), 0)
  const saleCash = dailyExits.reduce((s: number, e: any) => s + parseFloat(e.amount ?? '0'), 0)
  const totalCollected = orderCash + saleCash

  // For reconciliation: use the receiver's running balance when selected
  const receiverTotal = selectedReceiver && receiverBalance ? parseFloat(receiverBalance.balance) : totalCollected

  // Expenses
  const manualExpTotal = expenses.reduce((s, e) => s + e.amount, 0)
  const expected = receiverTotal - manualExpTotal
  const handed = parseFloat(handoverInput) || 0
  const diff = handed - expected

  function getDiff() {
    if (!handoverInput || handed === 0) return { cls: 'none', label: 'Enter amount above', val: '—', color: 'var(--text3)' }
    if (Math.abs(diff) < 0.01) return { cls: 'ok', label: 'Exact match ✓', val: '$0.00', color: 'var(--accent)' }
    if (diff < 0) return { cls: 'short', label: 'Short — receiver owes', val: `−${fmt2(Math.abs(diff))}`, color: 'var(--red)' }
    return { cls: 'over', label: 'Over — overpaid', val: `+${fmt2(diff)}`, color: 'var(--accent)' }
  }
  const diffInfo = getDiff()

  function showToast(msg: string) {
    setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  function confirmHandover() {
    if (!selectedReceiver) { showToast('Select a receiver'); return }
    createHandover.mutate(
      { date: selectedDate, receiverId: selectedReceiver, expectedAmt: expected.toFixed(2), handedAmt: handed.toFixed(2), notes: notes || null },
      {
        onSuccess: () => {
          setShowModal(false)
          showToast(`Handover confirmed — ${fmt2(handed)} from ${selectedReceiverName}`)
          setHandoverInput('')
          setNotes('')
          setExpenses([])
        },
      }
    )
  }

  const diffBg: Record<string, string> = { none: 'var(--surface2)', ok: 'var(--accent-bg)', over: 'var(--accent-bg)', short: 'var(--red-bg)' }
  const diffBorder: Record<string, string> = { none: '1px solid var(--border)', ok: '1px solid #a7f3d0', over: '1px solid #a7f3d0', short: '1px solid #fca5a5' }

  return (
    <>
      <Topbar title="Cash handover">
        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", outline: 'none', background: 'var(--surface)', color: 'var(--text2)' }} />
        <button className="btn" onClick={() => setShowHistory(h => !h)}>
          <i className="ti ti-history" style={{ fontSize: 15 }} /> {showHistory ? 'Hide history' : 'History'}
        </button>
      </Topbar>

      <div className="content">

        {/* KPI Row */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Collected today</div>
            <div className="kpi-value">{paymentsQ.isLoading ? '…' : fmt0(totalCollected)}</div>
            <div className="kpi-sub">{dailyPayments.length} payments + {dailyExits.length} sales</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Expenses deducted</div>
            <div className="kpi-value" style={{ color: 'var(--accent2)' }}>{fmt0(manualExpTotal)}</div>
            <div className="kpi-sub">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Expected handover</div>
            <div className="kpi-value">{fmt0(expected)}</div>
            <div className="kpi-sub">collected − expenses</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Handed over</div>
            <div className="kpi-value" style={{ color: handed > 0 ? 'var(--accent)' : 'var(--text3)' }}>
              {handed > 0 ? fmt0(handed) : '$0'}
            </div>
            <div className="kpi-sub">{handed > 0 ? 'logged this session' : 'pending'}</div>
          </div>
        </div>

        {/* Pending balances — every user with balance > 0 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Pending balances
          </div>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
            {allBalances.length} person{allBalances.length !== 1 ? 's' : ''} holding cash
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {allBalancesQ.isLoading && (
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading balances…</div>
          )}
          {!allBalancesQ.isLoading && allBalances.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--accent)', padding: '10px 16px', background: 'var(--accent-bg)', borderRadius: 'var(--radius-lg)', border: '1px solid #a7f3d0' }}>
              ✓ All clear — no one is holding unaccounted cash
            </div>
          )}
          {allBalances.map(b => {
            const initials = b.name.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
            const active = selectedReceiver === b.userId
            const bal = parseFloat(b.balance)
            return (
              <div key={b.userId}
                onClick={() => setSelectedReceiver(active ? '' : b.userId)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: active ? 'var(--text)' : 'var(--surface)', border: `1.5px solid ${active ? 'var(--text)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', cursor: 'pointer', minWidth: 200 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: active ? '#fff3' : 'var(--accent2-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: active ? '#fff' : 'var(--accent2)', flexShrink: 0 }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#fff' : 'var(--text)' }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: active ? '#fff8' : 'var(--text3)', textTransform: 'capitalize' }}>{b.role.replace('_', ' ')}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: active ? '#fff' : 'var(--accent2)' }}>
                    ${bal.toFixed(0)}
                  </div>
                  <div style={{ fontSize: 10, color: active ? '#fff8' : 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>balance</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Receiver balance card — shown when a receiver is selected */}
        {selectedReceiver && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <div className="card-title">
                <i className="ti ti-wallet" />
                {selectedReceiverName} — current cash balance
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {receiverBalance?.lastHandover && (
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                    last handover: {fmtDate(receiverBalance.lastHandover)}
                  </span>
                )}
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", color: parseFloat(receiverBalance?.total ?? '0') > 0 ? 'var(--accent2)' : 'var(--accent)' }}>
                  {receiverBalanceQ.isLoading ? '…' : `$${parseFloat(receiverBalance?.total ?? '0').toFixed(2)}`}
                </div>
              </div>
            </div>

            {receiverBalance && (receiverBalance.payments.length > 0 || receiverBalance.exits.length > 0) ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From / description</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receiverBalance.payments.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{fmtDate(p.date)}</td>
                      <td style={{ fontWeight: 500 }}>{p.clientName}</td>
                      <td><span className="badge badge-blue">{p.method}</span></td>
                      <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>${parseFloat(p.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  {receiverBalance.exits.map(e => (
                    <tr key={e.id}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{fmtDate(e.date)}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{e.recipient ?? 'Walk-in'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.description}</div>
                      </td>
                      <td><span className="badge badge-amber">Sale</span></td>
                      <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>${parseFloat(e.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <td colSpan={3} style={{ padding: '10px 18px', fontWeight: 600 }}>Total held by {selectedReceiverName}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent2)' }}>
                      ${parseFloat(receiverBalance.balance).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              !receiverBalanceQ.isLoading && (
                <div className="empty">{selectedReceiverName} has no uncollected cash — balance is $0.00.</div>
              )
            )}
          </div>
        )}

        <div className="two-col">

          {/* LEFT: Cash collected + Expenses */}
          <div className="stack">

            {/* Warehouse sales for the day */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-building-warehouse" /> Warehouse sales — {selectedDate}</div>
                <span className="badge badge-gray">{dailyExits.length} sale{dailyExits.length !== 1 ? 's' : ''}</span>
              </div>
              {exitsQ.isLoading && <div className="empty">Loading…</div>}
              {!exitsQ.isLoading && dailyExits.length === 0 && (
                <div className="empty">No warehouse sales with recorded amounts on this day.</div>
              )}
              {dailyExits.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Logged by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyExits.map((e: any) => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 500 }}>{e.recipient ?? '—'}</td>
                        <td>
                          {e.lotId
                            ? <span className="badge badge-amber">By kg — {parseFloat(e.kgQuantity ?? '0').toFixed(1)} kg</span>
                            : <span>{e.bagType?.name ?? '—'} × {e.quantity}</span>
                          }
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>
                          {fmt2(parseFloat(e.amount))}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{e.loggedBy?.name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td colSpan={2} style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600 }}>Total sales</td>
                      <td style={{ padding: '10px 18px', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>{fmt2(saleCash)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Order payments for the day */}
            {dailyPayments.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-cash" /> Order payments — {selectedDate}</div>
                  <span className="badge badge-gray">{dailyPayments.length} payment{dailyPayments.length !== 1 ? 's' : ''}</span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Method</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyPayments.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>{(p as any).client?.name ?? p.clientId.slice(0, 8)}</td>
                        <td><span className="badge badge-gray">{p.method}</span></td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>
                          {fmt2(parseFloat(p.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td colSpan={2} style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600 }}>Total payments</td>
                      <td style={{ padding: '10px 18px', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: 'var(--accent)' }}>{fmt2(orderCash)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Expenses */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-gas-station" /> Expenses (kept from collection)</div>
                <button className="btn" style={{ fontSize: 12 }} onClick={() => { setExpenses(p => [...p, { id: nextExpId, desc: '', amount: 0 }]); setNextExpId(n => n + 1) }}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add
                </button>
              </div>
              {expenses.length === 0 && <div className="empty">No expenses logged. Use + to add.</div>}
              {expenses.map(exp => (
                <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                  <i className="ti ti-notes" style={{ fontSize: 14, color: 'var(--text3)' }} />
                  <input
                    value={exp.desc} placeholder="Expense description"
                    onChange={e => setExpenses(p => p.map(x => x.id === exp.id ? { ...x, desc: e.target.value } : x))}
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", color: 'var(--text)', background: 'transparent' }}
                  />
                  <input
                    type="number" value={exp.amount || ''}
                    onChange={e => setExpenses(p => p.map(x => x.id === exp.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))}
                    style={{ width: 90, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', outline: 'none', background: 'var(--surface)' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>$</span>
                  <button onClick={() => setExpenses(p => p.filter(x => x.id !== exp.id))}
                    style={{ width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
                    <i className="ti ti-x" style={{ fontSize: 11 }} />
                  </button>
                </div>
              ))}
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Total expenses deducted</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent2)' }}>{fmt2(manualExpTotal)}</span>
              </div>
            </div>
          </div>

          {/* RIGHT: Reconciliation panel */}
          <div>
            <div className="cash-box" style={{ position: 'sticky', top: 76 }}>
              <div className="cb-head">
                <div className="cb-title"><i className="ti ti-calculator" style={{ fontSize: 14 }} /> Reconciliation</div>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{selectedDate}</span>
              </div>

              {selectedReceiver && receiverBalance ? (
                <div className="cb-row">
                  <span className="cb-label">Held by {selectedReceiverName}</span>
                  <span className="cb-val green">{fmt2(parseFloat(receiverBalance.balance))}</span>
                </div>
              ) : (
                <>
                  <div className="cb-row">
                    <span className="cb-label">Cash from sales</span>
                    <span className="cb-val green">{fmt2(saleCash)}</span>
                  </div>
                  <div className="cb-row">
                    <span className="cb-label">Order payments</span>
                    <span className="cb-val green">{fmt2(orderCash)}</span>
                  </div>
                </>
              )}
              <div className="cb-row">
                <span className="cb-label">− Expenses kept</span>
                <span className="cb-val amber">−{fmt2(manualExpTotal)}</span>
              </div>
              <div className="cb-total">
                <span className="cb-total-label">Expected handover</span>
                <span className="cb-total-val">{fmt2(expected)}</span>
              </div>

              <div className="handover-section">
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>
                  Cash handed over
                </label>
                <input
                  className="handover-inp"
                  type="number" placeholder="0.00"
                  value={handoverInput}
                  onChange={e => setHandoverInput(e.target.value)}
                />
                <div className={`handover-diff ${diffInfo.cls}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 'var(--radius)', marginBottom: 10, background: diffBg[diffInfo.cls], border: diffBorder[diffInfo.cls] }}>
                  <span style={{ fontSize: 12 }}>{diffInfo.label}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14, color: diffInfo.color }}>{diffInfo.val}</span>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. client will pay tomorrow"
                    className="form-input" />
                </div>

                <button
                  className="submit-btn"
                  disabled={handed <= 0 || !selectedReceiver || createHandover.isPending}
                  onClick={() => setShowModal(true)}
                >
                  <i className="ti ti-check" /> {createHandover.isPending ? 'Saving…' : 'Confirm handover'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Handover history */}
        {showHistory && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Handover history</div>
              <button className="btn" onClick={() => setShowHistory(false)}>✕ Close</button>
            </div>
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-history" /> All handovers</div>
              </div>
              {historyQ.isLoading && <div className="empty">Loading…</div>}
              {!historyQ.isLoading && (historyQ.data?.data ?? []).length === 0 && (
                <div className="empty">No handovers recorded yet.</div>
              )}
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receiver</th>
                    <th style={{ textAlign: 'right' }}>Expected</th>
                    <th style={{ textAlign: 'right' }}>Handed over</th>
                    <th style={{ textAlign: 'right' }}>Difference</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyQ.data?.data ?? []).map((h: any) => {
                    const d = parseFloat(h.difference)
                    return (
                      <tr key={h.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{fmtDate(h.date)}</td>
                        <td style={{ fontWeight: 500 }}>{h.receiverName}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{fmt2(parseFloat(h.expectedAmt))}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>{fmt2(parseFloat(h.handedAmt))}</td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: Math.abs(d) < 0.01 ? 'var(--accent)' : d < 0 ? 'var(--red)' : 'var(--accent2)' }}>
                          {Math.abs(d) < 0.01 ? '✓' : d > 0 ? `+${fmt2(d)}` : fmt2(d)}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{h.notes ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* Confirm modal */}
      {showModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-head">
              <div className="modal-title">Confirm handover — {selectedReceiverName}</div>
              <button className="panel-close-btn" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[
                  ['Total collected', fmt2(totalCollected)],
                  ['Expenses deducted', `−${fmt2(manualExpTotal)}`],
                  ['Expected handover', fmt2(expected)],
                  ['Actual handed over', fmt2(handed)],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--text2)' }}>{label}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: diffBg[diffInfo.cls], border: diffBorder[diffInfo.cls], display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{diffInfo.label}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: diffInfo.color }}>{diffInfo.val}</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}
                onClick={confirmHandover} disabled={createHandover.isPending}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> Confirm &amp; log handover
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast show">
          <i className="ti ti-check-circle" /> <span>{toast}</span>
        </div>
      )}
    </>
  )
}
