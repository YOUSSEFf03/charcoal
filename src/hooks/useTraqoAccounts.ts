import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { TraqoAccount } from '../types/api'

/**
 * Owner-only Traqo accounts admin view (Settings → Traqo accounts).
 * Never exposes a key value — see TraqoAccount's own doc comment.
 * GET /traqo-accounts
 */
export function useTraqoAccounts() {
  return useQuery({
    queryKey: ['traqo-accounts'],
    queryFn: async () => {
      const res = await api.get<TraqoAccount[]>('/traqo-accounts')
      return res.data
    },
  })
}

/**
 * Enable/disable a Traqo account for new allocations (owner only).
 * PATCH /traqo-accounts/:id
 */
export function useUpdateTraqoAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await api.patch<TraqoAccount>(`/traqo-accounts/${id}`, { active })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['traqo-accounts'] })
    },
  })
}
