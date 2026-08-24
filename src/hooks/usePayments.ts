import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Payment, CreatePaymentDto, PaginatedResponse } from '../types/api'

/** Query params accepted by GET /payments. */
export interface PaymentsQuery {
  clientId?: string
  invoiceId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
  /** 'date' | 'amount'. Omit for the default (date desc). */
  sortBy?: 'date' | 'amount'
  sortOrder?: 'asc' | 'desc'
}

const paymentsKey = (params?: PaymentsQuery) => ['payments', params ?? {}] as const

/**
 * List payments (paginated).
 * @param params - client / invoice filters
 * @returns React Query result of PaginatedResponse<Payment>
 * GET /payments
 */
export function usePayments(params?: PaymentsQuery) {
  return useQuery({
    queryKey: paymentsKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Payment>>('/payments', { params })
      return res.data
    },
  })
}

/**
 * Single payment by ID — Fill Client Payment Detail page. Includes receiver
 * and allocations→invoice (PaymentsService.findOne()'s widened include).
 * GET /payments/:id
 */
export function usePayment(id: string) {
  return useQuery({
    queryKey: ['payments', 'detail', id],
    queryFn: async () => {
      const res = await api.get<Payment>(`/payments/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Record a payment.
 * Side effects: updates invoice.paidAmount + invoice.status, recalculates
 * client.balance.
 * @returns mutation accepting CreatePaymentDto
 * POST /payments
 */
export function useCreatePayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreatePaymentDto) => {
      const res = await api.post<Payment>('/payments', body)
      return res.data
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['reports', 'client-ledger'] })
      qc.invalidateQueries({ queryKey: ['reports', 'ar-summary'] })
      // A payment against a warehouse-sale invoice changes the Warehouse
      // Sales cash box for that payment's date.
      qc.invalidateQueries({ queryKey: ['stock-exits', 'warehouse-cash-summary'] })
      if (data.clientId) {
        qc.invalidateQueries({ queryKey: ['clients', data.clientId, 'balance'] })
        qc.invalidateQueries({ queryKey: ['reports', 'client-ledger', data.clientId] })
      }
      // Refresh receiver balances so CashHandover page stays current
      if (data.receiverId) {
        qc.invalidateQueries({ queryKey: ['cash-handovers', 'balance', data.receiverId] })
        qc.invalidateQueries({ queryKey: ['cash-handovers', 'balances'] })
      }
    },
  })
}
