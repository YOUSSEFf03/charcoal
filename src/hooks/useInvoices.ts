import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Invoice,
  InvoiceDetail,
  CreateInvoiceDto,
  IssueInvoiceDto,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /invoices. */
export interface InvoicesQuery {
  clientId?: string
  status?: string
  page?: number
  limit?: number
  search?: string
  dateFrom?: string
  dateTo?: string
}

const invoicesKey = (params?: InvoicesQuery) => ['invoices', params ?? {}] as const

/**
 * List invoices (paginated).
 * @param params - client / status / pagination filters
 * @returns React Query result of PaginatedResponse<Invoice>
 * GET /invoices
 */
export function useInvoices(params?: InvoicesQuery) {
  return useQuery({
    queryKey: invoicesKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Invoice>>('/invoices', { params })
      return res.data
    },
  })
}

/**
 * Fetch one invoice with client and payments.
 * @param id - invoice UUID
 * @returns React Query result of InvoiceDetail
 * GET /invoices/:id
 */
export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: async () => {
      const res = await api.get<InvoiceDetail>(`/invoices/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create a draft invoice (subtotal/total computed from lines).
 * @returns mutation accepting CreateInvoiceDto
 * POST /invoices
 */
export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateInvoiceDto) => {
      const res = await api.post<Invoice>('/invoices', body)
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['clients', data.clientId] })
    },
  })
}

/**
 * Issue a draft invoice (status -> issued, stamps issuedAt).
 * @returns mutation accepting { id, body?: IssueInvoiceDto }
 * POST /invoices/:id/issue
 */
export function useIssueInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body?: IssueInvoiceDto }) => {
      const res = await api.post<Invoice>(`/invoices/${id}/issue`, body ?? {})
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices', id] })
    },
  })
}

/**
 * Cancel an invoice (status -> cancelled).
 * @returns mutation accepting the invoice id (string)
 * POST /invoices/:id/cancel
 */
export function useCancelInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<Invoice>(`/invoices/${id}/cancel`, {})
      return res.data
    },
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoices', id] })
      qc.invalidateQueries({ queryKey: ['clients', data.clientId] })
    },
  })
}
