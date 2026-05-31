// ─────────────────────────────────────────────────────────────────────────────
// Clients Service
// Covers: clients, orders, order bag lines, invoices, payments.
// ─────────────────────────────────────────────────────────────────────────────

import { get, post, patch, del, buildQuery } from "./api";
import type {
  Client,
  ClientOrder,
  Invoice,
  Payment,
  CRMOverdueClient,
  PaginatedResponse,
  CreateClientRequest,
  UpdateClientRequest,
  AddClientPhoneRequest,
  CreateClientOrderRequest,
  UpdateClientOrderRequest,
  CreateInvoiceRequest,
  UpdateInvoiceRequest,
  IssueInvoiceRequest,
  CreatePaymentRequest,
  ClientType,
  OrderStatus,
  InvoiceStatus,
} from "../types/api";

// ── Clients ───────────────────────────────────────────────────────────────────

export interface ListClientsParams {
  page?: number;
  limit?: number;
  type?: ClientType;
  search?: string;     // searches name
  withBalance?: boolean; // include computed balance field
}

export const clientsService = {
  // ── Clients ───────────────────────────────────────────────────────────────

  /** List clients. Owner and sales_rep only. */
  list(params: ListClientsParams = {}): Promise<PaginatedResponse<Client>> {
    return get(`/clients${buildQuery(params)}`);
  },

  /** Get a single client with full profile and computed balance. */
  getById(id: string): Promise<Client> {
    return get(`/clients/${id}`);
  },

  /** Create a new client. Owner or sales_rep. */
  create(data: CreateClientRequest): Promise<Client> {
    return post("/clients", data);
  },

  /** Update client fields. Owner or sales_rep. */
  update(id: string, data: UpdateClientRequest): Promise<Client> {
    return patch(`/clients/${id}`, data);
  },

  /** Add a phone number to a client. Existing phones are never deleted. */
  addPhone(id: string, data: AddClientPhoneRequest): Promise<Client> {
    return post(`/clients/${id}/phones`, data);
  },

  /** Mark a client phone as inactive (NEVER deletes it — CONSTRAINT 14). */
  deactivatePhone(clientId: string, phoneNumber: string): Promise<Client> {
    return patch(`/clients/${clientId}/phones/deactivate`, { phoneNumber });
  },

  /** Get the CRM overdue list — clients who haven't ordered past their avg interval.
   *  Owner and sales_rep only. */
  getOverdue(): Promise<CRMOverdueClient[]> {
    return get("/clients/overdue");
  },

  // ── Orders ────────────────────────────────────────────────────────────────

  /** List all orders. Owner and sales_rep; optionally filtered. */
  listOrders(params: {
    page?: number;
    limit?: number;
    clientId?: string;
    status?: OrderStatus;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<ClientOrder>> {
    return get(`/orders${buildQuery(params)}`);
  },

  /** Get a single order with shipments and bag lines. */
  getOrder(id: string): Promise<ClientOrder> {
    return get(`/orders/${id}`);
  },

  /** Create a new order. Owner or sales_rep.
   *  Price is set at time of sale — no pre-set price list (CONSTRAINT 10). */
  createOrder(data: CreateClientOrderRequest): Promise<ClientOrder> {
    return post("/orders", data);
  },

  /** Update order fields or status. Owner or sales_rep. */
  updateOrder(id: string, data: UpdateClientOrderRequest): Promise<ClientOrder> {
    return patch(`/orders/${id}`, data);
  },

  /** Delete a draft order. Owner only. Cannot delete confirmed or delivered orders. */
  deleteOrder(id: string): Promise<void> {
    return del(`/orders/${id}`);
  },

  /** Get all orders for a specific client. */
  getClientOrders(
    clientId: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<PaginatedResponse<ClientOrder>> {
    return get(`/clients/${clientId}/orders${buildQuery(params)}`);
  },

  // ── Invoices ──────────────────────────────────────────────────────────────

  /** List invoices with optional filters. Owner, accountant, sales_rep. */
  listInvoices(params: {
    page?: number;
    limit?: number;
    clientId?: string;
    status?: InvoiceStatus;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<Invoice>> {
    return get(`/invoices${buildQuery(params)}`);
  },

  /** Get a single invoice with payment history. */
  getInvoice(id: string): Promise<Invoice> {
    return get(`/invoices/${id}`);
  },

  /** Create a draft invoice. Owner, accountant, or sales_rep. */
  createInvoice(data: CreateInvoiceRequest): Promise<Invoice> {
    return post("/invoices", data);
  },

  /** Update invoice fields (status, dueDate). */
  updateInvoice(id: string, data: UpdateInvoiceRequest): Promise<Invoice> {
    return patch(`/invoices/${id}`, data);
  },

  /** Issue an invoice (set status to "issued", stamp issuedAt). */
  issueInvoice(id: string, data?: IssueInvoiceRequest): Promise<Invoice> {
    return post(`/invoices/${id}/issue`, data);
  },

  /** Cancel an invoice. Owner only. */
  cancelInvoice(id: string): Promise<Invoice> {
    return post(`/invoices/${id}/cancel`);
  },

  /** Get all invoices for a client. */
  getClientInvoices(
    clientId: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<PaginatedResponse<Invoice>> {
    return get(`/clients/${clientId}/invoices${buildQuery(params)}`);
  },

  // ── Payments ──────────────────────────────────────────────────────────────

  /** List all payments with optional filters. Owner, accountant, sales_rep. */
  listPayments(params: {
    page?: number;
    limit?: number;
    clientId?: string;
    invoiceId?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<PaginatedResponse<Payment>> {
    return get(`/payments${buildQuery(params)}`);
  },

  /** Get a single payment. */
  getPayment(id: string): Promise<Payment> {
    return get(`/payments/${id}`);
  },

  /** Log a payment from a client. Owner, accountant, or sales_rep.
   *  Updates client.balance and invoice.paidAmount automatically. */
  createPayment(data: CreatePaymentRequest): Promise<Payment> {
    return post("/payments", data);
  },

  /** Get all payments for a client. */
  getClientPayments(
    clientId: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<PaginatedResponse<Payment>> {
    return get(`/clients/${clientId}/payments${buildQuery(params)}`);
  },

  /** Get the running balance for a client.
   *  Returns computed: Σ invoices − Σ payments. Never manually set (CONSTRAINT 15). */
  getClientBalance(clientId: string): Promise<{ balance: string; currency: string }> {
    return get(`/clients/${clientId}/balance`);
  },
};
