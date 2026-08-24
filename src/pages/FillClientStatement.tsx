import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useClientLedger } from '../hooks/useReports'
import { formatUsd } from '../lib/money'
import { formatDate, formatDateTime, toDateOnlyString, currentMonthToDateRange, currentWeekToDateRange } from '../lib/date'
import { exportStatementPdf } from '../lib/statementPdf'

type RangePreset = 'This month' | 'This week' | 'Last month' | 'Custom' | 'All time'

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

  const [rangePreset, setRangePreset] = useState<RangePreset>('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const today = new Date()
  const { dateFrom, dateTo } = (() => {
    if (rangePreset === 'This month') return currentMonthToDateRange()
    if (rangePreset === 'This week') return currentWeekToDateRange()
    if (rangePreset === 'Last month') return {
      dateFrom: toDateOnlyString(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      dateTo: toDateOnlyString(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
    if (rangePreset === 'Custom') return { dateFrom: customFrom || undefined, dateTo: customTo || undefined }
    return { dateFrom: undefined, dateTo: undefined }
  })()

  const filterActive = rangePreset !== 'All time'
  function clearFilters() {
    setRangePreset('All time')
    setCustomFrom('')
    setCustomTo('')
  }

  // Server-side date filtering — getClientLedger already accepts dateFrom/
  // dateTo and computes a correct openingBalance for the filtered window
  // (aggregate of everything strictly before dateFrom), so unlike the
  // in-page Client Statement tab this never needs to walk an unbounded
  // client-side array to find the opening balance.
  const ledgerQ = useClientLedger(id ?? '', { dateFrom, dateTo })
  const entries = ledgerQ.data?.entries ?? []
  const openingBalance = parseFloat(ledgerQ.data?.openingBalance ?? '0')
  const debitTotal = entries.reduce((s, e) => s + parseFloat(e.debit), 0)
  const creditTotal = entries.reduce((s, e) => s + parseFloat(e.credit), 0)
  const closingBalance = parseFloat(ledgerQ.data?.balance ?? String(openingBalance))

  const clientName = client?.name ?? '—'
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom ? formatDate(dateFrom, { day: '2-digit' }) : 'start'} — ${dateTo ? formatDate(dateTo, { day: '2-digit' }) : 'today'}`
    : 'All time'

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
      from: dateFrom ?? (entries[0]?.date ?? null),
      to: dateTo ?? (entries[entries.length - 1]?.date ?? null),
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

        <div className="filter-row">
          <select className="filter-select" value={rangePreset} onChange={e => setRangePreset(e.target.value as RangePreset)}>
            <option>All time</option>
            <option>This month</option>
            <option>This week</option>
            <option>Last month</option>
            <option>Custom</option>
          </select>
          {rangePreset === 'Custom' && (
            <>
              <input type="date" className="filter-select" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
              <input type="date" className="filter-select" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }} />
            </>
          )}
          {filterActive && <button className="btn" style={{ fontSize: 12 }} onClick={clearFilters}>Clear</button>}
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
                  <tr><td colSpan={5} className="empty">No fill pickups or payments {filterActive ? 'in this period' : 'recorded yet'}</td></tr>
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
