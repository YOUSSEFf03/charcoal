import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { MeResponse } from '../lib/types'

// Resolves the currently authenticated user (and their role) from the Clerk
// Bearer token. GET /auth/me is the canonical "who am I" call — use the returned
// `role` to gate UI the same way the backend gates data.
export function useMe() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await api.get<MeResponse>('/auth/me')
      return res.data
    },
  })
}
