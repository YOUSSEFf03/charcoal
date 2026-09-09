import { useState, useRef, useEffect } from 'react'
import Topbar from '../components/layout/Topbar'
import { useDailyPayments, useCashHandovers, useCreateCashHandover, useReceiverBalance, useAllBalances } from '../hooks/useCashHandover'
import { useExpenseCategories, useCreateExpenseCategory } from '../hooks/useExpenseCategories'
import { useStockExits } from '../hooks/useWarehouse'
import { formatUsd } from '../lib/money'
import { formatDate, toDateOnlyString, currentMonthToDateRange } from '../lib/date'

function fmt2(n: number) { return formatUsd(n, { decimals: 2 }) }
function fmt0(n: number) { return formatUsd(n, { decimals: 0 }) }
function fmtDate(iso: string) { return formatDate(iso) }

// Forensic audit (2026-08-31): "Expenses + Cash Handover expense selection
// redesign" — an expense row now selects an existing, reusable
// ExpenseCategory (or creates one via "+ Add new expense") instead of typing
// free text. categoryName is display-only, kept alongside categoryId purely
// so the row can render its label without a lookup — categoryId is the only
// field actually sent to the backend (see confirmHandover()).
interface Expense { id: number; categoryId: string; categoryName: string; amount: number }
const NEW_CATEGORY_VALUE = '__new__'

export default function CashHandover() {
  const [selectedDate, setSelectedDate] = useState(toDateOnlyString(new Date()))
  const [selectedReceiver, setSelectedReceiver] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [nextExpId, setNextExpId] = useState(1)
  const [handoverInput, setHandoverInput] = useState('')
  const [notes, setNotes] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // Handover history — filters are independent of the reconciliation day
  // picker above (selectedDate): previously history silently reused
  // selectedDate to derive "current month", so changing the reconciliation
  // day for today's handover also silently changed which past handovers the
  // history table showed. Same search/date-range/pagination architecture as
  // the Invoices page.
  const HISTORY_PAGE_SIZE = 20
  const [historySearch, setHistorySearch] = useState('')
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState('')
  const [historyDateRange, setHistoryDateRange] = useState('This month')
  const [historyCustomFrom, setHistoryCustomFrom] = useState('')
  const [historyCustomTo, setHistoryCustomTo] = useState('')
  const [historyPage, setHistoryPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedHistorySearch(historySearch), 300)
    return () => clearTimeout(t)
  }, [historySearch])

  // toDateOnlyString (local calendar-day parts), never toISOString().slice(0,10)
  // — the latter converts to UTC first and silently rolls the date back by
  // one day for a timezone ahead of UTC (Beirut, UTC+3), e.g. "This month"
  // opening on 31 July instead of 1 August. Reuses the same helper (and, for
  // "This month", the exact same currentMonthToDateRange()) already used
  // elsewhere in the app for this identical calculation.
  const historyToday = new Date()
  const { dateFrom: historyDateFrom, dateTo: historyDateTo } = (() => {
    if (historyDateRange === 'This month') return currentMonthToDateRange()
    if (historyDateRange === 'Last month') return {
      dateFrom: toDateOnlyString(new Date(historyToday.getFullYear(), historyToday.getMonth() - 1, 1)),
      dateTo: toDateOnlyString(new Date(historyToday.getFullYear(), historyToday.getMonth(), 0)),
    }
    if (historyDateRange === 'Custom') return { dateFrom: historyCustomFrom || undefined, dateTo: historyCustomTo || undefined }
    return { dateFrom: undefined, dateTo: undefined }
  })()

  // Any server-side filter change must land back on page 1 — otherwise a
  // user on page 3 of "All time" could apply a filter with only 1 matching
  // page and see an empty page 3 instead of their results.
  useEffect(() => { setHistoryPage(1) }, [debouncedHistorySearch, historyDateRange, historyCustomFrom, historyCustomTo])

  function resetHistoryFilters() {
    setHistorySearch('')
    setHistoryDateRange('All time')
    setHistoryCustomFrom('')
    setHistoryCustomTo('')
  }

  // Live data
  const paymentsQ = useDailyPayments(selectedDate)
  const exitsQ = useStockExits({ dateFrom: selectedDate, dateTo: selectedDate, exitType: 'walk_in', limit: 200 })
  const historyQ = useCashHandovers({
    search: debouncedHistorySearch || undefined,
    dateFrom: historyDateFrom,
    dateTo: historyDateTo,
    page: historyPage,
    limit: HISTORY_PAGE_SIZE,
  })
  const historyRows = historyQ.data?.data ?? []
  const historyTotal = historyQ.data?.total ?? 0
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))
  const historyFilterActive = historySearch !== '' || historyDateRange !== 'All time'
  const allBalancesQ = useAllBalances()
  const allBalances = allBalancesQ.data ?? []
  const createHandover = useCreateCashHandover()
  const receiverBalanceQ = useReceiverBalance(selectedReceiver)
  const receiverBalance = receiverBalanceQ.data
  const categoriesQ = useExpenseCategories()
  const categories = categoriesQ.data ?? []
  const createCategory = useCreateExpenseCategory()

  // "+ Add new expense" — which expense row (by id) is currently prompting
  // for a new category name. null when no such prompt is open.
  const [newCategoryForRowId, setNewCategoryForRowId] = useState<number | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')

  function handleCategorySelect(rowId: number, value: string) {
    if (value === NEW_CATEGORY_VALUE) {
      setNewCategoryForRowId(rowId)
      setNewCategoryName('')
      return
    }
    const cat = categories.find(c => c.id === value)
    setExpenses(p => p.map(x => x.id === rowId ? { ...x, categoryId: value, categoryName: cat?.name ?? '' } : x))
  }

  async function confirmNewCategory() {
    const name = newCategoryName.trim()
    if (!name || newCategoryForRowId == null) return
    try {
      const cat = await createCategory.mutateAsync(name)
      setExpenses(p => p.map(x => x.id === newCategoryForRowId ? { ...x, categoryId: cat.id, categoryName: cat.name } : x))
      setNewCategoryForRowId(null)
      setNewCategoryName('')
    } catch (err: any) {
      showToast(err?.error ?? 'Failed to create category')
    }
  }

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
    // Same `expenses` array used above to compute `expected` — persisted verbatim so the
    // itemized deductions survive (previously discarded on submit) and stay consistent
    // with the expectedAmt they produced. Blank/zero rows (an unfilled "+" row) are dropped.
    const expenseItems = expenses
      .filter(e => e.categoryId && e.amount > 0)
      .map(e => ({ categoryId: e.categoryId, amount: e.amount.toFixed(2) }))
    createHandover.mutate(
      {
        date: selectedDate,
        receiverId: selectedReceiver,
        expectedAmt: expected.toFixed(2),
        handedAmt: handed.toFixed(2),
        notes: notes || null,
        expenses: expenseItems.length > 0 ? expenseItems : undefined,
      },
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
              <div className="table-scroll">
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
              </div>
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
                <div className="table-scroll">
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
                </div>
              )}
            </div>

            {/* Order payments for the day */}
            {dailyPayments.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><i className="ti ti-cash" /> Order payments — {selectedDate}</div>
                  <span className="badge badge-gray">{dailyPayments.length} payment{dailyPayments.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="table-scroll">
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
              </div>
            )}

            {/* Expenses */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-gas-station" /> Expenses (kept from collection)</div>
                <button className="btn" style={{ fontSize: 12 }} onClick={() => { setExpenses(p => [...p, { id: nextExpId, categoryId: '', categoryName: '', amount: 0 }]); setNextExpId(n => n + 1) }}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add
                </button>
              </div>
              {expenses.length === 0 && <div className="empty">No expenses logged. Use + to add.</div>}
              {expenses.map(exp => (
                <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                  <i className="ti ti-notes" style={{ fontSize: 14, color: 'var(--text3)' }} />
                  <select
                    value={exp.categoryId}
                    onChange={e => handleCategorySelect(exp.id, e.target.value)}
                    style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '5px 8px', outline: 'none', fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", color: 'var(--text)', background: 'var(--surface)' }}
                  >
                    <option value="" disabled>Select expense…</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value={NEW_CATEGORY_VALUE}>+ Add new expense</option>
                  </select>
                  <input
                    type="number" value={exp.amount || ''}
                    onChange={e => setExpenses(p => p.map(x => x.id === exp.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))}
                    style={{ width: 90, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', outline: 'none', background: 'var(--surface)' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>$</span>
                  <button onClick={() => setExpenses(p => p.filter(x => x.id !== exp.id))}
                    aria-label="Remove expense"
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
                <span className="badge badge-gray">{historyQ.isLoading ? '…' : historyTotal} total</span>
              </div>

              <div className="filters" style={{ padding: '0 18px 14px' }}>
                <div className="filter-input">
                  <i className="ti ti-search" />
                  <input
                    type="text"
                    placeholder="Search receiver or notes…"
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                  />
                </div>
                <select className="filter-select" value={historyDateRange} onChange={e => setHistoryDateRange(e.target.value)}>
                  <option>All time</option>
                  <option>This month</option>
                  <option>Last month</option>
                  <option>Custom</option>
                </select>
                {historyDateRange === 'Custom' && (
                  <>
                    <input
                      type="date"
                      className="filter-select"
                      value={historyCustomFrom}
                      onChange={e => setHistoryCustomFrom(e.target.value)}
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                    />
                    <input
                      type="date"
                      className="filter-select"
                      value={historyCustomTo}
                      onChange={e => setHistoryCustomTo(e.target.value)}
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                    />
                  </>
                )}
                {historyFilterActive && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={resetHistoryFilters}>Clear</button>
                )}
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Receiver</th>
                      <th>Logged by</th>
                      <th style={{ textAlign: 'right' }}>Expected</th>
                      <th style={{ textAlign: 'right' }}>Handed over</th>
                      <th style={{ textAlign: 'right' }}>Difference</th>
                      <th>Expenses deducted</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyQ.isLoading && [0, 1, 2].map(i => (
                      <tr key={i}><td colSpan={8}><div className="skeleton" style={{ width: '100%', height: 18 }} /></td></tr>
                    ))}
                    {historyQ.isError && (
                      <tr><td colSpan={8} className="empty">
                        Failed to load handover history.
                        <div><button className="btn" style={{ marginTop: 10 }} onClick={() => historyQ.refetch()}>Retry</button></div>
                      </td></tr>
                    )}
                    {!historyQ.isLoading && !historyQ.isError && historyRows.map(h => {
                      const d = parseFloat(h.difference)
                      const hExpenses = h.expenses ?? []
                      return (
                        <tr key={h.id}>
                          <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{fmtDate(h.date)}</td>
                          {/* receiver is the live User relation (falls back to
                              the receiverName snapshot for legacy rows with no
                              receiverId) — never a hardcoded/frontend-only name. */}
                          <td style={{ fontWeight: 500 }}>{h.receiver?.name ?? h.receiverName}</td>
                          <td style={{ fontSize: 12, color: 'var(--text3)' }}>{h.loggedBy?.name ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{fmt2(parseFloat(h.expectedAmt))}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>{fmt2(parseFloat(h.handedAmt))}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: Math.abs(d) < 0.01 ? 'var(--accent)' : d < 0 ? 'var(--red)' : 'var(--accent2)' }}>
                            {Math.abs(d) < 0.01 ? '✓' : d > 0 ? `+${fmt2(d)}` : fmt2(d)}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text3)' }}>
                            {hExpenses.length === 0
                              ? '—'
                              : hExpenses.map(e => `${e.description} ${fmt2(parseFloat(e.amount))}`).join(', ')}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text3)' }}>{h.notes ?? '—'}</td>
                        </tr>
                      )
                    })}
                    {!historyQ.isLoading && !historyQ.isError && historyRows.length === 0 && (
                      <tr><td colSpan={8} className="empty">
                        {historyFilterActive ? 'No handovers match this filter.' : 'No handovers recorded yet.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!historyQ.isLoading && !historyQ.isError && historyRows.length > 0 && historyTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                  <button className="btn" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => Math.max(1, p - 1))}>
                    <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                    Page {historyPage} of {historyTotalPages}
                  </span>
                  <button className="btn" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}>
                    Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                  </button>
                </div>
              )}
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
              <button className="panel-close-btn" aria-label="Close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[
                  [
                    selectedReceiver && receiverBalance ? `Balance held by ${selectedReceiverName}` : 'Total collected today',
                    fmt2(receiverTotal),
                  ],
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

      {/* "+ Add new expense" — creates a new reusable ExpenseCategory (find-or-create,
          so typing an existing name just selects it rather than duplicating). */}
      {newCategoryForRowId != null && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setNewCategoryForRowId(null)}>
          <div className="modal" style={{ width: 360 }}>
            <div className="modal-head">
              <div className="modal-title">Add new expense category</div>
              <button className="panel-close-btn" aria-label="Close" onClick={() => setNewCategoryForRowId(null)}>✕</button>
            </div>
            <div className="modal-body">
              <label className="form-label">Category name</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Vehicle Repair"
                autoFocus
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newCategoryName.trim()) confirmNewCategory() }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setNewCategoryForRowId(null)}>Cancel</button>
              <button className="btn primary" onClick={confirmNewCategory} disabled={createCategory.isPending || !newCategoryName.trim()}>
                <i className="ti ti-check" style={{ fontSize: 14 }} /> {createCategory.isPending ? 'Adding…' : 'Add category'}
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
