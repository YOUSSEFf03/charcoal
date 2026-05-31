// ============================================================================
// Charcoal Business Accounting System — API Type Barrel
// ----------------------------------------------------------------------------
// The canonical type surface (every entity, DTO, and report shape) already
// lives in `src/lib/types.ts` (generated from schema.prisma, identical to
// backend-docs/types/api.ts). This file re-exports all of it so the hooks
// layer can import a single, stable `../types/api` path.
//
// A handful of endpoint-specific shapes documented in backend-docs/API.md but
// NOT present in the generated surface are declared below and marked with
// `// TODO: verify against Swagger`.
// ============================================================================

export * from '../lib/types'

import type {
  CreateShipmentBagDto,
  TripOtherExpense,
  WorkerRate,
  PackedStockSummary,
  Currency,
} from '../lib/types'

// ----------------------------------------------------------------------------
// SUPPLEMENTAL ENDPOINT SHAPES (not in the generated type surface)
// ----------------------------------------------------------------------------

/**
 * GET /warehouse/summary — live totals for the whole warehouse.
 * Shape taken from backend-docs/API.md example response.
 * TODO: verify against Swagger.
 */
export interface WarehouseSummary {
  totalRawKg: string // Decimal
  totalPackedNominalKg: string // Decimal
  totalSystemKg: string // Decimal
  lotCount: number
  packedSummary: PackedStockSummary[]
}

/**
 * GET /clients/:id/balance — computed client balance.
 * TODO: verify against Swagger.
 */
export interface ClientBalanceResponse {
  balance: string // Decimal
  currency: Currency
}

/**
 * PATCH /clients/:id/phones/deactivate — body marks a phone inactive.
 * Phone records are never deleted (CONSTRAINT 14).
 * TODO: verify against Swagger.
 */
export interface DeactivateClientPhoneDto {
  phoneNumber: string
}

/**
 * PATCH /shipments/:id/actual-weight — driver logs loaded weight.
 * TODO: verify against Swagger.
 */
export interface LogActualWeightDto {
  actualKg: string // Decimal
}

/**
 * POST /shipments/:id/confirm-delivery — driver/owner confirms delivery.
 * Side effects: status -> delivered, removes bags from packed stock,
 * updates order/invoice status, optionally logs a payment.
 * TODO: verify against Swagger.
 */
export interface ConfirmDeliveryDto {
  deliveredAt?: string
  actualKg?: string
  paymentAmount?: string // optional cash-on-delivery payment
  notes?: string | null
}

/**
 * POST /shipments/:id/return — log returned bags (re-enter packed stock).
 * TODO: verify against Swagger.
 */
export interface LogReturnDto {
  bags: CreateShipmentBagDto[]
  reason?: string | null
  notes?: string | null
}

/**
 * PATCH /workers/:id/rates — replaces the entire per-bag-type rate array.
 * TODO: verify against Swagger.
 */
export interface UpdateWorkerRatesDto {
  ratesPerBagType: WorkerRate[]
}

/**
 * POST /driver-trips/:id/complete — close a trip with final costs.
 * TODO: verify against Swagger.
 */
export interface CompleteDriverTripDto {
  fuelCost: string // Decimal
  otherExpenses?: TripOtherExpense[]
  notes?: string | null
}

/**
 * POST /reports/physical-count — submit a counted-vs-system reconciliation.
 * Returns a summary of the stock adjustments it created.
 * TODO: verify against Swagger.
 */
export interface SubmitPhysicalCountDto {
  rawLots?: { lotId: string; countedKg: string }[]
  packedStock?: { packedStockId: string; countedQty: number }[]
  date: string
  reason?: string | null
}
