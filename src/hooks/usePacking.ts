import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    },
  })
}
