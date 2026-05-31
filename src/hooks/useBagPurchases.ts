import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { BagPurchase, CreateBagPurchaseDto } from '../types/api'

export function useBagPurchases(params?: { bagTypeId?: string; limit?: number }) {
  return useQuery({
    queryKey: ['bag-purchases', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: (BagPurchase & { bagType?: { name: string } })[]; total: number }>(
        '/bag-purchases',
        { params: { limit: 200, ...params } },
      )
      return res.data
    },
  })
}

export function useCreateBagPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateBagPurchaseDto) => {
      const res = await api.post<BagPurchase>('/bag-purchases', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bag-purchases'] })
    },
  })
}
