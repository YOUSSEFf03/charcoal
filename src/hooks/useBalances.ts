import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Client, PaginatedResponse } from '../types/api'

/** Query params accepted by GET /clients (for the balances view). */
export interface ClientBalancesQuery {
  search?: string
  page?: number
  limit?: number
  type?: string
}

const balancesKey = (params?: ClientBalancesQuery) =>
  ['clients', 'balances', params ?? {}] as const

/**
 * List clients with their computed balance (each Client carries `balance`).
 * @param params - search / pagination / type filters
 * @returns React Query result of PaginatedResponse<Client>
 * GET /clients
 */
export function useClientBalances(params?: ClientBalancesQuery) {
  return useQuery({
    queryKey: balancesKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Client>>('/clients', { params })
      return res.data
    },
  })
}

/**
 * List overdue clients (aging / CRM alert list, most overdue first).
 * @returns React Query result of Client[]
 * GET /clients/overdue
 */
export function useClientAging() {
  return useQuery({
    queryKey: ['clients', 'overdue'],
    queryFn: async () => {
      const res = await api.get<Client[]>('/clients/overdue')
      return res.data
    },
  })
}
