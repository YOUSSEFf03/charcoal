# Database Planning

Stack: **PostgreSQL** on Railway, managed via **Prisma ORM**

---

## Entity Relationship Summary (23 entities)

```
User ──────────────────────────────────────────────────────────────────┐
 ├── creates ──► Container                                             │
 ├── adds ────► ContainerExpense                                       │
 ├── is worker ► PackingSession                                        │
 ├── counts ──► StockAdjustment (countedBy)                           │
 ├── approves ► StockAdjustment (approvedBy, owner only)              │
 ├── creates ──► ClientOrder                                           │
 ├── logs ────► StockExit                                              │
 ├── logs ────► Payment                                                │
 ├── adds ────► BagPurchase                                            │
 └── drives ──► DriverTrip                                            │
                                                                       │
Supplier ──────────────────────────────────────────────────────────────┤
 ├── has many ► Container                                              │
 ├── has many ► ContainerProductLine                                   │
 └── has many ► StockLot                                               │
                                                                       │
Container ─────────────────────────────────────────────────────────────┤
 ├── has many ► ContainerProductLine                                   │
 ├── has many ► ContainerExpense                                       │
 ├── has one ─► ContainerDiscount                                      │
 └── has many ► StockLot (created on arrival)                         │
                                                                       │
StockLot ──────────────────────────────────────────────────────────────┤
 ├── has many ► PackingSession (consumes kg from lot)                  │
 ├── has many ► PackedStock (output bags linked to source lot)         │
 └── has many ► StockAdjustment                                        │
                                                                       │
BagType ───────────────────────────────────────────────────────────────┤
 ├── has many ► BagPurchase                                            │
 ├── has many ► PackedStock                                            │
 ├── has many ► OrderBagLine                                           │
 ├── has many ► ShipmentBag                                            │
 ├── has many ► StockExit                                              │
 └── has many ► InvoiceLineItem (via Invoice.lines JSON)               │
                                                                       │
PackedStock ────────────────────────────────────────────────────────────┤
 ├── belongs to ► StockLot (source lot)                                │
 ├── belongs to ► BagType                                              │
 ├── belongs to ► PackingSession (created by)                          │
 ├── has many ► StockExit (decrements quantity)                        │
 └── has many ► StockAdjustment                                        │
                                                                       │
Client ─────────────────────────────────────────────────────────────────┤
 ├── has many ► ClientOrder                                            │
 ├── has many ► Invoice                                                │
 └── has many ► Payment                                                │
                                                                       │
ClientOrder ────────────────────────────────────────────────────────────┤
 ├── belongs to ► Client                                               │
 ├── has many ► OrderBagLine                                           │
 ├── has many ► Shipment                                               │
 ├── has many ► PackingSession (mode=order)                            │
 ├── has many ► StockExit                                              │
 └── has many ► Invoice                                                │
                                                                       │
Shipment ───────────────────────────────────────────────────────────────┤
 ├── belongs to ► ClientOrder                                          │
 ├── belongs to ► DriverTrip (optional)                                │
 └── has many ► ShipmentBag                                            │
                                                                       │
Invoice ────────────────────────────────────────────────────────────────┤
 ├── belongs to ► Client                                               │
 ├── belongs to ► ClientOrder (optional — null for walk-in)            │
 └── has many ► Payment                                                │
                                                                       │
Worker ─────────────────────────────────────────────────────────────────┘
 └── has many ► WorkerPayment
```

---

## Required Indexes

### Primary Keys (auto-indexed)
All models use `uuid` as primary key with `@id @default(uuid())`.

### Foreign Key Indexes (Prisma auto-creates these)
All `@relation` fields are automatically indexed by Prisma.

### Additional Indexes to Create

```sql
-- Stock lot lookups (most frequent warehouse queries)
CREATE INDEX idx_stock_lots_type_grade ON stock_lots(charcoal_type, grade);
CREATE INDEX idx_stock_lots_supplier ON stock_lots(supplier_id);
CREATE INDEX idx_stock_lots_has_stock ON stock_lots(kg_remaining) WHERE kg_remaining > 0;

-- Packed stock by bag type (critical for order fulfillment validation)
CREATE INDEX idx_packed_stock_bag_type ON packed_stocks(bag_type_id);
CREATE INDEX idx_packed_stock_lot ON packed_stocks(lot_id);

-- Packing sessions by worker (worker dashboard)
CREATE INDEX idx_packing_sessions_worker ON packing_sessions(worker_id);
CREATE INDEX idx_packing_sessions_date ON packing_sessions(date);

-- Orders by client and status (CRM views)
CREATE INDEX idx_client_orders_client ON client_orders(client_id);
CREATE INDEX idx_client_orders_status ON client_orders(status);
CREATE INDEX idx_client_orders_created_at ON client_orders(created_at);

-- Invoices by client and status (ledger queries)
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_issued_at ON invoices(issued_at);

-- Payments by client (balance computation)
CREATE INDEX idx_payments_client ON payments(client_id);
CREATE INDEX idx_payments_date ON payments(date);

-- Shipments by trip and status (driver views)
CREATE INDEX idx_shipments_trip ON shipments(trip_id);
CREATE INDEX idx_shipments_status ON shipments(status);

-- Stock exits by date (P&L report)
CREATE INDEX idx_stock_exits_date ON stock_exits(date);
CREATE INDEX idx_stock_exits_exit_type ON stock_exits(exit_type);

-- Driver trips by driver (mobile driver view)
CREATE INDEX idx_driver_trips_driver ON driver_trips(driver_id);
CREATE INDEX idx_driver_trips_status ON driver_trips(status);

-- Containers by status (dashboard)
CREATE INDEX idx_containers_status ON containers(status);
```

---

## Computed Fields (Never Stored — Always Calculated)

These are computed in application logic, **not stored in the database**:

| Field | Formula | Where computed |
|-------|---------|----------------|
| `ContainerProductLine.tonnage` | `paidBags × kgPerBag / 1000` | Container service |
| `ContainerProductLine.expenseShare` | `totalExpenses × (tonnage / totalTonnage)` | Container service |
| `ContainerProductLine.allInCostPerKg` | Full formula (see SPEC.md §5) | Container service |
| `Container.totals.*` | Aggregates over all product lines | Container service |
| `PackingSession.kgOutputTotal` | `Σ (bagsOutput[i].qty × bagType[i].nominalKg)` | Packing service |
| `PackingSession.varianceKg` | `kgConsumed − kgOutputTotal` | Packing service |
| `PackingSession.sessionEarnings` | `Σ (bagsOutput[i].qty × workerRate[i])` | Packing service |
| `Client.balance` | `Σ invoices − Σ payments` | Never manually set |
| `Client.avgOrderDays` | Mean of gaps between order dates | Updated after each order |
| `Worker.totalOwed` | `totalEarned − totalPaid` | Worker service |
| `Invoice.subtotal` | `Σ lineTotal` | Invoice service |

---

## JSON Field Schemas

### `clients.phones`
```json
[
  { "number": "+961 70 123456", "label": "mobile", "isActive": true, "dateAdded": "2024-01-15" },
  { "number": "+961 1 234567",  "label": "office", "isActive": false, "dateAdded": "2023-06-01" }
]
```
**CONSTRAINT 14**: Phone numbers are NEVER deleted. Only `isActive` is set to `false`.

### `clients.preferredTypes`
```json
[
  { "charcoalType": "BBQ hardwood", "grade": "A" },
  { "charcoalType": "shisha",       "grade": "B" }
]
```

### `suppliers.contactPersons`
```json
[
  { "name": "Ahmad Khalil", "phone": "+966 50 000001", "role": "Sales Manager" }
]
```

### `suppliers.charcoalTypes`
```json
[
  { "type": "BBQ hardwood", "grade": "A" },
  { "type": "BBQ hardwood", "grade": "B" }
]
```

### `suppliers.bankDetails`
```json
{
  "bankName": "Saudi National Bank",
  "accountNumber": "SA00 0000 0000 0000 0000 0000",
  "iban": "SA00 0000 0000 0000 0000 0000",
  "swift": "NCBKSAJE"
}
```

### `packing_sessions.bagsOutput`
```json
[
  { "bagTypeId": "uuid-2kg",  "quantity": 100 },
  { "bagTypeId": "uuid-5kg",  "quantity": 20  },
  { "bagTypeId": "uuid-10kg", "quantity": 50  }
]
```

### `invoices.lines`
```json
[
  {
    "bagTypeId": "uuid-2kg",
    "bagTypeName": "2kg bag",
    "qty": 100,
    "pricePerBag": "2.50",
    "lineTotal": "250.00"
  }
]
```

### `driver_trips.otherExpenses`
```json
[
  { "description": "Toll fees - Nahr el Kalb", "amount": "5.00" },
  { "description": "Parking",                   "amount": "2.00" }
]
```

### `workers.ratesPerBagType`
```json
[
  { "bagTypeId": "uuid-2kg",  "ratePerBag": "0.05" },
  { "bagTypeId": "uuid-5kg",  "ratePerBag": "0.08" },
  { "bagTypeId": "uuid-10kg", "ratePerBag": "0.12" }
]
```

### `workers.totalBagsPacked`
```json
[
  { "bagTypeId": "uuid-2kg",  "count": 5430 },
  { "bagTypeId": "uuid-5kg",  "count": 1200 },
  { "bagTypeId": "uuid-10kg", "count": 880  }
]
```

---

## Database-Level Constraints

The following constraints must be enforced via Prisma validators or PostgreSQL CHECK constraints:

```sql
-- CONSTRAINT 1 & 2: Stock quantities must never go negative
ALTER TABLE stock_lots      ADD CONSTRAINT kg_remaining_non_negative CHECK (kg_remaining >= 0);
ALTER TABLE packed_stocks   ADD CONSTRAINT quantity_non_negative      CHECK (quantity >= 0);

-- Container discount: one per container (enforced by @unique on containerId)
-- Already handled by Prisma schema @unique

-- Shipment status transition guard: delivered → only to returned (enforced in app)
-- Session variance < 0 requires varianceNote (enforced in app before INSERT)
```

---

## Critical Business Rules at the Data Layer

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | `lot.kgRemaining >= 0` | CHECK constraint + app-level guard before deducting |
| 2 | `packedStock.quantity >= 0` | CHECK constraint + app-level guard before deducting |
| 3 | `session.kgConsumed <= lot.kgRemaining` | App checks before inserting session |
| 4 | Shipment bags ≤ available packed stock | App checks per bag type before inserting |
| 5 | Every stock exit has: exitType, bagTypeId, quantity, loggedById, date | NOT NULL constraints |
| 6 | Every adjustment has: reason, approvedById (owner) | NOT NULL + role check in app |
| 7 | `varianceKg < 0` requires varianceNote | App validation before INSERT |
| 8 | No lot merging across suppliers | Enforced by keeping separate StockLot per supplier+type+grade |
| 9 | Container expenses can be added post-arrival → recalculate costPerKg | App recalculates on every expense write |
| 14 | Client phones never deleted | No DELETE on phones — only UPDATE isActive=false |
| 15 | Client balance never manually set | No `balance` column; always computed from invoices/payments |

---

## Migration Strategy

```bash
# Initial migration (creates all tables)
cd packages/database
npx prisma migrate dev --name init

# After schema changes
npx prisma migrate dev --name describe_your_change

# Production
npx prisma migrate deploy
```

Prisma stores migration history in `_prisma_migrations` table. Never edit migration files after they're applied.
