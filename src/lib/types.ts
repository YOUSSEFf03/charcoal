// ============================================================================
// Charcoal Business Accounting System — API Type Surface
// ----------------------------------------------------------------------------
// Single source of truth for every request DTO and response interface across
// all 8 modules. Generated from schema.prisma (PostgreSQL + Prisma).
//
// CONVENTIONS
//  - All monetary values are transmitted as STRINGS (Prisma Decimal). Never use
//    `number` for money — JSON floats lose precision. Parse client-side.
//  - All timestamps are ISO 8601 strings (e.g. "2026-05-26T14:30:00.000Z").
//  - Date-only fields (Prisma @db.Date) are "YYYY-MM-DD" strings.
//  - All IDs are UUID v4 strings.
//  - Fields marked `// AR` accept Arabic (UTF-8) input.
// ============================================================================

// ----------------------------------------------------------------------------
// ENUMS (mirror schema.prisma exactly)
// ----------------------------------------------------------------------------

export type Role = 'owner' | 'accountant' | 'sales_rep' | 'worker' | 'driver' | 'receiver';

export type ContainerStatus = 'port' | 'transit' | 'arrived';

export type StockSource = 'container' | 'direct';

export type PackingMode = 'stock' | 'order';

export type ClientType =
  | 'restaurant'
  | 'shop'
  | 'wholesale'
  | 'walk_in'
  | 'corporate'
  | 'export'
  | 'fill_client';

export type Currency = 'USD' | 'LBP';

export type OrderStatus =
  | 'draft'
  | 'confirmed'
  | 'partially_delivered'
  | 'delivered'
  | 'invoiced'
  | 'paid';

export type ShipmentStatus = 'pending' | 'loaded' | 'delivered' | 'returned';

export type TripStatus = 'planned' | 'in_progress' | 'completed';

export type ExitType =
  | 'order'
  | 'walk_in'
  | 'sample'
  | 'gift'
  | 'internal'
  | 'client_bags_fill';

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'cancelled';

export type PaymentMethod = 'cash' | 'whish' | 'omt' | 'bank_transfer' | 'cheque';

export type AdjustmentType = 'lot' | 'packed_stock';

// ----------------------------------------------------------------------------
// SHARED ENVELOPES
// ----------------------------------------------------------------------------

/** Standard list envelope. Every collection GET returns this shape. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number; // total matching rows across all pages
  page: number; // 1-based
  limit: number; // page size
}

/** Standard error envelope. Returned for every non-2xx response. */
export interface ApiError {
  error: string; // human-readable message (English; safe to surface)
  code: string; // machine code, e.g. "VALIDATION_ERROR", "FORBIDDEN"
  details?: Record<string, string[]>; // field-level validation errors
}

/** Common query params accepted by all list endpoints. */
export interface ListQuery {
  page?: number; // default 1
  limit?: number; // default 25, max 100
  search?: string; // free-text search where supported
  sort?: string; // field name; prefix "-" for desc, e.g. "-createdAt"
}

/** Response after uploading a file (e.g. supplier bank doc, receipt). */
export interface FileUploadResponse {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

// ----------------------------------------------------------------------------
// JSON FIELD SHAPES
// ----------------------------------------------------------------------------

export interface ContactPerson {
  name: string; // AR
  phone: string;
  role: string; // AR — e.g. "sales", "logistics"
}

export interface SupplierCharcoalType {
  type: string;
  grade: string;
}

export interface BankDetails {
  bank_name: string;
  account_number: string;
  iban: string;
  swift: string;
}

export type PhoneLabel = 'mobile' | 'office' | 'whatsapp';

export interface ClientPhone {
  number: string;
  label: PhoneLabel;
  isActive: boolean; // never delete — flip to false instead
  dateAdded: string; // ISO date
}

export interface ClientPreferredType {
  charcoalType: string;
  grade: string;
}

export interface BagsOutputLine {
  bagTypeId: string;
  qty: number;
}

export interface TripOtherExpense {
  description: string; // AR
  amount: number;
  /** BUG-M: currency of this expense amount; defaults USD when omitted. */
  currency?: Currency;
}

export interface InvoiceLineItem {
  bagTypeId: string;
  bagTypeName: string;
  qty: number;
  pricePerBag: number;
  lineTotal: number; // qty * pricePerBag
}

export interface WorkerRate {
  bagTypeId: string;
  ratePerBag: string; // Decimal — stored as string via @IsNumberString DTO
}

export interface WorkerBagCount {
  bagTypeId: string;
  count: number;
}

// ----------------------------------------------------------------------------
// AUTH / USERS
// ----------------------------------------------------------------------------

export interface User {
  id: string;
  clerkId: string;
  email: string;
  name: string; // AR
  role: Role;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /auth/me — resolved from the Bearer token. */
export type MeResponse = User;

/** PATCH /users/:id (owner only) — change role / profile. */
export interface UpdateUserDto {
  name?: string;
  role?: Role;
  phone?: string | null;
}

/** Clerk webhook payload (subset we consume). */
export interface ClerkWebhookEvent {
  type: 'user.created' | 'user.updated' | 'user.deleted';
  data: {
    id: string; // clerkId
    email_addresses: { email_address: string; id: string }[];
    first_name: string | null;
    last_name: string | null;
    public_metadata: { role?: Role };
    phone_numbers?: { phone_number: string }[];
  };
}

// ----------------------------------------------------------------------------
// SUPPLIERS
// ----------------------------------------------------------------------------

export interface Supplier {
  id: string;
  name: string; // AR
  country: string;
  contactPersons: ContactPerson[];
  charcoalTypes: SupplierCharcoalType[];
  bankDetails: BankDetails | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  notes: string | null; // AR
  createdAt: string;
  updatedAt: string;
  // enriched by findAll
  totalSpentUsd: string;
  totalPaidUsd: string;
  outstandingUsd: string;
}

export interface CreateSupplierDto {
  name: string; // AR
  country: string;
  contactPersons?: ContactPerson[];
  charcoalTypes?: SupplierCharcoalType[];
  bankDetails?: BankDetails | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
}

export type UpdateSupplierDto = Partial<CreateSupplierDto>;

/** GET /suppliers/:id — includes purchase history rollup. */
export interface SupplierDetail extends Supplier {
  containerCount: number;
  activeLotCount: number;
  totalKgReceived: string;
  totalKgRemaining: string;
  totalSpentUsd: string;
  totalPaidUsd: string;
  outstandingUsd: string;
  avgPricePerKg: string | null;
  purchasedTypes: { type: string; grade: string; totalKg: number; kgRemaining: number }[];
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  containerId: string | null;
  container: { id: string; number: string } | null;
  amount: string;
  currency: Currency;
  method: PaymentMethod;
  date: string;
  notes: string | null;
  loggedById: string;
  loggedBy: { id: string; name: string };
  createdAt: string;
}

export interface CreateSupplierPaymentDto {
  amount: string;
  currency: Currency;
  method: PaymentMethod;
  date: string;
  containerId?: string;
  notes?: string;
}

// ----------------------------------------------------------------------------
// CONTAINERS
// ----------------------------------------------------------------------------

export interface ContainerProductLine {
  id: string;
  containerId: string;
  charcoalType: string;
  grade: string;
  supplierId: string;
  paidBags: number;
  giftBags: number;
  kgPerBag: string; // Decimal — reference only
  pricePerTon: string; // Decimal USD
  createdAt: string;
  updatedAt: string;
  // Computed (owner/accountant only — omitted entirely for other roles)
  computed?: ContainerLineCost;
}

/** Computed cost block. Present only for owner & accountant. */
export interface ContainerLineCost {
  tonnage: string; // paidBags * kgPerBag / 1000
  expenseShare: string;
  discountShare: string;
  allInCostPerTon: string;
  allInCostPerKg: string;
}

export interface ContainerExpense {
  id: string;
  containerId: string;
  description: string; // AR
  amount: string; // Decimal USD
  addedById: string;
  addedAt: string;
}

export interface ContainerDiscount {
  id: string;
  containerId: string;
  amount: string; // Decimal USD
}

export interface Container {
  id: string;
  number: string;
  supplierId: string;
  status: ContainerStatus;
  arrivalDate: string | null; // ISO date
  notes: string | null; // AR
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerDetail extends Container {
  supplier: Pick<Supplier, 'id' | 'name' | 'country'>;
  productLines: ContainerProductLine[];
  expenses: ContainerExpense[];
  discount: ContainerDiscount | null;
  // owner/accountant only
  totals?: {
    totalExpensesUsd: string;
    totalDiscountUsd: string;
    totalTonnage: string;
    grandTotalCostUsd: string;
  };
}

export interface CreateContainerProductLineDto {
  charcoalType: string;
  grade: string;
  supplierId: string;
  paidBags: number;
  giftBags?: number;
  kgPerBag: string;
  pricePerTon: string;
}

export interface CreateContainerDto {
  number: string;
  supplierId: string;
  status?: ContainerStatus; // default "port"
  notes?: string | null;
  productLines: CreateContainerProductLineDto[];
}

export interface UpdateContainerDto {
  number?: string;
  supplierId?: string;
  status?: ContainerStatus;
  arrivalDate?: string;
  notes?: string | null;
}

/** PATCH /containers/:id/status — arrival auto-creates stock lots. */
export interface UpdateContainerStatusDto {
  status: ContainerStatus;
  arrivalDate?: string; // required when status -> "arrived"
}

export interface CreateContainerExpenseDto {
  description: string;
  amount: string; // USD
}

export interface SetContainerDiscountDto {
  amount: string; // USD
}

// ----------------------------------------------------------------------------
// STOCK LOTS
// ----------------------------------------------------------------------------

export interface StockLot {
  id: string;
  charcoalType: string;
  grade: string;
  supplierId: string;
  kgReceived: string; // Decimal
  kgRemaining: string; // Decimal
  costPerKg: string | null; // Decimal — null/omitted for roles without cost access
  source: StockSource;
  containerId: string | null;
  dateReceived: string; // ISO date
  notes: string | null; // AR
  createdAt: string;
  updatedAt: string;
}

/** Direct lot creation (source = "direct"). Container lots are auto-created. */
export interface CreateStockLotDto {
  charcoalType: string;
  grade: string;
  supplierId: string;
  kgReceived: string;
  costPerKg: string; // owner only
  dateReceived: string;
  notes?: string | null;
}

export interface UpdateStockLotDto {
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// BAG TYPES & BAG PURCHASES
// ----------------------------------------------------------------------------

export interface BagType {
  id: string;
  name: string;
  nominalKg: string; // Decimal
  costPerBag: string | null; // Decimal — cost hidden from non-cost roles
  workerRate: string | null; // Decimal — hidden from non-cost roles
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBagTypeDto {
  name: string;
  nominalKg: string;
  costPerBag: string;
  workerRate: string;
  note?: string | null;
}

export type UpdateBagTypeDto = Partial<CreateBagTypeDto>;

export interface BagPurchase {
  id: string;
  bagTypeId: string;
  quantity: number;
  unitCost: string; // Decimal
  totalCost: string; // Decimal — quantity * unitCost
  /** BUG-L: currency of unitCost/totalCost; defaults USD. */
  currency: Currency;
  date: string; // ISO date
  addedById: string;
  notes: string | null;
}

export interface CreateBagPurchaseDto {
  bagTypeId: string;
  quantity: number;
  unitCost: string;
  /** BUG-L: currency of the cost; defaults USD when omitted. */
  currency?: Currency;
  date: string;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// PACKED STOCK
// ----------------------------------------------------------------------------

export interface PackedStock {
  id: string;
  lotId: string;
  bagTypeId: string;
  quantity: number;
  /** Bags committed to pending shipments — not available for sale/exit (free = quantity − reservedQuantity). */
  reservedQuantity: number;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

/** Aggregated packed inventory per bag type (Zone 2 view). */
export interface PackedStockSummary {
  bagTypeId: string;
  bagTypeName: string;
  totalBags: number;
  /** Bags reserved for pending shipments. */
  reservedBags: number;
  /** Bags free to sell/exit (totalBags − reservedBags, floored at 0). */
  availableBags: number;
  totalNominalKg: string;
}

// ----------------------------------------------------------------------------
// PACKING SESSIONS
// ----------------------------------------------------------------------------

export interface PackingSessionLot {
  id: string;
  sessionId: string;
  lotId: string;
  kgUsed: string; // Decimal
  lot?: { id: string; charcoalType: string; grade: string; costPerKg: string | null };
}

export interface PackingSession {
  id: string;
  workerId: string;
  workerEntityId?: string | null;
  mode: PackingMode;
  orderId: string | null;
  kgConsumed: string; // Decimal — total consumed across all lots (denormalized sum)
  sessionLots: PackingSessionLot[];
  bagsOutput: BagsOutputLine[];
  kgOutputTotal: string; // Decimal (computed)
  varianceKg: string; // Decimal (computed: kgConsumed - kgOutputTotal = waste)
  varianceNote: string | null;
  sessionEarnings: string | null; // Decimal — hidden from non-cost roles
  date: string; // ISO date
  startedAt: string;
  completedAt: string | null;
  notes: string | null;
  worker?: { id: string; name: string; email: string };
  workerEntity?: { id: string; name: string } | null;
}

/**
 * POST /packing-sessions — opens a session. kgConsumed is deducted from
 * lot.kgRemaining immediately (CONSTRAINT 3 enforced here).
 */
export interface PackingSessionLotInput {
  lotId: string;
  kg: string; // decimal string
}

export interface CreatePackingSessionDto {
  lotInputs: PackingSessionLotInput[]; // required, at least 1 lot
  bagsOutput: { bagTypeId: string; qty: number }[];
  varianceNote?: string | null;
  date?: string;
  notes?: string | null;
  workerEntityId?: string;
}

export interface UpdatePackingSessionDto {
  lotInputs?: PackingSessionLotInput[];
  bagsOutput?: { bagTypeId: string; qty: number }[];
  varianceNote?: string;
  date?: string;
  notes?: string;
  /** Empty string = clear worker entity */
  workerEntityId?: string;
}

/**
 * PATCH /packing-sessions/:id/complete — closes a session, writes packed
 * stock, computes variance & earnings. varianceNote required if variance < 0.
 */
export interface CompletePackingSessionDto {
  bagsOutput: BagsOutputLine[];
  varianceNote?: string | null;
}

// ----------------------------------------------------------------------------
// STOCK ADJUSTMENTS
// ----------------------------------------------------------------------------

export interface StockAdjustment {
  id: string;
  adjustmentType: AdjustmentType;
  lotId: string | null;
  packedStockId: string | null;
  qtyBefore: string; // Decimal
  qtyAfter: string; // Decimal
  difference: string; // Decimal
  reason: string; // AR
  countedById: string;
  approvedById: string; // owner only
  date: string; // ISO date
  createdAt: string;
}

/** POST /stock-adjustments — owner approval required (CONSTRAINT 6, 13). */
export interface CreateStockAdjustmentDto {
  adjustmentType: AdjustmentType;
  lotId?: string; // required when type = "lot"
  packedStockId?: string; // required when type = "packed_stock"
  qtyAfter: string; // qtyBefore + difference resolved server-side
  reason: string;
  date: string;
}

// ----------------------------------------------------------------------------
// CLIENTS
// ----------------------------------------------------------------------------

export interface Client {
  id: string;
  name: string; // AR
  type: ClientType;
  currency: Currency;
  phones: ClientPhone[];
  preferredTypes: ClientPreferredType[];
  avgOrderDays: string | null; // Decimal (computed)
  lastOrderDate: string | null; // ISO date (computed)
  paymentTerms: string | null;
  notes: string | null; // AR
  createdAt: string;
  updatedAt: string;
  // Computed (CONSTRAINT 15)
  balance: string; // Decimal — Σ invoice.total − Σ payment.amount
  isOverdue: boolean; // CRM alert flag
}

export interface CreateClientDto {
  name: string;
  type: ClientType;
  currency: Currency;
  phones?: ClientPhone[];
  preferredTypes?: ClientPreferredType[];
  paymentTerms?: string | null;
  notes?: string | null;
}

export type UpdateClientDto = Partial<CreateClientDto> & { isActive?: boolean };

/** POST /clients/:id/phones — add a number (never deletes — CONSTRAINT 14). */
export interface AddClientPhoneDto {
  number: string;
  label: PhoneLabel;
}

/** PATCH /clients/:id/phones/:number — only allowed change is isActive. */
export interface ToggleClientPhoneDto {
  isActive: boolean;
}

export interface ClientLedgerEntry {
  date: string;
  type: 'invoice' | 'payment';
  reference: string; // invoice id or payment id
  debit: string; // invoice total
  credit: string; // payment amount
  runningBalance: string;
}

export interface ClientLedger {
  clientId: string;
  currency: Currency;
  entries: ClientLedgerEntry[];
  balance: string;
}

// ----------------------------------------------------------------------------
// ORDERS
// ----------------------------------------------------------------------------

export interface OrderBagLine {
  id: string;
  orderId: string;
  bagTypeId: string;
  quantity: number;
}

export interface ClientOrder {
  id: string;
  clientId: string;
  charcoalType: string;
  grade: string;
  totalKgRequested: string; // Decimal
  bagTypeId: string | null;
  bagType: { id: string; name: string; nominalKg: string } | null;
  pricePerBag: string; // Decimal
  currency: Currency;
  status: OrderStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  supplierName: string | null;
  driverId: string | null;
}

export interface ClientOrderDetail extends ClientOrder {
  client: Pick<Client, 'id' | 'name' | 'type' | 'currency'>;
  bagType: { id: string; name: string; nominalKg: string } | null;
  driver: { id: string; name: string } | null;
  bagLines: OrderBagLine[];
  shipments: Shipment[];
  invoices: Invoice[];
}

export interface CreateOrderBagLineDto {
  bagTypeId: string;
  quantity: number;
}

export interface CreateOrderDto {
  clientId: string;
  charcoalType: string;
  grade: string;
  totalKgRequested: string;
  bagTypeId?: string | null;
  pricePerBag: string;
  currency?: Currency;
  bagLines?: CreateOrderBagLineDto[];
  notes?: string | null;
  driverId?: string;
  supplierName?: string;
}

export interface UpdateOrderDto {
  charcoalType?: string;
  grade?: string;
  totalKgRequested?: string;
  bagTypeId?: string | null;
  pricePerBag?: string;
  bagLines?: CreateOrderBagLineDto[];
  notes?: string | null;
}

export interface UpdateOrderStatusDto {
  status: OrderStatus;
}

// ----------------------------------------------------------------------------
// SHIPMENTS
// ----------------------------------------------------------------------------

export interface ShipmentBag {
  id: string;
  shipmentId: string;
  bagTypeId: string;
  quantity: number;
}

export interface Shipment {
  id: string;
  orderId: string;
  tripId: string | null;
  address: string; // AR
  nominalKg: string; // Decimal (computed)
  actualKg: string | null; // Decimal — driver entered
  status: ShipmentStatus;
  deliveredAt: string | null;
  notes: string | null; // AR
  createdAt: string;
  updatedAt: string;
  bags: ShipmentBag[];
}

export interface CreateShipmentBagDto {
  bagTypeId: string;
  quantity: number;
}

/** POST /shipments — CONSTRAINT 4: bag qty <= available packed stock. */
export interface CreateShipmentDto {
  orderId: string;
  address: string;
  bags: CreateShipmentBagDto[];
  notes?: string | null;
}

export interface UpdateShipmentDto {
  address?: string;
  bags?: CreateShipmentBagDto[];
  notes?: string | null;
}

/** PATCH /shipments/:id/deliver — driver confirms delivery. */
export interface DeliverShipmentDto {
  actualKg?: string;
  deliveredAt?: string; // defaults to now
}

// ----------------------------------------------------------------------------
// DRIVER TRIPS
// ----------------------------------------------------------------------------

export interface DriverTrip {
  id: string;
  driverId: string;
  status: TripStatus;
  fuelCost: string | null; // Decimal
  /** BUG-M: currency of fuelCost; defaults USD. */
  fuelCurrency: Currency;
  otherExpenses: TripOtherExpense[];
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null; // AR
  createdAt: string;
  updatedAt: string;
  // Included by every list/create/findOne response
  driver?: { id: string; name: string };
  shipments?: { id: string; address: string; status: ShipmentStatus }[];
}

export interface DriverTripDetail extends DriverTrip {
  shipments: Shipment[];
}

export interface CreateDriverTripDto {
  driverId: string;
  shipmentIds: string[]; // shipments to bundle into this trip
  notes?: string | null;
}

export interface UpdateDriverTripDto {
  fuelCost?: string | null;
  /** BUG-M: currency of fuelCost; defaults USD when omitted. */
  fuelCurrency?: Currency;
  otherExpenses?: TripOtherExpense[];
  notes?: string | null;
  shipmentIds?: string[]; // re-assign bundled shipments
}

export interface UpdateDriverTripStatusDto {
  status: TripStatus;
}

// ----------------------------------------------------------------------------
// STOCK EXITS
// ----------------------------------------------------------------------------

export interface StockExit {
  id: string;
  // Mode 1 — packed bags:
  packedStockId: string | null;
  bagTypeId: string | null;
  quantity: number | null;
  // Mode 2 — raw kg from lot:
  lotId: string | null;
  kgQuantity: string | null; // Decimal
  exitType: ExitType;
  reason: string | null; // AR — required for sample/gift/internal
  recipient: string | null; // AR
  orderId: string | null;
  clientId: string | null;
  amount: string | null; // Decimal — sale amount for walk_in exits
  /** BUG-K: currency of `amount`; defaults USD. Only meaningful when amount != null. */
  currency: Currency;
  collectedBy: string | null;
  collectedById: string | null;
  loggedById: string;
  date: string; // ISO date
  createdAt: string;
}

/** POST /stock-exits — CONSTRAINT 5: exactly one mode must be supplied. */
export interface CreateStockExitDto {
  // Mode 1 — packed bags:
  packedStockId?: string;
  bagTypeId?: string;
  quantity?: number;
  // Mode 2 — raw kg from lot:
  lotId?: string;
  kgQuantity?: string;
  exitType: ExitType;
  reason?: string | null; // required when exitType in (sample, gift, internal)
  recipient?: string | null;
  orderId?: string | null;
  clientId?: string | null;
  amount?: string; // walk_in sale price
  /** BUG-K: currency of `amount`; defaults USD when omitted. */
  currency?: Currency;
  collectedById?: string;
  date: string;
}

// ----------------------------------------------------------------------------
// INVOICES
// ----------------------------------------------------------------------------

export interface Invoice {
  id: string;
  orderId: string | null;
  clientId: string;
  lines: InvoiceLineItem[];
  subtotal: string; // Decimal
  total: string; // Decimal
  currency: Currency;
  status: InvoiceStatus;
  paidAmount: string; // Decimal
  /** BUG-J: LBP-per-USD rate snapshotted at issue time; null for never-issued drafts. */
  exchangeRateSnapshot: string | null; // Decimal
  issuedAt: string | null;
  dueDate: string | null; // ISO date
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDetail extends Invoice {
  client: Pick<Client, 'id' | 'name' | 'type' | 'currency'>;
  payments: Payment[];
  balanceDue: string; // total - paidAmount
}

export interface CreateInvoiceLineDto {
  bagTypeId: string;
  qty: number;
  pricePerBag: number;
}

export interface CreateInvoiceDto {
  clientId: string;
  orderId?: string | null; // null for walk-in
  lines: CreateInvoiceLineDto[];
  dueDate?: string | null;
}

export interface UpdateInvoiceDto {
  lines?: CreateInvoiceLineDto[];
  dueDate?: string | null;
}

/** PATCH /invoices/:id/issue — moves draft -> issued, sets issuedAt. */
export interface IssueInvoiceDto {
  issuedAt?: string; // defaults to now
  dueDate?: string | null;
}

// ----------------------------------------------------------------------------
// PAYMENTS
// ----------------------------------------------------------------------------

export interface Payment {
  id: string;
  clientId: string;
  invoiceId: string | null;
  amount: string; // Decimal
  currency: Currency;
  method: PaymentMethod;
  date: string; // ISO date
  loggedById: string;
  notes: string | null;
  receiverId: string | null;
  receiverName: string | null;
  createdAt: string;
}

export interface CreatePaymentDto {
  clientId: string;
  invoiceId?: string | null;
  amount: string;
  currency: Currency; // must match client.currency
  method: PaymentMethod;
  date: string;
  notes?: string | null;
  receiverId?: string;    // User.id of the receiver (preferred)
  receiverName?: string;  // fallback string (legacy)
}

// ----------------------------------------------------------------------------
// WORKERS
// ----------------------------------------------------------------------------

export interface Worker {
  id: string;
  name: string; // AR
  phone: string | null;
  ratesPerBagType: WorkerRate[];
  /** @deprecated Cache column — never written post-migration; always [] in API responses. Use packing-session data for a live breakdown. */
  totalBagsPacked: WorkerBagCount[];
  totalEarned: string; // Decimal
  totalPaid: string; // Decimal
  totalOwed: string; // Decimal (computed: totalEarned - totalPaid)
  dailyRate: string;      // Decimal — daily wage rate
  attendanceDays: number; // computed from WorkerAttendance count
  pieceEarned: string;    // Decimal — Σ sessionEarnings (bag-rate earnings)
  dailyEarned: string;    // Decimal — attendanceDays × dailyRate
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkerDto {
  name: string;
  phone?: string | null;
  ratesPerBagType?: WorkerRate[];
  notes?: string | null;
  dailyRate?: string;
}

export interface UpdateWorkerDto {
  name?: string;
  phone?: string | null;
  ratesPerBagType?: WorkerRate[];
  notes?: string | null;
}

export interface WorkerPayment {
  id: string;
  workerId: string;
  amount: string; // Decimal
  date: string; // ISO date
  notes: string | null;
  createdAt: string;
}

export interface CreateWorkerPaymentDto {
  amount: string;
  date: string;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// WORKER ATTENDANCE
// ----------------------------------------------------------------------------

export interface WorkerAttendanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
}

export interface CreateWorkerAttendanceDto {
  date: string; // YYYY-MM-DD
}

// ----------------------------------------------------------------------------
// REPORTS (all owner/accountant scoped unless noted)
// ----------------------------------------------------------------------------

export interface ReportDateRange {
  from?: string; // ISO date
  to?: string; // ISO date
  currency?: Currency; // reporting currency, default USD
}

export interface ProfitLossReport {
  from: string | null;
  to: string | null;
  revenue: string;
  cogs: string;
  bagCost: string;
  varianceCost: string;
  deliveryCost: string;
  grossProfit: string; // owner only
}

export interface StockValueReport {
  data: {
    lotId: string;
    charcoalType: string;
    grade: string;
    kgRemaining: string;
    costPerKg: string;
    lotValue: string;
  }[];
  total: number;
  page: number;
  limit: number;
  totalValue: string;
}

export interface VarianceReportRow {
  sessionId: string;
  date: string;
  workerId: string;
  workerName: string;
  lots: { lotId: string; charcoalType: string; grade: string; kgUsed: string }[];
  kgConsumed: string;
  kgOutputTotal: string;
  varianceKg: string;
  varianceNote: string | null;
  varianceCost: string; // was varianceCostUsd
}

export interface VarianceReport {
  from: string | null;
  to: string | null;
  data: VarianceReportRow[]; // paginated; was "rows"
  total: number;
  page: number;
  limit: number;
  totalVarianceKg: string;
  totalVarianceCost: string; // was totalVarianceCostUsd
}

export interface ContainerCostReportRow {
  containerId: string;
  number: string;
  supplierName: string;
  arrivalDate: string | null;
  productLines: {
    id: string;
    charcoalType: string;
    grade: string;
    paidBags: number;
    giftBags: number;
    kgPerBag: string;
    pricePerTon: string;
    computed: ContainerLineCost;
  }[];
  totalExpenses: string;
  totalDiscount: string;
  totalTonnage: string;
}

export interface ContainerCostReport {
  data: ContainerCostReportRow[];
  total: number;
  page: number;
  limit: number;
}

export interface WorkerEarningsReport {
  workerId: string;
  workerName: string;
  from: string | null;
  to: string | null;
  sessions: {
    data: { sessionId: string; date: string; sessionEarnings: string }[];
    total: number;
    page: number;
    limit: number;
  };
  payments: { paymentId: string; date: string; amount: string; notes: string | null }[];
  totalEarned: string;
  totalPaid: string;
  totalOwed: string;
}

export interface PhysicalCountReport {
  generatedAt: string;
  packedStock: {
    bagTypeId: string;
    bagTypeName: string;
    items: { packedStockId: string; lotId: string; quantity: number }[];
  }[];
}

export interface DashboardSummary {
  // Scoped by role — fields the role cannot see are omitted.
  containersInTransit: number;
  rawStockKg: string;
  packedBags: number;
  openOrders: number;
  overdueClients: number;
  pendingShipments: number;
  todayRevenue?: string; // owner/accountant/sales_rep
  monthRevenue?: string; // owner/accountant
  monthGrossProfit?: string; // owner only
  workerOwed?: string; // owner
}

// ----------------------------------------------------------------------------
// GENERAL EXPENSES
// ----------------------------------------------------------------------------

export interface GeneralExpense {
  id: string;
  description: string;
  amount: string;        // Decimal string
  isRecurring: boolean;
  category: string | null;
  date: string;          // YYYY-MM-DD
  notes: string | null;
  addedById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGeneralExpenseDto {
  description: string;
  amount: string;
  isRecurring?: boolean;
  category?: string | null;
  date?: string;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// AR SUMMARY (GET /reports/ar-summary)
// ----------------------------------------------------------------------------

/** Full-table AR aggregate — KPI cards on the Invoices page. */
export interface ArSummary {
  totalInvoiced: string;    // Decimal — SUM(total) for all non-draft/non-cancelled invoices
  totalCollected: string;   // Decimal — SUM(amount) across all payments
  totalOutstanding: string; // Decimal — SUM(total - paidAmount) for open invoices
  totalOverdue: string;     // Decimal — SUM(total - paidAmount) for overdue invoices
  openInvoiceCount: number;
  overdueCount: number;
  oldestOverdueDays: number;
}
