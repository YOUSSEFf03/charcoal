import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  WarehouseSummary,
  StockLot,
  PackedStock,
  PackedStockSummary,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /stock-lots. */
export interface StockLotsQuery {
  charcoalType?: string
  grade?: string
  hasStock?: boolean
  supplierId?: string
  source?: string
  page?: number
  limit?: number
}

/** Query params accepted by GET /packed-stock. */
export interface PackedStockQuery {
  bagTypeId?: string
  lotId?: string
}

/**
 * Fetch live warehouse totals.
 * @returns React Query result of WarehouseSummary
 * GET /warehouse/summary
 */
export function useWarehouseSummary() {
  return useQuery({
    queryKey: ['warehouse', 'summary'],
    queryFn: async () => {
      const res = await api.get<WarehouseSummary>('/warehouse/summary')
      return res.data
    },
  })
}

/**
 * List stock lots (paginated).
 * @param params - charcoalType / grade / hasStock filters
 * @returns React Query result of PaginatedResponse<StockLot>
 * GET /stock-lots
 */
export function useStockLots(params?: StockLotsQuery) {
  return useQuery({
    queryKey: ['stock-lots', params ?? {}],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<StockLot>>('/stock-lots', { params })
      return res.data
    },
  })
}

/**
 * Fetch one stock lot.
 * @param id - stock lot UUID
 * @returns React Query result of StockLot
 * GET /stock-lots/:id
 */
export function useStockLot(id: string) {
  return useQuery({
    queryKey: ['stock-lots', id],
    queryFn: async () => {
      const res = await api.get<StockLot>(`/stock-lots/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * List packed stock with bag type and lot.
 * @param params - bagTypeId filter
 * @returns React Query result of PackedStock[]
 * GET /packed-stock
 */
export function usePackedStock(params?: PackedStockQuery) {
  return useQuery({
    queryKey: ['packed-stock', params ?? {}],
    queryFn: async () => {
      const res = await api.get<PackedStock[]>('/packed-stock', { params })
      return res.data
    },
  })
}

/**
 * Fetch aggregated packed-stock totals per bag type.
 * @returns React Query result of PackedStockSummary[]
 * GET /packed-stock/summary
 */
export function usePackedStockSummary() {
  return useQuery({
    queryKey: ['packed-stock', 'summary'],
    queryFn: async () => {
      const res = await api.get<PackedStockSummary[]>('/packed-stock/summary')
      return res.data
    },
  })
}

/** List packed stock records (with quantity > 0 by default). GET /packed-stock */
export function usePackedStockRecords(params?: { bagTypeId?: string; limit?: number }) {
  return useQuery({
    queryKey: ['packed-stock-records', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: any[] }>('/packed-stock', { params })
      return res.data.data
    },
  })
}

/** Update sale amount on a stock exit. PATCH /stock-exits/:id */
export function useUpdateStockExit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, amount, recipient }: { id: string; amount?: number; recipient?: string }) => {
      const res = await api.patch(`/stock-exits/${id}`, { amount, recipient })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-exits'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

/** List stock exits (sales log). GET /stock-exits */
export function useStockExits(params?: { exitType?: string; dateFrom?: string; dateTo?: string; limit?: number; clientId?: string; lotId?: string }) {
  return useQuery({
    queryKey: ['stock-exits', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: any[]; total: number }>('/stock-exits', { params })
      return res.data
    },
  })
}

/** Create a stock exit (packed bags or raw lot by-kg). POST /stock-exits */
export function useCreateStockExit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      // packed mode
      packedStockId?: string
      bagTypeId?: string
      quantity?: number
      // raw lot mode
      lotId?: string
      kgQuantity?: number
      // common
      exitType: string
      date: string
      recipient?: string
      reason?: string
      clientId?: string
      amount?: number
      collectedBy?: string
    }) => {
      const res = await api.post('/stock-exits', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
      qc.invalidateQueries({ queryKey: ['packed-stock-records'] })
      qc.invalidateQueries({ queryKey: ['stock-exits'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'summary'] })
      // Invalidate all client queries so balance/overdue update immediately
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

/** Fetch stock adjustments (paginated). GET /stock-adjustments */
export function useStockAdjustments(params?: { limit?: number; page?: number }) {
  return useQuery({
    queryKey: ['stock-adjustments', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: any[]; total: number }>('/stock-adjustments', { params })
      return res.data
    },
  })
}

/** Update a stock adjustment. PATCH /stock-adjustments/:id */
export function useUpdateStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { qtyAfter?: string; reason?: string } }) => {
      const res = await api.patch(`/stock-adjustments/${id}`, body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'summary'] })
    },
  })
}

/** Delete a stock adjustment (reverses its effect). DELETE /stock-adjustments/:id */
export function useDeleteStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/stock-adjustments/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'summary'] })
    },
  })
}

/** Create a stock adjustment. POST /stock-adjustments */
export function useCreateStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      adjustmentType: 'lot' | 'packed_stock'
      lotId?: string
      packedStockId?: string
      qtyBefore: string
      qtyAfter: string
      reason: string
      date: string
    }) => {
      const res = await api.post('/stock-adjustments', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'summary'] })
    },
  })
}
