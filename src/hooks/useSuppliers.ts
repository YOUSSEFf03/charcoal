import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Supplier,
  SupplierDetail,
  SupplierPayment,
  CreateSupplierDto,
  CreateSupplierPaymentDto,
  UpdateSupplierDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /suppliers. */
export interface SuppliersQuery {
  search?: string
  page?: number
  limit?: number
}

const suppliersKey = (params?: SuppliersQuery) =>
  ['suppliers', params ?? {}] as const

/**
 * List suppliers (paginated).
 * @param params - search / pagination filters
 * @returns React Query result of PaginatedResponse<Supplier>
 * GET /suppliers
 */
export function useSuppliers(params?: SuppliersQuery) {
  return useQuery({
    queryKey: suppliersKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Supplier>>('/suppliers', { params })
      return res.data
    },
  })
}

/**
 * Fetch one supplier with purchase-history rollup.
 * @param id - supplier UUID
 * @returns React Query result of SupplierDetail
 * GET /suppliers/:id
 */
export function useSupplier(id: string) {
  return useQuery({
    queryKey: ['suppliers', id],
    queryFn: async () => {
      const res = await api.get<SupplierDetail>(`/suppliers/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create a supplier.
 * @returns mutation accepting CreateSupplierDto
 * POST /suppliers
 */
export function useCreateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateSupplierDto) => {
      const res = await api.post<Supplier>('/suppliers', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })
}

/**
 * List payments made to a supplier.
 * GET /suppliers/:id/payments
 */
export function useSupplierPayments(supplierId: string) {
  return useQuery({
    queryKey: ['suppliers', supplierId, 'payments'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<SupplierPayment>>(
        `/suppliers/${supplierId}/payments`,
        { params: { limit: 100 } },
      )
      return res.data
    },
    enabled: Boolean(supplierId),
  })
}

/**
 * Record a payment to a supplier.
 * POST /suppliers/:id/payments
 */
export function useCreateSupplierPayment(supplierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateSupplierPaymentDto) => {
      const res = await api.post<SupplierPayment>(
        `/suppliers/${supplierId}/payments`,
        body,
      )
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers', supplierId] })
      qc.invalidateQueries({ queryKey: ['suppliers', supplierId, 'payments'] })
    },
  })
}

/**
 * Update a supplier.
 * @returns mutation accepting { id, body: UpdateSupplierDto }
 * PATCH /suppliers/:id
 */
export function useUpdateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: UpdateSupplierDto
    }) => {
      const res = await api.patch<Supplier>(`/suppliers/${id}`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['suppliers', id] })
    },
  })
}
