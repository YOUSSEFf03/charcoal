import type { WorkerCostCategory, PaymentMethod } from '../types/api'

/**
 * Business-language labels for WorkerCost.category / WorkerPayment.method —
 * the underlying model is WorkerCost, but factory staff never see the word
 * "cost": this records what a worker earned, not a business expense.
 *
 * Shared between Employees.tsx (the Statement of Account, "Add earnings"
 * modal) and Expenses.tsx (the Business Expenses "Employee wage" rows —
 * wages/COGS-vs-expenses audit, 2026-09-06) so there is exactly ONE label
 * mapping for these enums, never two that could silently drift apart.
 */
export const CATEGORY_LABEL: Record<WorkerCostCategory, string> = {
  daily_wage: 'Daily wage',
  weekly_wage: 'Weekly wage',
  monthly_salary: 'Monthly salary',
  bonus: 'Bonus',
  deduction: 'Deduction',
  fuel: 'Fuel',
  food: 'Food',
  transport: 'Transport',
  advance: 'Advance',
  correction: 'Correction',
  other: 'Other',
}
export const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL) as WorkerCostCategory[]

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash', whish: 'Whish', omt: 'OMT', bank_transfer: 'Bank', cheque: 'Cheque',
}
export const PAYMENT_METHODS = Object.keys(METHOD_LABEL) as PaymentMethod[]
