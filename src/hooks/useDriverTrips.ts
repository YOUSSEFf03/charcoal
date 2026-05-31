import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  DriverTrip,
  DriverTripDetail,
  CreateDriverTripDto,
  CompleteDriverTripDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /driver-trips. */
export interface DriverTripsQuery {
  driverId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

const tripsKey = (params?: DriverTripsQuery) =>
  ['driver-trips', params ?? {}] as const

/**
 * List driver trips (paginated).
 * @param params - driver / status / date filters
 * @returns React Query result of PaginatedResponse<DriverTrip>
 * GET /driver-trips
 */
export function useDriverTrips(params?: DriverTripsQuery) {
  return useQuery({
    queryKey: tripsKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<DriverTrip>>('/driver-trips', {
        params,
      })
      return res.data
    },
  })
}

/**
 * Fetch one driver trip with its shipments.
 * @param id - driver trip UUID
 * @returns React Query result of DriverTripDetail
 * GET /driver-trips/:id
 */
export function useDriverTrip(id: string) {
  return useQuery({
    queryKey: ['driver-trips', id],
    queryFn: async () => {
      const res = await api.get<DriverTripDetail>(`/driver-trips/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create a driver trip (bundles the given shipments).
 * @returns mutation accepting CreateDriverTripDto
 * POST /driver-trips
 */
export function useCreateDriverTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateDriverTripDto) => {
      const res = await api.post<DriverTrip>('/driver-trips', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-trips'] })
      // Bundling shipments changes their trip assignment.
      qc.invalidateQueries({ queryKey: ['shipments'] })
    },
  })
}

/**
 * Start a trip (status -> in_progress, stamps startedAt).
 * @returns mutation accepting the trip id (string)
 * POST /driver-trips/:id/start
 */
export function useStartTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<DriverTrip>(`/driver-trips/${id}/start`, {})
      return res.data
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['driver-trips'] })
      qc.invalidateQueries({ queryKey: ['driver-trips', id] })
    },
  })
}

/**
 * Complete a trip (status -> completed, records final costs, stamps completedAt).
 * @returns mutation accepting { id, body: CompleteDriverTripDto }
 * POST /driver-trips/:id/complete
 */
export function useCompleteTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CompleteDriverTripDto
    }) => {
      const res = await api.post<DriverTrip>(`/driver-trips/${id}/complete`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['driver-trips'] })
      qc.invalidateQueries({ queryKey: ['driver-trips', id] })
    },
  })
}
