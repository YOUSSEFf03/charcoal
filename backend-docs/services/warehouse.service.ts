// ─────────────────────────────────────────────────────────────────────────────
// Warehouse Service
// Covers: stock lots, bag types, bag purchases, packed stock, packing sessions,
//         stock adjustments, and the warehouse summary.
// ─────────────────────────────────────────────────────────────────────────────

import { get, post, patch, del, buildQuery } from "./api";
import type {
  StockLot,
  BagType,
  BagPurchase,
  PackedStock,
  PackedStockSummary,
  PackingSession,
  StockAdjustment,
  Worker,
  WorkerPayment,
  PaginatedResponse,
  CreateDirectStockLotRequest,
  CreateBagTypeRequest,
  UpdateBagTypeRequest,
  CreateBagPurchaseRequest,
  CreatePackingSessionRequest,
  CreateStockAdjustmentRequest,
  CreateWorkerRequest,
  UpdateWorkerRequest,
  SetWorkerRatesRequest,
  CreateWorkerPaymentRequest,
} from "../types/api";

// ── Stock Lots ─────────────────────────────────────────────────────────────────

export interface ListStockLotsParams {
  page?: number;
  limit?: number;
  charcoalType?: string;
  grade?: string;
  supplierId?: string;
  source?: string;
  hasStock?: boolean; // filter to lots with kgRemaining > 0
}

export const warehouseService = {
  // ── Stock Lots ────────────────────────────────────────────────────────────

  /** List all stock lots with optional filters. */
  listLots(params: ListStockLotsParams = {}): Promise<PaginatedResponse<StockLot>> {
    return get(`/stock-lots${buildQuery(params)}`);
  },

  /** Get a single stock lot. */
  getLot(id: string): Promise<StockLot> {
    return get(`/stock-lots/${id}`);
  },

  /** Create a direct stock lot (source = "direct", no container). Owner only. */
  createDirectLot(data: CreateDirectStockLotRequest): Promise<StockLot> {
    return post("/stock-lots", data);
  },

  /** Get warehouse summary: total raw kg, packed stock counts, total system kg. */
  getSummary(): Promise<{
    totalRawKg: string;
    totalPackedNominalKg: string;
    totalSystemKg: string;
    lotCount: number;
    packedSummary: PackedStockSummary[];
  }> {
    return get("/warehouse/summary");
  },

  // ── Bag Types ─────────────────────────────────────────────────────────────

  /** List all bag types. */
  listBagTypes(): Promise<BagType[]> {
    return get("/bag-types");
  },

  /** Get a single bag type. */
  getBagType(id: string): Promise<BagType> {
    return get(`/bag-types/${id}`);
  },

  /** Create a bag type. Owner only. */
  createBagType(data: CreateBagTypeRequest): Promise<BagType> {
    return post("/bag-types", data);
  },

  /** Update a bag type (name, nominalKg, costPerBag, workerRate). Owner only. */
  updateBagType(id: string, data: UpdateBagTypeRequest): Promise<BagType> {
    return patch(`/bag-types/${id}`, data);
  },

  /** Delete a bag type. Only if no packed stock or sessions reference it. Owner only. */
  deleteBagType(id: string): Promise<void> {
    return del(`/bag-types/${id}`);
  },

  // ── Bag Purchases ─────────────────────────────────────────────────────────

  /** List bag purchases with optional pagination. */
  listBagPurchases(params: { page?: number; limit?: number; bagTypeId?: string } = {}): Promise<PaginatedResponse<BagPurchase>> {
    return get(`/bag-purchases${buildQuery(params)}`);
  },

  /** Log a new bag purchase. Owner or accountant. */
  createBagPurchase(data: CreateBagPurchaseRequest): Promise<BagPurchase> {
    return post("/bag-purchases", data);
  },

  // ── Packed Stock ──────────────────────────────────────────────────────────

  /** List all packed stock records. */
  listPackedStock(params: { bagTypeId?: string; lotId?: string } = {}): Promise<PackedStock[]> {
    return get(`/packed-stock${buildQuery(params)}`);
  },

  /** Get packed stock summary grouped by bag type. */
  getPackedStockSummary(): Promise<PackedStockSummary[]> {
    return get("/packed-stock/summary");
  },

  // ── Packing Sessions ──────────────────────────────────────────────────────

  /** List packing sessions. Workers see their own only; owner sees all. */
  listSessions(params: {
    page?: number;
    limit?: number;
    workerId?: string;
    lotId?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<PackingSession>> {
    return get(`/packing-sessions${buildQuery(params)}`);
  },

  /** Get a single packing session. */
  getSession(id: string): Promise<PackingSession> {
    return get(`/packing-sessions/${id}`);
  },

  /** Create and complete a packing session. Worker or owner.
   *
   *  Business rules enforced:
   *  - kgConsumed <= lot.kgRemaining
   *  - varianceKg < 0 requires varianceNote
   *  - Immediately reduces lot.kgRemaining
   *  - Creates packed stock records
   *  - Updates worker totalEarned and totalBagsPacked */
  createSession(data: CreatePackingSessionRequest): Promise<PackingSession> {
    return post("/packing-sessions", data);
  },

  // ── Stock Adjustments ─────────────────────────────────────────────────────

  /** List all stock adjustments. Owner only. */
  listAdjustments(params: {
    page?: number;
    limit?: number;
    adjustmentType?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<StockAdjustment>> {
    return get(`/stock-adjustments${buildQuery(params)}`);
  },

  /** Create a stock adjustment (physical count result). Owner only.
   *  Server computes qtyBefore, difference, and sets approvedById = caller. */
  createAdjustment(data: CreateStockAdjustmentRequest): Promise<StockAdjustment> {
    return post("/stock-adjustments", data);
  },

  // ── Workers ───────────────────────────────────────────────────────────────

  /** List all workers. Owner only. */
  listWorkers(): Promise<Worker[]> {
    return get("/workers");
  },

  /** Get a single worker. Owner only. */
  getWorker(id: string): Promise<Worker> {
    return get(`/workers/${id}`);
  },

  /** Create a worker profile. Owner only. */
  createWorker(data: CreateWorkerRequest): Promise<Worker> {
    return post("/workers", data);
  },

  /** Update worker name/phone/notes. Owner only. */
  updateWorker(id: string, data: UpdateWorkerRequest): Promise<Worker> {
    return patch(`/workers/${id}`, data);
  },

  /** Set the worker's rate per bag type. Owner only. Replaces the entire rates array. */
  setWorkerRates(id: string, data: SetWorkerRatesRequest): Promise<Worker> {
    return patch(`/workers/${id}/rates`, data);
  },

  /** List payments made to a worker. Owner only. */
  listWorkerPayments(workerId: string): Promise<WorkerPayment[]> {
    return get(`/workers/${workerId}/payments`);
  },

  /** Log a payment to the worker. Owner only. Updates worker.totalPaid. */
  createWorkerPayment(workerId: string, data: CreateWorkerPaymentRequest): Promise<WorkerPayment> {
    return post(`/workers/${workerId}/payments`, data);
  },
};
