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

export type ShipmentStatus = 'pending' | 'loaded' | 'delivered' | 'returned' | 'cancelled';

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
  // Free-form JSON on the backend (charcoalTypes?: unknown[], no shape
  // validation) — price is optional reference pricing, not enforced anywhere.
  price?: string;
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
  label: string;
  amount: string; // Decimal
  /** BUG-M: currency of this expense amount; defaults USD when omitted. */
  currency?: Currency;
}

/** BAG line — bags sold by count. Present on all historical invoices after Phase 1 migration. */
export interface BagInvoiceLine {
  saleUnit?: 'BAG'; // optional: absent on pre-Phase-3 BAG lines; treat absent as 'BAG'
  bagTypeId: string;
  bagTypeName: string;
  qty: number;
  pricePerBag: number;
  lineTotal: number;
}

/** KG line — charcoal sold by weight. Introduced in Phase 3. */
export interface KgInvoiceLine {
  saleUnit: 'KG';
  kgQuantity: string;   // decimal string, 3dp
  description: string;  // charcoal type + grade snapshot
  pricePerKg: string;   // decimal string
  lineTotal: number;
}

/**
 * Union of all invoice line variants.
 * Discriminate on `line.saleUnit === 'KG'` — everything else is a BAG line.
 * All existing code that reads bagTypeName/qty/pricePerBag continues to work
 * on BagInvoiceLine; new code branches on the discriminator first.
 */
export type InvoiceLineItem = BagInvoiceLine | KgInvoiceLine;

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
  displayId?: string; // human-readable reference code, e.g. "S-001"
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
  displayId?: string; // human-readable reference code, e.g. "PI-0001"
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

/** GET /reports/supplier-ledger/:supplierId — one row of the Supplier Statement of Account. */
export interface SupplierLedgerEntry {
  date: string;
  type: 'purchase' | 'payment';
  sourceType?: 'container' | 'direct'; // present only when type === 'purchase'
  reference: string; // UUID — containerId for container purchases, stockLot.id for direct, payment.id for payments
  displayId: string | null;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
}

/** GET /reports/supplier-ledger/:supplierId — the Supplier Statement of Account. */
export interface SupplierLedger {
  supplierId: string;
  summary: {
    totalPurchased: string;
    totalPaid: string;
    outstanding: string;
    openingBalance: string;
  };
  entries: SupplierLedgerEntry[];
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

/**
 * Cached tracking summary embedded on each row of GET /containers (the list
 * endpoint) — a `select`-scoped subset of ContainerTracking, deliberately
 * excluding `rawResponse` and `events` (those stay on the detail page's
 * dedicated GET /containers/:id/tracking call) so the list stays a single
 * JOIN and never over-fetches per row. Reflects the last successful manual
 * refresh — opening the list never calls Traqo.
 */
export interface ContainerTrackingSummary {
  status: string | null;
  vessel: string | null;
  voyage: string | null;
  origin: string | null;
  destination: string | null;
  currentLocation: string | null;
  eta: string | null; // ISO date
  lastFetchedAt: string; // ISO date
}

export interface Container {
  id: string;
  displayId?: string; // human-readable reference code, e.g. "CON-001"
  number: string;
  supplierId: string;
  status: ContainerStatus;
  arrivalDate: string | null; // ISO date
  notes: string | null; // AR
  // Ocean carrier for shipment tracking (Traqo). Independent of `status` —
  // never set/derived from tracking data, only from the container-edit form.
  sealine: string | null;
  sealineName: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  // Present only on GET /containers list rows; null if never refreshed;
  // absent (undefined) on responses that don't select it (e.g. container detail).
  tracking?: ContainerTrackingSummary | null;
  // Already returned by GET /containers (used server-side for cost totals);
  // exposed here too so the list/history pages can compute total weight and
  // cost without a second request.
  productLines?: ContainerProductLine[];
  expenses?: ContainerExpense[];
  discount?: ContainerDiscount | null;
  // select-scoped (kgReceived/kgRemaining only, both on the list AND the
  // detail endpoint) — lets the Finalize confirmation summary and the
  // History page's "Remaining stock" column read real values without a
  // second request. Typed to exactly what's selected — never claims the
  // full StockLot shape (id/charcoalType/etc. aren't fetched here).
  stockLots?: Array<Pick<StockLot, 'kgReceived' | 'kgRemaining'>>;
  // Finalization (Container Finalization + History). Both null = active.
  // Both set = the financial/identity record is locked and historical.
  // Independent of `status` — a finalized container's status is always
  // 'arrived', but status itself is never changed by finalization.
  finalizedAt: string | null; // ISO date
  finalizedById: string | null;
  finalizedBy: { id: string; name: string } | null;
}

export interface TrackingEvent {
  id: string;
  trackingId: string;
  description: string;
  location: string | null;
  occurredAt: string | null; // ISO date
  createdAt: string;
}

/** Last stored shipment-tracking snapshot (GET /containers/:id/tracking). Null until the first refresh. */
export interface ContainerTracking {
  id: string;
  containerId: string;
  provider: string;
  referenceNumber: string;
  sealine: string;
  sealineName: string | null;
  status: string | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  voyage: string | null;
  currentLocation: string | null;
  eta: string | null; // ISO date
  isDelayed: boolean | null;
  shipmentUid: string | null;
  shipmentPublicUrl: string | null;
  // Traqo's own shipment-lifecycle fields — the confirmed signal that Traqo
  // has closed/released this shipment (isActive === false or closedAt !==
  // null). Independent of Container.status: a container can be `arrived`
  // on our side while Traqo is still actively tracking (isActive: true).
  isActive: boolean | null;
  closedAt: string | null; // ISO date
  providerUpdatedAt: string | null; // ISO date — the provider's own "last updated"
  lastFetchedAt: string; // ISO date — when WE last successfully called the provider
  lastError: string | null; // set only when the most recent refresh attempt failed
  createdAt: string;
  updatedAt: string;
  events: TrackingEvent[];
}

/** GET /containers/tracking/carriers?search= — for the carrier picker. */
export interface CarrierOption {
  scac: string;
  name: string;
}

/**
 * GET /traqo-accounts (owner-only, Settings). Never carries a key value —
 * only `envKeyName` (a label, e.g. "TRAQO_API_KEY_1") and `keyConfigured`
 * (whether the backend resolved a value for it, never the value itself).
 */
export interface TraqoAccount {
  id: string;
  name: string;
  envKeyName: string;
  keyConfigured: boolean;
  active: boolean;
  status: 'healthy' | 'rate_limited' | 'auth_failed' | 'payment_required';
  priority: number;
  maxContainers: number;
  activeContainers: number;
  unavailableUntil: string | null; // ISO date
  lastFailureAt: string | null; // ISO date
  lastFailureKind: string | null;
}

/**
 * GET /mobile-devices (owner-only, Settings → Container Mobile App). A
 * registered push-notification target for the read-only container-tracking
 * mobile app (Phase C DeviceToken). Never carries the push token itself —
 * see DeviceRegistryService.listAll() on the backend.
 */
export interface MobileDevice {
  id: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
  active: boolean;
  createdAt: string; // ISO date
  updatedAt: string; // ISO date
  lastSeenAt: string; // ISO date
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
  // No arrivalDate — the backend always server-stamps this
  // (UpdateContainerDto = PartialType(CreateContainerDto), which has no such
  // field either); it is never accepted from the client.
  notes?: string | null;
  sealine?: string;
  sealineName?: string;
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
  displayId?: string; // human-readable reference code, e.g. "G-001"
  charcoalType: string;
  grade: string;
  supplierId: string;
  supplier?: Pick<Supplier, 'id' | 'name'>; // included by GET /stock-lots

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
  displayId?: string; // human-readable reference code, e.g. "BP-001"
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
  // Included by GET /packed-stock — costPerKg stripped from `lot` for sales_rep/worker roles.
  lot?: Pick<StockLot, 'id' | 'displayId' | 'charcoalType' | 'grade' | 'costPerKg' | 'dateReceived'>;
  bagType?: Pick<BagType, 'id' | 'name' | 'nominalKg' | 'costPerBag' | 'workerRate' | 'note'>;
  /** This batch's packing session's business date — GET /packed-stock only. */
  session?: { date: string };
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
  /** Distinct source lots currently holding stock (quantity > 0) of this bag type.
   *  Only present on GET /packed-stock/summary — WarehouseSummary.packedSummary
   *  (a separate, independent computation in warehouse.service.ts) omits it. */
  lotCount?: number;
}

// ----------------------------------------------------------------------------
// PACKING SESSIONS
// ----------------------------------------------------------------------------

export interface PackingSessionLot {
  id: string;
  sessionId: string;
  lotId: string;
  kgUsed: string; // Decimal
  lot?: { id: string; displayId?: string; charcoalType: string; grade: string; costPerKg: string | null };
}

export interface PackingSession {
  id: string;
  displayId?: string; // human-readable reference code, e.g. "PK-001"
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
  displayId?: string; // human-readable reference code, e.g. "ADJ-001"
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
  displayId?: string; // human-readable reference code, e.g. "C-001"
  name: string; // AR
  nameAr: string | null;
  type: ClientType;
  currency: Currency;
  phones: ClientPhone[];
  preferredTypes: ClientPreferredType[];
  avgOrderDays: string | null; // Decimal (computed)
  lastOrderDate: string | null; // ISO date (computed)
  paymentTerms: string | null;
  address: string | null;
  creditLimit: string | null; // Decimal — informational only, not enforced
  notes: string | null; // AR
  notesEn: string | null;
  isActive: boolean;
  /**
   * Multiple-locations audit, 2026-08-31: opt-in switch that reveals the
   * Locations management UI (ClientDetail.tsx). A client stays a normal
   * single-location client by default (false) — Order forms never show a
   * location selector unless this is true AND the client has at least one
   * active location. NEVER a second financial account: the client's single
   * `balance` below is completely unaffected either way — see
   * ClientLocation's backend schema doc comment.
   */
  multiLocationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  // Computed (CONSTRAINT 15)
  balance: string; // Decimal — Σ invoice.total − Σ payment.amount
  isOverdue: boolean; // CRM alert flag
  // Computed ranking fields (GET /clients only). totalInvoiced/totalCollected
  // are accrual/cash totals, NOT profit — this app has no per-client cost
  // attribution (COGS/bags/delivery/labor aren't tracked per client), so
  // there is no "most profitable client" figure anywhere in the API.
  totalInvoiced?: string; // Decimal — Σ invoice.total, excludes draft/cancelled
  totalCollected?: string; // Decimal — Σ payment.amount
  orderCount?: number;
}

export interface CreateClientDto {
  name: string;
  nameAr?: string | null;
  type: ClientType;
  currency: Currency;
  phones?: ClientPhone[];
  preferredTypes?: ClientPreferredType[];
  paymentTerms?: string | null;
  address?: string | null;
  creditLimit?: string | null; // Decimal string
  notes?: string | null;
  notesEn?: string | null;
}

export type UpdateClientDto = Partial<CreateClientDto> & { isActive?: boolean; multiLocationEnabled?: boolean };

/** POST /clients/:id/phones — add a number (never deletes — CONSTRAINT 14). */
export interface AddClientPhoneDto {
  number: string;
  label: PhoneLabel;
}

/** PATCH /clients/:id/phones/:number — only allowed change is isActive. */
export interface ToggleClientPhoneDto {
  isActive: boolean;
}

// ----------------------------------------------------------------------------
// CLIENT LOCATIONS (forensic audit, 2026-08-31) — provenance for normal
// Orders only. NEVER a second financial account: no balance, no ledger row
// ever references a location. See ClientLocation's backend schema.prisma doc
// comment for the full read.
// ----------------------------------------------------------------------------

export interface ClientLocation {
  id: string;
  clientId: string;
  name: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** POST /clients/:id/locations — find-or-conflict, case-insensitive within this client. */
export interface CreateClientLocationDto {
  name: string;
  address?: string;
  phone?: string;
  notes?: string;
}

/** PATCH /clients/:id/locations/:locationId — deactivate/reactivate via isActive.
 *  There is intentionally no DELETE endpoint (never hard-deleted). */
export type UpdateClientLocationDto = Partial<CreateClientLocationDto> & { isActive?: boolean };

export interface ClientLedgerEntry {
  date: string;
  /** 'fill_pickup' — Fill Client bag pickup (StockExit, exitType='client_bags_fill'); always a debit. */
  type: 'invoice' | 'payment' | 'fill_pickup';
  reference: string; // UUID — use for links
  displayId: string | null;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
  /** Present on 'invoice' entries only — lets callers derive an open-invoice count without a second query. */
  status?: string;
  /**
   * Present on 'invoice' entries only. Set when this invoice was raised from
   * an Order (source: 'ORDER') — the client's own business-facing Order
   * reference (ClientOrder.displayId, e.g. "SO-0168"), resolved via the
   * invoice's `orderId` FK. Null for a WAREHOUSE_SALE invoice (no order).
   * `displayId` above stays the Invoice's OWN reference regardless — this is
   * additive, for callers that need to show the order the sale actually
   * belongs to (see forensic audit, 2026-08-31: "Statement of Account shows
   * the wrong ID for orders").
   */
  orderId?: string | null;
  orderDisplayId?: string | null;
}

export interface ClientLedger {
  clientId: string;
  currency: Currency;
  openingBalance: string;
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

/**
 * Scalar columns common to every /orders response, regardless of which
 * relations that particular endpoint chooses to include.
 * Matches exactly what PATCH /orders/:id and PATCH /orders/:id/mark-delivered
 * return (neither includes any relation).
 */
export interface ClientOrderBase {
  id: string;
  displayId?: string; // human-readable reference code, e.g. "SO-0001"
  clientId: string;
  charcoalType: string;
  grade: string;
  totalKgRequested: string; // Decimal
  bagTypeId: string | null;
  pricePerBag: string; // Decimal
  currency: Currency;
  status: OrderStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  supplierName: string | null;
  driverId: string | null;
  /** Multiple-locations audit, 2026-08-31 — which of the client's branches
   *  this order/delivery is for. Null for a normal single-location client or
   *  a historical order predating this feature — never fabricated. */
  locationId: string | null;
}

/** GET /orders (list) — orders.service.ts findAll() include: { client: {id,name}, bagType: {id,name,nominalKg}, location: {id,name} } */
export interface ClientOrderListItem extends ClientOrderBase {
  client: Pick<Client, 'id' | 'name'>;
  bagType: { id: string; name: string; nominalKg: string } | null;
  location: { id: string; name: string } | null;
}

/**
 * GET /orders/delivery-queue — orders.service.ts findDeliveryQueue()'s
 * minimal select: same shape as ClientOrderListItem plus the driver
 * relation (id/name only), which the queue cards show but the plain order
 * list does not fetch.
 */
export interface DeliveryQueueOrderItem extends ClientOrderListItem {
  driver: { id: string; name: string } | null;
}

/** POST /orders — orders.service.ts create() include: { client: {id,name}, orderBagLines: true, location: {id,name} } */
export interface ClientOrderCreated extends ClientOrderBase {
  client: Pick<Client, 'id' | 'name'>;
  orderBagLines: OrderBagLine[];
  location: { id: string; name: string } | null;
}

/**
 * GET /orders/:id — orders.service.ts findOne() include: { client, driver, bagType, location, shipments, orderBagLines, invoices }.
 * `client: true` in the Prisma include means the backend actually returns
 * the FULL Client row — address/nameAr below were already present on the
 * wire and are just now declared (needed by the delivery receipt).
 */
export interface ClientOrderDetail extends ClientOrderBase {
  client: Pick<Client, 'id' | 'name' | 'nameAr' | 'type' | 'currency' | 'address'>;
  bagType: { id: string; name: string; nominalKg: string } | null;
  driver: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
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
  /** Client location/branch UUID (optional — must belong to the client and
   *  be active). Never used for Warehouse/Walk-in Sales. */
  locationId?: string | null;
}

/**
 * PATCH /orders/:id — orders.service.ts update(). All fields optional.
 * clientId/pricePerBag/currency/totalKgRequested/bagTypeId are only
 * writable while the order is still 'draft' (OrdersService.update()'s
 * lockedFields guard) — the caller must omit them entirely for a non-draft
 * order, since the backend rejects the KEY being present at all, even with
 * an unchanged value, not just an actual change.
 */
export interface UpdateOrderDto {
  clientId?: string;
  charcoalType?: string;
  grade?: string;
  totalKgRequested?: string;
  bagTypeId?: string | null;
  pricePerBag?: string;
  currency?: Currency;
  bagLines?: CreateOrderBagLineDto[];
  notes?: string | null;
  driverId?: string | null;
  supplierName?: string | null;
  /** Editable in any status (informational provenance only). `null` clears it. */
  locationId?: string | null;
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
  displayId?: string; // human-readable reference code, e.g. "SH-001"
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
  nominalKg: string; // Decimal
  tripId?: string;
  bags: CreateShipmentBagDto[];
  notes?: string;
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
  displayId?: string; // human-readable reference code, e.g. "T-001"
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
  displayId?: string; // human-readable reference code, e.g. "EX-001"
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
  displayId?: string; // human-readable reference code, e.g. "SI-0001"
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
  client: Pick<Client, 'id' | 'name' | 'type' | 'currency' | 'phones'>;
  /** Source reference — null for a WAREHOUSE_SALE invoice (Invoice.source);
   * present for an ORDER invoice. Minimal projection, not the full order. */
  order: { id: string; displayId?: string; status: string } | null;
  /** Only payments directly linked to this invoice at creation time (Payment.invoiceId). */
  payments: Payment[];
  /** Complete picture of what's actually been applied to this invoice, including
   * amounts FIFO-allocated here from a client-level payment (Payment.invoiceId
   * null) — see PaymentAllocationService. Sums to paidAmount. */
  allocations: { id: string; amount: string; createdAt: string; payment: Pick<Payment, 'id' | 'displayId' | 'clientId' | 'date' | 'method' | 'invoiceId'> }[];
  balanceDue: string; // total - paidAmount
}

export interface CreateBagInvoiceLineDto {
  saleUnit?: 'BAG';
  bagTypeId: string;
  bagTypeName: string;
  qty: number;
  pricePerBag: string;
}

export interface CreateKgInvoiceLineDto {
  saleUnit: 'KG';
  kgQuantity: string;
  description: string;
  pricePerKg: string;
}

export type CreateInvoiceLineDto = CreateBagInvoiceLineDto | CreateKgInvoiceLineDto;

export interface CreateInvoiceDto {
  clientId: string;
  orderId?: string | null; // null for walk-in
  lines: CreateInvoiceLineDto[];
  currency: string;
  dueDate?: string | null;
}

export interface UpdateInvoiceDto {
  lines?: CreateInvoiceLineDto[];
  dueDate?: string | null;
}


// ----------------------------------------------------------------------------
// PAYMENTS
// ----------------------------------------------------------------------------

export interface Payment {
  id: string;
  displayId?: string; // human-readable reference code, e.g. "RV-0001"
  clientId: string;
  invoiceId: string | null;
  amount: string; // Decimal
  currency: Currency;
  method: PaymentMethod;
  date: string; // ISO date
  loggedById: string;
  loggedBy?: { id: string; name: string };
  invoice?: { id: string; displayId: string | null } | null;
  notes: string | null;
  receiverId: string | null;
  receiverName: string | null;
  /** Authoritative receiver relation — id/name only (no email/phone). Present on
   * both GET /payments (list) and GET /payments/:id. Prefer this over the
   * denormalized receiverName string, which is only a display fallback. */
  receiver?: { id: string; name: string } | null;
  /** Only present on GET /payments/:id. How this payment's amount was actually applied across invoice(s). */
  allocations?: { id: string; amount: string; invoiceId: string; invoice: { id: string; displayId: string | null } }[];
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
  displayId?: string; // human-readable reference code, e.g. "W-001"
  name: string; // AR
  phone: string | null;
  ratesPerBagType: WorkerRate[];
  /** @deprecated Cache column — never written post-migration; always [] in API responses. Use packing-session data for a live breakdown. */
  totalBagsPacked: WorkerBagCount[];
  totalEarned: string; // Decimal
  totalPaid: string; // Decimal
  totalOwed: string; // Decimal (computed: totalEarned - totalPaid)
  pieceEarned: string;    // Decimal — Σ sessionEarnings (bag-rate earnings)
  costEarned: string;     // Decimal — Σ WorkerCost.amount (earnings entries)
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkerDto {
  name: string;
  phone?: string | null;
  ratesPerBagType?: WorkerRate[];
  notes?: string | null;
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
  method: PaymentMethod;
  referenceNumber: string | null; // receipt #, transfer ID, cheque number
  date: string; // ISO date
  notes: string | null;
  createdAt: string;
}

/** Itemized cash deducted before a handover (e.g. gas, parking). No own date —
 *  derives it from the parent CashHandover.date. */
export interface CashHandoverExpense {
  id: string;
  cashHandoverId: string;
  // Auto-derived from category.name at write time (forensic audit,
  // 2026-08-31) — never independently editable once a category is selected.
  description: string;
  amount: string; // Decimal
  // Nullable only for a pre-migration legacy row (see ExpenseCategory doc
  // comment, backend) — every row created going forward always has one.
  categoryId: string | null;
  createdAt: string;
}

/**
 * Reusable expense category/type (e.g. "Fuel", "Food") — selected from a
 * dropdown when logging a Cash Handover expense, or created via
 * "+ Add new expense" (find-or-create, case-insensitive — see
 * useCreateExpenseCategory()).
 */
export interface ExpenseCategory {
  id: string;
  name: string;
  createdAt: string;
}

/** GET /cash-handovers/expenses/summary — one row per employee. */
export interface ExpenseEmployeeSummary {
  employeeId: string | null;
  employeeName: string;
  totalExpenses: string; // Decimal
}

/** GET /cash-handovers/expenses/employee/:employeeId */
export interface ExpenseEmployeeDetail {
  employeeId: string;
  employeeName: string;
  totalExpenses: string; // Decimal
  categories: { categoryId: string | null; categoryName: string; total: string }[];
}

/** GET /cash-handovers/expenses/employee/:employeeId/category/:categoryId */
export interface ExpenseCategoryOccurrence {
  id: string;
  date: string;
  amount: string; // Decimal
  cashHandoverId: string;
}
export interface ExpenseCategoryDetail {
  employeeId: string;
  employeeName: string;
  categoryId: string;
  categoryName: string;
  total: string; // Decimal
  occurrences: ExpenseCategoryOccurrence[];
}

/**
 * GET /cash-handovers/expenses — flat list of every cash-handover-sourced
 * BUSINESS expense in range (business-model audit, 2026-09-04: "a Cash
 * Handover is NOT an employee expense" — the expense belongs to the
 * business; cashHolderId/cashHolderName label ONLY whose custody it was
 * deducted from, never ownership). handoverExpectedAmt/handoverHandedAmt/
 * handoverExpensesTotal let a detail view reconstruct "cash collected/held
 * = expectedAmt + handoverExpensesTotal" without a second request.
 */
export interface BusinessExpense {
  id: string;
  date: string; // the parent CashHandover's date — the authoritative accounting date
  categoryId: string | null;
  categoryName: string;
  description: string;
  amount: string; // Decimal
  cashHandoverId: string;
  cashHolderId: string | null;
  cashHolderName: string;
  handoverExpectedAmt: string; // Decimal
  handoverHandedAmt: string; // Decimal
  handoverExpensesTotal: string; // Decimal — sum of every expense on this same handover
}

export interface CashHandover {
  id: string;
  date: string; // YYYY-MM-DD
  // The historical name snapshot (always present, even for legacy rows with
  // no receiverId) — receiver below is the live User relation, included by
  // GET /cash-handovers but previously missing from this type entirely.
  receiverName: string;
  receiverId: string | null;
  receiver: { id: string; name: string } | null;
  expectedAmt: string; // Decimal — collected minus itemized expenses
  handedAmt: string; // Decimal
  difference: string; // Decimal — handedAmt - expectedAmt
  notes: string | null;
  loggedById: string;
  loggedBy: { id: string; name: string };
  createdAt: string;
  expenses: CashHandoverExpense[];
}

export interface CreateWorkerPaymentDto {
  amount: string;
  method?: PaymentMethod;
  referenceNumber?: string | null;
  date: string;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// WORKER EARNINGS (WorkerCost) — the earnings ledger, in business language.
// "Cost" internally (matches the backend model + route path); "Earnings" in
// every user-facing string, since this records what a worker earned, not a
// business expense (see the employee module redesign decision).
// ----------------------------------------------------------------------------

export type WorkerCostCategory =
  | 'daily_wage'
  | 'weekly_wage'
  | 'monthly_salary'
  | 'bonus'
  | 'deduction'
  | 'fuel'
  | 'food'
  | 'transport'
  | 'advance'
  | 'correction'
  | 'other';

export interface WorkerEarning {
  id: string;
  workerId: string;
  date: string; // ISO date
  amount: string; // Decimal
  category: WorkerCostCategory;
  notes: string | null;
  fileId: string | null; // storage-agnostic reference to an attached receipt/photo, if any
  createdById: string;
  createdAt: string;
}

export interface CreateWorkerEarningDto {
  amount: string;
  category: WorkerCostCategory;
  date?: string;
  notes?: string | null;
  fileId?: string | null;
}

export interface UpdateWorkerEarningDto {
  amount?: string;
  category?: WorkerCostCategory;
  date?: string;
  notes?: string | null;
  fileId?: string | null;
}

/**
 * "Add daily wage" — records TODAY's daily wage for a worker using the
 * single global daily-wage amount configured in Settings (see
 * useSettings.ts's useDailyWageRate). `date` should be the caller's own
 * local-date string (toDateOnlyString(new Date())), the same convention
 * every other manual entry in this app already sends.
 */
export interface LogDailyWageDto {
  date?: string;
}

/**
 * One row of a worker's Statement of Account (Employee Detail audit,
 * 2026-09-05) — mirrors ClientLedgerEntry's shape/conventions (openingBalance
 * + running balance, never a second accounting calculation). `category`/
 * `method`/`referenceNumber`/`notes` are raw so the frontend builds the
 * description using the SAME label maps (CATEGORY_LABEL/METHOD_LABEL)
 * Employees.tsx already defines elsewhere on this page.
 */
export interface WorkerStatementEntry {
  date: string;
  type: 'earning' | 'payment';
  source: 'cost' | 'session' | 'payment';
  reference: string; // WorkerCost/PackingSession/WorkerPayment id
  /** Present on 'cost' entries only. */
  category?: WorkerCostCategory | null;
  /** Present on 'payment' entries only. */
  method?: PaymentMethod;
  /** Present on 'payment' entries only. */
  referenceNumber?: string | null;
  notes?: string | null;
  earned: string; // Decimal, '0.00' for a payment entry
  paid: string; // Decimal, '0.00' for an earning entry
  runningBalance: string; // Decimal
}

export interface WorkerStatement {
  workerId: string;
  openingBalance: string; // Decimal
  entries: WorkerStatementEntry[];
  balance: string; // Decimal
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
  revenue: string; // accrual basis — SUM(invoice.total) for issued/partially_paid/paid + walk-in exits
  cogs: string;
  bagCost: string;
  varianceCost: string;
  deliveryCost: string;
  grossProfit: string; // owner only — revenue - cogs - bagCost - varianceCost - deliveryCost (UNCHANGED, never redefined)
  cashCollected: string; // cash basis — SUM(payment.amount) actually received in range; not part of grossProfit or netProfit
  // ── Net Profit — additive second tier ────────────────────────────────────
  laborCost: string; // accrual — Σ PackingSession.sessionEarnings + Σ WorkerCost.amount; WorkerPayment (a cash settlement) is deliberately excluded
  generalExpense: string; // Σ GeneralExpense.amount — "Option B" recurrence (same rule as the Expenses page)
  handoverExpense: string; // Σ CashHandoverExpense.amount, dated by its parent CashHandover.date
  netProfit: string; // grossProfit - laborCost - generalExpense - handoverExpense
}

export interface DailyRevenuePoint {
  date: string; // YYYY-MM-DD
  revenue: string; // accrual basis — same definition as ProfitLossReport.revenue
}

export interface DailyRevenueReport {
  from: string | null;
  to: string | null;
  data: DailyRevenuePoint[]; // one entry per day in range, zero-filled
  totalRevenue: string;
}

export interface RevenueByTypePoint {
  charcoalType: string; // 'Uncategorized' for pre-existing lines with no stamped type
  revenue: string; // accrual basis — same definition as ProfitLossReport.revenue
}

export interface RevenueByTypeReport {
  from: string | null;
  to: string | null;
  data: RevenueByTypePoint[]; // sorted descending by revenue
  totalRevenue: string;
}

export interface PnlByTypeRow {
  charcoalType: string; // 'Uncategorized' for pre-existing lines with no stamped type
  revenue: string; // accrual basis — same definition as ProfitLossReport.revenue
  cogs: string; // same definition as ProfitLossReport.cogs
  grossProfit: string; // revenue - cogs (NOT the same figure as ProfitLossReport.grossProfit,
  // which also nets bagCost/varianceCost/deliveryCost — those aren't attributable to a
  // single charcoal type, so this is textbook gross profit, not full P&L net profit)
  marginPct: string; // grossProfit / revenue * 100, one decimal; '0.0' when revenue is 0
}

export interface PnlByTypeReport {
  from: string | null;
  to: string | null;
  data: PnlByTypeRow[]; // sorted descending by revenue
  totalRevenue: string;
  totalCogs: string;
  totalGrossProfit: string;
  totalMarginPct: string;
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
  sessionDisplayId?: string;
  date: string;
  workerId: string;
  workerName: string;
  lots: { lotId: string; displayId?: string; charcoalType: string; grade: string; kgUsed: string }[];
  kgConsumed: string;
  kgOutputTotal: string;
  varianceKg: string;
  varianceNote: string | null;
  varianceCost: string; // was varianceCostUsd
}

export interface VarianceByTypeRow {
  charcoalType: string;
  sessions: number; // sessions that touched this type — a session spanning
  // multiple types is counted once under each, so this need not sum to `total`
  totalVarianceKg: string; // signed — same varianceKg definition as VarianceReportRow, apportioned by kg share
  avgVariancePct: string; // Σ(this type's varianceKg) / Σ(this type's kgUsed) * 100, one decimal
  shareOfTotalPct: string; // share of Σ|varianceKg| across all types, one decimal — always sums to 100%
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
  byCharcoalType: VarianceByTypeRow[]; // full-table breakdown, independent of data's pagination
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

// ----------------------------------------------------------------------------
// FULL DAY REPORT (forensic audit, 2026-09) — read-only end-of-day business
// summary. GET /reports/daily/:date (owner only). Every field here is a
// verbatim mirror of ReportsService.getDailyReport()'s actual return shape —
// see that method's own doc comment for exactly which authoritative
// model/service each section reads from and why.
// ----------------------------------------------------------------------------

/** One logical sale (one row per COALESCE(invoiceId, id) — see StockExitsService.findAllGrouped()). */
/**
 * One logical sale — either ONE Invoice (source 'ORDER' or 'WAREHOUSE_SALE',
 * same accrual definition ProfitLossReport.revenue/ArSummary already use) or
 * ONE anonymous (no client, no invoice) walk-in StockExit (source
 * 'ANONYMOUS'). `description` is server-built (ReportsService's
 * buildInvoiceDescription() for invoiced sales — the SAME method the Client
 * Statement of Account uses) so it can never disagree with the client
 * ledger's own description for the identical invoice.
 */
export interface DailyReportSale {
  id: string;
  invoiceId: string | null;
  invoiceDisplayId: string | null;
  source: 'ORDER' | 'WAREHOUSE_SALE' | 'ANONYMOUS';
  date: string;
  clientId: string | null;
  client: { id: string; name: string } | null;
  currency: string;
  description: string;
  saleTotal: string;
  paidAmount: string;
  remaining: string;
  status: string;
}

export interface DailyReportPayment {
  id: string;
  displayId: string | null;
  client: { id: string; name: string };
  amount: string;
  currency: string;
  method: string;
  date: string;
  receiver: { id: string; name: string } | null;
  allocations: Array<{ amount: string; invoiceId: string; invoiceDisplayId: string | null; invoiceSource: string }>;
}

export interface DailyReportCashHandoverExpense {
  id: string;
  amount: string;
  category: string;
  employee: { id: string | null; name: string };
  cashHandoverId: string;
}

export interface DailyReportGeneralExpense {
  id: string;
  description: string;
  amount: string;
  category: string | null;
  isRecurring: boolean;
  notes: string | null;
}

export interface DailyReportWorkerCost {
  id: string;
  worker: { id: string; name: string };
  amount: string;
  category: string;
  notes: string | null;
}

export interface DailyReportCashHandover {
  id: string;
  receiver: { id: string | null; name: string };
  expectedAmt: string;
  handedAmt: string;
  difference: string;
  notes: string | null;
  expenses: Array<{ id: string; category: string; amount: string }>;
  settledAmount: string;
}

export interface DailyReportOrder {
  id: string;
  displayId: string | null;
  client: { id: string; name: string };
  location: { id: string; name: string } | null;
  status: string;
  charcoalType: string;
  grade: string;
  totalKgRequested: string;
}

export interface DailyReportDeliveredOrder {
  id: string;
  displayId: string | null;
  status: string;
  client: { id: string; name: string };
  location: { id: string; name: string } | null;
}

export interface DailyReportStockMovementRow {
  exitType: string;
  charcoalType: string;
  grade: string;
  bags: number;
  kg: string;
}

export interface DailyReportClientReceivable {
  clientId: string;
  clientName: string;
  currency: string;
  openingBalance: string;
  todaysCharges: string;
  todaysPayments: string;
  closingBalance: string;
}

export interface DailyReportEmployeeSummary {
  receiver: { id: string; name: string };
  receivedToday: string;
  handedOverToday: string;
  outstandingAsOfEndOfDay: string;
}

export interface DailyReportException {
  type: string;
  description: string;
  referenceId?: string;
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  summary: {
    totalSales: string;
    totalCashCollected: string;
    totalCashHandoverExpenses: string;
    totalGeneralExpenses: string;
    totalWorkerCost: string;
    totalHandedOver: string;
    saleCount: number;
    paymentCount: number;
  };
  sales: DailyReportSale[];
  payments: DailyReportPayment[];
  expenses: {
    cashHandoverExpenses: DailyReportCashHandoverExpense[];
    generalExpenses: DailyReportGeneralExpense[];
    workerCosts: DailyReportWorkerCost[];
  };
  cashHandovers: DailyReportCashHandover[];
  orders: {
    created: DailyReportOrder[];
    delivered: DailyReportDeliveredOrder[];
  };
  stockMovement: {
    in: {
      rawLots: Array<{ lotId: string; charcoalType: string; grade: string; supplier: string; kgReceived: string; source: string }>;
      packedFromSessions: Array<{ sessionId: string; worker: string; kgConsumed: string; kgOutputTotal: string; bagsOutput: unknown }>;
    };
    out: DailyReportStockMovementRow[];
  };
  clientReceivables: DailyReportClientReceivable[];
  employeeSummary: DailyReportEmployeeSummary[];
  exceptions: DailyReportException[];
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
  displayId?: string; // human-readable reference code, e.g. "GE-001"
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

export type UpdateGeneralExpenseDto = Partial<CreateGeneralExpenseDto>;

// ----------------------------------------------------------------------------
// AR SUMMARY (GET /reports/ar-summary)
// ----------------------------------------------------------------------------

/** Full-table AR aggregate — KPI cards on the Invoices page. */
export interface ArSummary {
  totalInvoiced: string;    // Decimal — SUM(total) for all non-draft/non-cancelled invoices
  totalCollected: string;   // Decimal — SUM(amount) across all payments
  totalOutstanding: string; // Decimal — SUM per-client (invoiced − all payments), floored at 0
  totalOverdue: string;     // Decimal — SUM(total - paidAmount) for overdue invoices
  openInvoiceCount: number;
  overdueCount: number;
  oldestOverdueDays: number;
}
