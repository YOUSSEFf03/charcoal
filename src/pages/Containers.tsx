import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useContainers } from '../hooks/useContainers'
import { useSuppliers } from '../hooks/useSuppliers'
import type { Container, ContainerStatus } from '../types/api'

type CtrStatus = 'all' | 'port' | 'transit' | 'arrived'

const STATUS_BADGE: Record<ContainerStatus, { label: string; cls: string }> = {
  port: { label: 'At port', cls: 'badge-amber' },
  transit: { label: 'In transit', cls: 'badge-blue' },
  arrived: { label: 'Arrived', cls: 'badge-green' },
}

const STRIPE_COLOR: Record<ContainerStatus, string> = {
  port: 'var(--accent2)',
  transit: 'var(--blue)',
  arrived: 'var(--accent)',
}

// Format an ISO arrival date to the short "28 May" display used on the cards.
function fmtEta(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function Containers() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<CtrStatus>('all')
  const [search, setSearch] = useState('')

  // The list endpoint filters server-side; we pass status + search params.
  const { data, isLoading, isError, refetch } = useContainers({
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: search || undefined,
  })
  // Supplier lookup for the client-side name join (cards display name, not id).
  const suppliersQ = useSuppliers({ limit: 100 })
  const supplierNameById = new Map((suppliersQ.data?.data ?? []).map(s => [s.id, s.name]))
  const containers: Container[] = data?.data ?? []

  // Tab counts: total reflects the active query; per-status is best-effort from
  // the loaded page (the API paginates, so these are page-local counts).
  const counts = {
    all: statusFilter === 'all' ? (data?.total ?? containers.length) : (data?.total ?? containers.length),
    port: containers.filter(c => c.status === 'port').length,
    transit: containers.filter(c => c.status === 'transit').length,
    arrived: containers.filter(c => c.status === 'arrived').length,
  }

  return (
    <>
      <Topbar title="Containers">
        <button className="btn primary" onClick={() => navigate('/containers/new')}>
          <i className="ti ti-plus" style={{ fontSize: 14 }} /> New container
        </button>
      </Topbar>
      <div className="content">

        {/* Search + status filter tabs */}
        <div className="filters">
          <div className="filter-input">
            <i className="ti ti-search" />
            <input type="text" placeholder="Search container number…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="status-tabs">
          {([['all', 'All'], ['port', 'At port'], ['transit', 'In transit'], ['arrived', 'Arrived']] as const).map(([key, label]) => (
            <button
              key={key}
              className={`status-tab${statusFilter === key ? ' active' : ''}`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
              <span style={{ marginLeft: 6, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", opacity: 0.7 }}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        {/* Loading state — skeleton cards */}
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map(i => (
              <div className="ctr-card" key={i}>
                <div className="ctr-card-inner">
                  <div className="ctr-status-stripe" style={{ background: 'var(--border)' }} />
                  <div className="ctr-body">
                    <div className="skeleton" style={{ width: '30%', height: 16, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: '50%', height: 12 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state with retry */}
        {isError && (
          <div className="empty">
            Failed to load containers.
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => refetch()}>Retry</button>
            </div>
          </div>
        )}

        {/* Container cards */}
        {!isLoading && !isError && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {containers.map(ctr => {
              const badge = STATUS_BADGE[ctr.status]
              const stripe = STRIPE_COLOR[ctr.status]
              return (
                <div
                  key={ctr.id}
                  className="ctr-card"
                  onClick={() => navigate('/containers/' + encodeURIComponent(ctr.id))}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="ctr-card-inner">
                    <div className="ctr-status-stripe" style={{ background: stripe }} />
                    <div className="ctr-body">
                      <div className="ctr-head">
                        <div>
                          <div className="ctr-number">{ctr.number}</div>
                          <div className="ctr-supplier">
                            <i className="ti ti-building-store" style={{ fontSize: 12 }} /> {supplierNameById.get(ctr.supplierId) ?? ctr.supplierId}
                          </div>
                        </div>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <div className="ctr-meta">
                        <span><i className="ti ti-clock" /> ETA {fmtEta(ctr.arrivalDate)}</span>
                        {ctr.notes && <span><i className="ti ti-map-pin" /> {ctr.notes}</span>}
                      </div>
                    </div>
                    <div className="ctr-right">
                      <span className="badge badge-gray" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
                        {ctr.status}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
            {containers.length === 0 && (
              <div className="empty">No containers found.</div>
            )}
          </div>
        )}

      </div>
    </>
  )
}
