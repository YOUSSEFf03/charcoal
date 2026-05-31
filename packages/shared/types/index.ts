export type Role = "owner" | "accountant" | "sales_rep" | "worker" | "driver";

export type Currency = "USD" | "LBP";

export type ContainerStatus = "port" | "transit" | "arrived";
export type StockSource = "container" | "direct";
export type PackingMode = "stock" | "order";
export type ClientType =
  | "restaurant"
  | "shop"
  | "wholesale"
  | "walk_in"
  | "corporate"
  | "export";
export type OrderStatus =
  | "draft"
  | "confirmed"
  | "partially_delivered"
  | "delivered"
  | "invoiced"
  | "paid";
export type ShipmentStatus = "pending" | "loaded" | "delivered" | "returned";
export type TripStatus = "planned" | "in_progress" | "completed";
export type ExitType =
  | "order"
  | "walk_in"
  | "sample"
  | "gift"
  | "internal"
  | "client_bags_fill";
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "cancelled";
export type PaymentMethod = "cash" | "whish" | "omt";
export type AdjustmentType = "lot" | "packed_stock";

export interface AuthContext {
  userId: string;
  role: Role;
}

export interface ErrorResponse {
  error: string;
  code: string;
  details?: Record<string, string[]>;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface UserDTO {
  id: string;
  clerkId: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRoleDTO {
  role: Role;
}

export interface ContactPerson {
  name: string;
  phone?: string;
  email?: string;
  position?: string;
}

export interface SupplierDTO {
  id: string;
  name: string;
  country: string;
  contactPersons: ContactPerson[];
  charcoalTypes: string[];
  bankDetails: Record<string, unknown> | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerDTO {
  id: string;
  number: string;
  supplierId: string;
  status: ContainerStatus;
  arrivalDate: string | null;
  notes: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerProductLineDTO {
  id: string;
  containerId: string;
  charcoalType: string;
  grade: string;
  supplierId: string;
  paidBags: number;
  giftBags: number;
  kgPerBag: string;
  pricePerTon: string;
}

export interface ContainerExpenseDTO {
  id: string;
  containerId: string;
  description: string;
  amount: string;
  addedById: string;
  addedAt: string;
}

export interface StockLotDTO {
  id: string;
  charcoalType: string;
  grade: string;
  supplierId: string;
  kgReceived: string;
  kgRemaining: string;
  costPerKg?: string;
  source: StockSource;
  containerId: string | null;
  dateReceived: string;
  notes: string | null;
}

export interface BagTypeDTO {
  id: string;
  name: string;
  nominalKg: string;
  costPerBag: string;
  workerRate: string;
  note: string | null;
}

export interface BagOutputLine {
  bagTypeId: string;
  quantity: number;
}

export interface PackingSessionDTO {
  id: string;
  lotId: string;
  workerId: string;
  mode: PackingMode;
  orderId: string | null;
  kgConsumed: string;
  bagsOutput: BagOutputLine[];
  kgOutputTotal: string;
  varianceKg: string;
  varianceNote: string | null;
  sessionEarnings: string;
  date: string;
}

export interface ClientDTO {
  id: string;
  name: string;
  type: ClientType;
  currency: Currency;
  phones: ClientPhone[];
  preferredTypes: string[];
  avgOrderDays: string | null;
  lastOrderDate: string | null;
  paymentTerms: string | null;
  notes: string | null;
}

export interface ClientPhone {
  number: string;
  isActive: boolean;
  label?: string;
}

export interface ClientBalanceDTO {
  clientId: string;
  currency: Currency;
  invoicedTotal: string;
  paidTotal: string;
  balance: string;
}

export interface OrderDTO {
  id: string;
  clientId: string;
  charcoalType: string;
  grade: string;
  totalKgRequested: string;
  bagTypeId: string | null;
  pricePerBag: string;
  currency: Currency;
  status: OrderStatus;
  createdById: string;
  notes: string | null;
}

export interface ShipmentDTO {
  id: string;
  orderId: string;
  tripId: string | null;
  address: string;
  nominalKg: string;
  actualKg: string | null;
  status: ShipmentStatus;
  deliveredAt: string | null;
  notes: string | null;
}

export interface DriverTripDTO {
  id: string;
  driverId: string;
  status: TripStatus;
  fuelCost: string | null;
  otherExpenses: TripExpense[];
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

export interface TripExpense {
  description: string;
  amount: string;
}

export interface StockExitDTO {
  id: string;
  packedStockId: string;
  bagTypeId: string;
  quantity: number;
  exitType: ExitType;
  reason: string | null;
  recipient: string | null;
  orderId: string | null;
  loggedById: string;
  date: string;
}

export interface InvoiceLine {
  bagTypeId: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface InvoiceDTO {
  id: string;
  orderId: string | null;
  clientId: string;
  lines: InvoiceLine[];
  subtotal: string;
  total: string;
  currency: Currency;
  status: InvoiceStatus;
  paidAmount: string;
  issuedAt: string | null;
  dueDate: string | null;
}

export interface PaymentDTO {
  id: string;
  clientId: string;
  invoiceId: string | null;
  amount: string;
  currency: Currency;
  method: PaymentMethod;
  date: string;
  loggedById: string;
  notes: string | null;
}

export interface WorkerDTO {
  id: string;
  name: string;
  phone: string | null;
  ratesPerBagType: WorkerRate[];
  totalBagsPacked: BagOutputLine[];
  totalEarned: string;
  totalPaid: string;
  notes: string | null;
}

export interface WorkerRate {
  bagTypeId: string;
  rate: string;
}

export interface WorkerPaymentDTO {
  id: string;
  workerId: string;
  amount: string;
  date: string;
  notes: string | null;
}
