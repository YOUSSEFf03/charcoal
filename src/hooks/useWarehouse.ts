import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  WarehouseSummary,
  StockLot,
  PackedStock,
  PackedStockSummary,
  PaginatedResponse,
  LotMaterialFlow,
  ContainerMaterialFlow,
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
 * Material-flow breakdown for one stock lot — received, consumed (packing / fill jobs /
 * direct exits), packed output, waste, remaining, and the per-session allocation that
 * backs those totals. A packing session that draws from multiple lots is apportioned by
 * each lot's real kg share server-side (see WarehouseService.computeLotFlows()) — this
 * is the fix for the double-count bug where a lot's page used to show a multi-lot
 * session's FULL output instead of its own share.
 * GET /warehouse/lots/:id/material-flow
 */
export function useLotMaterialFlow(lotId: string) {
  return useQuery({
    queryKey: ['warehouse', 'lot-material-flow', lotId],
    queryFn: async () => {
      const res = await api.get<LotMaterialFlow>(`/warehouse/lots/${lotId}/material-flow`)
      return res.data
    },
    enabled: Boolean(lotId),
  })
}

/**
 * Material-flow breakdown for a container, rolled up from all of its stock lots. A
 * packing session drawing from multiple lots of the same container is counted once,
 * split by each lot's real share — never once per lot.
 * GET /warehouse/containers/:id/material-flow
 */
export function useContainerMaterialFlow(containerId: string) {
  return useQuery({
    queryKey: ['warehouse', 'container-material-flow', containerId],
    queryFn: async () => {
      const res = await api.get<ContainerMaterialFlow>(`/warehouse/containers/${containerId}/material-flow`)
      return res.data
    },
    enabled: Boolean(containerId),
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
 * All stock lots with kgRemaining > 0, unbounded — populates the
 * warehouse-sale KG-mode lot selector (WarehouseSales.tsx), replacing
 * useStockLots({hasStock:true, limit:100}) there, which could hide an older
 * lot with real stock beyond the 100 most-recently-received. Unlike the
 * packed-stock FIFO draw, a KG sale always draws from exactly ONE lot,
 * manually chosen by the user — this is a visibility fix, not a
 * server-side draw/split. See StockLotsService.findAvailable()'s doc
 * comment for the full reasoning.
 * GET /stock-lots/available
 */
export function useAvailableStockLots() {
  return useQuery({
    queryKey: ['stock-lots', 'available'],
    queryFn: async () => {
      const res = await api.get<StockLot[]>('/stock-lots/available')
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

/**
 * Server-side FIFO draw plan for one bag type — which PackedStock record(s),
 * oldest first, a sale of `quantity` bags should draw from. Replaces
 * client-side FIFO computation over usePackedStockRecords()'s capped list
 * (a bag type with more than that cap's worth of outstanding batches could
 * report false "insufficient stock"). Read-only/advisory — does not
 * decrement anything; the actual write happens via the existing
 * createExit/createWalkInSale calls, using the returned draws[].
 * GET /packed-stock/fifo-draw
 */
export interface FifoDrawItem {
  packedStockId: string
  quantity: number
}
export interface FifoDrawResult {
  draws: FifoDrawItem[]
  fulfilled: boolean
  requested: number
  available: number
}

export function useFifoDraw() {
  return useMutation({
    mutationFn: async (params: { bagTypeId: string; quantity: number }) => {
      const res = await api.get<FifoDrawResult>('/packed-stock/fifo-draw', { params })
      return res.data
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

/** Walk-in sales aggregate for KPI tiles — no page limit. GET /stock-exits/summary */
export interface WalkInSummary {
  bags: number
  kg: string
}

export function useWalkInSummary(params: { dateFrom: string; dateTo: string }) {
  return useQuery({
    queryKey: ['stock-exits', 'summary', params],
    queryFn: async () => {
      const res = await api.get<WalkInSummary>('/stock-exits/summary', { params })
      return res.data
    },
  })
}

/**
 * Warehouse cash box — cash ACTUALLY COLLECTED from warehouse sales on one
 * date: anonymous StockExit amounts + Payment rows for warehouse-sale
 * invoices (Invoice.source='WAREHOUSE_SALE'). Never invoice totals, never
 * unpaid amounts, never non-warehouse client payments — see
 * StockExitsService.getWarehouseCashSummary()'s doc comment for the full
 * accounting rule. GET /stock-exits/warehouse-cash-summary
 */
export interface WarehouseCashSummary {
  date: string
  cashCollected: string
  paymentCount: number
  anonymousSalesCount: number
}

export function useWarehouseCashSummary(date: string) {
  return useQuery({
    queryKey: ['stock-exits', 'warehouse-cash-summary', date],
    queryFn: async () => {
      const res = await api.get<WarehouseCashSummary>('/stock-exits/warehouse-cash-summary', { params: { date } })
      return res.data
    },
    enabled: Boolean(date),
  })
}

/**
 * "On account (no amount)" diagnostic — count of today's walk-in exits tied
 * to a registered client, with no amount of their own, whose client hasn't
 * paid anything yet today. Computed server-side, unbounded (not derived from
 * the limit:100-capped todayExitsQ/todayPaymentsQ lists, which could
 * silently undercount on a busy day). Same exact definition as before — see
 * StockExitsService.getOnAccountCount()'s doc comment. Separate from
 * useWarehouseCashSummary(), which is unchanged.
 * GET /stock-exits/on-account-summary
 */
export interface OnAccountSummary {
  date: string
  onAccountCount: number
}

export function useOnAccountCount(date: string) {
  return useQuery({
    queryKey: ['stock-exits', 'on-account-summary', date],
    queryFn: async () => {
      const res = await api.get<OnAccountSummary>('/stock-exits/on-account-summary', { params: { date } })
      return res.data
    },
    enabled: Boolean(date),
  })
}

/** List stock exits (sales log). GET /stock-exits */
export function useStockExits(params?: { exitType?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number; clientId?: string; lotId?: string; hasAmount?: boolean }) {
  return useQuery({
    queryKey: ['stock-exits', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: any[]; total: number; page: number; limit: number }>('/stock-exits', { params })
      return res.data
    },
  })
}

/**
 * Single stock exit by ID — Fill Client Pickup Detail page (StockExit rows
 * with exitType='client_bags_fill' ARE the "pickup" record; there is no
 * separate Pickup model).
 * GET /stock-exits/:id
 */
export function useStockExit(id: string) {
  return useQuery({
    queryKey: ['stock-exits', 'detail', id],
    queryFn: async () => {
      const res = await api.get<any>(`/stock-exits/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * One client's COMPLETE warehouse-sales totals (count/kg/amount) — no page
 * limit. Source of truth for ClientDetail's warehouse-sales KPIs; the
 * paginated useStockExits({clientId}) list must never be used to compute
 * these totals (page cap → undercount).
 * GET /stock-exits/client-summary/:clientId
 */
export interface ClientWarehouseSummary {
  totalCount: number
  totalKg: string
  totalAmount: string
}

export function useClientWarehouseSummary(clientId: string) {
  return useQuery({
    queryKey: ['stock-exits', 'client-summary', clientId],
    queryFn: async () => {
      const res = await api.get<ClientWarehouseSummary>(`/stock-exits/client-summary/${clientId}`)
      return res.data
    },
    enabled: Boolean(clientId),
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
      collectedById?: string
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
      // A raw-lot exit changes Raw Material Exits/Remaining; a packed-bag exit changes
      // Packed-Bag Sales/Current Packed Stock — either way the open Lot/Container panel
      // must refresh, not just the raw list. Partial key match invalidates every lot/
      // container's cached flow (the mutation doesn't always know which lot(s)/container
      // are affected up front — e.g. a packed-bag exit only carries packedStockId).
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
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
      // A lot-level adjustment changes lotAdjustmentsKg/Remaining on the material-flow
      // response (Finding B); a packed_stock adjustment changes Current Packed Stock.
      // Partial key invalidates every cached lot/container flow.
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
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
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
    },
  })
}

/** Create a stock adjustment. POST /stock-adjustments
 *  Owner: applied immediately (status 'approved'). Accountant/worker: recorded
 *  as 'pending' — no stock change until an owner calls useApproveStockAdjustment(). */
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
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
    },
  })
}

/** Approve a pending stock adjustment (owner only) — applies the atomic delta now.
 *  POST /stock-adjustments/:id/approve */
export function useApproveStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/stock-adjustments/${id}/approve`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'summary'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'lot-material-flow'] })
      qc.invalidateQueries({ queryKey: ['warehouse', 'container-material-flow'] })
    },
  })
}

/** Reject a pending stock adjustment (owner only) — discards it, no stock change.
 *  POST /stock-adjustments/:id/reject */
export function useRejectStockAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/stock-adjustments/${id}/reject`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
    },
  })
}
