import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useClientBalances, useClientAging } from '../hooks/useBalances'
import type { Client } from '../types/api'

// Format a Decimal-string money figure as USD (no decimals, comma grouped).
function fmtUsd0(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '$0'
}

function fmtUsd2(value?: string | null) {
  const n = value != null ? parseFloat(value) : NaN
  return Number.isFinite(n)
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$0.00'
}

function fmtDate(iso?: string | null) {
  if (!iso) return 'no order yet'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// First two word-initials of a (possibly Arabic) client name.
function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
}

// Days since an ISO date (used to derive the age bar / overdue styling).
function daysSince(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
}

const TYPE_COLORS: Record<string, string> = {
  restaurant: 'var(--blue)',
  wholesale:  'var(--accent)',
  export:     'var(--text)',
  corporate:  'var(--accent2)',
  shop:       'var(--text3)',
  walk_in:    '#86EFAC',
}

export default function Balances() {
  const navigate = useNavigate()
  const [selectedBucket, setSelectedBucket] = useState(0)
  const [search, setSearch] = useState('')

  // Live client balances (main table) + overdue/aging list.
  const {
    data: balancesResp,
    isLoading: balLoading,
    isError: balError,
    refetch: refetchBalances,
  } = useClientBalances({ search: search || undefined, limit: 100 })
  const {
    data: agingData,
    isLoading: agingLoading,
    isError: agingError,
    refetch: refetchAging,
  } = useClientAging()

  // Only clients that actually owe us money ("money clients owe us").
  const balanceClients: Client[] = (balancesResp?.data ?? []).filter(c => parseFloat(c.balance) > 0)
  const overdueClients: Client[] = agingData ?? []

  // Headline / aging-bucket figures derived from live data.
  const totalOwed = balanceClients.reduce((s, c) => s + parseFloat(c.balance), 0)
  const overdueOwed = overdueClients.reduce((s, c) => s + parseFloat(c.balance), 0)

  // "Owed by client type" — computed from real balances
  const byTypeMap = new Map<string, number>()
  for (const c of balanceClients) {
    const bal = parseFloat(c.balance)
    byTypeMap.set(c.type, (byTypeMap.get(c.type) ?? 0) + bal)
  }
  const BY_TYPE = Array.from(byTypeMap.entries())
    .filter(([, amt]) => amt > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([type, amt]) => ({
      name: type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      pct: totalOwed > 0 ? Math.round((amt / totalOwed) * 100) : 0,
      amount: fmtUsd0(String(amt)),
      color: TYPE_COLORS[type] ?? 'var(--border2)',
    }))

  // Aging buckets, derived from live counts (layout/classes preserved exactly).
  const AGING = [
    { label: 'All open',     sub: `${balanceClients.length} clients`,            amount: fmtUsd0(String(totalOwed)),  cls: '' },
    { label: 'On account',   sub: `${balanceClients.length - overdueClients.length} not overdue`, amount: fmtUsd0(String(totalOwed - overdueOwed)), cls: 'ok' },
    { label: 'Overdue',      sub: `${overdueClients.length} clients`,            amount: fmtUsd0(String(overdueOwed)), cls: 'danger' },
  ]

  // "Oldest unpaid" — the most-overdue clients (aging list is sorted by the API).
  const oldest = overdueClients.slice(0, 3)

  const filtered = balanceClients

  return (
    <>
      <Topbar title="Balances">
        <span className="page-sub" style={{ color: 'var(--text3)' }}>money clients owe us</span>
        <button className="btn" style={{ marginLeft: 'auto' }}><i className="ti ti-send" style={{ fontSize: 15 }} /> Send reminders</button>
        <button className="btn primary" onClick={() => navigate('/payment')}><i className="ti ti-cash" style={{ fontSize: 15 }} /> Log payment</button>
        <button className="btn"><i className="ti ti-download" style={{ fontSize: 15 }} /> Export CSV</button>
      </Topbar>
      <div className="content">

        {/* Headline */}
        <div className="headline">
          <div className="headline-main">
            <div className="headline-lbl">total owed to us</div>
            <div className="headline-val">{balLoading ? <span className="skeleton" style={{ display: 'inline-block', width: 160, height: 30 }} /> : fmtUsd0(String(totalOwed))}</div>
            <div className="headline-sub">across {balanceClients.length} clients with a balance</div>
          </div>
          <div className="headline-stat">
            <div className="v green">{balanceClients.length}</div>
            <div className="k">clients with balance</div>
          </div>
          <div className="headline-stat">
            <div className="v red">{agingLoading ? '—' : fmtUsd0(String(overdueOwed))}</div>
            <div className="k">overdue · {overdueClients.length} clients</div>
          </div>
        </div>

        {/* Aging */}
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">
            <div className="card-title"><i className="ti ti-clock" /> Aging buckets · click to filter</div>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>days past invoice date</span>
          </div>
          <div className="aging-row">
            {AGING.map((b, i) => (
              <div key={i} className={`aging-cell ${b.cls} ${selectedBucket === i ? 'sel' : ''}`} onClick={() => setSelectedBucket(i)}>
                <span className="bucket">{b.label}</span>
                <span className="v">{b.amount}</span>
                <span className="count">{b.sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Two columns: by type + oldest */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 18 }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title"><i className="ti ti-chart-bar" /> Owed by client type</div>
            </div>
            {balLoading && <div className="empty" style={{ padding: 14 }}>Loading…</div>}
            {!balLoading && BY_TYPE.length === 0 && (
              <div className="empty" style={{ padding: 14 }}>No outstanding balances.</div>
            )}
            {BY_TYPE.map(t => (
              <div className="share-row" key={t.name}>
                <span className="share-name">{t.name}</span>
                <div className="share-bar"><div className="fill" style={{ width: `${t.pct}%`, background: t.color }} /></div>
                <span className="share-val">{t.amount}</span>
                <span className="share-pct">{t.pct}%</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title"><i className="ti ti-alert-triangle" style={{ color: 'var(--red)' }} /> Oldest unpaid</div>
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>60+ days</span>
            </div>
            {agingLoading && [0, 1, 2].map(i => (
              <div className="oldest-row" key={i}>
                <div>
                  <div className="skeleton" style={{ width: 140, height: 13, marginBottom: 4 }} />
                  <div className="skeleton" style={{ width: 90, height: 11 }} />
                </div>
                <div className="amt"><div className="skeleton" style={{ width: 60, height: 13 }} /></div>
                <div className="age"><div className="skeleton" style={{ width: 50, height: 11 }} /></div>
              </div>
            ))}
            {agingError && (
              <div style={{ padding: '18px', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
                Failed to load overdue clients.
                <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetchAging()}>Retry</button></div>
              </div>
            )}
            {!agingLoading && !agingError && oldest.length === 0 && (
              <div style={{ padding: '18px', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No overdue clients.</div>
            )}
            {!agingLoading && !agingError && oldest.map(o => {
              const age = daysSince(o.lastOrderDate)
              return (
                <div className="oldest-row" key={o.id} onClick={() => navigate(`/clients/${o.id}`)} style={{ cursor: 'pointer' }}>
                  <div>
                    <div className="nm">{o.name}</div>
                    <div className="sub">{o.type} · last order {fmtDate(o.lastOrderDate)}</div>
                  </div>
                  <div className="amt">{fmtUsd2(o.balance)}</div>
                  <div className="age">{age != null ? `${age} days` : '—'}</div>
                </div>
              )
            })}
            <div style={{ padding: '11px 18px', background: 'var(--surface2)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)', fontFamily: "'IBM Plex Mono',monospace" }}>
              <span style={{ color: 'var(--red)' }}>Send overdue reminder to all {oldest.length} →</span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="controls">
          <div className="search-wrap">
            <i className="ti ti-search" />
            <input type="text" placeholder="Search clients…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="seg">
            <div className="seg-opt sel">All <span style={{ color: 'var(--text3)', marginLeft: 4 }}>{balanceClients.length}</span></div>
            {BY_TYPE.map(t => (
              <div key={t.name} className="seg-opt">
                {t.name} <span style={{ color: 'var(--text3)', marginLeft: 4 }}>{balanceClients.filter(c => c.type.replace('_',' ').replace(/\b\w/g, l => l.toUpperCase()) === t.name).length}</span>
              </div>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>sort: oldest first</span>
        </div>

        {/* Table */}
        <div className="card">
          <div className="bal-row head">
            <span />
            <span>Client</span>
            <span>Type</span>
            <span className="right">Currency</span>
            <span className="right">Last payment</span>
            <span className="right">Oldest invoice</span>
            <span className="right">Balance</span>
            <span className="right">Actions</span>
          </div>

          {balLoading && [0, 1, 2, 3].map(i => (
            <div className="bal-row" key={`sk-${i}`}>
              <div className="bal-av"><div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} /></div>
              <div className="bal-client">
                <span className="bal-name"><div className="skeleton" style={{ width: 160, height: 13, marginBottom: 4 }} /></span>
                <span className="bal-meta"><div className="skeleton" style={{ width: 110, height: 11 }} /></span>
              </div>
              <span><div className="skeleton" style={{ width: 60, height: 12 }} /></span>
              <span className="num"><div className="skeleton" style={{ width: 36, height: 12, marginLeft: 'auto' }} /></span>
              <span className="num"><div className="skeleton" style={{ width: 80, height: 12, marginLeft: 'auto' }} /></span>
              <div className="age-cell"><div className="skeleton" style={{ width: 70, height: 12 }} /></div>
              <span className="num"><div className="skeleton" style={{ width: 70, height: 13, marginLeft: 'auto' }} /></span>
              <span />
            </div>
          ))}

          {balError && (
            <div style={{ padding: '36px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
              Failed to load client balances.
              <div><button className="btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => refetchBalances()}>Retry</button></div>
            </div>
          )}

          {!balLoading && !balError && filtered.length === 0 && (
            <div style={{ padding: '36px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
              No clients with an outstanding balance.
            </div>
          )}

          {!balLoading && !balError && filtered.map(c => {
            const overdue = c.isOverdue
            const ageClass = overdue ? 'danger' : 'ok'
            const age = daysSince(c.lastOrderDate)
            const agePct = age != null ? Math.min(100, Math.round((age / 120) * 100)) : 0
            const activePhone = c.phones?.find(p => p.isActive)?.number ?? c.phones?.[0]?.number ?? '—'
            return (
              <div className="bal-row" key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                <div className="bal-av">{initialsOf(c.name)}</div>
                <div className="bal-client">
                  <span className="bal-name">{c.name}</span>
                  <span className="bal-meta">{activePhone}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{c.type}</span>
                <span className="num" style={{ fontWeight: 400, color: 'var(--text2)' }}>{c.currency}</span>
                <span className="num" style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtDate(c.lastOrderDate)}</span>
                <div className="age-cell">
                  <div className="age-bar"><div className={`fill ${ageClass}`} style={{ width: `${agePct}%` }} /></div>
                  <span className={`age-days ${ageClass}`}>{age != null ? `${age} d` : '—'}</span>
                </div>
                <span className={`balance-cell ${overdue ? 'red' : 'amber'}`}>{fmtUsd0(c.balance)}</span>
                <div className="row-actions" onClick={e => e.stopPropagation()}>
                  <button className="icon-btn" onClick={() => navigate(`/clients/${c.id}`)} title="View"><i className="ti ti-arrow-up-right" /></button>
                  <button className="icon-btn" title="Print statement"><i className="ti ti-printer" /></button>
                  <button className="icon-btn" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }} onClick={() => navigate('/payment')} title="Log payment"><i className="ti ti-cash" /></button>
                </div>
              </div>
            )
          })}

          {!balLoading && !balError && filtered.length > 0 && (
            <div className="bal-foot">
              <span />
              <span>{filtered.length} clients with balance</span>
              <span />
              <span className="num" style={{ textAlign: 'right' }}>{filtered.filter(c => c.currency === 'USD').length} USD · {filtered.filter(c => c.currency === 'LBP').length} LBP</span>
              <span />
              <span style={{ textAlign: 'right' }}>overdue {overdueClients.length}</span>
              <span className="total">{fmtUsd0(String(totalOwed))}</span>
              <span />
            </div>
          )}
        </div>

      </div>
    </>
  )
}
