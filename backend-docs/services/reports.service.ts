// ─────────────────────────────────────────────────────────────────────────────
// Reports Service
// Covers all 7 report endpoints. Role gating is enforced server-side.
// - owner: all reports including gross profit and cost_per_kg
// - accountant: all except gross profit
// - sales_rep: client ledger only
// ─────────────────────────────────────────────────────────────────────────────

import { get, post, buildQuery } from "./api";
import type {
  ProfitLossReport,
  StockValueReport,
  VarianceReport,
  ClientLedger,
  WorkerEarningsReport,
  ContainerCostReport,
  PhysicalCountItem,
  SubmitPhysicalCountRequest,
  ReportFilters,
} from "../types/api";

export const reportsService = {
  /** P&L report. Owner only.
   *  Returns: revenue, COGS, bag cost, variance cost, delivery cost, gross profit. */
  getProfitLoss(filters: ReportFilters = {}): Promise<ProfitLossReport> {
    return get(`/reports/profit-loss${buildQuery(filters)}`);
  },

  /** Stock value report. Owner and accountant.
   *  Returns: raw stock value + packed stock value per lot and bag type. */
  getStockValue(): Promise<StockValueReport> {
    return get("/reports/stock-value");
  },

  /** Variance report. Owner and accountant.
   *  Returns: per session, per charcoal type, and per worker variance summaries. */
  getVariance(filters: ReportFilters = {}): Promise<VarianceReport> {
    return get(`/reports/variance${buildQuery(filters)}`);
  },

  /** Client ledger report. Owner, accountant, and sales_rep.
   *  Returns: all invoices and payments with running balance for a specific client. */
  getClientLedger(clientId: string, filters: ReportFilters = {}): Promise<ClientLedger> {
    return get(`/reports/client-ledger/${clientId}${buildQuery(filters)}`);
  },

  /** Worker earnings report. Owner only.
   *  Returns: bags packed by type, rates, earned, paid, owed. */
  getWorkerEarnings(workerId: string, filters: ReportFilters = {}): Promise<WorkerEarningsReport> {
    return get(`/reports/worker-earnings/${workerId}${buildQuery(filters)}`);
  },

  /** Container cost report. Owner and accountant.
   *  Returns: full cost breakdown per container and product line. */
  getContainerCosts(filters: { dateFrom?: string; dateTo?: string; supplierId?: string } = {}): Promise<ContainerCostReport> {
    return get(`/reports/container-costs${buildQuery(filters)}`);
  },

  // ── Physical Stock Count ──────────────────────────────────────────────────

  /** Get current system quantities for all lots and packed stock items.
   *  Owner only — used as starting point for a physical count. */
  getPhysicalCountItems(): Promise<PhysicalCountItem[]> {
    return get("/reports/physical-count");
  },

  /** Submit the physical count results. Owner only.
   *  For each item where countedQty !== systemQty, creates a StockAdjustment. */
  submitPhysicalCount(data: SubmitPhysicalCountRequest): Promise<{
    adjustmentsCreated: number;
    adjustments: { id: string; type: string; name: string; before: string; after: string; difference: string }[];
  }> {
    return post("/reports/physical-count", data);
  },
};
