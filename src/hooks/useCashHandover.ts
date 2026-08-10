import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Payment, PaginatedResponse, CashHandover, CashHandoverExpense } from '../types/api'

/**
 * Payments recorded on a single day (cash-handover reconciliation).
 * The backend filters payments by a date range, so a single `date` is mapped
 * to dateFrom == dateTo == date.
 * @param date - ISO date (YYYY-MM-DD); when omitted, no date filter is applied
 * @returns React Query result of PaginatedResponse<Payment>
 * GET /payments?dateFrom=date&dateTo=date
 */
export function useDailyPayments(date?: string) {
  return useQuery({
    queryKey: ['payments', 'daily', date ?? null],
    queryFn: async () => {
      const params = date ? { dateFrom: date, dateTo: date, limit: 100 } : { limit: 100 }
      const res = await api.get<PaginatedResponse<Payment>>('/payments', { params })
      return res.data
    },
  })
}

/**
 * Driver trips (and their recorded expenses) for a single day.
 * `date` is mapped to dateFrom == dateTo == date for the driver-trips filter.
 * @param date - ISO date (YYYY-MM-DD); when omitted, no date filter is applied
 * @returns React Query result of PaginatedResponse<DriverTrip>
 * GET /driver-trips?dateFrom=date&dateTo=date
 */
export interface UserBalance {
  userId: string
  name: string
  role: string
  totalCollected: string | null
  totalHandedOver: string | null
  balance: string
}

/**
 * All users who have collected money with a positive running balance.
 * Sorted by balance descending. Refetches every 30 s.
 * GET /cash-handovers/balances
 */
export function useAllBalances() {
  return useQuery({
    queryKey: ['cash-handovers', 'balances'],
    queryFn: async () => {
      const res = await api.get<UserBalance[]>('/cash-handovers/balances')
      return res.data
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useReceiverBalance(receiverId: string) {
  return useQuery({
    queryKey: ['cash-handovers', 'balance', receiverId],
    queryFn: async () => {
      const res = await api.get(`/cash-handovers/balance/user/${receiverId}`)
      return res.data as {
        receiverId: string
        receiverName: string
        balance: string          // net: totalCollected − totalHandedOver
        total: string            // alias for balance
        totalCollected: string
        totalHandedOver: string
        lastHandover: string | null
        payments: { id: string; date: string; amount: string; method: string; clientName: string; notes: string | null }[]
        exits: { id: string; date: string; amount: string; recipient: string | null; description: string }[]
        handovers: { id: string; date: string; handedAmt: string; expectedAmt: string; difference: string; notes: string | null }[]
      }
    },
    enabled: !!receiverId,
  })
}

export function useCashHandovers(params?: { dateFrom?: string; dateTo?: string; limit?: number }) {
  return useQuery({
    queryKey: ['cash-handovers', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: CashHandover[]; total: number }>('/cash-handovers', { params })
      return res.data
    },
  })
}

export function useCreateCashHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      date: string
      receiverId: string        // User.id of the receiver
      expectedAmt: string
      handedAmt: string
      notes?: string | null
      /** Itemized amounts already deducted from collected cash before handover
       *  (e.g. gas, parking) — the SAME values used to compute expectedAmt. */
      expenses?: { description: string; amount: string }[]
    }) => {
      const res = await api.post('/cash-handovers', body)
      return res.data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['cash-handovers'] })
      qc.invalidateQueries({ queryKey: ['cash-handovers', 'balances'] })
      qc.invalidateQueries({ queryKey: ['cash-handovers', 'balance', vars.receiverId] })
    },
  })
}

/** A cash-handover expense annotated with its parent handover's date and receiver,
 *  for display in the Expenses aggregation. */
export interface AggregatedCashHandoverExpense extends CashHandoverExpense {
  handoverDate: string
  receiverName: string
}

/**
 * Aggregate itemized cash-handover expenses across all handovers in a date range.
 * CashHandoverExpense has no date of its own — it's derived from the parent
 * CashHandover.date (see schema comment).
 * @param params - optional dateFrom / dateTo (inclusive) on the parent handover's date
 * @returns React Query result of AggregatedCashHandoverExpense[]
 * GET /cash-handovers?dateFrom=&dateTo= (expenses already included server-side)
 */
export function useAllCashHandoverExpenses(params?: { dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: ['cash-handovers', 'expenses', params ?? {}],
    queryFn: async () => {
      const res = await api.get<{ data: CashHandover[]; total: number }>('/cash-handovers', {
        params: { limit: 200, ...params },
      })
      const handovers = res.data.data
      const all: AggregatedCashHandoverExpense[] = handovers.flatMap((h) =>
        (h.expenses ?? []).map((e) => ({ ...e, handoverDate: h.date, receiverName: h.receiverName })),
      )
      return all
    },
  })
}
