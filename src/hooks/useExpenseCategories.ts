import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ExpenseCategory } from '../types/api'

/**
 * All reusable expense categories (Fuel, Food, …), for the Cash Handover
 * expense dropdown.
 * GET /expense-categories
 */
export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const res = await api.get<ExpenseCategory[]>('/expense-categories')
      return res.data
    },
  })
}

/**
 * "+ Add new expense" — creates a new category, or returns the existing one
 * if the name already matches case-insensitively (find-or-create; never
 * creates a Fuel/fuel/FUEL duplicate).
 * POST /expense-categories
 */
export function useCreateExpenseCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await api.post<ExpenseCategory>('/expense-categories', { name })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-categories'] })
    },
  })
}
