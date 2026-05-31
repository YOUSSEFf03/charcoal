import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { BagType, CreateBagTypeDto, UpdateBagTypeDto } from '../types/api'

export function useBagTypes() {
  return useQuery({
    queryKey: ['bag-types'],
    queryFn: async () => {
      const res = await api.get<{ data: BagType[] }>('/bag-types?limit=100')
      return res.data.data
    },
  })
}

export function useCreateBagType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateBagTypeDto) => {
      const res = await api.post<BagType>('/bag-types', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bag-types'] })
    },
  })
}

export function useUpdateBagType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateBagTypeDto }) => {
      const res = await api.patch<BagType>(`/bag-types/${id}`, body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bag-types'] })
    },
  })
}

export function useDeleteBagType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/bag-types/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bag-types'] })
    },
  })
}
