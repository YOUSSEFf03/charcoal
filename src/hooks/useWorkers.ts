import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Worker,
  CreateWorkerDto,
  UpdateWorkerRatesDto,
  CreateWorkerPaymentDto,
  WorkerPayment,
  WorkerEarning,
  CreateWorkerEarningDto,
  UpdateWorkerEarningDto,
  LogDailyWageDto,
  WorkerStatement,
  WorkerPerformance,
  PaginatedResponse,
} from '../types/api'

/** Date-range params for the Statement of Account. */
export interface WorkerStatementQuery {
  dateFrom?: string
  dateTo?: string
}

/** Date-range params for Employee Performance analytics. */
export interface WorkerPerformanceQuery {
  dateFrom?: string
  dateTo?: string
}

// "Next page" is available whenever fewer records have been fetched so far
// than the server reports as the total — the same page/limit/total contract
// every paginated list endpoint in this codebase already returns.
function nextPageParam(lastPage: PaginatedResponse<unknown>): number | undefined {
  return lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined
}

/**
 * List all workers (totalOwed computed).
 * @returns React Query result of Worker[]
 * GET /workers
 */
export function useWorkers() {
  return useQuery({
    queryKey: ['workers', {}],
    queryFn: async () => {
      // limit:100 (the server's MAX_PAGE_LIMIT — see pagination.pipes.ts) rather
      // than the endpoint's own default of 20. Every caller of this hook (payment/
      // invoice receiver pickers, Employees list, Dashboard) treats the result as
      // "all workers" with no pagination UI of its own, so silently truncating at
      // the default page size hid real workers once a shop had more than 20.
      const res = await api.get<{ data: Worker[] }>('/workers', { params: { limit: 100 } })
      return res.data.data
    },
  })
}

/**
 * Fetch one worker.
 * @param id - worker UUID
 * @returns React Query result of Worker
 * GET /workers/:id
 */
export function useWorker(id: string) {
  return useQuery({
    queryKey: ['workers', id],
    queryFn: async () => {
      const res = await api.get<Worker>(`/workers/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create a worker.
 * @returns mutation accepting CreateWorkerDto
 * POST /workers
 */
export function useCreateWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateWorkerDto) => {
      const res = await api.post<Worker>('/workers', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

/**
 * Delete a worker permanently.
 * DELETE /workers/:id
 */
export function useDeleteWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/workers/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

/**
 * Update a worker's name, phone, or notes.
 * @returns mutation accepting { id, body: { name?, phone?, notes? } }
 * PATCH /workers/:id
 */
export function useUpdateWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { name?: string; phone?: string | null; notes?: string | null } }) => {
      const res = await api.patch<Worker>(`/workers/${id}`, body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

/**
 * Replace a worker's per-bag-type rate array.
 * @returns mutation accepting { id, body: UpdateWorkerRatesDto }
 * PATCH /workers/:id/rates
 */
export function useUpdateWorkerRates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: UpdateWorkerRatesDto
    }) => {
      const res = await api.patch<Worker>(`/workers/${id}/rates`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}

/**
 * Log a payment to a worker (increments worker.totalPaid).
 * @returns mutation accepting { id, body: CreateWorkerPaymentDto }
 * POST /workers/:id/payments
 */
export function useLogWorkerPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CreateWorkerPaymentDto
    }) => {
      const res = await api.post<WorkerPayment>(`/workers/${id}/payments`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}

// Page sizes match what these two endpoints were already hardcoded to before
// "See more" existed (20 payments, 50 earnings per page) — kept unchanged so
// the batch size a user sees per load stays the same; only the ability to
// fetch page 2+ is new.
const WORKER_PAYMENTS_PAGE_SIZE = 20
const WORKER_EARNINGS_PAGE_SIZE = 50

/**
 * List payments for a worker as an accumulating "See more" history feed —
 * newest first, paginated server-side (page/limit/total, the same contract
 * every paginated list endpoint in this codebase returns). Each call to
 * `fetchNextPage()` fetches only the next page and appends it to
 * `data.pages`; already-loaded pages are kept, never re-fetched from page 1.
 * @param workerId - worker UUID (skip query if undefined)
 * @returns React Query infinite-query result; flatten via
 *   `data?.pages.flatMap(p => p.data)` for the full list loaded so far
 * GET /workers/:id/payments
 */
export function useWorkerPayments(workerId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['workers', workerId, 'payments'],
    queryFn: async ({ pageParam }) => {
      const res = await api.get<PaginatedResponse<WorkerPayment>>(`/workers/${workerId}/payments`, {
        params: { page: pageParam, limit: WORKER_PAYMENTS_PAGE_SIZE },
      })
      return res.data
    },
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: Boolean(workerId),
  })
}

/**
 * List earnings entries for a worker as an accumulating "See more" history
 * feed — newest first, paginated server-side. See {@link useWorkerPayments}
 * for the pagination contract; identical shape, different endpoint/page size.
 * @param workerId - worker UUID (skip query if undefined)
 * @returns React Query infinite-query result; flatten via
 *   `data?.pages.flatMap(p => p.data)` for the full list loaded so far
 * GET /workers/:id/earnings
 */
export function useWorkerEarnings(workerId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['workers', workerId, 'earnings'],
    queryFn: async ({ pageParam }) => {
      const res = await api.get<PaginatedResponse<WorkerEarning>>(`/workers/${workerId}/earnings`, {
        params: { page: pageParam, limit: WORKER_EARNINGS_PAGE_SIZE },
      })
      return res.data
    },
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: Boolean(workerId),
  })
}

/**
 * Log an earnings entry for a worker (daily wage, bonus, deduction, etc.).
 * @returns mutation accepting { id, body: CreateWorkerEarningDto }
 * POST /workers/:id/earnings
 */
export function useCreateWorkerEarning() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CreateWorkerEarningDto
    }) => {
      const res = await api.post<WorkerEarning>(`/workers/${id}/earnings`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}

/**
 * Edit an earnings entry — the backend only accepts this within a short
 * window of creation (EDIT_WINDOW_EXPIRED past that); the UI should offer a
 * "log a correction entry" path instead once the window has passed.
 * @returns mutation accepting { id, earningId, body: UpdateWorkerEarningDto }
 * PATCH /workers/:id/earnings/:earningId
 */
export function useUpdateWorkerEarning() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      earningId,
      body,
    }: {
      id: string
      earningId: string
      body: UpdateWorkerEarningDto
    }) => {
      const res = await api.patch<WorkerEarning>(`/workers/${id}/earnings/${earningId}`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}

/**
 * "Add daily wage" — records today's daily wage using the configured
 * Settings amount (see useDailyWageRate). Rejects with a 409 (surfaced as an
 * ApiError with error.code === 'DAILY_WAGE_ALREADY_RECORDED') if this worker
 * already has a daily wage recorded for the given date.
 * @returns mutation accepting { id, body: LogDailyWageDto }
 * POST /workers/:id/daily-wage
 */
export function useLogDailyWage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: LogDailyWageDto }) => {
      const res = await api.post<WorkerEarning>(`/workers/${id}/daily-wage`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
      qc.invalidateQueries({ queryKey: ['workers', id, 'statement'] })
      qc.invalidateQueries({ queryKey: ['workers', id, 'earnings'] })
    },
  })
}

/**
 * Statement of Account — chronological earning/payment ledger with a
 * running balance, correctly accounting for an opening balance when a date
 * range is given (never a fake zero for a partial period — see
 * WorkersService.getStatement()'s doc comment).
 * @param workerId - worker UUID (skip query if undefined)
 * @param params - optional dateFrom/dateTo
 * @returns React Query result of WorkerStatement
 * GET /workers/:id/statement
 */
export function useWorkerStatement(workerId: string | undefined, params?: WorkerStatementQuery) {
  return useQuery({
    queryKey: ['workers', workerId, 'statement', params ?? {}],
    queryFn: async () => {
      const res = await api.get<WorkerStatement>(`/workers/${workerId}/statement`, { params })
      return res.data
    },
    enabled: Boolean(workerId),
  })
}

/**
 * Payments for a worker within a specific period — a plain (non-infinite)
 * query reusing the SAME `/workers/:id/payments` endpoint {@link
 * useWorkerPayments} already calls, just with dateFrom/dateTo applied
 * server-side. Used by the Employee Profile's period-scoped Payments
 * section — a bounded month is always a small list, so no "See more"
 * pagination is needed here (unlike the lifetime history feed).
 * @param workerId - worker UUID (skip query if undefined)
 * @param params - optional dateFrom/dateTo
 * GET /workers/:id/payments
 */
export function useWorkerPaymentsInPeriod(workerId: string | undefined, params?: WorkerStatementQuery) {
  return useQuery({
    queryKey: ['workers', workerId, 'payments', 'period', params ?? {}],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<WorkerPayment>>(`/workers/${workerId}/payments`, {
        params: { ...params, page: 1, limit: 100 },
      })
      return res.data
    },
    enabled: Boolean(workerId),
  })
}

/**
 * Employee Performance analytics — bags packed, bag-type breakdown, working
 * days, daily performance, packing history, daily wages, and payments total
 * for the given period. Server-side date filtering (see
 * WorkersService.getPerformance()'s doc comment) — a normal monthly view
 * never fetches the worker's entire lifetime packing history; an unbounded
 * "all time" request (no params) still returns `totals`/`byBagType` but
 * `dailyPerformance`/`packingHistory`/`dailyWages` come back `null`.
 * @param workerId - worker UUID (skip query if undefined)
 * @param params - optional dateFrom/dateTo
 * @returns React Query result of WorkerPerformance
 * GET /workers/:id/performance
 */
export function useWorkerPerformance(workerId: string | undefined, params?: WorkerPerformanceQuery) {
  return useQuery({
    queryKey: ['workers', workerId, 'performance', params ?? {}],
    queryFn: async () => {
      const res = await api.get<WorkerPerformance>(`/workers/${workerId}/performance`, { params })
      return res.data
    },
    enabled: Boolean(workerId),
  })
}
