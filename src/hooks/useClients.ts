import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  AddClientPhoneDto,
  DeactivateClientPhoneDto,
  ClientBalanceResponse,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /clients. */
export interface ClientsQuery {
  search?: string
  page?: number
  limit?: number
  type?: string
  isActive?: boolean
  excludeFillClient?: boolean
  hasBalance?: boolean
  /**
   * 'balance'/'totalInvoiced'/'totalCollected'/'orderCount' are not stored
   * columns, so sorting by them fetches the full matching set server-side
   * and paginates after — real-column sorts ('name'/'lastOrderDate'/
   * 'avgOrderDays') stay cheap. Omit for the default (createdAt desc).
   */
  sortBy?: 'name' | 'lastOrderDate' | 'avgOrderDays' | 'balance' | 'totalInvoiced' | 'totalCollected' | 'orderCount'
  sortOrder?: 'asc' | 'desc'
  /**
   * totalInvoiced is also not a stored column, so a min/max range also
   * forces the full-fetch-then-filter path server-side (same as hasBalance).
   */
  minTotalInvoiced?: number
  maxTotalInvoiced?: number
}

const clientsKey = (params?: ClientsQuery) => ['clients', params ?? {}] as const

/**
 * List clients (paginated).
 * @param params - search / pagination / type filter
 * @returns React Query result of PaginatedResponse<Client>
 * GET /clients
 */
export function useClients(params?: ClientsQuery) {
  return useQuery({
    queryKey: clientsKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Client>>('/clients', { params })
      return res.data
    },
  })
}

/**
 * Fetch one client profile (includes computed balance).
 * @param id - client UUID
 * @returns React Query result of Client
 * GET /clients/:id
 */
export function useClient(id: string) {
  return useQuery({
    queryKey: ['clients', id],
    queryFn: async () => {
      const res = await api.get<Client>(`/clients/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Fetch a client's computed balance.
 * @param id - client UUID
 * @returns React Query result of { balance, currency }
 * GET /clients/:id/balance
 */
export function useClientBalance(id: string) {
  return useQuery({
    queryKey: ['clients', id, 'balance'],
    queryFn: async () => {
      const res = await api.get<ClientBalanceResponse>(`/clients/${id}/balance`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * List overdue clients (CRM alert list, sorted most overdue first).
 * @returns React Query result of Client[]
 * GET /clients/overdue
 */
export function useOverdueClients() {
  return useQuery({
    queryKey: ['clients', 'overdue'],
    // TODO: verify against Swagger — API.md names this CRMOverdueClient[]
    queryFn: async () => {
      const res = await api.get<Client[]>('/clients/overdue')
      return res.data
    },
  })
}

export interface ClientsCounts {
  allCount: number
  balanceCount: number
  overdueCount: number
}

/**
 * Fetch tab counts for the Clients page (excludes fill_client).
 * @param search - Optional name search to scope counts
 * @returns React Query result of ClientsCounts
 * GET /clients/counts
 */
export function useClientsCounts(search?: string) {
  return useQuery({
    queryKey: ['clients', 'counts', search ?? ''],
    queryFn: async () => {
      const res = await api.get<ClientsCounts>('/clients/counts', {
        params: search ? { search } : {},
      })
      return res.data
    },
  })
}

/**
 * Create a client.
 * @returns mutation accepting CreateClientDto
 * POST /clients
 */
export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateClientDto) => {
      const res = await api.post<Client>('/clients', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

/**
 * Update a client.
 * @returns mutation accepting { id, body: UpdateClientDto }
 * PATCH /clients/:id
 */
export function useUpdateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateClientDto }) => {
      const res = await api.patch<Client>(`/clients/${id}`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['clients', id] })
    },
  })
}

/**
 * Add a phone number to a client (phones are never deleted — CONSTRAINT 14).
 * @returns mutation accepting { id, body: AddClientPhoneDto }
 * POST /clients/:id/phones
 */
export function useAddPhone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AddClientPhoneDto }) => {
      const res = await api.post<Client>(`/clients/${id}/phones`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['clients', id] })
    },
  })
}

/**
 * Mark a client's phone number inactive (record preserved).
 * @returns mutation accepting { id, body: DeactivateClientPhoneDto }
 * PATCH /clients/:id/phones/deactivate
 */
export function useDeactivatePhone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: DeactivateClientPhoneDto
    }) => {
      const res = await api.patch<Client>(`/clients/${id}/phones/deactivate`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['clients', id] })
    },
  })
}
