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
  TripOtherExpense,
  WorkerRate,
  PackedStockSummary,
  Currency,
  PaymentMethod,
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
  estimatedTotalValue?: string // Decimal — omitted for sales_rep/worker roles
}

/**
 * GET /warehouse/lots/:id/material-flow — one packing session's contribution to a
 * single lot's material flow. `sessionKgConsumed`/`sessionKgOutputTotal` are the
 * SESSION's totals (shown for context only) — `allocatedOutputKg`/`allocatedWasteKg`
 * are this lot's own share and are what must be displayed/summed per lot.
 */
export interface LotFlowSession {
  sessionId: string
  date: string
  bagCount: number
  lotKgUsed: string // Decimal — this lot's real input to the session
  sessionKgConsumed: string // Decimal — session total, reference only
  sessionKgOutputTotal: string // Decimal — session total, reference only
  sharePct: string // this lot's kgUsed / session kgConsumed * 100
  /** HISTORICAL output — session.kgOutputTotal apportioned by this lot's input share.
   *  Fixed at packing time. NEVER derived from live PackedStock.quantity, which shrinks
   *  with later sales/adjustments against that batch. This lot's share only. */
  allocatedOutputKg: string // Decimal
  allocatedWasteKg: string // Decimal — this lot's share of max(varianceKg, 0)
  /** CURRENT, live on-hand PackedStock kg still remaining from this exact (lot, session)
   *  batch — informational only, a snapshot of today's inventory. Never part of output/
   *  waste/yield. Label as "Current stock from this batch" if shown, never "output". */
  currentBatchStockKg: string // Decimal
}

/** GET /warehouse/lots/:id/material-flow — full material-flow breakdown for one StockLot. */
export interface LotMaterialFlow {
  lotId: string
  charcoalType: string
  grade: string
  received: string // Decimal — StockLot.kgReceived
  consumedPacking: string // Decimal — Σ PackingSessionLot.kgUsed for this lot
  consumedFillJobs: string // Decimal — Σ FillJobLot.kgUsed for this lot
  /** Σ StockAdjustment.difference WHERE adjustmentType='lot' AND status='approved' for this
   *  lot. Same sign convention as the write path: positive = stock gain, negative = loss.
   *  Reconciliation: received − consumedPacking − consumedFillJobs − rawMaterialExitsKg +
   *  lotAdjustmentsKg = remaining, exactly. */
  lotAdjustmentsKg: string // Decimal
  /** Raw-material exits: StockExit rows where StockExit.lotId = this lot (by-kg sales).
   *  One of the writers of StockLot.kgRemaining (alongside packing, fill jobs, adjustments). */
  rawMaterialExitsKg: string // Decimal
  /** Finished-goods exits: StockExit rows where StockExit.packedStockId → PackedStock.lotId
   *  = this lot (bag sales drawn from this lot's packed batches). Reduces
   *  PackedStock.quantity only — never StockLot.kgRemaining. Kept separate so the UI never
   *  presents it as additional raw-material consumption. */
  packedBagSalesKg: string // Decimal
  /** Σ StockExit.amount across every exit counted in rawMaterialExitsKg/packedBagSalesKg —
   *  the unbounded, authoritative $ total for this lot's exits (never reduce over a
   *  page-limited exit list for this figure). */
  totalExitAmount: string // Decimal
  /** HISTORICAL total output — Σ per-session kgOutputTotal shares (see LotFlowSession). */
  packedOutput: string // Decimal
  /** CURRENT total on-hand PackedStock kg for this lot, across all its batches.
   *  Informational only — label as "Current Packed Stock", never "output"/"produced". */
  currentPackedStockKg: string // Decimal
  waste: string // Decimal — Σ this lot's allocated share of max(varianceKg, 0)
  remaining: string // Decimal — StockLot.kgRemaining (raw material only; unaffected by packedBagSalesKg)
  wastePct: string | null // waste / consumedPacking * 100 — null if consumedPacking is 0
  yieldPct: string | null // packedOutput / consumedPacking * 100 — null if consumedPacking is 0
  sessions: LotFlowSession[]
}

/** One StockLot's contribution to its container's material flow. */
export interface ContainerLotFlow {
  lotId: string
  charcoalType: string
  grade: string
  received: string // Decimal
  consumedPacking: string // Decimal
  lotAdjustmentsKg: string // Decimal — see LotMaterialFlow.lotAdjustmentsKg
  sharePct: string | null // this lot's consumedPacking / container's total consumedPacking * 100
  packedOutput: string // Decimal — this lot's allocated share (historical)
  currentPackedStockKg: string // Decimal — informational only, see LotMaterialFlow
  waste: string // Decimal — this lot's allocated share
  remaining: string // Decimal
  yieldPct: string | null
}

/**
 * GET /warehouse/containers/:id/material-flow — container-level material flow, rolled up
 * from every StockLot belonging to the container. A packing session drawing from multiple
 * lots of the SAME container is counted exactly once (see WarehouseService.computeLotFlows()
 * doc comment for the anti-double-count proof) — never once per contributing lot.
 */
export interface ContainerMaterialFlow {
  containerId: string
  received: string // Decimal
  consumedPacking: string // Decimal
  consumedFillJobs: string // Decimal
  lotAdjustmentsKg: string // Decimal — see LotMaterialFlow.lotAdjustmentsKg
  rawMaterialExitsKg: string // Decimal
  packedBagSalesKg: string // Decimal
  packedOutput: string // Decimal
  currentPackedStockKg: string // Decimal — informational only, see LotMaterialFlow
  waste: string // Decimal
  remaining: string // Decimal
  wastePct: string | null
  yieldPct: string | null
  lots: ContainerLotFlow[]
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
  notes?: string
  paymentAmount?: string // optional cash-on-delivery payment (decimal string)
  paymentMethod?: PaymentMethod
  paymentDate?: string // ISO 8601
}

/**
 * POST /shipments/:id/return — log returned bags (re-enter packed stock).
 * TODO: verify against Swagger.
 */
export interface LogReturnDto {
  notes?: string
}

/**
 * PATCH /workers/:id/rates — replaces the entire per-bag-type rate array.
 * TODO: verify against Swagger.
 */
export interface UpdateWorkerRatesDto {
  ratesPerBagType: WorkerRate[]
}

/**
 * GET /workers/:id/performance — employee performance analytics (Employee
 * Profile audit, 2026-09-07). Bags/rate/earnings come from
 * PackingSession.bagsOutput's per-line snapshotted rate — never the current
 * BagType/Worker rate config, which can't reprice a past session. A working
 * day is a distinct PackingSession.date; two sessions on the same date count
 * once. `dailyPerformance`/`packingHistory`/`dailyWages` are `null` for an
 * unbounded "all time" request (no dateFrom/dateTo) — only `totals` and
 * `byBagType` (safe aggregates) are ever returned for an unbounded period.
 */
export interface WorkerPerformanceTotals {
  bagsPacked: number
  sessions: number
  workingDays: number
  packingEarnings: string // Decimal
  avgBagsPerWorkingDay: string | null // Decimal
  avgBagsPerSession: string | null // Decimal
  avgEarningsPerWorkingDay: string | null // Decimal
  avgEarningsPerSession: string | null // Decimal
}

export interface WorkerPerformanceByBagType {
  bagTypeId: string
  bagTypeName: string
  bags: number
  /** Qty-weighted average of the real snapshotted rates actually used — equals the single configured rate unless it changed mid-period. */
  ratePerBag: string // Decimal
  /** True if this bag type's snapshotted rate differed across sessions within the period. */
  rateVaries: boolean
  earned: string // Decimal
  workingDays: number
  avgBagsPerWorkingDay: string | null // Decimal
}

export interface WorkerDailyPerformance {
  date: string // ISO date
  bagsPacked: number
  sessions: number
  earned: string // Decimal
}

export interface WorkerPackingHistoryEntry {
  date: string // ISO date
  sessionId: string
  bagTypeId: string
  bagTypeName: string
  quantity: number
  ratePerBag: string // Decimal — the historical snapshot, not the current rate
  earned: string // Decimal
}

export interface WorkerDailyWage {
  id: string
  date: string // ISO date
  amount: string // Decimal
}

export interface WorkerPerformance {
  workerId: string
  from: string | null
  to: string | null
  totals: WorkerPerformanceTotals
  byBagType: WorkerPerformanceByBagType[]
  dailyPerformance: WorkerDailyPerformance[] | null
  packingHistory: WorkerPackingHistoryEntry[] | null
  dailyWages: WorkerDailyWage[] | null
  paymentsTotal: string // Decimal
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
  items: { packedStockId: string; actualQuantity: number }[]
}

/**
 * PATCH /containers/:containerId/product-lines/:lineId — partial update of a
 * container product line. All fields optional (PartialType of the create DTO).
 * TODO: verify against Swagger.
 */
export interface UpdateContainerProductLineDto {
  charcoalType?: string
  grade?: string
  supplierId?: string
  paidBags?: number
  giftBags?: number
  kgPerBag?: string
  pricePerTon?: string
}

/**
 * PATCH /containers/:containerId/expenses/:expenseId — partial update of a
 * container expense. All fields optional (PartialType of the create DTO).
 * TODO: verify against Swagger.
 */
export interface UpdateContainerExpenseDto {
  description?: string
  amount?: string
}
