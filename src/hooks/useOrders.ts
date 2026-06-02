import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  ClientOrder,
  ClientOrderDetail,
  CreateOrderDto,
  UpdateOrderDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /orders. */
export interface OrdersQuery {
  clientId?: string
  status?: string
  page?: number
  limit?: number
  search?: string
}

const ordersKey = (params?: OrdersQuery) => ['orders', params ?? {}] as const

/**
 * List orders (paginated).
 * @param params - clientId / status / pagination filters
 * @returns React Query result of PaginatedResponse<ClientOrder>
 * GET /orders
 */
export function useOrders(params?: OrdersQuery) {
  return useQuery({
    queryKey: ordersKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ClientOrder>>('/orders', { params })
      return res.data
    },
  })
}

/**
 * Fetch one order with client, shipments and bag lines.
 * @param id - order UUID
 * @returns React Query result of ClientOrderDetail
 * GET /orders/:id
 */
export function useOrder(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: async () => {
      const res = await api.get<ClientOrderDetail>(`/orders/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create an order.
 * @returns mutation accepting CreateOrderDto
 * POST /orders
 */
export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateOrderDto) => {
      const res = await api.post<ClientOrder>('/orders', body)
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      // Order creation touches client.lastOrderDate / avgOrderDays.
      qc.invalidateQueries({ queryKey: ['clients', data.clientId] })
    },
  })
}

/**
 * Update an order.
 * @returns mutation accepting { id, body: UpdateOrderDto }
 * PATCH /orders/:id
 */
export function useUpdateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateOrderDto }) => {
      const res = await api.patch<ClientOrder>(`/orders/${id}`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', id] })
    },
  })
}

/**
 * Force-mark an order as delivered (owner override when driver forgets).
 * @returns mutation accepting the order id (string)
 * PATCH /orders/:id/mark-delivered
 */
export function useMarkOrderDelivered() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.patch<ClientOrder>(`/orders/${id}/mark-delivered`, {})
      return res.data
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', id] })
    },
  })
}

/**
 * Delete a draft order.
 * @returns mutation accepting the order id (string)
 * DELETE /orders/:id
 */
export function useDeleteOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/orders/${id}`)
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', id] })
    },
  })
}
