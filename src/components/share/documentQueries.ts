import { api } from '../../lib/api'
import type { BagType, Client, ClientOrderDetail, InvoiceDetail } from '../../lib/types'
import type { DailyReport } from '../../types/api'

// Query options for the data the share dialogs need. Keys are IDENTICAL to the
// ones in hooks/useInvoices, useClients and useReports, so a page that already
// loaded the data shares the cache, and the dialogs can also fetch imperatively
// (queryClient.fetchQuery) when the user hits Share before it has arrived.

export const invoiceQuery = (id: string) => ({
  queryKey: ['invoices', id] as const,
  queryFn: async () => (await api.get<InvoiceDetail>(`/invoices/${id}`)).data,
})

export const clientQuery = (id: string) => ({
  queryKey: ['clients', id] as const,
  queryFn: async () => (await api.get<Client>(`/clients/${id}`)).data,
})

export const dailyReportQuery = (date: string) => ({
  queryKey: ['reports', 'daily', date] as const,
  queryFn: async () => (await api.get<DailyReport>(`/reports/daily/${date}`)).data,
})

export const orderQuery = (id: string) => ({
  queryKey: ['orders', id] as const,
  queryFn: async () => (await api.get<ClientOrderDetail>(`/orders/${id}`)).data,
})

export const bagTypesQuery = () => ({
  queryKey: ['bag-types'] as const,
  queryFn: async () => (await api.get<{ data: BagType[] }>('/bag-types?limit=100')).data.data,
})
