// ─────────────────────────────────────────────────────────────────────────────
// Delivery Service
// Covers: shipments, driver trips, stock exits, and suppliers.
// ─────────────────────────────────────────────────────────────────────────────

import { get, post, patch, del, buildQuery } from "./api";
import type {
  Shipment,
  DriverTrip,
  StockExit,
  Supplier,
  PaginatedResponse,
  CreateShipmentRequest,
  UpdateShipmentRequest,
  ConfirmDeliveryRequest,
  LogReturnRequest,
  CreateDriverTripRequest,
  UpdateDriverTripRequest,
  CreateStockExitRequest,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  ShipmentStatus,
  TripStatus,
  ExitType,
} from "../types/api";

export const deliveryService = {
  // ── Shipments ─────────────────────────────────────────────────────────────

  /** List shipments with optional filters. */
  listShipments(params: {
    page?: number;
    limit?: number;
    orderId?: string;
    tripId?: string;
    status?: ShipmentStatus;
    driverId?: string;
  } = {}): Promise<PaginatedResponse<Shipment>> {
    return get(`/shipments${buildQuery(params)}`);
  },

  /** Get a single shipment with its bags breakdown. */
  getShipment(id: string): Promise<Shipment> {
    return get(`/shipments/${id}`);
  },

  /** Create a shipment within an order. Sales_rep or owner.
   *  Server validates: total bags <= available packed stock per bag type (CONSTRAINT 4). */
  createShipment(data: CreateShipmentRequest): Promise<Shipment> {
    return post("/shipments", data);
  },

  /** Update shipment (address, assign to trip, log actual weight, status). */
  updateShipment(id: string, data: UpdateShipmentRequest): Promise<Shipment> {
    return patch(`/shipments/${id}`, data);
  },

  /** Driver logs actual weight at loading. Driver role only. */
  logActualWeight(id: string, actualKg: string): Promise<Shipment> {
    return patch(`/shipments/${id}/actual-weight`, { actualKg });
  },

  /** Driver confirms delivery at a stop. Driver role only.
   *  - Sets status = "delivered", stamps deliveredAt
   *  - Removes bags from packed stock
   *  - Updates order and invoice status
   *  - Optionally logs a payment if paid on delivery */
  confirmDelivery(id: string, data: ConfirmDeliveryRequest): Promise<Shipment> {
    return post(`/shipments/${id}/confirm-delivery`, data);
  },

  /** Driver logs a return. Driver role only.
   *  Returned bags re-enter packed stock as a new PackedStock record. */
  logReturn(id: string, data: LogReturnRequest): Promise<Shipment> {
    return post(`/shipments/${id}/return`, data);
  },

  // ── Driver Trips ──────────────────────────────────────────────────────────

  /** List driver trips. Drivers see their own; owner/sales_rep see all. */
  listTrips(params: {
    page?: number;
    limit?: number;
    driverId?: string;
    status?: TripStatus;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<DriverTrip>> {
    return get(`/driver-trips${buildQuery(params)}`);
  },

  /** Get a single trip with all shipments and stops. */
  getTrip(id: string): Promise<DriverTrip> {
    return get(`/driver-trips/${id}`);
  },

  /** Create a driver trip and assign shipments to it. Owner or sales_rep. */
  createTrip(data: CreateDriverTripRequest): Promise<DriverTrip> {
    return post("/driver-trips", data);
  },

  /** Update trip status, fuel cost, other expenses, timestamps. Driver or owner. */
  updateTrip(id: string, data: UpdateDriverTripRequest): Promise<DriverTrip> {
    return patch(`/driver-trips/${id}`, data);
  },

  /** Start a trip (status → in_progress, stamp startedAt). Driver only. */
  startTrip(id: string): Promise<DriverTrip> {
    return post(`/driver-trips/${id}/start`);
  },

  /** Complete a trip (status → completed, stamp completedAt). Driver or owner. */
  completeTrip(id: string, data: { fuelCost?: string; otherExpenses?: { description: string; amount: string }[] }): Promise<DriverTrip> {
    return post(`/driver-trips/${id}/complete`, data);
  },

  /** Get the receipt data for printing at delivery. Driver only. */
  getDeliveryReceipt(shipmentId: string): Promise<{
    receiptId: string;
    companyName: string;
    date: string;
    time: string;
    clientName: string;
    address: string;
    lines: { bagTypeName: string; quantity: number; pricePerBag: string; lineTotal: string }[];
    subtotal: string;
    currency: string;
    paymentStatus: "paid" | "on_account";
    driverName: string;
  }> {
    return get(`/shipments/${shipmentId}/receipt`);
  },

  // ── Stock Exits ───────────────────────────────────────────────────────────

  /** List stock exits. All exits for audit; filter by type for specific views. */
  listStockExits(params: {
    page?: number;
    limit?: number;
    exitType?: ExitType;
    bagTypeId?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<StockExit>> {
    return get(`/stock-exits${buildQuery(params)}`);
  },

  /** Log a non-sale stock exit (sample, gift, internal, client_bags_fill).
   *  Worker or owner. Reduces packed stock qty. */
  createStockExit(data: CreateStockExitRequest): Promise<StockExit> {
    return post("/stock-exits", data);
  },

  // ── Suppliers ─────────────────────────────────────────────────────────────

  /** List all suppliers. */
  listSuppliers(params: { page?: number; limit?: number; search?: string } = {}): Promise<PaginatedResponse<Supplier>> {
    return get(`/suppliers${buildQuery(params)}`);
  },

  /** Get a single supplier with purchase history. */
  getSupplier(id: string): Promise<Supplier> {
    return get(`/suppliers/${id}`);
  },

  /** Create a supplier. Owner or accountant. */
  createSupplier(data: CreateSupplierRequest): Promise<Supplier> {
    return post("/suppliers", data);
  },

  /** Update supplier profile. Owner or accountant. */
  updateSupplier(id: string, data: UpdateSupplierRequest): Promise<Supplier> {
    return patch(`/suppliers/${id}`, data);
  },

  /** Delete a supplier. Only if no containers or lots are linked. Owner only. */
  deleteSupplier(id: string): Promise<void> {
    return del(`/suppliers/${id}`);
  },
};
