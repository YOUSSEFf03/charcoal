// ─────────────────────────────────────────────────────────────────────────────
// Mock In-Memory Database
// Realistic seed data for development and testing via MSW.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  User, Supplier, Container, ContainerProductLine, ContainerExpense,
  ContainerDiscount, StockLot, BagType, PackedStock, PackingSession,
  Client, ClientOrder, Shipment, ShipmentBag, DriverTrip, StockExit,
  Invoice, Payment, Worker, WorkerPayment,
} from "../types/api";

import {
  Role, ContainerStatus, StockSource, PackingMode, ClientType,
  Currency, OrderStatus, ShipmentStatus, TripStatus, ExitType,
  InvoiceStatus, PaymentMethod,
} from "../types/api";

// ── Users ─────────────────────────────────────────────────────────────────────

export const users: User[] = [
  {
    id: "user-owner-001",
    clerkId: "clerk_owner_001",
    email: "owner@charcoal.lb",
    name: "Georges Khoury",
    role: Role.owner,
    phone: "+961 70 111222",
    createdAt: "2024-01-01T08:00:00Z",
    updatedAt: "2024-01-01T08:00:00Z",
  },
  {
    id: "user-sales-001",
    clerkId: "clerk_sales_001",
    email: "sales@charcoal.lb",
    name: "Nadia Haddad",
    role: Role.sales_rep,
    phone: "+961 70 333444",
    createdAt: "2024-01-05T08:00:00Z",
    updatedAt: "2024-01-05T08:00:00Z",
  },
  {
    id: "user-worker-001",
    clerkId: "clerk_worker_001",
    email: "worker@charcoal.lb",
    name: "Hassan Nassar",
    role: Role.worker,
    phone: "+961 70 555666",
    createdAt: "2024-01-10T08:00:00Z",
    updatedAt: "2024-01-10T08:00:00Z",
  },
  {
    id: "user-driver-001",
    clerkId: "clerk_driver_001",
    email: "driver@charcoal.lb",
    name: "Khalil Mansour",
    role: Role.driver,
    phone: "+961 70 777888",
    createdAt: "2024-01-10T08:00:00Z",
    updatedAt: "2024-01-10T08:00:00Z",
  },
  {
    id: "user-accountant-001",
    clerkId: "clerk_accountant_001",
    email: "accountant@charcoal.lb",
    name: "Rania Salam",
    role: Role.accountant,
    phone: "+961 70 999000",
    createdAt: "2024-01-05T08:00:00Z",
    updatedAt: "2024-01-05T08:00:00Z",
  },
];

// ── Suppliers ─────────────────────────────────────────────────────────────────

export const suppliers: Supplier[] = [
  {
    id: "supplier-001",
    name: "Saudi Charcoal Factory",
    country: "Saudi Arabia",
    contactPersons: [
      { name: "Abdullah Al-Rashid", phone: "+966 50 000001", role: "Export Manager" },
    ],
    charcoalTypes: [
      { type: "BBQ hardwood", grade: "A" },
      { type: "BBQ hardwood", grade: "B" },
    ],
    bankDetails: {
      bankName: "Saudi National Bank",
      accountNumber: "SA00 0000 0000 0000 0000 0000",
      iban: "SA00 0000 0000 0000 0000 0000",
      swift: "NCBKSAJE",
    },
    paymentTerms: "30% upfront, 70% on BL",
    leadTimeDays: 45,
    notes: "Reliable supplier. Best quality Grade A.",
    createdAt: "2024-01-01T08:00:00Z",
    updatedAt: "2024-01-01T08:00:00Z",
  },
  {
    id: "supplier-002",
    name: "Indonesian Charcoal Co.",
    country: "Indonesia",
    contactPersons: [
      { name: "Budi Santoso", phone: "+62 812 0000001", role: "Sales" },
    ],
    charcoalTypes: [
      { type: "shisha", grade: "A" },
      { type: "restaurant grade", grade: "B" },
    ],
    paymentTerms: "100% TT before loading",
    leadTimeDays: 60,
    createdAt: "2024-01-02T08:00:00Z",
    updatedAt: "2024-01-02T08:00:00Z",
  },
];

// ── Bag Types ─────────────────────────────────────────────────────────────────

export const bagTypes: BagType[] = [
  {
    id: "bagtype-2kg",
    name: "2kg bag",
    nominalKg: "2.000",
    costPerBag: "0.0800",
    workerRate: "0.0500",
    note: "Same physical bag as 1.9kg",
    createdAt: "2024-01-01T08:00:00Z",
    updatedAt: "2024-01-01T08:00:00Z",
  },
  {
    id: "bagtype-5kg",
    name: "5kg bag",
    nominalKg: "5.000",
    costPerBag: "0.1200",
    workerRate: "0.0800",
    createdAt: "2024-01-01T08:00:00Z",
    updatedAt: "2024-01-01T08:00:00Z",
  },
  {
    id: "bagtype-10kg",
    name: "10kg bag",
    nominalKg: "10.000",
    costPerBag: "0.2000",
    workerRate: "0.1200",
    createdAt: "2024-01-01T08:00:00Z",
    updatedAt: "2024-01-01T08:00:00Z",
  },
];

// ── Workers ───────────────────────────────────────────────────────────────────

export const workers: Worker[] = [
  {
    id: "worker-001",
    name: "Hassan Nassar",
    phone: "+961 70 555666",
    ratesPerBagType: [
      { bagTypeId: "bagtype-2kg", ratePerBag: "0.0500" },
      { bagTypeId: "bagtype-5kg", ratePerBag: "0.0800" },
      { bagTypeId: "bagtype-10kg", ratePerBag: "0.1200" },
    ],
    totalBagsPacked: [
      { bagTypeId: "bagtype-2kg", count: 3200 },
      { bagTypeId: "bagtype-5kg", count: 800 },
      { bagTypeId: "bagtype-10kg", count: 420 },
    ],
    totalEarned: "290.40",
    totalPaid: "200.00",
    totalOwed: "90.40",
    createdAt: "2024-01-10T08:00:00Z",
    updatedAt: "2024-05-01T08:00:00Z",
  },
];

// ── Containers ────────────────────────────────────────────────────────────────

export const containers: Container[] = [
  {
    id: "container-001",
    number: "CONT-2024-001",
    supplierId: "supplier-001",
    status: ContainerStatus.arrived,
    arrivalDate: "2024-02-15",
    notes: "First container of 2024",
    createdById: "user-owner-001",
    createdAt: "2024-01-20T08:00:00Z",
    updatedAt: "2024-02-15T08:00:00Z",
    totals: {
      totalTonnage: "12.000",
      totalProductCost: "3600.00",
      totalExpenses: "1200.00",
      totalDiscount: "100.00",
      averageCostPerTon: "391.67",
      averageCostPerKg: "0.3917",
    },
  },
  {
    id: "container-002",
    number: "CONT-2024-002",
    supplierId: "supplier-002",
    status: ContainerStatus.transit,
    notes: "Shisha batch",
    createdById: "user-owner-001",
    createdAt: "2024-04-01T08:00:00Z",
    updatedAt: "2024-04-10T08:00:00Z",
  },
];

export const containerProductLines: ContainerProductLine[] = [
  {
    id: "cpl-001",
    containerId: "container-001",
    charcoalType: "BBQ hardwood",
    grade: "A",
    supplierId: "supplier-001",
    paidBags: 800,
    giftBags: 20,
    kgPerBag: "10.000",
    pricePerTon: "280.00",
    createdAt: "2024-01-20T08:00:00Z",
    updatedAt: "2024-01-20T08:00:00Z",
    computed: {
      tonnage: "8.000",
      baseCost: "2240.00",
      expenseShare: "800.00",
      discountShare: "66.67",
      expensePerTon: "100.00",
      discountPerTon: "8.33",
      allInCostPerTon: "371.67",
      allInCostPerKg: "0.3717",
    },
  },
  {
    id: "cpl-002",
    containerId: "container-001",
    charcoalType: "BBQ hardwood",
    grade: "B",
    supplierId: "supplier-001",
    paidBags: 400,
    giftBags: 0,
    kgPerBag: "10.000",
    pricePerTon: "235.00",
    createdAt: "2024-01-20T08:00:00Z",
    updatedAt: "2024-01-20T08:00:00Z",
    computed: {
      tonnage: "4.000",
      baseCost: "940.00",
      expenseShare: "400.00",
      discountShare: "33.33",
      expensePerTon: "100.00",
      discountPerTon: "8.33",
      allInCostPerTon: "326.67",
      allInCostPerKg: "0.3267",
    },
  },
];

export const containerExpenses: ContainerExpense[] = [
  { id: "exp-001", containerId: "container-001", description: "Freight", amount: "600.00", addedById: "user-owner-001", addedAt: "2024-01-21T08:00:00Z" },
  { id: "exp-002", containerId: "container-001", description: "Beirut port fees", amount: "350.00", addedById: "user-owner-001", addedAt: "2024-02-01T08:00:00Z" },
  { id: "exp-003", containerId: "container-001", description: "Truck to warehouse", amount: "150.00", addedById: "user-owner-001", addedAt: "2024-02-15T08:00:00Z" },
  { id: "exp-004", containerId: "container-001", description: "Agent fees", amount: "100.00", addedById: "user-accountant-001", addedAt: "2024-02-20T08:00:00Z" },
];

export const containerDiscounts: ContainerDiscount[] = [
  { id: "disc-001", containerId: "container-001", amount: "100.00" },
];

// ── Stock Lots ────────────────────────────────────────────────────────────────

export const stockLots: StockLot[] = [
  {
    id: "lot-001",
    charcoalType: "BBQ hardwood",
    grade: "A",
    supplierId: "supplier-001",
    kgReceived: "8000.000",
    kgRemaining: "3200.000",
    costPerKg: "0.3717",
    source: StockSource.container,
    containerId: "container-001",
    dateReceived: "2024-02-15",
    notes: "From container CONT-2024-001",
    createdAt: "2024-02-15T10:00:00Z",
    updatedAt: "2024-05-01T08:00:00Z",
  },
  {
    id: "lot-002",
    charcoalType: "BBQ hardwood",
    grade: "B",
    supplierId: "supplier-001",
    kgReceived: "4000.000",
    kgRemaining: "1800.000",
    costPerKg: "0.3267",
    source: StockSource.container,
    containerId: "container-001",
    dateReceived: "2024-02-15",
    createdAt: "2024-02-15T10:00:00Z",
    updatedAt: "2024-05-01T08:00:00Z",
  },
];

// ── Packing Sessions ──────────────────────────────────────────────────────────

export const packingSessions: PackingSession[] = [
  {
    id: "session-001",
    lotId: "lot-001",
    workerId: "user-worker-001",
    mode: PackingMode.stock,
    kgConsumed: "500.000",
    bagsOutput: [
      { bagTypeId: "bagtype-2kg", quantity: 150 },
      { bagTypeId: "bagtype-5kg", quantity: 30 },
      { bagTypeId: "bagtype-10kg", quantity: 10 },
    ],
    kgOutputTotal: "550.000",
    varianceKg: "-50.000",
    varianceNote: "Scale calibration issue — recalibrated after session",
    sessionEarnings: "21.10",
    date: "2024-02-20",
    startedAt: "2024-02-20T08:00:00Z",
    completedAt: "2024-02-20T11:30:00Z",
  },
  {
    id: "session-002",
    lotId: "lot-001",
    workerId: "user-worker-001",
    mode: PackingMode.stock,
    kgConsumed: "300.000",
    bagsOutput: [
      { bagTypeId: "bagtype-2kg", quantity: 100 },
      { bagTypeId: "bagtype-10kg", quantity: 19 },
    ],
    kgOutputTotal: "390.000",
    varianceKg: "-90.000",
    varianceNote: "Dust and breakage — higher than usual due to dry batch",
    sessionEarnings: "7.28",
    date: "2024-03-01",
    startedAt: "2024-03-01T08:00:00Z",
    completedAt: "2024-03-01T10:00:00Z",
  },
];

// ── Packed Stock ──────────────────────────────────────────────────────────────

export const packedStocks: PackedStock[] = [
  { id: "ps-001", lotId: "lot-001", bagTypeId: "bagtype-2kg", quantity: 120, sessionId: "session-001", createdAt: "2024-02-20T11:30:00Z", updatedAt: "2024-05-01T08:00:00Z" },
  { id: "ps-002", lotId: "lot-001", bagTypeId: "bagtype-5kg", quantity: 30, sessionId: "session-001", createdAt: "2024-02-20T11:30:00Z", updatedAt: "2024-05-01T08:00:00Z" },
  { id: "ps-003", lotId: "lot-001", bagTypeId: "bagtype-10kg", quantity: 8, sessionId: "session-001", createdAt: "2024-02-20T11:30:00Z", updatedAt: "2024-05-01T08:00:00Z" },
  { id: "ps-004", lotId: "lot-001", bagTypeId: "bagtype-2kg", quantity: 80, sessionId: "session-002", createdAt: "2024-03-01T10:00:00Z", updatedAt: "2024-05-01T08:00:00Z" },
  { id: "ps-005", lotId: "lot-001", bagTypeId: "bagtype-10kg", quantity: 15, sessionId: "session-002", createdAt: "2024-03-01T10:00:00Z", updatedAt: "2024-05-01T08:00:00Z" },
];

// ── Clients ───────────────────────────────────────────────────────────────────

export const clients: Client[] = [
  {
    id: "client-001",
    name: "Al-Nakheel Restaurant",
    type: ClientType.restaurant,
    currency: Currency.USD,
    phones: [
      { number: "+961 1 234567", label: "office", isActive: true, dateAdded: "2024-01-15" },
      { number: "+961 70 234567", label: "mobile", isActive: true, dateAdded: "2024-01-15" },
    ],
    preferredTypes: [{ charcoalType: "BBQ hardwood", grade: "A" }],
    avgOrderDays: "14.50",
    lastOrderDate: "2024-04-28",
    paymentTerms: "net 15",
    notes: "Orders every 2 weeks. Prefers morning deliveries.",
    balance: "350.00",
    createdAt: "2024-01-15T08:00:00Z",
    updatedAt: "2024-05-01T08:00:00Z",
  },
  {
    id: "client-002",
    name: "Beirut Shisha Lounge",
    type: ClientType.shop,
    currency: Currency.USD,
    phones: [
      { number: "+961 70 456789", label: "whatsapp", isActive: true, dateAdded: "2024-02-01" },
    ],
    preferredTypes: [{ charcoalType: "BBQ hardwood", grade: "A" }],
    avgOrderDays: "21.00",
    lastOrderDate: "2024-04-20",
    paymentTerms: "cash on delivery",
    balance: "0.00",
    createdAt: "2024-02-01T08:00:00Z",
    updatedAt: "2024-04-20T08:00:00Z",
  },
  {
    id: "client-003",
    name: "مطعم الكرم",
    type: ClientType.restaurant,
    currency: Currency.LBP,
    phones: [
      { number: "+961 71 567890", label: "mobile", isActive: true, dateAdded: "2024-03-01" },
    ],
    preferredTypes: [{ charcoalType: "BBQ hardwood", grade: "B" }],
    lastOrderDate: "2024-03-15",
    paymentTerms: "net 30",
    balance: "1800000.00",
    notes: "Arabic client. LBP payments only.",
    createdAt: "2024-03-01T08:00:00Z",
    updatedAt: "2024-03-15T08:00:00Z",
  },
  {
    id: "client-004",
    name: "Walk-in Customer",
    type: ClientType.walk_in,
    currency: Currency.USD,
    phones: [],
    preferredTypes: [],
    balance: "0.00",
    createdAt: "2024-01-01T08:00:00Z",
    updatedAt: "2024-01-01T08:00:00Z",
  },
  {
    id: "client-005",
    name: "Levant Export Co.",
    type: ClientType.export,
    currency: Currency.USD,
    phones: [
      { number: "+961 1 999000", label: "office", isActive: true, dateAdded: "2024-04-01" },
    ],
    preferredTypes: [
      { charcoalType: "BBQ hardwood", grade: "A" },
      { charcoalType: "BBQ hardwood", grade: "B" },
    ],
    paymentTerms: "50% upfront, 50% on delivery",
    balance: "1200.00",
    createdAt: "2024-04-01T08:00:00Z",
    updatedAt: "2024-04-15T08:00:00Z",
  },
];

// ── Orders ────────────────────────────────────────────────────────────────────

export const orders: ClientOrder[] = [
  {
    id: "order-001",
    clientId: "client-001",
    charcoalType: "BBQ hardwood",
    grade: "A",
    totalKgRequested: "200.000",
    bagTypeId: "bagtype-10kg",
    pricePerBag: "8.50",
    currency: Currency.USD,
    status: OrderStatus.delivered,
    createdById: "user-sales-001",
    createdAt: "2024-04-25T08:00:00Z",
    updatedAt: "2024-04-28T16:00:00Z",
    notes: "Urgent — needed before weekend",
  },
  {
    id: "order-002",
    clientId: "client-002",
    charcoalType: "BBQ hardwood",
    grade: "A",
    totalKgRequested: "100.000",
    bagTypeId: "bagtype-2kg",
    pricePerBag: "2.50",
    currency: Currency.USD,
    status: OrderStatus.confirmed,
    createdById: "user-sales-001",
    createdAt: "2024-05-01T09:00:00Z",
    updatedAt: "2024-05-01T09:30:00Z",
  },
  {
    id: "order-003",
    clientId: "client-005",
    charcoalType: "BBQ hardwood",
    grade: "A",
    totalKgRequested: "500.000",
    bagTypeId: "bagtype-10kg",
    pricePerBag: "7.80",
    currency: Currency.USD,
    status: OrderStatus.invoiced,
    createdById: "user-owner-001",
    createdAt: "2024-04-10T08:00:00Z",
    updatedAt: "2024-04-15T12:00:00Z",
    notes: "Export order — needs export invoice",
  },
];

// ── Shipments ─────────────────────────────────────────────────────────────────

export const shipments: Shipment[] = [
  {
    id: "shipment-001",
    orderId: "order-001",
    tripId: "trip-001",
    address: "Mar Elias Street, Beirut",
    nominalKg: "200.000",
    actualKg: "202.500",
    status: ShipmentStatus.delivered,
    deliveredAt: "2024-04-28T14:30:00Z",
    createdAt: "2024-04-26T08:00:00Z",
    updatedAt: "2024-04-28T14:30:00Z",
    bags: [
      { id: "sb-001", shipmentId: "shipment-001", bagTypeId: "bagtype-10kg", quantity: 20 },
    ],
  },
];

// ── Driver Trips ──────────────────────────────────────────────────────────────

export const driverTrips: DriverTrip[] = [
  {
    id: "trip-001",
    driverId: "user-driver-001",
    status: TripStatus.completed,
    fuelCost: "15.00",
    otherExpenses: [{ description: "Toll - Nahr el Kalb", amount: "3.00" }],
    startedAt: "2024-04-28T08:00:00Z",
    completedAt: "2024-04-28T16:00:00Z",
    createdAt: "2024-04-27T08:00:00Z",
    updatedAt: "2024-04-28T16:00:00Z",
  },
];

// ── Invoices ──────────────────────────────────────────────────────────────────

export const invoices: Invoice[] = [
  {
    id: "invoice-001",
    orderId: "order-001",
    clientId: "client-001",
    lines: [
      { bagTypeId: "bagtype-10kg", bagTypeName: "10kg bag", qty: 20, pricePerBag: "8.50", lineTotal: "170.00" },
    ],
    subtotal: "170.00",
    total: "170.00",
    currency: Currency.USD,
    status: InvoiceStatus.partially_paid,
    paidAmount: "0.00",
    issuedAt: "2024-04-28T15:00:00Z",
    dueDate: "2024-05-13",
    createdAt: "2024-04-28T15:00:00Z",
    updatedAt: "2024-04-28T15:00:00Z",
  },
  {
    id: "invoice-002",
    orderId: "order-003",
    clientId: "client-005",
    lines: [
      { bagTypeId: "bagtype-10kg", bagTypeName: "10kg bag", qty: 50, pricePerBag: "7.80", lineTotal: "390.00" },
    ],
    subtotal: "390.00",
    total: "390.00",
    currency: Currency.USD,
    status: InvoiceStatus.partially_paid,
    paidAmount: "195.00",
    issuedAt: "2024-04-15T08:00:00Z",
    dueDate: "2024-04-30",
    createdAt: "2024-04-15T08:00:00Z",
    updatedAt: "2024-04-20T08:00:00Z",
  },
];

// ── Payments ──────────────────────────────────────────────────────────────────

export const payments: Payment[] = [
  {
    id: "payment-001",
    clientId: "client-005",
    invoiceId: "invoice-002",
    amount: "195.00",
    currency: Currency.USD,
    method: PaymentMethod.whish,
    date: "2024-04-20",
    loggedById: "user-sales-001",
    notes: "50% upfront as agreed",
    createdAt: "2024-04-20T08:00:00Z",
  },
];

// ── Worker Payments ───────────────────────────────────────────────────────────

export const workerPayments: WorkerPayment[] = [
  {
    id: "wpay-001",
    workerId: "worker-001",
    amount: "200.00",
    date: "2024-04-01",
    notes: "Monthly settlement",
    createdAt: "2024-04-01T08:00:00Z",
  },
];

// ── Stock Exits ───────────────────────────────────────────────────────────────

export const stockExits: StockExit[] = [
  {
    id: "exit-001",
    packedStockId: "ps-003",
    bagTypeId: "bagtype-10kg",
    quantity: 2,
    exitType: ExitType.sample,
    reason: "Sample for new restaurant client",
    recipient: "Tannourine Restaurant",
    loggedById: "user-sales-001",
    date: "2024-03-05",
    createdAt: "2024-03-05T10:00:00Z",
  },
];

// ── DB helper functions ───────────────────────────────────────────────────────

export const db = {
  users,
  suppliers,
  containers,
  containerProductLines,
  containerExpenses,
  containerDiscounts,
  bagTypes,
  workers,
  workerPayments,
  stockLots,
  packingSessions,
  packedStocks,
  clients,
  orders,
  shipments,
  driverTrips,
  invoices,
  payments,
  stockExits,

  findById<T extends { id: string }>(collection: T[], id: string): T | undefined {
    return collection.find((item) => item.id === id);
  },

  paginate<T>(collection: T[], page = 1, limit = 20): { data: T[]; total: number; page: number; limit: number } {
    const start = (page - 1) * limit;
    return {
      data: collection.slice(start, start + limit),
      total: collection.length,
      page,
      limit,
    };
  },
};
