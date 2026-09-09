import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useClientLedger } from '../hooks/useReports'
import { formatUsd } from '../lib/money'
import { formatDate, formatDateTime, toDateOnlyString } from '../lib/date'
import { exportStatementPdf } from '../lib/statementPdf'

// Statement of Account presentation (monthly-statement unification,
// 2026-09-07): the PRIMARY view is always a single calendar month, navigated
// with ← / → — same convention as Employees.tsx's Statement of Account and
// ClientDetail.tsx's Client Statement tab. "All time" and "Custom" (the
// free-text range this page used to default to) remain available as
// de-emphasized, explicit opt-ins — never the default.
type StatementMode = 'month' | 'all-time' | 'custom'

/**
 * Fill Client Statement of Account — dedicated full-page route.
 *
 * Reuses the exact same authoritative source as the normal Client Statement
 * (ReportsService.getClientLedger — already Fill-Client-aware: it folds
 * StockExit pickups in as debit rows alongside payment credits) and the same
 * PDF builder (statementPdf.ts) — no separate accounting calculation and no
 * second PDF implementation.
 */
export default function FillClientStatement() {
  const { id } = useParams<{ id: string }>()

  const clientQ = useClient(id ?? '')
  const client = clientQ.data

  const [statementMode, setStatementMode] = useState<StatementMode>('month')
  const [statementMonth, setStatementMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const statementMonthYear  = statementMonth.getFullYear()
  const statementMonthIdx   = statementMonth.getMonth()
  const statementMonthLabel = statementMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  function goToPrevMonth() {
    setStatementMode('month')
    setStatementMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function goToNextMonth() {
    setStatementMode('month')
    setStatementMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  const { dateFrom, dateTo } =
    statementMode === 'all-time' ? { dateFrom: undefined, dateTo: undefined } :
    statementMode === 'custom'   ? { dateFrom: customFrom || undefined, dateTo: customTo || undefined } :
    {
      dateFrom: toDateOnlyString(new Date(statementMonthYear, statementMonthIdx, 1)),
      dateTo:   toDateOnlyString(new Date(statementMonthYear, statementMonthIdx + 1, 0)),
    }

  // Server-side date filtering — getClientLedger already accepts dateFrom/
  // dateTo and computes a correct openingBalance for the filtered window
  // (aggregate of everything strictly before dateFrom), so this never needs
  // to walk an unbounded client-side array to find the opening balance, and
  // a normal monthly view never fetches the client's entire lifetime history.
  const ledgerQ = useClientLedger(id ?? '', { dateFrom, dateTo })
  const entries = ledgerQ.data?.entries ?? []
  const openingBalance = parseFloat(ledgerQ.data?.openingBalance ?? '0')
  const debitTotal = entries.reduce((s, e) => s + parseFloat(e.debit), 0)
  const creditTotal = entries.reduce((s, e) => s + parseFloat(e.credit), 0)
  const closingBalance = parseFloat(ledgerQ.data?.balance ?? String(openingBalance))

  const clientName = client?.name ?? '—'
  const periodLabel = statementMode === 'all-time' ? 'All time'
    : statementMode === 'custom' ? (dateFrom || dateTo ? `${dateFrom ? formatDate(dateFrom, { day: '2-digit' }) : 'start'} — ${dateTo ? formatDate(dateTo, { day: '2-digit' }) : 'today'}` : 'Custom range')
    : statementMonthLabel

  async function handlePrintPdf() {
    if (!client) return
    await exportStatementPdf({
      client: {
        name: client.name,
        // Fill Client has no stored address anywhere in this app, same as
        // normal Client (see ClientDetail.tsx's identical comment) — never
        // invent one.
        address: null,
        phone: client.phones?.find((p: any) => p.isActive)?.number ?? null,
        currency: client.currency,
      },
      from: dateFrom ? new Date(dateFrom).toISOString() : (entries[0]?.date ?? null),
      to: dateTo ? new Date(dateTo).toISOString() : (entries[entries.length - 1]?.date ?? null),
      rows: entries.map((e, i) => ({
        ref: String(i + 1),
        rawDate: e.date,
        desc: e.description,
        debit: parseFloat(e.debit),
        credit: parseFloat(e.credit),
        balance: parseFloat(e.runningBalance),
      })),
      openingBalance,
      periodDebitTotal: debitTotal,
      periodCreditTotal: creditTotal,
      closingBalance,
    })
  }

  return (
    <>
      <Topbar title="Statement of account" back={{ label: 'Fill Client', to: `/fill-clients/${id}` }}>
        <button className="btn" style={{ marginLeft: 'auto' }} disabled={!client} onClick={handlePrintPdf}>
          <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print PDF
        </button>
      </Topbar>
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{clientName}</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-file-invoice" /> Statement of account</span>
              <span className="meta-row"><i className="ti ti-calendar" /> {periodLabel}</span>
              {client?.currency && <span className="badge badge-gray">{client.currency}</span>}
            </div>
          </div>
        </div>

        {/* Month navigation — same convention as Employees.tsx's Statement of
            Account and ClientDetail.tsx's Client Statement tab. */}
        <div className="filter-row" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {statementMode === 'month' && (
              <>
                <button className="btn" onClick={goToPrevMonth} title="Previous month">
                  <i className="ti ti-chevron-left" style={{ fontSize: 14 }} />
                </button>
                <div style={{ fontWeight: 600, fontSize: 14, minWidth: 140, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {statementMonthLabel}
                </div>
                <button className="btn" onClick={goToNextMonth} title="Next month">
                  <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                </button>
              </>
            )}
            {statementMode === 'all-time' && (
              <div style={{ fontWeight: 600, fontSize: 14, fontFamily: "'IBM Plex Mono', monospace" }}>All time</div>
            )}
            {statementMode === 'custom' && (
              <>
                <input type="date" className="filter-select" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
                <input type="date" className="filter-select" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
              </>
            )}
          </div>
          <div className="seg">
            {([['month', 'Month'], ['all-time', 'All time'], ['custom', 'Custom']] as const).map(([k, lbl]) => (
              <div key={k} className={`seg-opt ${statementMode === k ? 'sel' : ''}`} onClick={() => setStatementMode(k)}>{lbl}</div>
            ))}
          </div>
        </div>

        <div className="stmt-summary">
          <div className="stmt-cell"><div className="l">Opening balance</div><div className="v">{formatUsd(openingBalance)}</div></div>
          <div className="stmt-cell"><div className="l">Total debit</div><div className="v amber">{formatUsd(debitTotal)}</div><div className="s">fill pickups</div></div>
          <div className="stmt-cell"><div className="l">Total credit</div><div className="v green">{formatUsd(creditTotal)}</div><div className="s">payments received</div></div>
          <div className="stmt-cell"><div className="l">Closing balance</div><div className={`v ${closingBalance > 0 ? 'amber' : closingBalance < 0 ? 'red' : 'green'}`}>{formatUsd(closingBalance)}</div><div className="s">{closingBalance > 0 ? 'owed by client' : closingBalance < 0 ? 'in credit' : 'settled'}</div></div>
        </div>

        <div className="card">
          {ledgerQ.isLoading && <div className="empty">Loading…</div>}
          {ledgerQ.isError && <div className="empty">Failed to load statement. Please try again.</div>}
          {!ledgerQ.isLoading && !ledgerQ.isError && (
            <table className="data-table stmt-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="right">Debit</th>
                  <th className="right">Credit</th>
                  <th className="right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="opening">
                  <td className="mono"></td>
                  <td className="desc">Opening balance</td>
                  <td className="num"></td><td className="num"></td>
                  <td className="num">{formatUsd(openingBalance)}</td>
                </tr>
                {entries.map((e, i) => {
                  const debit = parseFloat(e.debit)
                  const credit = parseFloat(e.credit)
                  const balance = parseFloat(e.runningBalance)
                  return (
                    <tr key={i}>
                      <td className="mono">{formatDateTime(e.date, { day: '2-digit' })}</td>
                      <td className="desc">{e.description}</td>
                      <td className="num dr">{debit ? formatUsd(debit) : ''}</td>
                      <td className="num cr">{credit ? formatUsd(credit) : ''}</td>
                      <td className={`num ${balance < 0 ? 'bal-neg' : 'bal-pos'}`} style={{ fontWeight: 600 }}>{formatUsd(balance)}</td>
                    </tr>
                  )
                })}
                {entries.length === 0 && (
                  <tr><td colSpan={5} className="empty">No fill pickups or payments {statementMode !== 'all-time' ? 'in this period' : 'recorded yet'}</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right' }}>Totals</td>
                  <td className="num dr">{formatUsd(debitTotal)}</td>
                  <td className="num cr">{formatUsd(creditTotal)}</td>
                  <td className="num">{formatUsd(closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
