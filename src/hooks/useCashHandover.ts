import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Payment, PaginatedResponse, CashHandover,
  ExpenseEmployeeSummary, ExpenseEmployeeDetail, ExpenseCategoryDetail,
  BusinessExpense,
} from '../types/api'

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

export function useCashHandovers(params?: { dateFrom?: string; dateTo?: string; page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: ['cash-handovers', params ?? {}],
    queryFn: async ({ signal }) => {
      const res = await api.get<PaginatedResponse<CashHandover>>('/cash-handovers', { params, signal })
      return res.data
    },
    placeholderData: keepPreviousData,
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
       *  (e.g. gas, parking) — the SAME values used to compute expectedAmt.
       *  `categoryId` selects an existing ExpenseCategory (see
       *  useExpenseCategories()/useCreateExpenseCategory()) — free-text
       *  description is no longer accepted here (forensic audit, 2026-08-31). */
      expenses?: { categoryId: string; amount: string }[]
    }) => {
      const res = await api.post('/cash-handovers', body)
      return res.data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['cash-handovers'] })
      qc.invalidateQueries({ queryKey: ['cash-handovers', 'balances'] })
      qc.invalidateQueries({ queryKey: ['cash-handovers', 'balance', vars.receiverId] })
      qc.invalidateQueries({ queryKey: ['cash-handovers', 'expenses'] })
    },
  })
}

/** Date-range params shared by the Expenses page aggregation views. */
export interface ExpensesAggregationQuery {
  dateFrom?: string
  dateTo?: string
}

/**
 * Every cash-handover-sourced BUSINESS expense in range, flat (Business
 * Expenses page PRIMARY view — business-model audit, 2026-09-04: "a Cash
 * Handover is NOT an employee expense," the expense belongs to the business
 * and the employee is only the cash holder). Aggregated server-side from the
 * SAME CashHandoverExpense rows useExpensesSummary()/useEmployeeExpenses()
 * below read — never a second/duplicate record, never a client-side fan-out
 * over a paginated/capped fetch (same anti-pattern useExpensesSummary()'s own
 * doc comment describes).
 * GET /cash-handovers/expenses
 */
export function useBusinessExpenses(params?: ExpensesAggregationQuery) {
  return useQuery({
    queryKey: ['cash-handovers', 'expenses', 'business', params ?? {}],
    queryFn: async () => {
      const res = await api.get<BusinessExpense[]>('/cash-handovers/expenses', { params })
      return res.data
    },
  })
}

/**
 * Cash-holder expense totals (a secondary "by cash holder" breakdown of the
 * same business expenses above) — aggregated server-side from
 * CashHandoverExpense, never a client-side reduce over a paginated/capped
 * fetch (forensic audit, 2026-08-31 — this replaces a prior hook here that
 * fetched GET /cash-handovers?limit=200 and flattened every handover's
 * nested expenses in the browser, silently undercounting for any business
 * with more than 200 handovers).
 * GET /cash-handovers/expenses/summary
 */
export function useExpensesSummary(params?: ExpensesAggregationQuery) {
  return useQuery({
    queryKey: ['cash-handovers', 'expenses', 'summary', params ?? {}],
    queryFn: async () => {
      const res = await api.get<ExpenseEmployeeSummary[]>('/cash-handovers/expenses/summary', { params })
      return res.data
    },
  })
}

/**
 * One employee's expense total + category breakdown.
 * GET /cash-handovers/expenses/employee/:employeeId
 */
export function useEmployeeExpenses(employeeId: string, params?: ExpensesAggregationQuery) {
  return useQuery({
    queryKey: ['cash-handovers', 'expenses', 'employee', employeeId, params ?? {}],
    queryFn: async () => {
      const res = await api.get<ExpenseEmployeeDetail>(`/cash-handovers/expenses/employee/${employeeId}`, { params })
      return res.data
    },
    enabled: Boolean(employeeId),
  })
}

/**
 * Every individual expense occurrence for one employee in one category (the
 * drill-down from useEmployeeExpenses()'s category row).
 * GET /cash-handovers/expenses/employee/:employeeId/category/:categoryId
 */
export function useEmployeeCategoryExpenses(employeeId: string, categoryId: string, params?: ExpensesAggregationQuery) {
  return useQuery({
    queryKey: ['cash-handovers', 'expenses', 'employee', employeeId, 'category', categoryId, params ?? {}],
    queryFn: async () => {
      const res = await api.get<ExpenseCategoryDetail>(
        `/cash-handovers/expenses/employee/${employeeId}/category/${categoryId}`,
        { params },
      )
      return res.data
    },
    enabled: Boolean(employeeId) && Boolean(categoryId),
  })
}

