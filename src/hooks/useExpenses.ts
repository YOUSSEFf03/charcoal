import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Container,
  ContainerExpense,
  DriverTrip,
  PaginatedResponse,
  GeneralExpense,
  CreateGeneralExpenseDto,
  Worker,
  WorkerPayment,
} from '../types/api'

/** Date-range params for the aggregated expense views. */
export interface ExpensesQuery {
  dateFrom?: string
  dateTo?: string
}

/** A container expense annotated with its parent container number. */
export interface AggregatedContainerExpense extends ContainerExpense {
  containerNumber: string
}

/**
 * Aggregate container expenses across all containers.
 *
 * The backend exposes expenses only per-container (GET /containers/:id/expenses),
 * so this fans out: list containers, then fetch each container's expenses and
 * flatten them. The optional date range filters the flattened result by
 * `addedAt`.
 *
 * @param params - optional dateFrom / dateTo (inclusive) on expense addedAt
 * @returns React Query result of AggregatedContainerExpense[]
 * GET /containers + GET /containers/:id/expenses
 */
export function useAllExpenses(params?: { dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: ['expenses', 'containers', params ?? {}],
    queryFn: async () => {
      const containersRes = await api.get<PaginatedResponse<Container>>('/containers', {
        params: { limit: 100 },
      })
      const containers = containersRes.data.data

      const perContainer = await Promise.all(
        containers.map(async (c) => {
          const res = await api.get<ContainerExpense[]>(`/containers/${c.id}/expenses`)
          return res.data.map((e) => ({ ...e, containerNumber: c.number }))
        }),
      )

      let all: AggregatedContainerExpense[] = perContainer.flat()

      // addedAt is a full timestamp (DateTime, not date-only) — compare just the
      // date portion so a same-day expense with a non-midnight time isn't dropped
      // (a raw string compare against "YYYY-MM-DD" would exclude anything added
      // later than 00:00:00 UTC on the last day of the range).
      if (params?.dateFrom) {
        all = all.filter((e) => e.addedAt.slice(0, 10) >= params.dateFrom!)
      }
      if (params?.dateTo) {
        all = all.filter((e) => e.addedAt.slice(0, 10) <= params.dateTo!)
      }
      return all
    },
  })
}

/** A worker payment annotated with its worker's name, for display in the Expenses aggregation. */
export interface AggregatedWorkerPayment extends WorkerPayment {
  workerName: string
}

/**
 * Aggregate WorkerPayment records across ALL workers.
 *
 * The backend exposes payments only per-worker (GET /workers/:id/payments), so this
 * fans out: list workers, then fetch each worker's payments and flatten them — same
 * pattern as {@link useAllExpenses}'s container fan-out. WorkerPayment remains the
 * single source of truth; this creates no new records, it only aggregates for display.
 *
 * @returns React Query result of AggregatedWorkerPayment[]
 * GET /workers + GET /workers/:id/payments (per worker)
 */
export function useAllWorkerPayments() {
  return useQuery({
    queryKey: ['expenses', 'worker-payments'],
    queryFn: async () => {
      const workersRes = await api.get<{ data: Worker[] }>('/workers')
      const workers = workersRes.data.data

      const perWorker = await Promise.all(
        workers.map(async (w) => {
          const res = await api.get<{ data: WorkerPayment[] }>(`/workers/${w.id}/payments`, {
            params: { limit: 100 },
          })
          return res.data.data.map((p) => ({ ...p, workerName: w.name }))
        }),
      )

      return perWorker.flat() as AggregatedWorkerPayment[]
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
