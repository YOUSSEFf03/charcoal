import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Invoice,
  InvoiceDetail,
  CreateInvoiceDto,
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
  /** 'date' (issuedAt) | 'amount' (total) | 'paid' (paidAmount) | 'status'. Omit for the default (createdAt desc). */
  sortBy?: 'date' | 'amount' | 'paid' | 'status'
  sortOrder?: 'asc' | 'desc'
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
    queryFn: async ({ signal }) => {
      // signal: an in-flight request for a stale search term / page is aborted
      // as soon as a newer one supersedes it (React Query passes a fresh
      // AbortSignal per query-key change) — forwarded to axios so the
      // superseded request is actually cancelled on the wire, not just
      // ignored client-side once it resolves.
      const res = await api.get<PaginatedResponse<Invoice>>('/invoices', { params, signal })
      return res.data
    },
    // Keeps the previous page's rows on screen (instead of blanking to a
    // skeleton) while a new search term or page number is loading — the
    // search itself was already debounced+server-paginated, but with no
    // placeholderData every keystroke's new query key had zero cached data
    // to show yet, so the table flashed empty on every search edit even
    // though the underlying request was fast. This is what actually made
    // the search feel slow.
    placeholderData: keepPreviousData,
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
 * Issue a draft invoice (status -> issued, stamps issuedAt with the current
 * date and the live settings exchange rate). The backend route takes no
 * body at all (InvoicesController's issue() has no @Body() parameter).
 * @returns mutation accepting { id }
 * POST /invoices/:id/issue
 */
export function useIssueInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await api.post<Invoice>(`/invoices/${id}/issue`)
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
