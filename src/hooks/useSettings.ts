import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useExchangeRate() {
  return useQuery({
    queryKey: ['settings', 'exchange-rate'],
    queryFn: async () => {
      const res = await api.get<{ rate: number }>('/settings/exchange-rate')
      return res.data.rate
    },
    staleTime: 60_000,
  })
}

export function useSetExchangeRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rate: number) => {
      const res = await api.put<{ rate: number }>('/settings/exchange-rate', { rate })
      return res.data.rate
    },
    onSuccess: (rate) => {
      qc.setQueryData(['settings', 'exchange-rate'], rate)
    },
  })
}
