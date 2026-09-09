import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface CompanyInfo {
  name: string
  phone: string
  address: string
  addressAr: string
  taxNo: string
  email: string
  footer: string
}

export function useCompanyInfo() {
  return useQuery({
    queryKey: ['settings', 'company-info'],
    queryFn: async () => {
      const res = await api.get<CompanyInfo>('/settings/company-info')
      return res.data
    },
    staleTime: 60_000,
  })
}

export function useUpdateCompanyInfo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (partial: Partial<CompanyInfo>) => {
      const res = await api.put<CompanyInfo>('/settings/company-info', partial)
      return res.data
    },
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'company-info'], data)
    },
  })
}

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

/**
 * Single global daily-wage amount (USD) — Employee Detail audit (2026-09-05):
 * the source the "Daily wage" button on Employee Detail uses, so every
 * employee's button reads the same, single figure. 0 = not configured yet.
 * GET /settings/daily-wage
 */
export function useDailyWageRate() {
  return useQuery({
    queryKey: ['settings', 'daily-wage'],
    queryFn: async () => {
      const res = await api.get<{ rate: number }>('/settings/daily-wage')
      return res.data.rate
    },
    staleTime: 60_000,
  })
}

/**
 * Update the global daily-wage amount (owner only).
 * PUT /settings/daily-wage
 */
export function useSetDailyWageRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rate: number) => {
      const res = await api.put<{ rate: number }>('/settings/daily-wage', { rate })
      return res.data.rate
    },
    onSuccess: (rate) => {
      qc.setQueryData(['settings', 'daily-wage'], rate)
    },
  })
}
