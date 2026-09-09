import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { MobileDevice } from '../types/api'

/**
 * Owner-only mobile-device admin view (Settings → Container Mobile App).
 * Never exposes a push token — see MobileDevice's own doc comment.
 * GET /mobile-devices
 */
export function useMobileDevices() {
  return useQuery({
    queryKey: ['mobile-devices'],
    queryFn: async () => {
      const res = await api.get<MobileDevice[]>('/mobile-devices')
      return res.data
    },
  })
}

/**
 * Revoke a device — stops push notifications to it (owner only). Has no
 * effect on the mobile read API itself, which is authenticated by a single
 * shared secret common to every install, not a per-device credential.
 * PATCH /mobile-devices/:id/revoke
 */
export function useRevokeMobileDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.patch<{ id: string; active: boolean }>(`/mobile-devices/${id}/revoke`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mobile-devices'] })
    },
  })
}
