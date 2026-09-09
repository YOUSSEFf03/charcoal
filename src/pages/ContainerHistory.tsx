import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useContainers } from '../hooks/useContainers'
import { useSuppliers } from '../hooks/useSuppliers'
import type { Container } from '../types/api'
import { formatDate, toDateOnlyString, currentMonthToDateRange } from '../lib/date'
import { formatUsd } from '../lib/money'

/** Same tonnage formula as ContainerDetail.tsx / Containers.tsx — reused, not reinvented. */
function totalWeightTons(ctr: Container): number {
  const lines = ctr.productLines ?? []
  return lines.reduce((s, l) => s + (l.paidBags * parseFloat(l.kgPerBag)) / 1000, 0)
}

/** Same all-in-cost formula ContainerDetail.tsx computes client-side (productCost + expenses − discount). */
function totalCostUsd(ctr: Container): number {
  const lines = ctr.productLines ?? []
  const productCost = lines.reduce((s, l) => s + (l.paidBags * parseFloat(l.kgPerBag) * parseFloat(l.pricePerTon)) / 1000, 0)
  const totalExp = (ctr.expenses ?? []).reduce((s, e) => s + parseFloat(e.amount), 0)
  const discountAmt = ctr.discount ? parseFloat(ctr.discount.amount) : 0
  return productCost + totalExp - discountAmt
}

function costPerKg(ctr: Container): number {
  const tons = totalWeightTons(ctr)
  return tons > 0 ? totalCostUsd(ctr) / (tons * 1000) : 0
}

function remainingStockKg(ctr: Container): number {
  return (ctr.stockLots ?? []).reduce((s, l) => s + parseFloat(l.kgRemaining), 0)
}

export default function ContainerHistory() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [dateRange, setDateRange] = useState('All time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  // Compute ISO date bounds from the date-range selector using the same
  // local-calendar-day helpers as Invoices.tsx — never toISOString(), which
  // converts to UTC first and can roll the date back a day for a timezone
  // ahead of UTC (Beirut, UTC+3).
  const today = new Date()
  const { finalizedFrom, finalizedTo } = (() => {
    if (dateRange === 'This month') {
      const r = currentMonthToDateRange()
      return { finalizedFrom: r.dateFrom, finalizedTo: r.dateTo }
    }
    if (dateRange === 'Last month') return {
      finalizedFrom: toDateOnlyString(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      finalizedTo: toDateOnlyString(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
    if (dateRange === 'Custom') return { finalizedFrom: customFrom || undefined, finalizedTo: customTo || undefined }
    return { finalizedFrom: undefined, finalizedTo: undefined }
  })()

  // Every filter change lands back on page 1 — same rule Invoices.tsx follows,
  // so a filtered result set with fewer pages never strands the user on an
  // empty page N.
  useEffect(() => { setPage(1) }, [search, supplierFilter, finalizedFrom, finalizedTo])

  const { data, isLoading, isError, refetch } = useContainers({
    finalized: true,
    search: search || undefined,
    supplierId: supplierFilter || undefined,
    finalizedFrom,
    finalizedTo,
    page,
    limit: PAGE_SIZE,
  })
  const suppliersQ = useSuppliers({ limit: 100 })
  const suppliers = suppliersQ.data?.data ?? []
  const supplierNameById = new Map(suppliers.map(s => [s.id, s.name]))

  const containers: Container[] = data?.data ?? []
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <>
      <Topbar title="Container History" />
      <div className="content">

        <div className="filters">
          <div className="filter-input">
            <i className="ti ti-search" />
            <input type="text" placeholder="Search container number…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="filter-select" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="filter-select" value={dateRange} onChange={e => setDateRange(e.target.value)}>
            <option>All time</option>
            <option>This month</option>
            <option>Last month</option>
            <option>Custom</option>
          </select>
          {dateRange === 'Custom' && (
            <>
              <input
                type="date"
                className="filter-select"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
              />
              <input
                type="date"
                className="filter-select"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
              />
            </>
          )}
          {(search || supplierFilter || dateRange !== 'All time') && (
            <button
              className="btn"
              style={{ fontSize: 12 }}
              onClick={() => { setSearch(''); setSupplierFilter(''); setDateRange('All time'); setCustomFrom(''); setCustomTo('') }}
            >
              Clear
            </button>
          )}
        </div>

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton" style={{ width: '100%', height: 44, marginBottom: 4 }} />
            {[0, 1, 2].map(i => <div className="skeleton" key={i} style={{ width: '100%', height: 40 }} />)}
          </div>
        )}

        {isError && (
          <div className="empty">
            Failed to load container history.
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => refetch()}>Retry</button>
            </div>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Container</th>
                    <th>Supplier</th>
                    <th>Carrier</th>
                    <th>Arrived</th>
                    <th>Finalized</th>
                    <th>Finalized by</th>
                    <th className="right">Total weight</th>
                    <th className="right">Total cost</th>
                    <th className="right">Cost/kg</th>
                    <th className="right">Remaining stock</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map(ctr => (
                    <tr key={ctr.id} onClick={() => navigate('/containers/' + encodeURIComponent(ctr.id))} style={{ cursor: 'pointer' }}>
                      <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>{ctr.number}</td>
                      <td>{supplierNameById.get(ctr.supplierId) ?? ctr.supplierId}</td>
                      <td>{ctr.sealineName ?? ctr.sealine ?? '—'}</td>
                      <td>{formatDate(ctr.arrivalDate)}</td>
                      <td>{formatDate(ctr.finalizedAt)}</td>
                      <td>{ctr.finalizedBy?.name ?? '—'}</td>
                      <td className="right num">{totalWeightTons(ctr).toFixed(2)} t</td>
                      <td className="right num">{formatUsd(totalCostUsd(ctr))}</td>
                      <td className="right num">${costPerKg(ctr).toFixed(2)}</td>
                      <td className="right num">{remainingStockKg(ctr).toLocaleString()} kg</td>
                    </tr>
                  ))}
                  {containers.length === 0 && (
                    <tr><td colSpan={10} className="empty">No finalized containers match your search/filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {containers.length > 0 && totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '14px 0 4px' }}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <i className="ti ti-chevron-left" style={{ fontSize: 14 }} /> Previous
                </button>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  Page {page} of {totalPages}
                </span>
                <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  Next <i className="ti ti-chevron-right" style={{ fontSize: 14 }} />
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </>
  )
}
