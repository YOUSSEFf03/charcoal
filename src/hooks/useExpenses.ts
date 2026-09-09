import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  DriverTrip,
  PaginatedResponse,
  GeneralExpense,
  CreateGeneralExpenseDto,
  UpdateGeneralExpenseDto,
  Worker,
  WorkerPayment,
  WorkerStatement,
  WorkerStatementEntry,
} from '../types/api'

/** Date-range params for the aggregated expense views. */
export interface ExpensesQuery {
  dateFrom?: string
  dateTo?: string
}

/** A worker payment annotated with its worker's name, for display in the Expenses aggregation. */
export interface AggregatedWorkerPayment extends WorkerPayment {
  workerName: string
}

/**
 * Aggregate WorkerPayment records across ALL workers.
 *
 * The backend exposes payments only per-worker (GET /workers/:id/payments), so this
 * fans out: list workers, then fetch each worker's payments and flatten them.
 * WorkerPayment remains the single source of truth; this creates no new records,
 * it only aggregates for display.
 *
 * @param params - optional dateFrom/dateTo, forwarded to EACH per-worker request
 * (server-side filtering — see WorkersService.listPayments) so the Expenses
 * page's Employee Payments tab gets every payment in the selected month
 * regardless of how many payments a worker has all-time, never a fixed-size
 * recent page sliced by date client-side.
 * @returns React Query result of AggregatedWorkerPayment[]
 * GET /workers + GET /workers/:id/payments (per worker)
 */
export function useAllWorkerPayments(params?: ExpensesQuery) {
  return useQuery({
    queryKey: ['expenses', 'worker-payments', params ?? {}],
    queryFn: async () => {
      const workersRes = await api.get<{ data: Worker[] }>('/workers', { params: { limit: 100 } })
      const workers = workersRes.data.data

      const perWorker = await Promise.all(
        workers.map(async (w) => {
          const res = await api.get<{ data: WorkerPayment[] }>(`/workers/${w.id}/payments`, {
            params: { limit: 200, ...params },
          })
          return res.data.data.map((p) => ({ ...p, workerName: w.name }))
        }),
      )

      return perWorker.flat() as AggregatedWorkerPayment[]
    },
  })
}

/** One WorkerCost-sourced statement entry, annotated with its worker's id/name
 *  for display in the Expenses aggregation — never a session (per-bag) or
 *  payment entry (see useAllWorkerWageExpenses()'s doc comment). */
export interface AggregatedWorkerWageExpense extends WorkerStatementEntry {
  workerId: string
  workerName: string
}

/**
 * Aggregate employee WAGE EXPENSE (WorkerCost — daily wage, bonus, deduction,
 * etc.) across ALL workers, for the Expenses page's Business Expenses tab.
 *
 * COGS-vs-Expenses audit (2026-09-06): per-bag/product-direct labor
 * (PackingSession.sessionEarnings) is deliberately EXCLUDED here — it already
 * feeds the P&L's labor cost (functionally its COGS-adjacent labor line, see
 * ReportsService.getProfitLoss()'s doc comment) and must never also appear as
 * an operating expense (that would double-count it). Only `source === 'cost'`
 * entries (WorkerCost — non-product-direct labor: daily wage and every other
 * WorkerCost category, which the existing P&L already lumps together as one
 * "laborCost" figure alongside sessionEarnings) are kept.
 *
 * Reuses the SAME `/workers/:id/statement` endpoint the Employee Payments tab
 * and the Employees page's Statement of Account already use — no new
 * backend endpoint, no duplicate WorkerCost record, no second accounting
 * calculation. WorkerCost remains the single source of truth; this only
 * aggregates and filters it for display.
 *
 * @param params - optional dateFrom/dateTo, forwarded to EACH per-worker
 * statement request (server-side date filtering, same as useAllWorkerPayments).
 * @returns React Query result of AggregatedWorkerWageExpense[]
 * GET /workers + GET /workers/:id/statement (per worker)
 */
export function useAllWorkerWageExpenses(params?: ExpensesQuery) {
  return useQuery({
    queryKey: ['expenses', 'worker-wage-expenses', params ?? {}],
    queryFn: async () => {
      const workersRes = await api.get<{ data: Worker[] }>('/workers', { params: { limit: 100 } })
      const workers = workersRes.data.data

      const perWorker = await Promise.all(
        workers.map(async (w) => {
          const res = await api.get<WorkerStatement>(`/workers/${w.id}/statement`, { params })
          return res.data.entries
            .filter((e) => e.source === 'cost')
            .map((e) => ({ ...e, workerId: w.id, workerName: w.name }))
        }),
      )

      return perWorker.flat() as AggregatedWorkerWageExpense[]
    },
  })
}

/**
 * List driver trips (their fuel / other expenses are part of each trip record).
 * @param params - optional dateFrom / dateTo passed through to the API
 * @returns React Query result of PaginatedResponse<DriverTrip>
 * GET /driver-trips
 */
export function useDriverExpenses(params?: ExpensesQuery) {
  return useQuery({
    queryKey: ['driver-trips', 'expenses', params ?? {}],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<DriverTrip>>('/driver-trips', {
        params,
      })
      return res.data
    },
  })
}

/**
 * List all general (non-container, non-driver) expenses.
 * @param params - optional dateFrom / dateTo (inclusive); recurring rows are
 * included server-side from their recorded date forward — never for a period
 * before that date ("Option B" recurrence; see backend GeneralExpensesService).
 * @returns React Query result of PaginatedResponse<GeneralExpense>
 * GET /general-expenses
 */
export function useGeneralExpenses(params?: ExpensesQuery) {
  return useQuery({
    queryKey: ['general-expenses', params ?? {}],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<GeneralExpense>>('/general-expenses', {
        params: { limit: 100, ...params },
      })
      return res.data.data
    },
  })
}

/**
 * Create a general expense, then invalidate the list query.
 * POST /general-expenses
 */
export function useCreateGeneralExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateGeneralExpenseDto) => {
      const res = await api.post<GeneralExpense>('/general-expenses', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['general-expenses'] })
    },
  })
}

/**
 * Update a general expense (owner only).
 * PATCH /general-expenses/:id
 */
export function useUpdateGeneralExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateGeneralExpenseDto }) => {
      const res = await api.patch<GeneralExpense>(`/general-expenses/${id}`, body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['general-expenses'] })
    },
  })
}

/**
 * Delete a general expense (owner only).
 * DELETE /general-expenses/:id
 */
export function useDeleteGeneralExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/general-expenses/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['general-expenses'] })
    },
  })
}
