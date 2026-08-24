import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** One row in the fill_job_lots junction table — normalized charcoal input per lot. */
export interface FillJobLot {
  id: string
  fillJobId: string
  lotId: string
  kgUsed: string       // Decimal — kg taken from this lot
  costPerKg: string    // Decimal — snapshot at time of fill
  cost: string         // Decimal — = kgUsed × costPerKg
  lot?: { id: string; charcoalType: string; grade: string }
}

export interface FillJobBagOutput {
  specKey: string
  size: number
  charcoal: string
  qty: number
  fillPricePerBag: number
}

export interface FillJob {
  id: string
  clientId: string
  date: string
  workerEntityId: string | null
  workerEntity: { id: string; name: string } | null
  fillJobLots: FillJobLot[]
  bagOutputs: FillJobBagOutput[]
  totalCharcoalKg: string
  totalBags: number
  totalCost: string
  notes: string | null
  createdAt: string
}

export interface FillPriceStats {
  [specKey: string]: {
    avgFillPrice: number
    lastFillPrice: number
  }
}

export interface CreateFillJobDto {
  clientId: string
  date: string
  workerEntityId?: string
  charcoalInputs: { lotId: string; kg: number }[]
  bagOutputs: { specKey: string; size: number; charcoal: string; qty: number }[]
  notes?: string
}

export interface FillJobsQuery {
  page?: number
  limit?: number
  dateFrom?: string
  dateTo?: string
}

export function useFillJobs(clientId: string, params?: FillJobsQuery) {
  return useQuery({
    queryKey: ['fill-jobs', clientId, params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: FillJob[]; total: number; page: number; limit: number }>('/fill-jobs', {
        params: { clientId, limit: 100, ...params },
      })
      return res.data
    },
    enabled: Boolean(clientId),
  })
}

/**
 * Single fill job by ID — Fill Job Detail page.
 * GET /fill-jobs/:id
 */
export function useFillJob(id: string) {
  return useQuery({
    queryKey: ['fill-jobs', 'detail', id],
    queryFn: async () => {
      const res = await api.get<FillJob>(`/fill-jobs/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Net bags currently in the warehouse per bag spec (specKey) for one Fill
 * Client — produced minus picked up, computed server-side, unbounded per
 * client. Authoritative source for the Bags & Pricing "in warehouse" column;
 * NOT derived from the (display-capped) useFillJobs/useStockExits lists.
 * GET /fill-jobs/net-stock
 */
export interface FillJobNetStockEntry { size: number; charcoal: string; netStock: number }

export function useFillJobNetStock(clientId: string) {
  return useQuery({
    queryKey: ['fill-jobs', 'net-stock', clientId],
    queryFn: async () => {
      const res = await api.get<Record<string, FillJobNetStockEntry>>('/fill-jobs/net-stock', {
        params: { clientId },
      })
      return res.data
    },
    enabled: Boolean(clientId),
  })
}

export function useFillJobPriceStats(clientId: string) {
  return useQuery({
    queryKey: ['fill-jobs', 'price-stats', clientId],
    queryFn: async () => {
      const res = await api.get<FillPriceStats>('/fill-jobs/price-stats', {
        params: { clientId },
      })
      return res.data
    },
    enabled: Boolean(clientId),
  })
}

/**
 * Year-to-date fill-client KPI summary — bags filled, waste, revenue, cost,
 * profit, margin — computed server-side, unbounded per client (not capped
 * at limit:100 like the raw fill-jobs/pickups lists). See
 * FillJobsService.getYtdSummary()'s doc comment for the exact formulas
 * (a direct port of what FillClientDetail.tsx used to compute client-side).
 * GET /fill-jobs/ytd-summary
 */
export interface FillJobYtdSummary {
  bagsYTD: number
  jobCount: number
  wasteKg: string
  wastePct: number
  revenueYTD: string
  costYTD: string
  profitYTD: string
  marginYTD: number
  hasData: boolean
}

export function useFillJobYtdSummary(clientId: string) {
  return useQuery({
    queryKey: ['fill-jobs', 'ytd-summary', clientId],
    queryFn: async () => {
      const res = await api.get<FillJobYtdSummary>('/fill-jobs/ytd-summary', {
        params: { clientId },
      })
      return res.data
    },
    enabled: Boolean(clientId),
  })
}

export function useCreateFillJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dto: CreateFillJobDto) => {
      const res = await api.post<FillJob>('/fill-jobs', dto)
      return res.data
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['fill-jobs', variables.clientId] })
      qc.invalidateQueries({ queryKey: ['fill-jobs', 'price-stats', variables.clientId] })
      // Force immediate refetch on all pages — stock lots changed on the backend
      qc.invalidateQueries({ queryKey: ['stock-lots'], refetchType: 'all' })
      qc.invalidateQueries({ queryKey: ['warehouse', 'summary'], refetchType: 'all' })
    },
  })
}

export interface ConfirmFillPickupDto {
  clientId: string
  date: string
  totalAmount: number
  recipient?: string
  bagSummary: { specKey: string; size: number; charcoal: string; qty: number; unitPrice: number }[]
}

export function useConfirmFillPickup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dto: ConfirmFillPickupDto) => {
      // Single stock exit for the whole pickup, amount drives client balance.
      // reason stores bagSummary as JSON so we can parse it back to compute stock.
      const res = await api.post('/stock-exits', {
        exitType: 'client_bags_fill',
        date: dto.date,
        clientId: dto.clientId,
        amount: dto.totalAmount || undefined,
        recipient: dto.recipient || undefined,
        reason: JSON.stringify(dto.bagSummary),
      })
      return res.data
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['clients', variables.clientId, 'balance'] })
      qc.invalidateQueries({ queryKey: ['clients', variables.clientId] })
      qc.invalidateQueries({ queryKey: ['stock-exits'] })
    },
  })
}
