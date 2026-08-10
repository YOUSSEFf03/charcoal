import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  ClientOrderListItem,
  ClientOrderCreated,
  Shipment,
  CreateOrderDto,
  CreateShipmentDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /orders (warehouse sales view). */
export interface WarehouseSalesQuery {
  clientId?: string
  status?: string
  page?: number
  limit?: number
}

const salesKey = (params?: WarehouseSalesQuery) =>
  ['orders', 'warehouse-sales', params ?? {}] as const

/**
 * List warehouse sales (orders, each carrying its shipment details on detail).
 * @param params - clientId / status / pagination filters
 * @returns React Query result of PaginatedResponse<ClientOrderListItem>
 * GET /orders
 */
export function useWarehouseSales(params?: WarehouseSalesQuery) {
  return useQuery({
    queryKey: salesKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ClientOrderListItem>>('/orders', { params })
      return res.data
    },
  })
}

/**
 * Result of a warehouse sale: the created order plus its shipment.
 */
export interface CreateSaleResult {
  order: ClientOrderCreated
  shipment: Shipment
}

/**
 * Create a warehouse sale: POST /orders, then POST /shipments for the new order.
 * The shipment is created against the order returned by the first call, so the
 * caller supplies the shipment fields without an orderId.
 * @returns mutation accepting { order, shipment } where shipment omits orderId
 * POST /orders then POST /shipments
 */
export function useCreateSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      order,
      shipment,
    }: {
      order: CreateOrderDto
      shipment: Omit<CreateShipmentDto, 'orderId'>
    }): Promise<CreateSaleResult> => {
      const orderRes = await api.post<ClientOrderCreated>('/orders', order)
      const createdOrder = orderRes.data
      const shipmentRes = await api.post<Shipment>('/shipments', {
        ...shipment,
        orderId: createdOrder.id,
      })
      return { order: createdOrder, shipment: shipmentRes.data }
    },
    onSuccess: ({ order }) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['clients', order.clientId] })
      // Allocating bags reduces available packed stock.
      qc.invalidateQueries({ queryKey: ['packed-stock'] })
    },
  })
}
