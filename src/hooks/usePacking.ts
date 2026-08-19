import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  PackingSession,
  CreatePackingSessionDto,
  UpdatePackingSessionDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /packing-sessions. */
export interface PackingSessionsQuery {
  workerId?: string
  workerEntityId?: string
  lotId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

const packingKey = (params?: PackingSessionsQuery) =>
  ['packing-sessions', params ?? {}] as const

/**
 * List packing sessions (paginated).
 * @param params - worker / lot / date filters
 * @returns React Query result of PaginatedResponse<PackingSession>
 * GET /packing-sessions
 */
export function usePackingSessions(params?: PackingSessionsQuery) {
  return useQuery({
    queryKey: packingKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<PackingSession>>(
        '/packing-sessions',
        { params },
      )
      return res.data
    },
  })
}

/**
 * List one worker's packing sessions as an accumulating "See more" history
 * feed — same /packing-sessions endpoint and page/limit/total contract as
 * {@link usePackingSessions}, but kept as a separate hook (useInfiniteQuery,
 * not useQuery) so Packing.tsx/Warehouse.tsx — the other two callers of
 * usePackingSessions() — are unaffected; they expect a single page, not an
 * accumulated page list. Used by Employees.tsx's merged history timeline.
 * @param workerEntityId - worker UUID (skip query if undefined)
 * @param limit - page size (defaults to 50, matching Employees.tsx's prior
 *   single-page limit — unchanged, only page 2+ is newly reachable)
 * @returns React Query infinite-query result; flatten via
 *   `data?.pages.flatMap(p => p.data)` for the full list loaded so far
 */
export function useWorkerPackingSessionsHistory(workerEntityId: string | undefined, limit = 50) {
  return useInfiniteQuery({
    queryKey: ['packing-sessions', 'worker-history', workerEntityId, limit],
    queryFn: async ({ pageParam }) => {
      const res = await api.get<PaginatedResponse<PackingSession>>('/packing-sessions', {
        params: { workerEntityId, page: pageParam, limit },
      })
      return res.data
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.limit < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: Boolean(workerEntityId),
  })
}

/**
 * Fetch one packing session with lot and worker.
 * @param id - packing session UUID
 * @returns React Query result of PackingSession
 * GET /packing-sessions/:id
 */
export function usePackingSession(id: string) {
  return useQuery({
    queryKey: ['packing-sessions', id],
    queryFn: async () => {
      const res = await api.get<PackingSession>(`/packing-sessions/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Update an existing packing session (reverses old lot deductions, applies new).
 * @returns mutation accepting { id, data: UpdatePackingSessionDto }
 * PATCH /packing-sessions/:id
 */
export function useUpdatePackingSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePackingSessionDto }) => {
      const res = await api.patch<PackingSession>(`/packing-sessions/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packing-sessions'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
      qc.invalidateQueries({ queryKey: ['workers'] })
      // Editing a session changes Consumed/Historical Output/Waste/Current Packed Stock
      // for every lot it touches (old and new) — refresh any open Warehouse lot/container panel.
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
    },
  })
}

/**
 * Create a packing session.
 * Side effects: reduces lot.kgRemaining, creates packed stock, updates
 * worker earnings/bag counts.
 * @returns mutation accepting CreatePackingSessionDto
 * POST /packing-sessions
 */
export function useCreatePackingSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreatePackingSessionDto) => {
      const res = await api.post<PackingSession>('/packing-sessions', body)
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['packing-sessions'] })
      // Consuming a lot and producing bags moves stock + worker totals.
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
      qc.invalidateQueries({ queryKey: ['workers', data.workerId] })
      // New session changes Consumed/Historical Output/Waste for every lot it drew from —
      // refresh any open Warehouse lot/container panel.
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
    },
  })
}
