import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useDailyReport } from '../hooks/useReports'
import { useDocLang } from '../lib/i18n/useDocLang'
import { DocLangToggle } from '../components/ui/DocLangToggle'
import { DailyReportDocument } from '../components/documents/DailyReportDocument'
import { t, type DocLabelKey } from '../lib/i18n/docLabels'
import type { DocLang } from '../lib/i18n/docLang'

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
 *
 * Language: `/reports/daily/:date?lang=en|ar`. Absent or invalid => English
 * (historical output, unchanged). `ar` sets dir="rtl" lang="ar" on the
 * document, uses dictionary labels (docLabels.ts), mirrors table alignment,
 * and isolates numbers/amounts LTR. Backend free text and enum values
 * (statuses, methods, categories, names) are shown as stored.
 */
export default function DailyReportPrint() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [lang, setLang] = useDocLang('en')
  const reportQ = useDailyReport(date ?? '')
  const report = reportQ.data

  const L = (key: DocLabelKey, vars?: Record<string, string | number>) => t(lang, key, vars)

  function changeDate(next: string) {
    // Keep the chosen language when moving to another day.
    navigate({ pathname: `/reports/daily/${next}`, search: location.search }, { replace: true })
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
      status === 403 ? L('report.ownerOnly') :
      status === 400 ? L('report.invalidDate') :
      reportQ.isError ? L('report.loadFailed') :
      L('report.notFound')
    return (
      <div
        dir={lang === 'ar' ? 'rtl' : undefined}
        lang={lang === 'ar' ? 'ar' : undefined}
        style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#666' }}
      >
        {msg}
      </div>
    )
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DocLangToggle value={lang} onChange={(l) => setLang(l as DocLang)} />
          <button
            onClick={() => window.print()}
            style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <i className="ti ti-printer" style={{ fontSize: 15 }} /> Print
          </button>
        </div>
      </div>

      <DailyReportDocument report={report} lang={lang} />

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
