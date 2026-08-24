import { useParams } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClient } from '../hooks/useClients'
import { useFillJob } from '../hooks/useFillJobs'
import { formatUsd } from '../lib/money'
import { formatDateTime } from '../lib/date'

/**
 * Fill Job detail — worthy of its own page because a job carries multiple
 * charcoal-lot inputs and multiple bag-type outputs, each with its own
 * per-item cost, which a list row can't reasonably show. No displayId and
 * no status field exist on FillJob (see fill-jobs.service.ts) — titled by
 * date, no status badge. No edit action: FillJobsController has no update
 * endpoint (create-only).
 */
export default function FillClientFillJobDetail() {
  const { clientId, jobId } = useParams<{ clientId: string; jobId: string }>()

  const clientQ = useClient(clientId ?? '')
  const client = clientQ.data
  const jobQ = useFillJob(jobId ?? '')
  const job = jobQ.data

  if (jobQ.isLoading) {
    return (
      <>
        <Topbar title="Fill job" back={{ label: 'Fill Jobs', to: `/fill-clients/${clientId}/fill-jobs` }} />
        <div className="content"><div className="empty">Loading…</div></div>
      </>
    )
  }
  if (jobQ.isError || !job) {
    return (
      <>
        <Topbar title="Fill job" back={{ label: 'Fill Jobs', to: `/fill-clients/${clientId}/fill-jobs` }} />
        <div className="content"><div className="empty">Fill job not found.</div></div>
      </>
    )
  }

  return (
    <>
      <Topbar title={`Fill job — ${formatDateTime(job.date, { day: '2-digit' })}`} back={{ label: 'Fill Jobs', to: `/fill-clients/${clientId}/fill-jobs` }} />
      <div className="content">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>Fill job</h1>
            <div className="page-header-meta">
              <span className="meta-row"><i className="ti ti-user" /> {client?.name ?? '—'}</span>
              <span className="meta-row"><i className="ti ti-calendar" /> {formatDateTime(job.date, { day: '2-digit' })}</span>
              {job.workerEntity && <span className="meta-row"><i className="ti ti-hammer" /> {job.workerEntity.name}</span>}
            </div>
          </div>
          <div className="kpi-strip">
            <div className="kpi-tile">
              <div className="kpi-tile-label">Charcoal used</div>
              <div className="kpi-tile-value">{parseFloat(job.totalCharcoalKg).toFixed(1)} kg</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Bags produced</div>
              <div className="kpi-tile-value">{job.totalBags}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">Total cost</div>
              <div className="kpi-tile-value">{formatUsd(job.totalCost)}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-package" /> Bags produced</div></div>
          <table className="data-table">
            <thead><tr><th>Bag spec</th><th className="right">Qty</th><th className="right">Fill price / bag</th></tr></thead>
            <tbody>
              {job.bagOutputs.map((b, i) => (
                <tr key={i}>
                  <td>{b.size} kg · {b.charcoal}</td>
                  <td className="right num" style={{ fontWeight: 600 }}>{b.qty}</td>
                  <td className="right num" style={{ color: 'var(--accent2)' }}>{formatUsd(b.fillPricePerBag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-flame" /> Charcoal consumed</div></div>
          <table className="data-table">
            <thead><tr><th>Lot</th><th className="right">Kg used</th><th className="right">Cost/kg</th><th className="right">Cost</th></tr></thead>
            <tbody>
              {job.fillJobLots.map(l => (
                <tr key={l.id}>
                  <td>{l.lot ? `${l.lot.charcoalType} · ${l.lot.grade}` : '—'}</td>
                  <td className="right num">{parseFloat(l.kgUsed).toFixed(1)} kg</td>
                  <td className="right num" style={{ color: 'var(--text2)' }}>{formatUsd(l.costPerKg)}</td>
                  <td className="right num" style={{ fontWeight: 600 }}>{formatUsd(l.cost)}</td>
                </tr>
              ))}
              {job.fillJobLots.length === 0 && <tr><td colSpan={4} className="empty">No lot breakdown recorded</td></tr>}
            </tbody>
          </table>
        </div>

        {job.notes && (
          <div className="card">
            <div className="card-head"><div className="card-title"><i className="ti ti-notes" /> Notes</div></div>
            <div style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.6 }}>{job.notes}</div>
          </div>
        )}

        <div className="card">
          <div className="card-head"><div className="card-title"><i className="ti ti-info-circle" /> Details</div></div>
          <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 13 }}>
            <div><div style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 3 }}>Logged at</div>{formatDateTime(job.createdAt, { day: '2-digit' })}</div>
          </div>
        </div>
      </div>
    </>
  )
}
