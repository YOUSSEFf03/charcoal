import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  ArSummary,
  ProfitLossReport,
  StockValueReport,
  VarianceReport,
  ContainerCostReport,
  ClientLedger,
  PhysicalCountReport,
  SubmitPhysicalCountDto,
} from '../types/api'

/** Date-range params accepted by GET /reports/profit-loss. */
export interface ProfitLossQuery {
  dateFrom?: string
  dateTo?: string
  charcoalType?: string
  grade?: string
  clientId?: string
  clientType?: string
}

/** Params accepted by GET /reports/variance. */
export interface VarianceQuery {
  dateFrom?: string
  dateTo?: string
  workerId?: string
}

/** Params accepted by GET /reports/container-costs. */
export interface ContainerCostsQuery {
  dateFrom?: string
  dateTo?: string
  supplierId?: string
}

/** Params accepted by GET /reports/client-ledger/:clientId. */
export interface ClientLedgerQuery {
  dateFrom?: string
  dateTo?: string
}

/**
 * AR summary — full-table SQL aggregates for invoice KPI cards.
 * Safe at any invoice/payment volume; no reduce() over a page slice.
 * GET /reports/ar-summary
 */
export function useArSummary() {
  return useQuery({
    queryKey: ['reports', 'ar-summary'],
    queryFn: async () => {
      const res = await api.get<ArSummary>('/reports/ar-summary')
      return res.data
    },
    staleTime: 30_000,
  })
}

/**
 * Profit & loss report (owner only).
 * @param params - date range and dimension filters
 * @returns React Query result of ProfitLossReport
 * GET /reports/profit-loss
 */
export function useProfitLoss(params?: ProfitLossQuery) {
  return useQuery({
    queryKey: ['reports', 'profit-loss', params ?? {}],
    queryFn: async () => {
      const res = await api.get<ProfitLossReport>('/reports/profit-loss', { params })
      return res.data
    },
  })
}

/**
 * Stock value report (owner/accountant).
 * @returns React Query result of StockValueReport
 * GET /reports/stock-value
 */
export function useStockValue() {
  return useQuery({
    queryKey: ['reports', 'stock-value'],
    queryFn: async () => {
      const res = await api.get<StockValueReport>('/reports/stock-value')
      return res.data
    },
  })
}

/**
 * Packing variance report.
 * @param params - date range / worker filter
 * @returns React Query result of VarianceReport
 * GET /reports/variance
 */
export function useVarianceReport(params?: VarianceQuery) {
  return useQuery({
    queryKey: ['reports', 'variance', params ?? {}],
    queryFn: async () => {
      const res = await api.get<VarianceReport>('/reports/variance', { params })
      return res.data
    },
  })
}

/**
 * Container cost report.
 * @param params - date range / supplier filter
 * @returns React Query result of ContainerCostReport
 * GET /reports/container-costs
 */
export function useContainerCosts(params?: ContainerCostsQuery) {
  return useQuery({
    queryKey: ['reports', 'container-costs', params ?? {}],
    queryFn: async () => {
      const res = await api.get<ContainerCostReport>('/reports/container-costs', {
        params,
      })
      return res.data
    },
  })
}

/**
 * Client ledger (statement of invoices and payments).
 * @param clientId - client UUID
 * @param params - date range filter
 * @returns React Query result of ClientLedger
 * GET /reports/client-ledger/:clientId
 */
export function useClientLedger(clientId: string, params?: ClientLedgerQuery) {
  return useQuery({
    queryKey: ['reports', 'client-ledger', clientId, params ?? {}],
    queryFn: async () => {
      const res = await api.get<ClientLedger>(
        `/reports/client-ledger/${clientId}`,
        { params },
      )
      return res.data
    },
    enabled: Boolean(clientId),
  })
}

/**
 * Physical-count report (current system quantities for all lots/packed stock).
 * @returns React Query result of PhysicalCountReport
 * GET /reports/physical-count
 */
export function usePhysicalCount() {
  return useQuery({
    queryKey: ['reports', 'physical-count'],
    queryFn: async () => {
      const res = await api.get<PhysicalCountReport>('/reports/physical-count')
      return res.data
    },
  })
}

/**
 * Submit a physical count (creates stock adjustments for discrepancies).
 * @returns mutation accepting SubmitPhysicalCountDto
 * POST /reports/physical-count
 */
export function useSubmitPhysicalCount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SubmitPhysicalCountDto) => {
      const res = await api.post('/reports/physical-count', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports', 'physical-count'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
    },
  })
}

export interface ActivityItem {
  id: string
  type: 'packing' | 'delivery' | 'payment' | 'invoice' | 'order' | 'fill' | 'container' | 'exit'
  title: string
  subtitle: string
  timestamp: string // ISO 8601
}

/**
 * Unified activity feed — newest events from all major domains.
 * Polls every 60 s so the dashboard stays reasonably fresh.
 * GET /reports/activity
 */
export function useActivity(limit = 30) {
  return useQuery({
    queryKey: ['reports', 'activity', limit],
    queryFn: async () => {
      const res = await api.get<ActivityItem[]>('/reports/activity', { params: { limit } })
      return res.data
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
