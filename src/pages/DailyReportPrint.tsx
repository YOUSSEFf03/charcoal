import { useParams, useNavigate } from 'react-router-dom'
import { useDailyReport } from '../hooks/useReports'
import { formatUsd } from '../lib/money'
import { formatDate } from '../lib/date'
import { COMPANY_INFO } from '../lib/companyInfo'
import farahLogo from '../assets/farah-charcoal-logo.png'
import type {
  DailyReportSale, DailyReportPayment, DailyReportCashHandover,
  DailyReportClientReceivable, DailyReportEmployeeSummary, DailyReportException,
} from '../types/api'

/**
 * Standalone printable Full Day Report — one A4 page (Phase 2, forensic
 * audit 2026-09). Real HTML/CSS document, printed via window.print(), same
 * "no canvas/PDF step" philosophy as InvoicePrint.tsx/DeliveryReceiptPrint.tsx.
 * Opened from Reports.tsx's "Full Day Report" tab via
 * <a href="/reports/daily/:date" target="_blank">. Owner only — matches the
 * backend's @Roles('owner') on GET /reports/daily/:date.
 *
 * Every figure rendered here is read VERBATIM from the backend response —
 * this component does no accounting math of its own (no re-summing, no
 * re-deriving a balance), matching the report's own read-only contract.
 */
export default function DailyReportPrint() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()
  const reportQ = useDailyReport(date ?? '')
  const report = reportQ.data

  function changeDate(next: string) {
    navigate(`/reports/daily/${next}`, { replace: true })
  }

  if (reportQ.isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #ddd', borderTopColor: '#1a1a1a', borderRadius: '50%', animation: 'dayreport-spin 0.8s linear infinite' }} />
        <style>{`@keyframes dayreport-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (reportQ.isError || !report) {
    const status = (reportQ.error as any)?.status as number | undefined
    const msg =
      status === 403 ? 'Owner access required for the Full Day Report' :
      status === 400 ? 'Invalid date' :
      reportQ.isError ? 'Failed to load report' :
      'Report not found'
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#666' }}>
        {msg}
      </div>
    )
  }

  const expenseTotal = (
    parseFloat(report.summary.totalCashHandoverExpenses) +
    parseFloat(report.summary.totalGeneralExpenses) +
    parseFloat(report.summary.totalWorkerCost)
  )

  return (
    <div className="day-report-shell">
      <div className="no-print" style={{ width: '100%', maxWidth: '210mm', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#555' }}>Full Day Report</span>
          <input
            type="date"
            value={date ?? ''}
            onChange={e => changeDate(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #ccc', fontSize: 13 }}
          />
        </div>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print
        </button>
      </div>

      <div className="day-report">
        <div className="day-report-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={farahLogo} alt={COMPANY_INFO.name} className="day-report-logo" />
            <div>
              <div className="day-report-title">Full Day Report</div>
              <div style={{ fontSize: '0.85em', color: '#5a5750' }}>{COMPANY_INFO.name}</div>
            </div>
          </div>
          <div className="day-report-meta">
            <div style={{ fontSize: '1.15em', fontWeight: 700 }}>{formatDate(report.date)}</div>
            <div>Generated {formatDate(report.generatedAt)} {new Date(report.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>

        {/* ── Summary ── */}
        <div className="day-report-summary">
          <Kpi label="Total sales" value={formatUsd(report.summary.totalSales)} sub={`${report.summary.saleCount} sale${report.summary.saleCount === 1 ? '' : 's'}`} />
          <Kpi label="Cash collected" value={formatUsd(report.summary.totalCashCollected)} sub={`${report.summary.paymentCount} payment${report.summary.paymentCount === 1 ? '' : 's'}`} />
          <Kpi label="Expenses" value={formatUsd(expenseTotal)} sub="handover + general + wages" />
          <Kpi label="Cash handed over" value={formatUsd(report.summary.totalHandedOver)} sub={`${report.cashHandovers.length} handover${report.cashHandovers.length === 1 ? '' : 's'}`} />
        </div>

        {/* ── Sales ── */}
        <Section title="Sales" count={report.sales.length}>
          {report.sales.length === 0 ? <Empty /> : (
            <table>
              <thead>
                <tr><th>Client</th><th>Type</th><th>Description</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Remaining</th><th>Status</th></tr>
              </thead>
              <tbody>
                {report.sales.map((s: DailyReportSale) => (
                  <tr key={s.id}>
                    <td>{s.client?.name ?? 'Anonymous'}</td>
                    <td>{s.source === 'ORDER' ? 'Order' : s.source === 'WAREHOUSE_SALE' ? 'Warehouse' : 'Anonymous'}</td>
                    <td>{s.description}</td>
                    <td className="num">{formatUsd(s.saleTotal)}</td>
                    <td className="num">{formatUsd(s.paidAmount)}</td>
                    <td className="num">{formatUsd(s.remaining)}</td>
                    <td>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Payments ── */}
        <Section title="Payments" count={report.payments.length}>
          {report.payments.length === 0 ? <Empty /> : (
            <table>
              <thead>
                <tr><th>Client</th><th className="num">Amount</th><th>Method</th><th>Receiver</th><th>Applied to</th></tr>
              </thead>
              <tbody>
                {report.payments.map((p: DailyReportPayment) => (
                  <tr key={p.id}>
                    <td>{p.client.name}</td>
                    <td className="num">{formatUsd(p.amount)} {p.currency}</td>
                    <td>{p.method}</td>
                    <td>{p.receiver?.name ?? '—'}</td>
                    <td>{p.allocations.length === 0 ? '—' : p.allocations.map(a => `${a.invoiceDisplayId ?? a.invoiceId} (${formatUsd(a.amount)})`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Expenses ── */}
        <div className="day-report-section">
          <div className="day-report-section-title">Expenses</div>
          <div className="day-report-two-col">
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>Cash handover expenses ({report.expenses.cashHandoverExpenses.length})</div>
              {report.expenses.cashHandoverExpenses.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Cash holder</th><th>Category</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {report.expenses.cashHandoverExpenses.map(e => (
                      <tr key={e.id}><td>{e.employee.name}</td><td>{e.category}</td><td className="num">{formatUsd(e.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>Worker wages accrued ({report.expenses.workerCosts.length})</div>
              {report.expenses.workerCosts.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Worker</th><th>Category</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {report.expenses.workerCosts.map(w => (
                      <tr key={w.id}><td>{w.worker.name}</td><td>{w.category.replace(/_/g, ' ')}</td><td className="num">{formatUsd(w.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>General company expenses ({report.expenses.generalExpenses.length})</div>
            {report.expenses.generalExpenses.length === 0 ? <Empty /> : (
              <table>
                <thead><tr><th>Description</th><th>Category</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {report.expenses.generalExpenses.map(e => (
                    <tr key={e.id}><td>{e.description}</td><td>{e.category ?? '—'}</td><td className="num">{formatUsd(e.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Cash Handovers ── */}
        <Section title="Cash handovers" count={report.cashHandovers.length}>
          {report.cashHandovers.length === 0 ? <Empty /> : (
            <table>
              <thead>
                <tr><th>Receiver</th><th className="num">Expected</th><th className="num">Handed</th><th className="num">Difference</th><th className="num">Expenses kept</th><th className="num">Settled</th></tr>
              </thead>
              <tbody>
                {report.cashHandovers.map((h: DailyReportCashHandover) => (
                  <tr key={h.id}>
                    <td>{h.receiver.name}</td>
                    <td className="num">{formatUsd(h.expectedAmt)}</td>
                    <td className="num">{formatUsd(h.handedAmt)}</td>
                    <td className="num" style={{ color: parseFloat(h.difference) !== 0 ? '#b03a2e' : undefined }}>{formatUsd(h.difference)}</td>
                    <td className="num">{formatUsd(h.expenses.reduce((s, e) => s + parseFloat(e.amount), 0))}</td>
                    <td className="num">{formatUsd(h.settledAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Orders ── */}
        <div className="day-report-section">
          <div className="day-report-section-title">Orders</div>
          <div className="day-report-two-col">
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>Created today ({report.orders.created.length})</div>
              {report.orders.created.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Order</th><th>Client</th><th>Location</th><th>Status</th></tr></thead>
                  <tbody>
                    {report.orders.created.map(o => (
                      <tr key={o.id}><td>{o.displayId ?? o.id.slice(0, 8)}</td><td>{o.client.name}</td><td>{o.location?.name ?? '—'}</td><td>{o.status}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>Delivered today ({report.orders.delivered.length})</div>
              {report.orders.delivered.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Order</th><th>Client</th><th>Location</th></tr></thead>
                  <tbody>
                    {report.orders.delivered.map(o => (
                      <tr key={o.id}><td>{o.displayId ?? o.id.slice(0, 8)}</td><td>{o.client.name}</td><td>{o.location?.name ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* ── Stock Movement ── */}
        <div className="day-report-section">
          <div className="day-report-section-title">Stock movement</div>
          <div className="day-report-two-col">
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>In — raw lots received ({report.stockMovement.in.rawLots.length})</div>
              {report.stockMovement.in.rawLots.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Type</th><th>Grade</th><th>Supplier</th><th className="num">Kg</th></tr></thead>
                  <tbody>
                    {report.stockMovement.in.rawLots.map(l => (
                      <tr key={l.lotId}><td>{l.charcoalType}</td><td>{l.grade}</td><td>{l.supplier}</td><td className="num">{l.kgReceived}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ fontWeight: 600, fontSize: '0.9em', margin: '8px 0 4px' }}>In — packed from sessions ({report.stockMovement.in.packedFromSessions.length})</div>
              {report.stockMovement.in.packedFromSessions.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Worker</th><th className="num">Kg consumed</th><th className="num">Kg out</th></tr></thead>
                  <tbody>
                    {report.stockMovement.in.packedFromSessions.map(s => (
                      <tr key={s.sessionId}><td>{s.worker}</td><td className="num">{s.kgConsumed}</td><td className="num">{s.kgOutputTotal}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>Out ({report.stockMovement.out.length})</div>
              {report.stockMovement.out.length === 0 ? <Empty /> : (
                <table>
                  <thead><tr><th>Type</th><th>Charcoal</th><th>Grade</th><th className="num">Bags</th><th className="num">Kg</th></tr></thead>
                  <tbody>
                    {report.stockMovement.out.map((r, i) => (
                      <tr key={i}><td>{r.exitType.replace(/_/g, ' ')}</td><td>{r.charcoalType}</td><td>{r.grade}</td><td className="num">{r.bags || '—'}</td><td className="num">{parseFloat(r.kg) > 0 ? r.kg : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* ── Client Receivables ── */}
        <Section title="Client receivables (active clients only)" count={report.clientReceivables.length}>
          {report.clientReceivables.length === 0 ? <Empty text="No client activity today" /> : (
            <table>
              <thead>
                <tr><th>Client</th><th className="num">Opening</th><th className="num">Today's charges</th><th className="num">Today's payments</th><th className="num">Closing</th></tr>
              </thead>
              <tbody>
                {report.clientReceivables.map((c: DailyReportClientReceivable) => (
                  <tr key={c.clientId}>
                    <td>{c.clientName}</td>
                    <td className="num">{formatUsd(c.openingBalance)}</td>
                    <td className="num">{formatUsd(c.todaysCharges)}</td>
                    <td className="num">{formatUsd(c.todaysPayments)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatUsd(c.closingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Employee Summary ── */}
        <Section title="Employee / receiver summary" count={report.employeeSummary.length}>
          {report.employeeSummary.length === 0 ? <Empty /> : (
            <table>
              <thead>
                <tr><th>Employee</th><th className="num">Received today</th><th className="num">Handed over today</th><th className="num">Outstanding (end of day)</th></tr>
              </thead>
              <tbody>
                {report.employeeSummary.map((e: DailyReportEmployeeSummary) => (
                  <tr key={e.receiver.id}>
                    <td>{e.receiver.name}</td>
                    <td className="num">{formatUsd(e.receivedToday)}</td>
                    <td className="num">{formatUsd(e.handedOverToday)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatUsd(e.outstandingAsOfEndOfDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Exceptions ── */}
        <div className="day-report-section">
          <div className="day-report-section-title">
            Exceptions <span className="day-report-section-count">{report.exceptions.length}</span>
          </div>
          {report.exceptions.length === 0 ? <Empty text="No exceptions — nothing flagged for this day" /> : (
            <ul className="day-report-exceptions">
              {report.exceptions.map((x: DailyReportException, i) => (
                <li key={i}>{x.description}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{`
        @page { size: 210mm 297mm; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  )
}


function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="day-report-kpi">
      <div className="day-report-kpi-label">{label}</div>
      <div className="day-report-kpi-value">{value}</div>
      <div style={{ fontSize: '0.78em', color: '#8a877e' }}>{sub}</div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="day-report-section">
      <div className="day-report-section-title">
        {title} <span className="day-report-section-count">{count}</span>
      </div>
      {children}
    </div>
  )
}

function Empty({ text = 'No activity' }: { text?: string }) {
  return <div className="day-report-empty">{text}</div>
}
