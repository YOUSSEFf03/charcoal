// ─────────────────────────────────────────────────────────────────────────────
// Containers Service
// Covers: containers, product lines, expenses, discounts, stock lot creation.
// Roles: owner (full), accountant (read + expenses), sales_rep (read only)
// ─────────────────────────────────────────────────────────────────────────────

import { get, post, put, patch, del, buildQuery } from "./api";
import type {
  Container,
  ContainerProductLine,
  ContainerExpense,
  ContainerDiscount,
  StockLot,
  PaginatedResponse,
  CreateContainerRequest,
  UpdateContainerRequest,
  CreateProductLineRequest,
  UpdateProductLineRequest,
  CreateContainerExpenseRequest,
  UpdateContainerExpenseRequest,
  UpsertContainerDiscountRequest,
} from "../types/api";

// ── Containers ─────────────────────────────────────────────────────────────────

export interface ListContainersParams {
  page?: number;
  limit?: number;
  status?: string;
  supplierId?: string;
  search?: string;
}

export const containersService = {
  /** List all containers with pagination and optional filters. */
  list(params: ListContainersParams = {}): Promise<PaginatedResponse<Container>> {
    return get(`/containers${buildQuery(params)}`);
  },

  /** Get a single container with all product lines, expenses, discount, and computed totals. */
  getById(id: string): Promise<Container> {
    return get(`/containers/${id}`);
  },

  /** Create a new container. Owner only. */
  create(data: CreateContainerRequest): Promise<Container> {
    return post("/containers", data);
  },

  /** Update container fields (number, status, notes, arrivalDate). Owner only.
   *  Changing status to "arrived" triggers auto-creation of stock lots. */
  update(id: string, data: UpdateContainerRequest): Promise<Container> {
    return patch(`/containers/${id}`, data);
  },

  /** Delete a container. Only allowed if status is not "arrived". Owner only. */
  delete(id: string): Promise<void> {
    return del(`/containers/${id}`);
  },

  // ── Product Lines ─────────────────────────────────────────────────────────

  /** Get all product lines for a container with computed cost fields. */
  getProductLines(containerId: string): Promise<ContainerProductLine[]> {
    return get(`/containers/${containerId}/product-lines`);
  },

  /** Add a product line to a container. Owner only. */
  addProductLine(containerId: string, data: CreateProductLineRequest): Promise<ContainerProductLine> {
    return post(`/containers/${containerId}/product-lines`, data);
  },

  /** Update a product line. Owner only. Triggers cost recalculation. */
  updateProductLine(
    containerId: string,
    lineId: string,
    data: UpdateProductLineRequest
  ): Promise<ContainerProductLine> {
    return patch(`/containers/${containerId}/product-lines/${lineId}`, data);
  },

  /** Remove a product line. Only allowed before container arrival. Owner only. */
  deleteProductLine(containerId: string, lineId: string): Promise<void> {
    return del(`/containers/${containerId}/product-lines/${lineId}`);
  },

  // ── Expenses ──────────────────────────────────────────────────────────────

  /** List all expenses for a container. */
  getExpenses(containerId: string): Promise<ContainerExpense[]> {
    return get(`/containers/${containerId}/expenses`);
  },

  /** Add an expense to a container. Owner or accountant.
   *  Can be added after arrival — triggers cost_per_kg recalculation on all linked lots. */
  addExpense(containerId: string, data: CreateContainerExpenseRequest): Promise<ContainerExpense> {
    return post(`/containers/${containerId}/expenses`, data);
  },

  /** Update an expense. Owner or accountant. Triggers recalculation. */
  updateExpense(
    containerId: string,
    expenseId: string,
    data: UpdateContainerExpenseRequest
  ): Promise<ContainerExpense> {
    return patch(`/containers/${containerId}/expenses/${expenseId}`, data);
  },

  /** Delete an expense. Owner only. Triggers recalculation. */
  deleteExpense(containerId: string, expenseId: string): Promise<void> {
    return del(`/containers/${containerId}/expenses/${expenseId}`);
  },

  // ── Discount ──────────────────────────────────────────────────────────────

  /** Get the discount for a container. */
  getDiscount(containerId: string): Promise<ContainerDiscount | null> {
    return get(`/containers/${containerId}/discount`);
  },

  /** Create or update the discount for a container. Owner only. */
  upsertDiscount(containerId: string, data: UpsertContainerDiscountRequest): Promise<ContainerDiscount> {
    return put(`/containers/${containerId}/discount`, data);
  },

  /** Remove the discount. Owner only. */
  deleteDiscount(containerId: string): Promise<void> {
    return del(`/containers/${containerId}/discount`);
  },

  // ── Stock lots created by this container ──────────────────────────────────

  /** Get all stock lots that were created when this container arrived. */
  getStockLots(containerId: string): Promise<StockLot[]> {
    return get(`/containers/${containerId}/stock-lots`);
  },
};
