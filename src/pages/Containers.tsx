import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useContainers } from '../hooks/useContainers'
import { useSuppliers } from '../hooks/useSuppliers'
import type { Container, ContainerStatus, ContainerTrackingSummary } from '../types/api'
import { formatDate, formatDateTime, formatEtaCountdown, daysUntil } from '../lib/date'

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

/** Sum of paidBags × kgPerBag / 1000 across product lines — the same tonnage
 * formula ContainerDetail.tsx uses. productLines is already returned by
 * GET /containers (no extra request). */
function totalWeightTons(ctr: Container): number {
  const lines = ctr.productLines ?? []
  return lines.reduce((s, l) => s + (l.paidBags * parseFloat(l.kgPerBag)) / 1000, 0)
}

/** Text color for the countdown value, by urgency — overdue reads as red,
 * arriving today/very soon as amber, everything else as the default text
 * color. Purely a visual cue; formatEtaCountdown() owns the wording. */
function countdownColor(eta: string | null | undefined): string {
  const days = daysUntil(eta)
  if (days === null) return 'var(--text3)'
  if (days < 0) return 'var(--red)'
  if (days <= 3) return 'var(--accent2)'
  return 'var(--text)'
}

function routeLine(tracking: ContainerTrackingSummary | null | undefined): string | null {
  if (!tracking) return null
  if (tracking.origin && tracking.destination) return `${tracking.origin} → ${tracking.destination}`
  return tracking.origin ?? tracking.destination ?? null
}

export default function Containers() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<CtrStatus>('all')
  const [search, setSearch] = useState('')

  // The list endpoint filters server-side; we pass status + search params.
  // limit: 100 (the API's max — see ParseLimitPipe) so this "control center"
  // overview isn't silently truncated at the default page size of 20 before
  // being split into the two sections below. finalized: false — this page
  // represents ACTIVE operational work; finalized containers move to
  // /containers/history instead (Container Finalization + History).
  const { data, isLoading, isError, refetch } = useContainers({
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: search || undefined,
    limit: 100,
    finalized: false,
  })
  // Supplier lookup for the client-side name join (cards display name, not id).
  const suppliersQ = useSuppliers({ limit: 100 })
  const supplierNameById = new Map((suppliersQ.data?.data ?? []).map(s => [s.id, s.name]))
  const containers: Container[] = data?.data ?? []

  // Tab counts: total reflects the active query; per-status is best-effort from
  // the loaded page (the API paginates, so these are page-local counts).
  const counts = {
    all: data?.total ?? containers.length,
    port: containers.filter(c => c.status === 'port').length,
    transit: containers.filter(c => c.status === 'transit').length,
    arrived: containers.filter(c => c.status === 'arrived').length,
  }

  // The internal container status is the sole authority for which section a
  // container belongs to — never inferred from Traqo's tracking status. An
  // "arrived" container stays in ARRIVED even if its last cached tracking
  // snapshot still reads "IN_TRANSIT" (stale/unrefreshed data).
  const notArrived = containers.filter(c => c.status !== 'arrived')
  const arrived = containers.filter(c => c.status === 'arrived')

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

        {!isLoading && !isError && (
          <>
            {/* ============================================================
                NOT ARRIVED / IN TRANSIT — the operational section: what's
                still coming, where it is, and how many days remain.
               ============================================================ */}
            <div className="section-title">
              <i className="ti ti-ship" /> Not arrived / in transit
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", opacity: 0.7 }}>({notArrived.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
              {notArrived.map(ctr => {
                const badge = STATUS_BADGE[ctr.status]
                const stripe = STRIPE_COLOR[ctr.status]
                const tracking = ctr.tracking
                const route = routeLine(tracking)
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
                          {(ctr.sealineName ?? ctr.sealine) && (
                            <span><i className="ti ti-anchor" /> {ctr.sealineName ?? ctr.sealine}</span>
                          )}
                          {tracking?.status && (
                            <span className="badge badge-gray" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{tracking.status}</span>
                          )}
                          {(tracking?.vessel || tracking?.voyage) && (
                            <span><i className="ti ti-sailboat" /> {[tracking?.vessel, tracking?.voyage].filter(Boolean).join(' · ')}</span>
                          )}
                        </div>

                        {(route || tracking?.currentLocation) && (
                          <div className="ctr-meta">
                            {route && <span><i className="ti ti-route" /> {route}</span>}
                            {tracking?.currentLocation && <span><i className="ti ti-map-pin" /> Latest location: {tracking.currentLocation}</span>}
                          </div>
                        )}

                        {!ctr.sealine && (
                          <div className="ctr-meta" style={{ color: 'var(--text3)' }}>Carrier not set</div>
                        )}
                        {ctr.sealine && !tracking && (
                          <div className="ctr-meta" style={{ color: 'var(--text3)' }}>Tracking not available — open container to refresh</div>
                        )}

                        {tracking?.lastFetchedAt && (
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                            Tracking updated {formatDateTime(tracking.lastFetchedAt)}
                          </div>
                        )}
                      </div>
                      <div className="ctr-right">
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {tracking?.eta ? `ETA ${formatDate(tracking.eta)}` : ' '}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: countdownColor(tracking?.eta), textAlign: 'right' }}>
                          {formatEtaCountdown(tracking?.eta)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {notArrived.length === 0 && (
                <div className="empty">No containers currently in transit match your search/filter.</div>
              )}
            </div>

            {/* ============================================================
                ARRIVED — completed, compact, no countdown/tracking clutter.
               ============================================================ */}
            <div className="section-title">
              <i className="ti ti-anchor" /> Arrived
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", opacity: 0.7 }}>({arrived.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {arrived.map(ctr => {
                const route = routeLine(ctr.tracking)
                return (
                  <div
                    key={ctr.id}
                    className="ctr-card"
                    onClick={() => navigate('/containers/' + encodeURIComponent(ctr.id))}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="ctr-card-inner">
                      <div className="ctr-status-stripe" style={{ background: STRIPE_COLOR.arrived }} />
                      <div className="ctr-body">
                        <div className="ctr-head">
                          <div>
                            <div className="ctr-number">{ctr.number}</div>
                            <div className="ctr-supplier">
                              <i className="ti ti-building-store" style={{ fontSize: 12 }} /> {supplierNameById.get(ctr.supplierId) ?? ctr.supplierId}
                            </div>
                          </div>
                          <span className="badge badge-green">Arrived</span>
                        </div>
                        <div className="ctr-meta">
                          <span><i className="ti ti-calendar-check" /> Arrived {formatDate(ctr.arrivalDate)}</span>
                          <span><i className="ti ti-weight" /> {totalWeightTons(ctr).toFixed(2)} t</span>
                          {(ctr.sealineName ?? ctr.sealine) && (
                            <span><i className="ti ti-anchor" /> {ctr.sealineName ?? ctr.sealine}</span>
                          )}
                        </div>
                        {route && (
                          <div className="ctr-meta" style={{ color: 'var(--text3)' }}>
                            <span><i className="ti ti-route" /> {route}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {arrived.length === 0 && (
                <div className="empty">No arrived containers match your search/filter.</div>
              )}
            </div>
          </>
        )}

      </div>
    </>
  )
}
