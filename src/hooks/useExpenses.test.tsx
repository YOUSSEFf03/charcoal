// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// COGS-vs-Expenses audit (2026-09-06): useAllWorkerWageExpenses() is the
// exact boundary that must never let per-bag/product-direct labor
// (PackingSession.sessionEarnings, source: 'session') leak into the Expenses
// page as an operating expense — that would double-count it, since it
// already feeds the P&L's labor cost. Only WorkerCost entries (source:
// 'cost' — daily wage, bonus, deduction, etc.) may pass through. This is
// tested directly (not just via the page) because it's the single line of
// filter logic this entire task exists to protect.
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn()
vi.mock('../lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

import { useAllWorkerWageExpenses, useAllWorkerPayments } from './useExpenses'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const WORKERS = [
  { id: 'w1', name: 'Hassan' },
  { id: 'w2', name: 'Omar' },
]

/** A statement response mixing all three entry sources, exactly as the real
 *  GET /workers/:id/statement endpoint returns them. */
function makeStatementResponse(workerId: string) {
  return {
    workerId,
    openingBalance: '0.00',
    balance: '0.00',
    entries: [
      { date: '2026-09-05', type: 'earning', source: 'cost', reference: `${workerId}-c1`, category: 'daily_wage', notes: null, earned: '20.00', paid: '0.00', runningBalance: '20.00' },
      { date: '2026-09-08', type: 'earning', source: 'session', reference: `${workerId}-s1`, earned: '100.00', paid: '0.00', runningBalance: '120.00' },
      { date: '2026-09-10', type: 'payment', source: 'payment', reference: `${workerId}-p1`, method: 'cash', referenceNumber: null, notes: null, earned: '0.00', paid: '30.00', runningBalance: '90.00' },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAllWorkerWageExpenses()', () => {
  it('CASE 1 — excludes per-bag/product-direct labor (source: "session") entirely, never counting it as an operating expense', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/workers') return Promise.resolve({ data: { data: WORKERS } })
      const workerId = url.match(/\/workers\/(\w+)\/statement/)![1]
      return Promise.resolve({ data: makeStatementResponse(workerId) })
    })

    const { result } = renderHook(() => useAllWorkerWageExpenses({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data!.every((e) => e.source === 'cost')).toBe(true)
    expect(result.current.data!.some((e) => e.earned === '100.00')).toBe(false) // the $100 session entry never appears
  })

  it('CASE 2 — includes daily-wage (and every other WorkerCost category) as employee wage expense', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/workers') return Promise.resolve({ data: { data: WORKERS } })
      const workerId = url.match(/\/workers\/(\w+)\/statement/)![1]
      return Promise.resolve({ data: makeStatementResponse(workerId) })
    })

    const { result } = renderHook(() => useAllWorkerWageExpenses({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const hassanWage = result.current.data!.find((e) => e.workerId === 'w1')!
    expect(hassanWage.workerName).toBe('Hassan')
    expect(hassanWage.category).toBe('daily_wage')
    expect(hassanWage.earned).toBe('20.00')
  })

  it('never includes a WorkerPayment (source: "payment") entry — that stays on the separate Employee Payments aggregation', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/workers') return Promise.resolve({ data: { data: WORKERS } })
      const workerId = url.match(/\/workers\/(\w+)\/statement/)![1]
      return Promise.resolve({ data: makeStatementResponse(workerId) })
    })

    const { result } = renderHook(() => useAllWorkerWageExpenses({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data!.some((e) => e.source === 'payment')).toBe(false)
  })

  it('aggregates across ALL workers, annotated with their own workerId/workerName', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/workers') return Promise.resolve({ data: { data: WORKERS } })
      const workerId = url.match(/\/workers\/(\w+)\/statement/)![1]
      return Promise.resolve({ data: makeStatementResponse(workerId) })
    })

    const { result } = renderHook(() => useAllWorkerWageExpenses({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(2) // one 'cost' entry per worker
    expect(result.current.data!.map((e) => e.workerName).sort()).toEqual(['Hassan', 'Omar'])
  })

  it('passes dateFrom/dateTo through to each per-worker statement request — server-side month scoping, not a client-side slice', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/workers') return Promise.resolve({ data: { data: [WORKERS[0]] } })
      return Promise.resolve({ data: makeStatementResponse('w1') })
    })

    renderHook(() => useAllWorkerWageExpenses({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), { wrapper })
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/workers/w1/statement', { params: { dateFrom: '2026-09-01', dateTo: '2026-09-30' } }))
  })
})

describe('useAllWorkerPayments() — unaffected by the wage-expense hook (regression guard)', () => {
  it('still aggregates only WorkerPayment rows via GET /workers/:id/payments, untouched by this audit', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/workers') return Promise.resolve({ data: { data: [WORKERS[0]] } })
      return Promise.resolve({ data: { data: [{ id: 'p1', workerId: 'w1', amount: '30.00', method: 'cash', referenceNumber: null, date: '2026-09-10', notes: null }] } })
    })

    const { result } = renderHook(() => useAllWorkerPayments({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual([{ id: 'p1', workerId: 'w1', amount: '30.00', method: 'cash', referenceNumber: null, date: '2026-09-10', notes: null, workerName: 'Hassan' }])
  })
})
