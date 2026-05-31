import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { DriverTrip, PaginatedResponse } from '../types/api'

/** A driver option for dropdown selectors. */
export interface DriverOption {
  id: string
  name: string
}

/**
 * List drivers for dropdown selectors.
 *
 * The backend has no `GET /users?role=driver` filter (GET /users only accepts
 * page/limit), so driver identities are derived from the distinct `driverId`s
 * that appear across driver trips. DriverTrip carries no driver name, so `name`
 * falls back to the id; replace with a dedicated drivers endpoint if one is added.
 *
 * @returns React Query result of DriverOption[]
 * GET /driver-trips (distinct drivers)
 */
export function useDrivers() {
  return useQuery({
    queryKey: ['drivers'],
    queryFn: async () => {
      // Pull a large page so we capture all active drivers in one round trip.
      const res = await api.get<PaginatedResponse<DriverTrip>>('/driver-trips', {
        params: { limit: 100 },
      })
      const seen = new Map<string, DriverOption>()
      for (const trip of res.data.data) {
        if (!seen.has(trip.driverId)) {
          seen.set(trip.driverId, { id: trip.driverId, name: trip.driverId })
        }
      }
      return Array.from(seen.values())
    },
  })
}
