import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Container,
  ContainerExpense,
  DriverTrip,
  PaginatedResponse,
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

      if (params?.dateFrom) {
        all = all.filter((e) => e.addedAt >= params.dateFrom!)
      }
      if (params?.dateTo) {
        all = all.filter((e) => e.addedAt <= params.dateTo!)
      }
      return all
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
