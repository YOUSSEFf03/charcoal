import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  ArSummary,
  ProfitLossReport,
  DailyRevenueReport,
  RevenueByTypeReport,
  PnlByTypeReport,
  StockValueReport,
  VarianceReport,
  ContainerCostReport,
  ClientLedger,
  SupplierLedger,
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

/** Date-range params accepted by GET /reports/daily-revenue. */
export interface DailyRevenueQuery {
  dateFrom?: string
  dateTo?: string
}

/** Date-range params accepted by GET /reports/revenue-by-type. */
export interface RevenueByTypeQuery {
  dateFrom?: string
  dateTo?: string
}

/** Date-range params accepted by GET /reports/pnl-by-type. */
export interface PnlByTypeQuery {
  dateFrom?: string
  dateTo?: string
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

/** Params accepted by GET /reports/supplier-ledger/:supplierId. */
export interface SupplierLedgerQuery {
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
 * Daily revenue report (owner only) — accrual revenue bucketed by day, same
 * definition as useProfitLoss()'s revenue figure. Shared by the Reports P&L
 * tab and the Dashboard "Daily revenue" card — same hook, same cache entry
 * for a given date range, so both pages request it at most once.
 * @param params - date range
 * @returns React Query result of DailyRevenueReport
 * GET /reports/daily-revenue
 */
export function useDailyRevenue(params?: DailyRevenueQuery) {
  return useQuery({
    queryKey: ['reports', 'daily-revenue', params ?? {}],
    queryFn: async () => {
      const res = await api.get<DailyRevenueReport>('/reports/daily-revenue', { params })
      return res.data
    },
  })
}

/**
 * Revenue by charcoal type (owner only) — same accrual revenue definition as
 * useProfitLoss()/useDailyRevenue(), grouped by charcoal type instead of one
 * total or a per-day series. Also the data source the future P&L-by-charcoal-
 * type table will reuse.
 * @param params - date range
 * @returns React Query result of RevenueByTypeReport
 * GET /reports/revenue-by-type
 */
export function useRevenueByType(params?: RevenueByTypeQuery) {
  return useQuery({
    queryKey: ['reports', 'revenue-by-type', params ?? {}],
    queryFn: async () => {
      const res = await api.get<RevenueByTypeReport>('/reports/revenue-by-type', { params })
      return res.data
    },
  })
}

/**
 * P&L by charcoal type (owner only) — revenue, COGS, gross profit, and
 * margin per type. Backend merges useRevenueByType()'s own aggregation with
 * a new COGS-by-type query; no revenue calculation is duplicated here either
 * — this hook just reads the merged result.
 * @param params - date range
 * @returns React Query result of PnlByTypeReport
 * GET /reports/pnl-by-type
 */
export function usePnlByType(params?: PnlByTypeQuery) {
  return useQuery({
    queryKey: ['reports', 'pnl-by-type', params ?? {}],
    queryFn: async () => {
      const res = await api.get<PnlByTypeReport>('/reports/pnl-by-type', { params })
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
 * Supplier ledger (Supplier Statement of Account) — chronological purchase/payment
 * list with running balance. Mirrors useClientLedger().
 * @param supplierId - supplier UUID
 * @param params - date range filter
 * @returns React Query result of SupplierLedger
 * GET /reports/supplier-ledger/:supplierId
 */
export function useSupplierLedger(supplierId: string, params?: SupplierLedgerQuery) {
  return useQuery({
    queryKey: ['reports', 'supplier-ledger', supplierId, params ?? {}],
    queryFn: async () => {
      const res = await api.get<SupplierLedger>(
        `/reports/supplier-ledger/${supplierId}`,
        { params },
      )
      return res.data
    },
    enabled: Boolean(supplierId),
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
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
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
