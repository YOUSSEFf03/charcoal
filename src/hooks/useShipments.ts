import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Shipment,
  CreateShipmentDto,
  ConfirmDeliveryDto,
  LogReturnDto,
  LogActualWeightDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /shipments. */
export interface ShipmentsQuery {
  orderId?: string
  tripId?: string
  status?: string
  driverId?: string
  page?: number
  limit?: number
}

const shipmentsKey = (params?: ShipmentsQuery) =>
  ['shipments', params ?? {}] as const

/**
 * List shipments (paginated).
 * @param params - order / trip / status / driver filters
 * @returns React Query result of PaginatedResponse<Shipment>
 * GET /shipments
 */
export function useShipments(params?: ShipmentsQuery) {
  return useQuery({
    queryKey: shipmentsKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Shipment>>('/shipments', { params })
      return res.data
    },
  })
}

/**
 * Fetch one shipment with its bags.
 * @param id - shipment UUID
 * @returns React Query result of Shipment
 * GET /shipments/:id
 */
export function useShipment(id: string) {
  return useQuery({
    queryKey: ['shipments', id],
    queryFn: async () => {
      const res = await api.get<Shipment>(`/shipments/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create a shipment (CONSTRAINT 4: bag qty <= available packed stock).
 * @returns mutation accepting CreateShipmentDto
 * POST /shipments
 */
export function useCreateShipment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateShipmentDto) => {
      const res = await api.post<Shipment>('/shipments', body)
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['orders', data.orderId] })
      // Allocating bags reduces available packed stock.
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
    },
  })
}

/**
 * Confirm delivery of a shipment.
 * Side effects: status -> delivered, removes bags from packed stock,
 * updates order/invoice status, optionally logs a payment.
 * @returns mutation accepting { id, body: ConfirmDeliveryDto }
 * POST /shipments/:id/confirm-delivery
 */
export function useConfirmDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: ConfirmDeliveryDto
    }) => {
      const res = await api.post<Shipment>(`/shipments/${id}/confirm-delivery`, body)
      return res.data
    },
    onSuccess: (data, { id }) => {
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['shipments', id] })
      qc.invalidateQueries({ queryKey: ['orders', data.orderId] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
    },
  })
}

/**
 * Log returned bags for a shipment (returned bags re-enter packed stock).
 * @returns mutation accepting { id, body: LogReturnDto }
 * POST /shipments/:id/return
 */
export function useLogReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: LogReturnDto }) => {
      const res = await api.post<Shipment>(`/shipments/${id}/return`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['shipments', id] })
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
    },
  })
}

/**
 * Log the actual loaded weight of a shipment (reconciliation only).
 * @returns mutation accepting { id, body: LogActualWeightDto }
 * PATCH /shipments/:id/actual-weight
 */
export function useLogActualWeight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: LogActualWeightDto
    }) => {
      const res = await api.patch<Shipment>(`/shipments/${id}/actual-weight`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['shipments', id] })
    },
  })
}
