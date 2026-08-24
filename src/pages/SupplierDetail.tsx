import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useSupplier, useSupplierPayments, useCreateSupplierPayment } from '../hooks/useSuppliers'
import { useContainers } from '../hooks/useContainers'
import { useSupplierLedger } from '../hooks/useReports'
import { exportExcel, type ExcelColumn } from '../lib/excelExport'
import { useExportColumnsModal } from '../components/ui/ExportColumnsModal'
import { formatUsd } from '../lib/money'
import { formatDate, toDateOnlyString } from '../lib/date'

type View = 'detail' | 'statement'

function initialsOf(name?: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

function money(n: number) { return formatUsd(n) }
function fmtDate(iso?: string | null): string { return formatDate(iso, { day: '2-digit' }) }

/* ── component ─────────────────────────────────────── */
export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const supplierId = id ?? ''

  const [view, setView] = useState<View>('detail')

  // Real supplier data from the API.
  const supplierQuery = useSupplier(supplierId)
  const supplier = supplierQuery.data

  // Containers + payments for this supplier.
  const containersQ  = useContainers({ supplierId, limit: 20 })
  const paymentsQ    = useSupplierPayments(supplierId)
  const createPaymentM = useCreateSupplierPayment(supplierId)
  const containers   = containersQ.data?.data ?? []
  const payments     = paymentsQ.data?.data ?? []

  // All KPIs come directly from the supplier detail response (computed server-side).
  // NOTE: this is an inventory-cost-basis figure (raw StockLot.costPerKg, which for
  // container lots already folds in allocated container expenses/discounts) — NOT
  // the same basis as the Statement of Account balance below, which excludes those
  // by design. Labeled "inventory cost outstanding" everywhere it's shown so the
  // two numbers are never confused with each other.
  const totalSpent      = parseFloat(supplier?.totalSpentUsd    ?? '0') || 0
  const totalPaid       = parseFloat(supplier?.totalPaidUsd     ?? '0') || 0
  const outstanding     = parseFloat(supplier?.outstandingUsd   ?? '0') || 0
  const totalKgReceived = parseFloat(supplier?.totalKgReceived  ?? '0') || 0
  const totalKgRemaining= parseFloat(supplier?.totalKgRemaining ?? '0') || 0
  const avgPricePerKg   = supplier?.avgPricePerKg != null ? parseFloat(supplier.avgPricePerKg) : null

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
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [payCurrency, setPayCurrency] = useState('USD')
  const [payDate, setPayDateVal] = useState(toDateOnlyString(new Date()))
  const [payRef, setPayRef] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const { openExportModal, exportColumnsModal } = useExportColumnsModal()

  // Statement of Account sub-view filters. dateFrom/dateTo are sent to the backend
  // (the opening balance is computed server-side for the exact selected range);
  // type/search are display-only filters applied client-side to the fetched entries.
  const [stmtFrom, setStmtFrom] = useState('')
  const [stmtTo, setStmtTo] = useState('')
  const [stmtType, setStmtType] = useState<'all' | 'debit' | 'credit'>('all')
  const [stmtQ, setStmtQ] = useState('')

  const ledgerQ = useSupplierLedger(supplierId, {
    dateFrom: stmtFrom || undefined,
    dateTo:   stmtTo   || undefined,
  })

  // Statement ledger sourced from backend — Container Product Line + direct Stock
  // Lot purchases, and Supplier Payments only. Container expenses, discounts, and
  // bag purchases are excluded (Supplier Statement scope — see design review).
  const LEDGER = (ledgerQ.data?.entries ?? []).map(e => ({
    rawDate:     e.date,
    date:        fmtDate(e.date),
    ref:         e.displayId ?? e.reference.slice(0, 8).toUpperCase(),
    referenceId: e.reference,
    sourceType:  e.sourceType,
    desc:        e.description,
    kind:        e.type as 'purchase' | 'payment',
    debit:       parseFloat(e.debit),
    credit:      parseFloat(e.credit),
    balance:     parseFloat(e.runningBalance),
  }))

  // Type/search filters only — date range is already applied server-side above.
  const stmtFiltered = LEDGER.filter(e => {
    if (stmtType === 'debit'  && !e.debit)  return false
    if (stmtType === 'credit' && !e.credit) return false
    if (stmtQ && !(e.desc + ' ' + e.ref).toLowerCase().includes(stmtQ.toLowerCase())) return false
    return true
  })
  const stmtDebit   = stmtFiltered.reduce((s, e) => s + e.debit, 0)
  const stmtCredit  = stmtFiltered.reduce((s, e) => s + e.credit, 0)
  // Server-computed opening balance for the exact selected date range — no client-side
  // "previous row" workaround needed since the backend already supports dateFrom/dateTo.
  const stmtOpening = parseFloat(ledgerQ.data?.summary.openingBalance ?? '0')
  const stmtClosing = stmtFiltered.length ? stmtFiltered[stmtFiltered.length - 1].balance : stmtOpening
  const stmtOpeningDate = stmtFiltered.length ? stmtFiltered[0].date : (LEDGER[0]?.date ?? fmtDate(new Date().toISOString()))
  const stmtPeriod = stmtFiltered.length ? `${stmtFiltered[0].date} — ${stmtFiltered[stmtFiltered.length - 1].date}` : '—'
  const stmtFilterActive = stmtFrom || stmtTo || stmtType !== 'all' || stmtQ
  function resetStmt() { setStmtFrom(''); setStmtTo(''); setStmtType('all'); setStmtQ('') }

  function exportStatement() {
    if (stmtFiltered.length === 0) { showToast('Nothing to export'); return }
    const stmtOpeningRawDate = stmtFiltered[0]?.rawDate ?? (LEDGER[0]?.rawDate ?? new Date().toISOString())
    type StmtRow = { rawDate: string; source: string; ref: string; desc: string; debit: number | null; credit: number | null; balance: number }
    const rows: StmtRow[] = [
      { rawDate: stmtOpeningRawDate, source: '', ref: '', desc: 'Opening balance', debit: null, credit: null, balance: stmtOpening },
      ...stmtFiltered.map(e => ({
        rawDate: e.rawDate, source: e.sourceType ?? 'payment', ref: e.ref, desc: e.desc,
        debit: e.debit || null, credit: e.credit || null, balance: e.balance,
      })),
    ]
    const columns: ExcelColumn<StmtRow>[] = [
      { key: 'date', header: 'Date', type: 'date', value: r => new Date(r.rawDate) },
      { key: 'source', header: 'Source', value: r => r.source || null },
      { key: 'ref', header: 'Ref', value: r => r.ref || null },
      { key: 'desc', header: 'Description', value: r => r.desc },
      { key: 'debit', header: 'Debit', type: 'currency', value: r => r.debit, total: 'sum' },
      { key: 'credit', header: 'Credit', type: 'currency', value: r => r.credit, total: 'sum' },
      // 'last', not 'sum' — same fix as ClientDetail's Client Statement:
      // every row's balance is already the running balance as of that row,
      // so the Total row should show the final row's balance, not Σ(all balances).
      { key: 'balance', header: 'Balance', type: 'currency', value: r => r.balance, total: 'last' },
    ]
    openExportModal({
      title: 'Supplier Statement', subtitle: supplier?.name ?? 'Supplier', columns,
      onExport: async selectedColumns => {
        await exportExcel({
          filename: `${supplierId}-statement`, sheetName: 'Statement',
          title: `Supplier Statement — ${supplier?.name ?? 'Supplier'}`,
          columns: selectedColumns, rows, emphasizeRowIndexes: [0],
        })
        showToast(`Exported ${stmtFiltered.length} rows`)
      },
    })
  }

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
    createPaymentM.mutate(
      { amount: amt.toFixed(2), currency: payCurrency as any, method: payMethod as any, date: payDate, notes: payRef || undefined },
      {
        onSuccess: () => {
          setPayOpen(false)
          showToast(`Payment ${money(amt)} recorded`)
          setPayAmt('')
          setPayRef('')
        },
        onError: () => showToast('Failed to save payment'),
      },
    )
  }

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
        {view === 'detail' ? (
          <>
            <button className="btn"><i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit</button>
            <button className="btn" onClick={() => setView('statement')}>
              <i className="ti ti-table" style={{ fontSize: 15 }} /> Statement of account
            </button>
            <button className="btn primary" onClick={() => setPayOpen(true)}>
              <i className="ti ti-cash" style={{ fontSize: 15 }} /> Pay supplier
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setView('detail')}>
            <i className="ti ti-arrow-left" style={{ fontSize: 15 }} /> Back to supplier
          </button>
        )}
      </Topbar>
      <div className="content">

        {/* ════════════ OVERVIEW ════════════ */}
        {view === 'detail' && (
          <>

        {/* ── HERO: outstanding balance is the star ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'stretch', marginBottom: 16 }}>

          {/* Left: supplier identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12, flexShrink: 0,
              background: 'var(--accent-bg)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '1.1rem', fontFamily: "'IBM Plex Mono',monospace",
            }}>{initialsOf(supplier?.name)}</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>{supplier?.name ?? '—'}</h1>
              <div className="page-header-meta" style={{ marginTop: 5 }}>
                {supplier?.country && <span className="badge badge-gray">{supplier.country}</span>}
                {supplier?.paymentTerms && <span className="meta-row"><i className="ti ti-calendar" /> {supplier.paymentTerms}</span>}
                {supplier?.leadTimeDays != null && <span className="meta-row"><i className="ti ti-truck-delivery" /> {supplier.leadTimeDays}d lead</span>}
                {supplier?.containerCount != null && <span className="meta-row"><i className="ti ti-ship" /> {supplier.containerCount} containers</span>}
              </div>
            </div>
          </div>

          {/* Right: balance hero block */}
          <div style={{
            background: outstanding > 0 ? 'var(--accent2-bg)' : 'var(--accent-bg)',
            border: `1.5px solid ${outstanding > 0 ? 'var(--accent2)' : 'var(--accent)'}`,
            borderRadius: 12, padding: '18px 28px', textAlign: 'right', minWidth: 260,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
          }}>
            <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.8px', color: outstanding > 0 ? 'var(--accent2)' : 'var(--accent)', fontWeight: 600 }}>
              Inventory cost outstanding
            </div>
            <div style={{ fontSize: '2.4rem', fontWeight: 800, letterSpacing: -1.5, fontFamily: "'IBM Plex Mono',monospace", color: outstanding > 0 ? 'var(--accent2)' : 'var(--accent)', lineHeight: 1 }}>
              {outstanding > 0 ? money(outstanding) : totalSpent > 0 ? 'Settled' : '—'}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: -2 }}>
              cost basis — see <a href="#" onClick={e => { e.preventDefault(); setView('statement') }} style={{ color: 'inherit', textDecoration: 'underline' }}>statement</a> for accounts payable
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                <span style={{ color: 'var(--text3)', marginRight: 4 }}>Total cost</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>{totalSpent > 0 ? money(totalSpent) : '—'}</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                <span style={{ color: 'var(--text3)', marginRight: 4 }}>Paid</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: 'var(--accent)' }}>{totalPaid > 0 ? money(totalPaid) : '—'}</span>
              </span>
            </div>
            <button className="btn green" onClick={() => setPayOpen(true)} style={{ marginTop: 10, fontSize: 13, fontWeight: 600, justifyContent: 'center' }}>
              <i className="ti ti-cash" style={{ fontSize: 14 }} /> Pay supplier
            </button>
          </div>
        </div>

        {/* ── SECONDARY KPIs (smaller) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Total kg received', value: totalKgReceived > 0 ? `${totalKgReceived.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg` : '—', sub: 'all time' },
            { label: 'In stock', value: totalKgRemaining > 0 ? `${totalKgRemaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg` : '—', sub: `${supplier?.activeLotCount ?? 0} active lots` },
            { label: 'Avg price / kg', value: avgPricePerKg != null ? money(avgPricePerKg) : '—', sub: 'weighted avg' },
            { label: 'Payments made', value: payments.length > 0 ? String(payments.length) : '—', sub: 'recorded payments' },
          ].map(k => (
            <div key={k.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", letterSpacing: -0.3 }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

          {/* LEFT */}
          <div className="stack">

            {/* Charcoal types — derived from real stock lots */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><i className="ti ti-flame" /> Charcoal we bought
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>
                    {(supplier?.purchasedTypes ?? []).length} types
                  </span>
                </div>
              </div>
              {(supplier?.purchasedTypes ?? []).length === 0 ? (
                <div className="empty">No stock lots found for this supplier</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Charcoal type</th>
                      <th style={{ width: 90 }}>Grade</th>
                      <th className="right" style={{ width: 110 }}>Total received</th>
                      <th className="right" style={{ width: 110 }}>In stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(supplier?.purchasedTypes ?? []).map((t, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{t.type}</td>
                        <td>
                          <span className={`grade-pill grade-${t.grade}`}>Grade {t.grade}</span>
                        </td>
                        <td className="right num">{t.totalKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</td>
                        <td className="right num" style={{ color: t.kgRemaining > 0 ? 'var(--accent)' : 'var(--text3)', fontWeight: t.kgRemaining > 0 ? 600 : 400 }}>
                          {t.kgRemaining > 0 ? `${t.kgRemaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  <table className="data-table" style={{ borderBottom: '1px solid var(--border)' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>Arrived</th>
                        <th>Container #</th>
                        <th style={{ width: 100 }}>Status</th>
                        <th style={{ width: 50 }} />
                      </tr>
                    </thead>
                    <tbody>
                  {containers.slice(0, shownCont).map(c => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/containers/' + c.id)}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{c.arrivalDate ?? '—'}</td>
                      <td style={{ fontWeight: 500 }}>{c.number}</td>
                      <td><span className={`badge ${c.status === 'arrived' ? 'badge-green' : c.status === 'port' ? 'badge-amber' : 'badge-gray'}`}>{c.status}</span></td>
                      <td>
                        <div className="row-actions" onClick={e => e.stopPropagation()}>
                          <button className="icon-btn" onClick={() => navigate('/containers/' + c.id)}><i className="ti ti-arrow-up-right" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                    </tbody>
                  </table>
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
                <div className="card-title">
                  <i className="ti ti-cash" /> Money we sent
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>
                    {payments.length} payment{payments.length !== 1 ? 's' : ''} · {totalPaid > 0 ? money(totalPaid) : '$0'} total
                  </span>
                </div>
                <button className="card-action" onClick={() => setPayOpen(true)}>
                  <i className="ti ti-plus" style={{ fontSize: 13 }} /> Add payment
                </button>
              </div>
              {paymentsQ.isLoading && <div className="empty">Loading…</div>}
              {!paymentsQ.isLoading && payments.length === 0 && (
                <div className="empty">No payments recorded yet.</div>
              )}
              {!paymentsQ.isLoading && payments.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Date</th>
                      <th style={{ width: 110 }}>Method</th>
                      <th>Note</th>
                      <th>Logged by</th>
                      <th className="right" style={{ width: 110 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>
                          {new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td><span className="badge badge-gray">{p.method.replace('_', ' ')}</span></td>
                        <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                          {p.container ? <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{p.container.number}</span> : '—'}
                          {p.notes && <span style={{ marginLeft: 6, color: 'var(--text3)' }}>{p.notes}</span>}
                        </td>
                        <td style={{ fontSize: 12.5, color: 'var(--text3)' }}>{p.loggedBy.name}</td>
                        <td className="right num" style={{ fontWeight: 600, color: 'var(--accent)' }}>
                          +{money(parseFloat(p.amount))} <span style={{ fontSize: 10, fontWeight: 400 }}>{p.currency}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
          </>
        )}

        {/* ════════════ STATEMENT OF ACCOUNT ════════════ */}
        {view === 'statement' && (
          <div className="fade-up stmt-view">
            <div className="view-head">
              <div>
                <div className="view-title">Statement of account</div>
                <div className="view-sub">
                  <span className="meta-row"><i className="ti ti-truck" /> {supplier?.name}</span>
                  <span className="meta-row"><i className="ti ti-calendar" /> {stmtPeriod}</span>
                  <span className="meta-row"><i className="ti ti-currency-dollar" /> USD</span>
                </div>
              </div>
              <div className="stmt-actions no-print">
                <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print</button>
                <button className="btn-export" onClick={exportStatement}><i className="ti ti-table-export" /> Export Excel</button>
              </div>
            </div>

            {/* Filter bar — hidden on print (see .no-print in index.css); the
                view-head above already shows supplier name + selected period,
                so nothing period-identifying is lost from the printout. */}
            <div className="filter-row no-print">
              <div className="filter-search">
                <i className="ti ti-search" />
                <input placeholder="Search description or ref…" value={stmtQ} onChange={e => setStmtQ(e.target.value)} />
              </div>
              <div className="seg">
                {([['all', 'All'], ['debit', 'Purchases'], ['credit', 'Payments']] as const).map(([k, lbl]) => (
                  <div key={k} className={`seg-opt ${stmtType === k ? 'sel' : ''}`} onClick={() => setStmtType(k)}>{lbl}</div>
                ))}
              </div>
              <div className="filter-dates">
                <span className="lbl">From</span>
                <input className="date-mini" type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} />
                <span className="lbl">To</span>
                <input className="date-mini" type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} />
              </div>
              {stmtFilterActive ? <button className="btn" onClick={resetStmt}><i className="ti ti-x" style={{ fontSize: 14 }} /> Reset</button> : null}
            </div>

            {/* Opening / closing summary */}
            <div className="stmt-summary">
              <div className="stmt-cell"><div className="l">Opening balance</div><div className="v">{money(stmtOpening)}</div><div className="s">{stmtOpeningDate}</div></div>
              <div className="stmt-cell"><div className="l">Total purchased</div><div className="v amber">{money(stmtDebit)}</div><div className="s">container &amp; direct</div></div>
              <div className="stmt-cell"><div className="l">Total paid</div><div className="v green">{money(stmtCredit)}</div><div className="s">payments recorded</div></div>
              <div className="stmt-cell"><div className="l">Closing balance</div><div className={`v ${stmtClosing > 0 ? 'amber' : stmtClosing < 0 ? 'red' : 'green'}`}>{money(stmtClosing)}</div><div className="s">{stmtClosing > 0 ? 'we owe' : stmtClosing < 0 ? 'in credit' : 'settled'}</div></div>
            </div>

            <div className="card">
              <table className="data-table stmt-table">
                <thead><tr>
                  <th style={{ width: 120 }}>Date</th><th style={{ width: 100 }}>Source</th><th style={{ width: 90 }}>Ref</th><th>Description</th>
                  <th className="right" style={{ width: 120 }}>Debit</th><th className="right" style={{ width: 120 }}>Credit</th>
                  <th className="right" style={{ width: 130 }}>Balance</th>
                </tr></thead>
                <tbody>
                  <tr className="opening">
                    <td className="mono">{stmtOpeningDate}</td>
                    <td></td><td></td>
                    <td className="desc">Opening balance</td>
                    <td className="num"></td><td className="num"></td>
                    <td className="num">{money(stmtOpening)}</td>
                  </tr>
                  {ledgerQ.isLoading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
                  {!ledgerQ.isLoading && stmtFiltered.map((e, i) => (
                    <tr key={i}>
                      <td className="mono">{e.date}</td>
                      <td>
                        {e.kind === 'purchase' ? (
                          <span className={`badge ${e.sourceType === 'container' ? 'badge-blue' : 'badge-amber'}`}>{e.sourceType === 'container' ? 'Container' : 'Direct'}</span>
                        ) : (
                          <span className="badge badge-green">Payment</span>
                        )}
                      </td>
                      <td className="mono ref-cell">
                        {e.kind === 'purchase' && e.sourceType === 'container' ? (
                          <a href={`/containers/${e.referenceId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{e.ref}</a>
                        ) : (
                          <span>{e.ref}</span>
                        )}
                      </td>
                      <td className="desc">{e.desc}</td>
                      <td className="num dr">{e.debit ? money(e.debit) : ''}</td>
                      <td className="num cr">{e.credit ? money(e.credit) : ''}</td>
                      <td className={`num ${e.balance < 0 ? 'bal-neg' : 'bal-pos'}`} style={{ fontWeight: 600 }}>{money(e.balance)}</td>
                    </tr>
                  ))}
                  {!ledgerQ.isLoading && stmtFiltered.length === 0 && <tr><td colSpan={7} className="empty">No entries match this filter</td></tr>}
                </tbody>
                <tfoot><tr>
                  <td colSpan={4} style={{ textAlign: 'right' }}>Totals</td>
                  <td className="num dr">{money(stmtDebit)}</td>
                  <td className="num cr">{money(stmtCredit)}</td>
                  <td className="num">{money(stmtClosing)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}

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
                  <span className="field-label">Date</span>
                  <input className="input" type="date" value={payDate} onChange={e => setPayDateVal(e.target.value)} />
                </div>
                <div>
                  <span className="field-label">Method</span>
                  <select className="select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="whish">Whish</option>
                    <option value="omt">OMT</option>
                  </select>
                </div>
                <div>
                  <span className="field-label">Amount</span>
                  <input className="input num" type="number" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <span className="field-label">Currency</span>
                  <select className="select" value={payCurrency} onChange={e => setPayCurrency(e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="LBP">LBP</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="field-label">Reference / note (optional)</span>
                  <input className="input" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. wire ref, cheque number" />
                </div>
              </div>
              {outstanding > 0 && (
                <div style={{ marginTop: 14, padding: '11px 14px', background: 'var(--accent2-bg)', borderRadius: 'var(--radius)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>Outstanding (inventory cost)</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, fontWeight: 700, color: 'var(--accent2)' }}>{money(outstanding)}</span>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>
                {payCurrency} payment · {supplier?.name}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setPayOpen(false)}>Cancel</button>
                <button className="btn green" onClick={savePay} disabled={createPaymentM.isPending}>
                  <i className="ti ti-check" style={{ fontSize: 15 }} />
                  {createPaymentM.isPending ? 'Saving…' : 'Save payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {exportColumnsModal}

      {/* Toast */}
      <div className={`toast ${toast ? 'show' : ''}`}>
        <i className="ti ti-check-circle" />
        <span>{toast}</span>
      </div>
    </>
  )
}
