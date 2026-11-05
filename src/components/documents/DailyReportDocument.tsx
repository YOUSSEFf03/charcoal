import type { ReactNode } from 'react'
import { formatUsd } from '../../lib/money'
import { formatDate } from '../../lib/date'
import { COMPANY_INFO } from '../../lib/companyInfo'
import { Ltr } from '../receipt/Ltr'
import { t, type DocLabelKey } from '../../lib/i18n/docLabels'
import { fmtDocDate, fmtDocMoney } from '../../lib/i18n/docFormat'
import type { DocLang } from '../../lib/i18n/docLang'
import farahLogo from '../../assets/farah-charcoal-logo.png'
import type {
  DailyReport, DailyReportSale, DailyReportPayment, DailyReportCashHandover,
  DailyReportClientReceivable, DailyReportEmployeeSummary, DailyReportException,
} from '../../types/api'

/**
 * The printable Full Day Report page body (presentational only). Shared by
 * the /reports/daily/:date print route and the off-screen PDF render used by
 * the Print / Download / Share dialog. Every figure is read verbatim from the
 * backend response — no accounting math here.
 */
export function DailyReportDocument({ report, lang }: { report: DailyReport; lang: DocLang }) {
  const L = (key: DocLabelKey, vars?: Record<string, string | number>) => t(lang, key, vars)
  /** Amounts: English keeps formatUsd ("$1,234.50"); Arabic puts the symbol after the number, LTR-isolated. */
  const usd = (n: string | number) => <Ltr lang={lang}>{lang === 'en' ? formatUsd(n) : fmtDocMoney(lang, Number(n), 'USD')}</Ltr>
  const num = (v: ReactNode) => <Ltr lang={lang}>{v}</Ltr>
  const day = (iso: string) => (lang === 'en' ? formatDate(iso) : fmtDocDate(lang, iso))

  const expenseTotal = (
    parseFloat(report.summary.totalCashHandoverExpenses) +
    parseFloat(report.summary.totalGeneralExpenses) +
    parseFloat(report.summary.totalWorkerCost)
  )
  // LRI/PDI isolates keep the date and time LTR inside the Arabic sentence.
  const iso = (v: string) => (lang === 'ar' ? `⁦${v}⁩` : v)
  const generatedTime = new Date(report.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const generatedLine = L('report.generatedAt', { date: iso(day(report.generatedAt)), time: iso(generatedTime) })
  const count = (n: number, one: DocLabelKey, many: DocLabelKey) => L(n === 1 ? one : many, { n })

  return (
    <div className="day-report" dir={lang === 'ar' ? 'rtl' : undefined} lang={lang === 'ar' ? 'ar' : undefined}>
      <div className="day-report-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={farahLogo} alt={COMPANY_INFO.name} className="day-report-logo" />
          <div>
            <div className="day-report-title">{L('report.title')}</div>
            <div style={{ fontSize: '0.85em', color: '#5a5750' }}>{lang === 'ar' ? COMPANY_INFO.nameAr : COMPANY_INFO.name}</div>
          </div>
        </div>
        <div className="day-report-meta">
          <div style={{ fontSize: '1.15em', fontWeight: 700 }}>{num(day(report.date))}</div>
          <div>{generatedLine}</div>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="day-report-summary">
        <Kpi label={L('report.kpi.totalSales')} value={usd(report.summary.totalSales)} sub={count(report.summary.saleCount, 'report.sale.one', 'report.sale.many')} />
        <Kpi label={L('report.kpi.cashCollected')} value={usd(report.summary.totalCashCollected)} sub={count(report.summary.paymentCount, 'report.payment.one', 'report.payment.many')} />
        <Kpi label={L('report.kpi.expenses')} value={usd(expenseTotal)} sub={L('report.kpi.expensesSub')} />
        <Kpi label={L('report.kpi.cashHandedOver')} value={usd(report.summary.totalHandedOver)} sub={count(report.cashHandovers.length, 'report.handover.one', 'report.handover.many')} />
      </div>

      {/* ── Sales ── */}
      <Section title={L('report.section.sales')} count={report.sales.length}>
        {report.sales.length === 0 ? <Empty text={L('common.noActivity')} /> : (
          <table>
            <thead>
              <tr><th>{L('common.client')}</th><th>{L('common.type')}</th><th>{L('common.description')}</th><th className="num">{L('common.total')}</th><th className="num">{L('common.paid')}</th><th className="num">{L('report.col.remaining')}</th><th>{L('common.status')}</th></tr>
            </thead>
            <tbody>
              {report.sales.map((s: DailyReportSale) => (
                <tr key={s.id}>
                  <td>{s.client?.name ?? L('common.anonymous')}</td>
                  <td>{s.source === 'ORDER' ? L('report.source.order') : s.source === 'WAREHOUSE_SALE' ? L('report.source.warehouse') : L('common.anonymous')}</td>
                  <td>{s.description}</td>
                  <td className="num">{usd(s.saleTotal)}</td>
                  <td className="num">{usd(s.paidAmount)}</td>
                  <td className="num">{usd(s.remaining)}</td>
                  <td>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Payments ── */}
      <Section title={L('report.section.payments')} count={report.payments.length}>
        {report.payments.length === 0 ? <Empty text={L('common.noActivity')} /> : (
          <table>
            <thead>
              <tr><th>{L('common.client')}</th><th className="num">{L('common.amount')}</th><th>{L('common.method')}</th><th>{L('report.col.receiver')}</th><th>{L('report.col.appliedTo')}</th></tr>
            </thead>
            <tbody>
              {report.payments.map((p: DailyReportPayment) => (
                <tr key={p.id}>
                  <td>{p.client.name}</td>
                  <td className="num">{num(`${formatUsd(p.amount)} ${p.currency}`)}</td>
                  <td>{p.method}</td>
                  <td>{p.receiver?.name ?? '—'}</td>
                  <td>{p.allocations.length === 0 ? '—' : num(p.allocations.map(a => `${a.invoiceDisplayId ?? a.invoiceId} (${formatUsd(a.amount)})`).join(', '))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Expenses ── */}
      <div className="day-report-section">
        <div className="day-report-section-title">{L('report.section.expenses')}</div>
        <div className="day-report-two-col">
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.expenses.cashHandover', { n: report.expenses.cashHandoverExpenses.length })}</div>
            {report.expenses.cashHandoverExpenses.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('report.col.cashHolder')}</th><th>{L('common.category')}</th><th className="num">{L('common.amount')}</th></tr></thead>
                <tbody>
                  {report.expenses.cashHandoverExpenses.map(e => (
                    <tr key={e.id}><td>{e.employee.name}</td><td>{e.category}</td><td className="num">{usd(e.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.expenses.workerWages', { n: report.expenses.workerCosts.length })}</div>
            {report.expenses.workerCosts.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('report.col.worker')}</th><th>{L('common.category')}</th><th className="num">{L('common.amount')}</th></tr></thead>
                <tbody>
                  {report.expenses.workerCosts.map(w => (
                    <tr key={w.id}><td>{w.worker.name}</td><td>{w.category.replace(/_/g, ' ')}</td><td className="num">{usd(w.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.expenses.general', { n: report.expenses.generalExpenses.length })}</div>
          {report.expenses.generalExpenses.length === 0 ? <Empty text={L('common.noActivity')} /> : (
            <table>
              <thead><tr><th>{L('common.description')}</th><th>{L('common.category')}</th><th className="num">{L('common.amount')}</th></tr></thead>
              <tbody>
                {report.expenses.generalExpenses.map(e => (
                  <tr key={e.id}><td>{e.description}</td><td>{e.category ?? '—'}</td><td className="num">{usd(e.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Cash Handovers ── */}
      <Section title={L('report.section.cashHandovers')} count={report.cashHandovers.length}>
        {report.cashHandovers.length === 0 ? <Empty text={L('common.noActivity')} /> : (
          <table>
            <thead>
              <tr><th>{L('report.col.receiver')}</th><th className="num">{L('report.col.expected')}</th><th className="num">{L('report.col.handed')}</th><th className="num">{L('report.col.difference')}</th><th className="num">{L('report.col.expensesKept')}</th><th className="num">{L('report.col.settled')}</th></tr>
            </thead>
            <tbody>
              {report.cashHandovers.map((h: DailyReportCashHandover) => (
                <tr key={h.id}>
                  <td>{h.receiver.name}</td>
                  <td className="num">{usd(h.expectedAmt)}</td>
                  <td className="num">{usd(h.handedAmt)}</td>
                  <td className="num" style={{ color: parseFloat(h.difference) !== 0 ? '#b03a2e' : undefined }}>{usd(h.difference)}</td>
                  <td className="num">{usd(h.expenses.reduce((s, e) => s + parseFloat(e.amount), 0))}</td>
                  <td className="num">{usd(h.settledAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Orders ── */}
      <div className="day-report-section">
        <div className="day-report-section-title">{L('report.section.orders')}</div>
        <div className="day-report-two-col">
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.orders.createdToday', { n: report.orders.created.length })}</div>
            {report.orders.created.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('report.col.order')}</th><th>{L('common.client')}</th><th>{L('report.col.location')}</th><th>{L('common.status')}</th></tr></thead>
                <tbody>
                  {report.orders.created.map(o => (
                    <tr key={o.id}><td>{num(o.displayId ?? o.id.slice(0, 8))}</td><td>{o.client.name}</td><td>{o.location?.name ?? '—'}</td><td>{o.status}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.orders.deliveredToday', { n: report.orders.delivered.length })}</div>
            {report.orders.delivered.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('report.col.order')}</th><th>{L('common.client')}</th><th>{L('report.col.location')}</th></tr></thead>
                <tbody>
                  {report.orders.delivered.map(o => (
                    <tr key={o.id}><td>{num(o.displayId ?? o.id.slice(0, 8))}</td><td>{o.client.name}</td><td>{o.location?.name ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Stock Movement ── */}
      <div className="day-report-section">
        <div className="day-report-section-title">{L('report.section.stockMovement')}</div>
        <div className="day-report-two-col">
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.stock.inRawLots', { n: report.stockMovement.in.rawLots.length })}</div>
            {report.stockMovement.in.rawLots.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('common.type')}</th><th>{L('common.grade')}</th><th>{L('report.col.supplier')}</th><th className="num">{L('report.col.kg')}</th></tr></thead>
                <tbody>
                  {report.stockMovement.in.rawLots.map(l => (
                    <tr key={l.lotId}><td>{l.charcoalType}</td><td>{l.grade}</td><td>{l.supplier}</td><td className="num">{num(l.kgReceived)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ fontWeight: 600, fontSize: '0.9em', margin: '8px 0 4px' }}>{L('report.stock.inPacked', { n: report.stockMovement.in.packedFromSessions.length })}</div>
            {report.stockMovement.in.packedFromSessions.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('report.col.worker')}</th><th className="num">{L('report.col.kgConsumed')}</th><th className="num">{L('report.col.kgOut')}</th></tr></thead>
                <tbody>
                  {report.stockMovement.in.packedFromSessions.map(s => (
                    <tr key={s.sessionId}><td>{s.worker}</td><td className="num">{num(s.kgConsumed)}</td><td className="num">{num(s.kgOutputTotal)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9em', marginBottom: 4 }}>{L('report.stock.out', { n: report.stockMovement.out.length })}</div>
            {report.stockMovement.out.length === 0 ? <Empty text={L('common.noActivity')} /> : (
              <table>
                <thead><tr><th>{L('common.type')}</th><th>{L('report.col.charcoal')}</th><th>{L('common.grade')}</th><th className="num">{L('report.col.bags')}</th><th className="num">{L('report.col.kg')}</th></tr></thead>
                <tbody>
                  {report.stockMovement.out.map((r, i) => (
                    <tr key={i}><td>{r.exitType.replace(/_/g, ' ')}</td><td>{r.charcoalType}</td><td>{r.grade}</td><td className="num">{num(r.bags || '—')}</td><td className="num">{parseFloat(r.kg) > 0 ? num(r.kg) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Client Receivables ── */}
      <Section title={L('report.section.clientReceivables')} count={report.clientReceivables.length}>
        {report.clientReceivables.length === 0 ? <Empty text={L('report.noClientActivity')} /> : (
          <table>
            <thead>
              <tr><th>{L('common.client')}</th><th className="num">{L('report.col.opening')}</th><th className="num">{L('report.col.todaysCharges')}</th><th className="num">{L('report.col.todaysPayments')}</th><th className="num">{L('report.col.closing')}</th></tr>
            </thead>
            <tbody>
              {report.clientReceivables.map((c: DailyReportClientReceivable) => (
                <tr key={c.clientId}>
                  <td>{c.clientName}</td>
                  <td className="num">{usd(c.openingBalance)}</td>
                  <td className="num">{usd(c.todaysCharges)}</td>
                  <td className="num">{usd(c.todaysPayments)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{usd(c.closingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Employee Summary ── */}
      <Section title={L('report.section.employeeSummary')} count={report.employeeSummary.length}>
        {report.employeeSummary.length === 0 ? <Empty text={L('common.noActivity')} /> : (
          <table>
            <thead>
              <tr><th>{L('report.col.employee')}</th><th className="num">{L('report.col.receivedToday')}</th><th className="num">{L('report.col.handedOverToday')}</th><th className="num">{L('report.col.outstandingEndOfDay')}</th></tr>
            </thead>
            <tbody>
              {report.employeeSummary.map((e: DailyReportEmployeeSummary) => (
                <tr key={e.receiver.id}>
                  <td>{e.receiver.name}</td>
                  <td className="num">{usd(e.receivedToday)}</td>
                  <td className="num">{usd(e.handedOverToday)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{usd(e.outstandingAsOfEndOfDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Exceptions ── */}
      <div className="day-report-section">
        <div className="day-report-section-title">
          {L('report.section.exceptions')} <span className="day-report-section-count">{num(report.exceptions.length)}</span>
        </div>
        {report.exceptions.length === 0 ? <Empty text={L('report.noExceptions')} /> : (
          <ul className="day-report-exceptions">
            {report.exceptions.map((x: DailyReportException, i) => (
              <li key={i}>{x.description}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default DailyReportDocument

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="day-report-kpi">
      <div className="day-report-kpi-label">{label}</div>
      <div className="day-report-kpi-value">{value}</div>
      <div style={{ fontSize: '0.78em', color: '#8a877e' }}>{sub}</div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="day-report-section">
      <div className="day-report-section-title">
        {title} <span className="day-report-section-count">{count}</span>
      </div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="day-report-empty">{text}</div>
}
