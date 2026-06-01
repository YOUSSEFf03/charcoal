# Charcoal Business Accounting System — Full Specification

> This document is the single source of truth for the system.
> Every module, entity, rule, and user flow is defined here.
> When building any part of the system, refer to this document first.

---

## Table of Contents

1. [Business Overview](#1-business-overview)
2. [Technology Constraints](#2-technology-constraints)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Core Concepts & Definitions](#4-core-concepts--definitions)
5. [Module 1 — Container Tracker](#5-module-1--container-tracker)
6. [Module 2 — Warehouse & Stock](#6-module-2--warehouse--stock)
7. [Module 3 — Packing Sessions](#7-module-3--packing-sessions)
8. [Module 4 — Client CRM](#8-module-4--client-crm)
9. [Module 5 — Orders & Invoicing](#9-module-5--orders--invoicing)
10. [Module 6 — Fill Jobs (Client-Provided Bags)](#10-module-6--fill-jobs-client-provided-bags)
11. [Module 7 — Delivery](#11-module-7--delivery)
12. [Module 8 — Suppliers](#12-module-8--suppliers)
13. [Module 9 — Reports & Reconciliation](#13-module-9--reports--reconciliation)
14. [Sales Scenarios](#14-sales-scenarios)
15. [Stock Reconciliation Rules](#15-stock-reconciliation-rules)
16. [Entity Reference — All 30 Entities](#16-entity-reference--all-30-entities)
17. [Business Logic & Formulas](#17-business-logic--formulas)
18. [Print Templates](#18-print-templates)
19. [Currency & Payments](#19-currency--payments)
20. [Arabic Language Support](#20-arabic-language-support)
21. [Critical Constraints — Never Violate](#21-critical-constraints--never-violate)

---

## 1. Business Overview

This is a charcoal import, warehousing, and distribution business based in Lebanon.

The business:
- Imports charcoal in containers from multiple suppliers
- Stores raw charcoal in a warehouse
- Repackages raw charcoal into bags of various sizes
- Sells to restaurants, shops, wholesalers, walk-in buyers, corporate clients, and exporters
- Delivers via drivers who cover multiple stops per trip
- Tracks all costs from container purchase through to final sale

### The core challenge this system solves

Raw charcoal enters the warehouse by weight (kg). It exits as counted bags. In between, a worker repacks it — but individual bags are never weighed during packing. The system must reconcile kg-in vs bags-out at all times so that a physical count of the warehouse always matches the system's numbers.

---

## 2. Technology Constraints

- All free-text fields must support Arabic input and display (RTL rendering)
- UI language is English only
- Drivers use the system on mobile — delivery and receipt printing flows must be mobile-first
- Receipt printing happens on-site via mobile printer connected to driver's phone
- Currency: USD and LBP — each client has one assigned currency
- Payment methods: cash, Whish, OMT
- Single warehouse, single owner account

---

## 3. User Roles & Permissions

There are 5 roles. Access is strictly enforced — never show data outside a role's permission set.

### 3.1 Owner
- Full access to all modules and all data
- Only role that can see **total profit**
- Only role that can **add or manage users**
- Only role that can **trigger physical stock counts**
- Only role that can **approve stock adjustments**
- Sets worker rate per bag type
- Pays worker (on demand, no fixed schedule)
- Manages container costs and expenses
- Sets client price rules (but price is entered at time of sale, not pre-set)

### 3.2 Sales Rep
- Can do most owner tasks **except**:
  - Cannot see total profit
  - Cannot see cost per kg
  - Cannot see container costs
  - Cannot add or manage users
  - Cannot adjust stock
- Can: create orders, split shipments, issue invoices, log payments, view client CRM and alerts, view packed stock quantities, log non-sale exits (samples, gifts)

### 3.3 Accountant
- Container costs and expenses (add/edit)
- All financial reports
- Client ledger and payment logging
- Stock value report
- Invoices and receipts
- Cannot: adjust stock, add users, see total profit

### 3.4 Worker
- Start and complete packing sessions
- Log kg consumed from a lot
- Log bag output by bag type
- Log non-sale exits (samples, internal use)
- Cannot see: prices, costs, client information

### 3.5 Driver
- View assigned delivery trips and stops
- Log actual weight per shipment
- Confirm delivery at each stop
- Print receipt on mobile printer
- Log returns
- Log fuel and trip expenses
- Cannot see: prices, costs, or create orders

---

## 4. Core Concepts & Definitions

### 4.1 Charcoal identity
Every piece of charcoal in the system has three identifiers:
- **Type** — the product name (e.g. BBQ hardwood, shisha, restaurant grade)
- **Grade** — quality level (e.g. A, B, C)
- **Supplier** — which supplier it came from

These three together form a unique stock identity. Two lots of "BBQ Grade A" from different suppliers are **never merged** — they are separate lots with separate costs.

### 4.2 Stock lot
A stock lot is a batch of raw charcoal in the warehouse. It has:
- A fixed `kg_received` (set on arrival, never changes)
- A live `kg_remaining` (decreases as packing sessions consume from it)
- A `cost_per_kg` (calculated from the container's all-in cost, never changes after arrival)

### 4.3 Bag type
A bag type is a packaging category, not an exact weight. Examples:
- "2kg bag" — actual bag contents may vary from 1.8kg to 2.2kg. This variation is normal and expected.
- "5kg bag", "10kg bag", "1.9kg bag"
- The **1.9kg bag and 2kg bag use the same physical bag**. They are different bag types in the system because the nominal weight differs, but the bag purchase cost is the same.
- Each bag type has: `nominal_kg`, `cost_per_bag` (what you pay for the empty bag), `worker_rate` (fixed amount the worker earns per bag of this type packed)

### 4.4 Packing session
The core warehouse operation. A worker takes raw charcoal from a lot and repacks it into bags.
- Input is measured: worker weighs the raw charcoal taken from the lot (`kg_consumed`)
- Output is counted: worker logs how many bags of each bag type were produced
- Individual bags are **never weighed** during packing
- The difference between input and output is `variance_kg` — always logged, never hidden

### 4.5 Packed stock
After a packing session, the output bags move to the packed zone of the warehouse. Packed stock is tracked by bag type and quantity, not by individual bag.

### 4.6 Client debit balance
`balance = Σ all invoices issued − Σ all payments received`
A positive balance means the client owes money. This is their debit.

### 4.7 Price at time of sale
There is no pre-set price list per client. The sales rep enters the price per bag when creating each order. This is intentional — a walk-in buyer purchasing one bag pays a different price than a restaurant ordering 300kg of the same product.

---

## 5. Module 1 — Container Tracker

### Purpose
Track the full cost of each incoming container from purchase through to warehouse arrival. Replaces the owner's existing standalone container tracking app. When a container is marked as arrived, it automatically creates stock lots in the warehouse.

### Who uses it
Owner and accountant.

### Container lifecycle
```
Created → At port → In transit → Arrived at warehouse
```
A container can be created at any stage. Expenses can be added at any stage, including after arrival.

### Product lines
Each container has one or more product lines. A product line is one charcoal type inside the container.

**Product line fields:**
- `type` — charcoal type (e.g. BBQ hardwood)
- `grade` — quality grade (e.g. A, B, C)
- `supplier_id` — which supplier
- `paid_bags` — number of bags paid for
- `gift_bags` — number of bags given free by supplier
- `kg_per_bag` — **reference only, not used in cost calculations**
- `price_per_ton` — what you paid the supplier per ton

### Expenses
- Free-text description + amount (USD)
- Common examples: truck, freight, agent fees, port fees, paper/admin, worker unloading, Beirut port expenses
- No fixed category list — operator types whatever the expense is
- Can be added **after the container has arrived** — a late invoice still gets logged
- When a new expense is added, all cost calculations recalculate automatically

### Discount
- One discount amount per container
- Applied as a reduction in cost
- Split across product lines proportionally by tonnage

### Expense allocation logic
Expenses are split across product lines **proportionally by tonnage** (not equally).

```
product_line_tonnage = paid_bags × kg_per_bag / 1000
total_tonnage = Σ all product lines tonnage

product_line_expense_share = (product_line_tonnage / total_tonnage) × total_expenses
expense_per_ton_for_line = product_line_expense_share / product_line_tonnage
```

### Cost report (live, recalculates on every change)
Per product line:
- `base_cost` = paid_bags × (price_per_ton / 1000 × kg_per_bag)
- `expense_per_ton` = this line's share of total expenses / tonnage
- `discount_per_ton` = discount × (this line's tonnage / total tonnage) / this line's tonnage
- `all_in_cost_per_ton` = price_per_ton + expense_per_ton − discount_per_ton
- `all_in_cost_per_kg` = all_in_cost_per_ton / 1000

Container totals:
- Total weight (tons)
- Total product cost
- Total expenses
- Total discount
- Average cost per ton
- Average cost per kg

### On arrival → auto-create stock lots
When owner marks container status as "Arrived at warehouse":
- One stock lot is created per product line
- `lot.kg_received` = paid_bags × kg_per_bag
- `lot.cost_per_kg` = product line's `all_in_cost_per_kg` at time of arrival
- `lot.source` = "container"
- `lot.kg_remaining` = `lot.kg_received` (starts full)

**Important:** If expenses are added after arrival and `cost_per_kg` changes, the lot's `cost_per_kg` **updates automatically**. The stock value report will reflect the updated cost.

### Direct warehouse addition (no container)
Some stock is added directly to the warehouse without a container record. Owner enters: type, grade, supplier, kg received, cost per kg, date. This creates a stock lot with `source = "direct"`.

---

## 6. Module 2 — Warehouse & Stock

### Purpose
Track all charcoal in the warehouse in real time. The system's total kg must always be reconcilable with a physical count.

### Two zones

**Zone 1 — Raw lots**
Raw, unpacked charcoal. Tracked by lot (see stock lot definition). Each lot decreases only when a packing session consumes from it.

**Zone 2 — Packed goods**
Bags ready for sale. Tracked by bag type and quantity. Increases when a packing session completes. Decreases when an exit is recorded (sale, sample, gift, etc.).

### Bag purchases
The business buys empty bags to pack charcoal into. This is a real cost.
- Logged as: bag type, quantity purchased, cost per bag, date
- The cost per bag is stored on the bag type record
- Bag cost is factored into profitability calculations (not into `cost_per_kg` of the lot, but as a separate line in P&L)

### Physical stock count
- Triggered by owner only — no fixed schedule
- Done lot by lot (raw zone) and bag type by bag type (packed zone)
- For each item: owner enters the physically counted quantity
- System calculates: `difference = system_quantity − counted_quantity`
- If difference ≠ 0: owner must enter a reason, then approve the adjustment
- A `stock_adjustment` record is created with: date, user, before, after, difference, reason
- **The system never auto-corrects silently**

### System stock formula
```
Total system kg =
  Σ (lot.kg_remaining for all open lots)
  + Σ (packed_stock.qty × bag_type.nominal_kg for all bag types)
  − (this is the number that must match a physical count)
```

---

## 7. Module 3 — Packing Sessions

### Purpose
Record the conversion of raw charcoal lots into packed bags. This is the only way stock moves from Zone 1 (raw) to Zone 2 (packed).

### Who uses it
Worker (creates sessions). Owner can view all sessions and reports.

### Session flow

**Step 1 — Select lot**
Worker picks which stock lot to open. System shows: type, grade, supplier, kg remaining.

**Step 2 — Set mode**
- `stock` — output goes to general packed stock inventory
- `order` — output is reserved for a specific client order (worker selects the order)

**Step 3 — Log kg consumed**
Worker weighs the raw charcoal they are about to pack. Enters the weight. This immediately reduces `lot.kg_remaining`.

**Step 4 — Pack bags**
Worker packs freely. No per-bag tracking. The system does nothing during this step.

**Step 5 — Log output**
Worker enters counts per bag type:
```
Example: 100 × 2kg bag, 20 × 5kg bag, 50 × 10kg bag
```
System calculates:
```
kg_output_total = (100 × 2) + (20 × 5) + (50 × 10) = 900kg
```

**Step 6 — Session closes**
```
variance_kg = kg_consumed − kg_output_total
```
- If variance > 0: charcoal was lost (dust, breakage, etc.) — normal and expected
- If variance < 0: output exceeds input — this is an error, system flags it and requires explanation
- Variance is always logged, never hidden

Packed stock records are created:
- One record per bag type in the output
- Linked to the session and the source lot

### Worker earnings
- Owner sets a `worker_rate` per bag type (e.g. $0.05 per 2kg bag, $0.12 per 10kg bag)
- After each session closes, earnings are calculated:
  ```
  session_earnings = Σ (bags_produced_of_type × worker_rate_for_type)
  ```
- Worker's running total (`total_bags_packed`, `total_owed`) updates automatically
- Owner pays whenever they choose — no fixed pay period
- When owner logs a payment to worker: `total_owed` decreases accordingly
- No payslip generation required — just show total bags by type and total amount owed

---

## 8. Module 4 — Client CRM

### Purpose
Manage all client relationships, track debit balances, flag clients who haven't ordered recently.

### Client types
`restaurant` | `shop` | `wholesale` | `walk-in` | `company/corporate` | `export`

### Client profile fields
- `name` — Arabic supported
- `type` — from list above
- `currency` — USD or LBP (applies to all their invoices and payments)
- `phones` — array of phone numbers, each with: number, label (mobile/office/WhatsApp), `is_active` boolean, date added. **Old numbers are kept, never deleted.**
- `preferred_charcoal_types` — array of charcoal type + grade combinations this client usually orders
- `avg_order_days` — calculated automatically from order history: average number of days between consecutive orders
- `notes` — free text, Arabic supported
- `balance` — computed: Σ invoices − Σ payments (positive = client owes money)
- `payment_terms` — e.g. "net 15", "cash on delivery", free text

### CRM alert page
A dedicated page showing clients who are overdue for an order.

Logic:
```
days_since_last_order = today − client.last_order_date
overdue = days_since_last_order > client.avg_order_days
```

Display:
- List of overdue clients sorted by most overdue first
- For each: client name, type, days since last order, avg order days, current balance
- Clicking a client opens their full profile — no action taken from this page, just view
- Accessible by: owner and sales rep

### Client history
Full order history, payment history, and phone number history all accessible from the client profile.

---

## 9. Module 5 — Orders & Invoicing

### Purpose
Create sales orders, split them into delivery shipments, generate invoices, and track payments.

### Order types by sales scenario

**Restaurant / delivery order**
- Created by sales rep on mobile
- Client selected, charcoal type + grade selected, total kg entered
- Price per bag entered at time of order creation (not pre-set)
- Order split into shipments (see Module 6)
- Invoice generated after delivery confirmation

**Walk-in warehouse buyer**
- Customer at warehouse, weighed on spot
- Sales rep or owner creates a quick sale: buyer name, bag type, actual weight recorded, price per bag
- Payment: immediate (cash/Whish/OMT) or goes on account
- Receipt printed immediately

**Direct bag sale (as-is from supplier)**
- Bags sold without repacking
- Treated as a regular order but bags come from a specific lot, not the packed zone

**Client brings own bags**
- Client provides empty bags, you fill them
- Charged per bag filled (your charcoal, their bags)
- System records: how many bags client brought, how many were filled
- Bag cost = zero (client's bags, not yours)
- Stock exits: the charcoal weight equivalent of bags filled

**Non-sale exits**
- Reason: `sample` | `gift` | `internal_use`
- Fields: bag type, quantity, reason, optional recipient name, date
- Creates a stock exit record
- No invoice generated
- Logged as a cost in P&L

### Invoice structure
```
invoice_line = bag_type × quantity × price_per_bag
invoice_total = Σ invoice_lines
currency = client.currency (USD or LBP)
```

### Payment logging
- Method: cash | Whish | OMT
- Partial payments allowed
- Each payment logs: amount, method, date, logged by (user)
- `client.balance` updates on every payment

---

## 10. Module 6 — Fill Jobs (Client-Provided Bags)

### Purpose
Handle the "fill client" workflow: a client supplies empty bags, the warehouse fills them with charcoal, and tracks the charcoal cost.

### Client Type
Clients with `type = "fill_client"` can create fill jobs. These are typically walk-in buyers or regular clients who prefer to supply their own bags rather than buy ours.

### Fill Job Workflow

**Step 1 — Create fill job**
Client brings bags to warehouse. Sales rep or owner creates a fill job:
- Client selected
- Date
- Worker assigned (optional — for piece-rate tracking)
- Bags to fill (list of bag types and quantities)

**Step 2 — Log charcoal source**
Worker takes charcoal from one or more stock lots and fills the bags. After filling, the fill job records:
- Which lot(s) were used and how many kg from each
- Total charcoal kg used (Σ of all lots)
- Total bags filled

**Step 3 — Calculate cost**
Per lot used:
```
cost_per_kg = lot's current cost_per_kg
kg_used = weighed by worker
cost = kg_used × cost_per_kg
```

Totals:
```
totalCharcoalKg = Σ kg_used across all lots
totalBags = Σ bags by type
totalCost = Σ cost per lot = Σ (kg_used × costPerKg)
```

### FillJob Fields
```
id              uuid PK
clientId        uuid FK → Client
date            date
workerEntityId  uuid FK → Worker (optional)
bagOutputs      jsonb         — [{bagTypeId, quantity}]
totalCharcoalKg decimal       — sum of all lot kg used
totalBags       integer       — sum of all bags filled
totalCost       decimal       — sum of (kg_used × cost_per_kg) per lot
notes           text          — Arabic supported
```

### FillJobLot
One record per lot used in the fill job.
```
id         uuid PK
fillJobId  uuid FK → FillJob
lotId      uuid FK → Stock lot
kgUsed     decimal               — weight taken from lot
costPerKg  decimal (snapshot)    — lot's cost_per_kg at time of fill
cost       decimal               — computed: kgUsed × costPerKg
```

### Stock Deduction
After a fill job completes:
- Each lot's `kg_remaining` decreases by `kgUsed`
- Packed stock is **not** created (client brings their own bags, we don't track them)
- A stock exit is created with `exitType = "client_bags_fill"`

### Difference from Packing Sessions

| Aspect | Packing Session | Fill Job |
|--------|---|---|
| **Output** | Packed stock (our bags) | None (client's bags) |
| **Bag cost** | Applied (we buy bags) | Not applied (client's bags) |
| **Worker earnings** | Optional rate per bag type | Not tracked (different workflow) |
| **Stock exit** | Created for sales only | Created for every fill job |
| **Variance** | Tracked (loss during packing) | Not tracked (client owns bags) |

### Fill Job vs Walk-in Sale
- **Walk-in**: Customer buys bags at warehouse, weighed, paid immediately, stock exits
- **Fill client**: Customer supplies bags, we fill and charge per bag or per kg, stock exits same way

Both are non-packing flows. Fill jobs are specifically for clients who bring bags repeatedly.

---

## 11. Module 7 — Delivery

### Purpose
Manage driver trips from warehouse to delivery locations. One trip covers multiple stops.

### Delivery flow

**Order splitting (done by sales rep)**
When a client orders 300kg:
- Sales rep creates shipments within the order
- Each shipment: delivery address, bags to deliver (bag type × quantity)
- Multiple shipments can go in one driver trip
- One driver trip can cover multiple clients / multiple orders

**Driver trip**
A driver trip contains one or more shipments (potentially from multiple orders/clients).

**At the warehouse (loading)**
- Driver sees all shipments assigned to their trip
- Driver loads bags, then weighs each shipment
- Driver enters actual weight per shipment (e.g. 302kg, 290kg, 295kg)
- Actual weight vs nominal weight (bag count × nominal kg) difference is noted — this is a reconciliation check, **not used for billing**. Billing is always based on bag count × price per bag.

**At the delivery location**
- Driver arrives at stop
- Driver confirms bags unloaded
- System generates delivery receipt
- Driver prints receipt on mobile printer and hands to client
- This receipt is the physical confirmation document

**After delivery confirmation**
- Packed stock is removed from system
- Invoice status updates
- If client pays on delivery: payment logged immediately
- If on account: balance updates

**Returns**
- If client refuses or returns bags:
- Driver logs: bag type, quantity returned, reason
- Returned bags re-enter packed stock as a new packed stock record
- Original invoice adjusted or credited

**Driver expenses**
- Per trip: fuel cost, toll fees, other
- Free text + amount
- Logged after trip completes

### Receipt format (printed on mobile printer)
- Company name
- Date and time
- Client name and address
- Delivery contents: bag type, quantity, price per bag, line total
- Total amount
- Currency
- Payment status (paid / on account)
- Driver name
- Signature line for client

---

## 12. Module 8 — Suppliers

### Purpose
Maintain supplier profiles for procurement reference.

### Supplier fields
- `name` — Arabic supported
- `country`
- `contact_persons` — array: name, phone, role
- `charcoal_types_supplied` — array of type + grade combinations this supplier offers
- `bank_details` — bank name, account number, IBAN, SWIFT
- `payment_terms` — free text (e.g. "30% upfront, 70% on BL")
- `lead_time_days` — typical days from order to shipment
- `notes` — free text, Arabic supported
- `purchase_history` — all containers linked to this supplier (read-only, computed)

---

## 13. Module 9 — Reports & Reconciliation

### Who sees what
- **Owner**: all reports including total profit, cost per kg, container costs, worker earnings
- **Accountant**: all financial reports except total profit
- **Sales rep**: client ledger only (invoiced amounts, payments, outstanding — no cost data)

### Report: Profit & Loss
```
Revenue = Σ all paid invoices (in USD equivalent)
COGS = Σ (kg sold × cost_per_kg per lot) for all exits
Bag cost = Σ (bags sold × cost_per_bag per bag type)
Variances = Σ (session.variance_kg × lot.cost_per_kg) for all sessions
Delivery expenses = Σ driver trip expenses
Container expenses = Σ all container expenses (already in cost_per_kg but shown separately)

Gross profit = Revenue − COGS − Bag cost − Variances − Delivery expenses
```
Filterable by: date range, charcoal type, client, client type

### Report: Stock value
```
Raw stock value = Σ (lot.kg_remaining × lot.cost_per_kg)
Packed stock value = Σ (packed_stock.qty × bag_type.nominal_kg × source_lot.cost_per_kg)
Total warehouse value = Raw stock value + Packed stock value
```

### Report: Variance report
Per session: date, worker, lot used, kg consumed, kg output, variance kg, variance %
Per charcoal type: total variance kg, total variance cost
Per worker: total variance kg across all sessions

### Report: Physical count reconciliation
Triggered by owner. Shows:
- System qty vs counted qty per lot
- System qty vs counted qty per bag type
- Total difference in kg and in value
- All pending adjustments requiring approval

### Report: Container cost report
Full breakdown matching the container tracker view. All containers with:
- Products, expenses, discounts
- Cost per ton and per kg per product line
- Status and arrival date

### Report: Client ledger
Per client:
- All invoices (date, amount, currency, status)
- All payments (date, amount, method)
- Running balance
- Outstanding total in USD and LBP

### Report: Worker earnings
- Total bags packed by bag type (all time or filtered by date)
- Rate per bag type
- Total earned
- Total paid
- Total outstanding

---

## 14. Sales Scenarios

### S1 — Walk-in warehouse buyer
- Customer arrives at warehouse unannounced
- Goods weighed on the spot
- Price negotiated and entered at time of sale
- Can pay immediately (cash/Whish/OMT) or go on account
- Receipt printed on spot
- Stock exits immediately on sale confirmation

### S2 — Restaurant delivery (primary flow)
- Sales rep receives order (phone/WhatsApp)
- Sales rep creates order in system on mobile
- Order split into shipments by location
- Driver assigned to trip covering multiple shipments
- Driver loads, weighs each shipment
- Driver delivers stop by stop, prints receipt at each stop
- Stock exits on delivery confirmation
- Payment logged (on delivery or on account)

### S3 — Bags sold as-is from supplier
- Some supplier bags are sold directly without repacking
- These exit directly from raw lot stock (not packed zone)
- Sometimes broken down into smaller bags (e.g. 10kg) by worker — worker earns rate per bag

### S4 — Client brings own bags
- Client supplies empty bags
- Worker fills bags with charcoal
- Charged per bag filled
- System tracks: bags brought by client, bags filled, charcoal kg used
- No bag purchase cost applied (client's bags)

### S5 — Sample / gift / internal use
- No invoice generated
- Stock exits with: reason, bag type, qty, optional recipient, date
- Logged as a cost in P&L

### S6 — Export / corporate order
- Same flow as S2 but client type is `export` or `company/corporate`
- May use client's own bags (S4 variant) or your bags
- Uses export-appropriate invoice template

---

## 15. Stock Reconciliation Rules

This is the core accounting guarantee of the system.

### The formula
```
System total kg =
  Σ lot.kg_remaining (all open lots)
  + Σ (packed_stock.qty × bag_type.nominal_kg) (all bag types)
```

This number must equal what you would count in a physical warehouse count.

### How every movement is tracked

| Event | Effect on system |
|---|---|
| Container arrives | New stock lot created, `kg_received` and `kg_remaining` set |
| Direct stock addition | New stock lot created |
| Packing session starts | `lot.kg_remaining` decreases by `kg_consumed` |
| Packing session ends | Packed stock records created for each bag type in output |
| Sale / delivery confirmed | Packed stock qty decreases |
| Non-sale exit (sample etc.) | Packed stock qty decreases |
| Return from client | Packed stock qty increases (new record) |
| Physical count adjustment | `lot.kg_remaining` or `packed_stock.qty` updated, adjustment record created |

### Variance
```
session.variance_kg = kg_consumed − Σ (bags_output_qty × bag_type.nominal_kg)
```
- Positive variance = loss (dust, breakage) — expected and normal
- Negative variance = output exceeds input — error, requires explanation
- Variance is a real cost — it appears in P&L

### Rules the system must enforce
1. `lot.kg_remaining` can never go below 0
2. `packed_stock.qty` can never go below 0
3. A packing session cannot consume more than `lot.kg_remaining`
4. A shipment cannot dispatch more bags than exist in packed stock
5. Every stock exit must have a reason and a linked user
6. No stock movement happens without a logged record

---

## 16. Entity Reference — All 30 Entities

### Container
```
id                uuid PK
number            string        — container reference number
supplier_id       uuid FK → Supplier
status            enum          — port | transit | arrived
arrival_date      date nullable
notes             text          — Arabic supported
created_by        uuid FK → User
created_at        timestamp
```

### Container product line
```
id                uuid PK
container_id      uuid FK → Container
charcoal_type     string        — e.g. "BBQ hardwood"
grade             string        — e.g. "A", "B", "C"
supplier_id       uuid FK → Supplier
paid_bags         integer
gift_bags         integer
kg_per_bag        decimal       — REFERENCE ONLY, not used in cost calculations
price_per_ton     decimal       — supplier's price in USD per ton
```
Computed fields (not stored, always calculated live):
```
tonnage           = paid_bags × kg_per_bag / 1000
base_cost         = paid_bags × (price_per_ton / 1000 × kg_per_bag)
expense_per_ton   = container's total expenses × (this_tonnage / total_container_tonnage) / this_tonnage
discount_per_ton  = container.discount × (this_tonnage / total_tonnage) / this_tonnage
all_in_cost_per_ton = price_per_ton + expense_per_ton − discount_per_ton
all_in_cost_per_kg  = all_in_cost_per_ton / 1000
```

### Container expense
```
id                uuid PK
container_id      uuid FK → Container
description       string        — free text, Arabic supported
amount            decimal       — USD
added_by          uuid FK → User
added_at          timestamp
```

### Container discount
```
id                uuid PK
container_id      uuid FK → Container (one per container)
amount            decimal       — USD
```

### Stock lot
```
id                uuid PK
charcoal_type     string
grade             string
supplier_id       uuid FK → Supplier
kg_received       decimal       — set on creation, never changes
kg_remaining      decimal       — updated by packing sessions and adjustments
cost_per_kg       decimal       — set on creation from container all_in_cost_per_kg; updates if container expenses change
source            enum          — container | direct
container_id      uuid nullable FK → Container
date_received     date
notes             text          — Arabic supported
```

### Bag type
```
id                uuid PK
name              string        — e.g. "2kg bag", "10kg bag"
nominal_kg        decimal       — declared weight (e.g. 2.0)
cost_per_bag      decimal       — what you pay for empty bag (USD)
worker_rate       decimal       — fixed amount worker earns per bag of this type packed
note              string        — e.g. "same physical bag as 1.9kg"
```

### Bag purchase
```
id                uuid PK
bag_type_id       uuid FK → Bag type
quantity          integer
unit_cost         decimal
total_cost        decimal       — computed: quantity × unit_cost
date              date
added_by          uuid FK → User
```

### Packed stock
```
id                uuid PK
lot_id            uuid FK → Stock lot   — which raw lot this came from
bag_type_id       uuid FK → Bag type
quantity          integer
session_id        uuid FK → Packing session
created_at        timestamp
```

### Packing session
```
id                uuid PK
lot_id            uuid FK → Stock lot
worker_id         uuid FK → Worker
mode              enum          — stock | order
order_id          uuid nullable FK → Client order
kg_consumed       decimal       — input weight, reduces lot.kg_remaining
bags_output       jsonb         — array: [{bag_type_id, quantity}]
kg_output_total   decimal       — computed: Σ (qty × bag_type.nominal_kg)
variance_kg       decimal       — computed: kg_consumed − kg_output_total
session_earnings  decimal       — computed: Σ (qty × bag_type.worker_rate)
date              date
started_at        timestamp
completed_at      timestamp
notes             text          — Arabic supported
```

### Stock adjustment
```
id                uuid PK
adjustment_type   enum          — lot | packed_stock
lot_id            uuid nullable FK → Stock lot
packed_stock_id   uuid nullable FK → Packed stock
qty_before        decimal
qty_after         decimal
difference        decimal       — qty_after − qty_before
reason            text          — required, Arabic supported
counted_by        uuid FK → User
approved_by       uuid FK → Owner
date              date
```

### Client
```
id                uuid PK
name              string        — Arabic supported
type              enum          — restaurant | shop | wholesale | walk-in | corporate | export
currency          enum          — USD | LBP
phones            jsonb         — array: [{number, label, is_active, date_added}]
preferred_types   jsonb         — array: [{charcoal_type, grade}]
avg_order_days    decimal       — auto-calculated from order history
last_order_date   date          — auto-updated
balance           decimal       — computed: Σ invoices − Σ payments (positive = owes money)
payment_terms     string        — free text
notes             text          — Arabic supported
created_at        timestamp
```

### Client order
```
id                uuid PK
client_id         uuid FK → Client
charcoal_type     string
grade             string
total_kg_requested decimal
price_per_bag     decimal       — entered at time of sale
bag_type_id       uuid FK → Bag type
currency          enum          — USD | LBP (inherits from client)
status            enum          — draft | confirmed | partially_delivered | delivered | invoiced | paid
created_by        uuid FK → User
created_at        timestamp
notes             text          — Arabic supported
```

### Shipment
```
id                uuid PK
order_id          uuid FK → Client order
trip_id           uuid nullable FK → Driver trip
address           string        — Arabic supported
bags              jsonb         — array: [{bag_type_id, quantity}]
nominal_kg        decimal       — computed: Σ (qty × bag_type.nominal_kg)
actual_kg         decimal nullable  — entered by driver at loading
status            enum          — pending | loaded | delivered | returned
delivered_at      timestamp nullable
```

### Driver trip
```
id                uuid PK
driver_id         uuid FK → User (driver role)
shipments         uuid[]        — array of shipment IDs
status            enum          — planned | in_progress | completed
fuel_cost         decimal nullable
other_expenses    jsonb         — [{description, amount}]
started_at        timestamp
completed_at      timestamp nullable
notes             text          — Arabic supported
```

### Stock exit
```
id                uuid PK
packed_stock_id   uuid FK → Packed stock
bag_type_id       uuid FK → Bag type
quantity          integer
exit_type         enum          — order | walk_in | sample | gift | internal | client_bags_fill
reason            text nullable — Arabic supported
recipient         string nullable — Arabic supported
order_id          uuid nullable FK → Client order
logged_by         uuid FK → User
date              date
```

### Invoice
```
id                uuid PK
order_id          uuid nullable FK → Client order
client_id         uuid FK → Client
lines             jsonb         — [{bag_type_id, bag_type_name, qty, price_per_bag, line_total}]
subtotal          decimal
total             decimal
currency          enum          — USD | LBP
status            enum          — draft | issued | partially_paid | paid | cancelled
paid_amount       decimal       — default 0
issued_at         timestamp
due_date          date nullable
```

### Payment
```
id                uuid PK
client_id         uuid FK → Client
invoice_id        uuid nullable FK → Invoice
amount            decimal
currency          enum          — USD | LBP
method            enum          — cash | whish | omt
date              date
logged_by         uuid FK → User
notes             text          — Arabic supported
```

### Worker
```
id                uuid PK
name              string        — Arabic supported
phone             string
rates_per_bag_type jsonb        — [{bag_type_id, rate_per_bag}]
total_bags_packed jsonb         — [{bag_type_id, count}] — running total
total_earned      decimal       — running total
total_paid        decimal       — running total
total_owed        decimal       — computed: total_earned − total_paid
notes             text
```

### Supplier
```
id                uuid PK
name              string        — Arabic supported
country           string
contact_persons   jsonb         — [{name, phone, role}]
charcoal_types    jsonb         — [{type, grade}]
bank_details      jsonb         — {bank_name, account_number, iban, swift}
payment_terms     string
lead_time_days    integer nullable
notes             text          — Arabic supported
```

---

## 17. Business Logic & Formulas

### Container cost allocation
```
line_tonnage[i] = paid_bags[i] × kg_per_bag[i] / 1000
total_tonnage = Σ line_tonnage[i]
expense_share[i] = total_expenses × (line_tonnage[i] / total_tonnage)
discount_share[i] = total_discount × (line_tonnage[i] / total_tonnage)
all_in_cost_per_ton[i] = price_per_ton[i] + (expense_share[i] / line_tonnage[i]) − (discount_share[i] / line_tonnage[i])
all_in_cost_per_kg[i] = all_in_cost_per_ton[i] / 1000
```

### Stock lot kg remaining
```
lot.kg_remaining = lot.kg_received − Σ session.kg_consumed (for all sessions using this lot) + Σ adjustment.difference (for all adjustments on this lot)
```

### Client balance
```
client.balance = Σ invoice.total (all invoices for client, all currencies converted to client.currency) − Σ payment.amount (all payments from client)
```

### Client avg_order_days
```
order_dates = sorted list of all confirmed order dates for client
gaps = [order_dates[i+1] − order_dates[i] for i in range(len−1)]
avg_order_days = mean(gaps)
-- Minimum 2 orders required to calculate; null if only 1 or 0 orders
```

### Worker total owed
```
worker.total_owed = Σ session.session_earnings − Σ payments_to_worker
```

### Session earnings
```
session.session_earnings = Σ (bags_output[type].quantity × worker.rates_per_bag_type[type].rate)
```

### Packing session variance
```
variance_kg = kg_consumed − Σ (bags_output[type].quantity × bag_type[type].nominal_kg)
-- Must be ≥ 0 normally. If negative, flag as error and require explanation.
```

### P&L gross profit
```
revenue = Σ invoice.total (convert all to USD using exchange rate at time of invoice)
cogs = Σ (stock_exit.quantity × bag_type.nominal_kg × source_lot.cost_per_kg)
bag_cost = Σ (stock_exit.quantity × bag_type.cost_per_bag) for order exits only
variance_cost = Σ (session.variance_kg × session.lot.cost_per_kg)
delivery_cost = Σ driver_trip.fuel_cost + Σ driver_trip.other_expenses
gross_profit = revenue − cogs − bag_cost − variance_cost − delivery_cost
```

---

## 18. Print Templates

Two templates required. Both must print cleanly on a mobile thermal printer (58mm or 80mm roll).

### Delivery receipt (printed by driver at restaurant)
```
[Company name]
[Date] [Time]

Receipt #[invoice_id short]
Client: [client.name]
Address: [shipment.address]

Item                Qty    Price    Total
[bag_type.name]     [n]    [$x/bag] [$xx]
...

Subtotal:           [$xx]
Currency:           [USD / LBP]
Payment:            [Paid / On Account]

Driver: [driver.name]
Client signature: ___________
```

### Invoice (office printing, A4)
Full invoice with: company header, client details, order lines, totals, payment terms, balance outstanding.

---

## 19. Currency & Payments

- Each client is assigned one currency: USD or LBP
- All invoices for that client use their assigned currency
- Payments are logged in the invoice currency
- Reports show totals in USD (LBP amounts converted using rate stored at time of transaction)
- Payment methods: cash | Whish | OMT
- Partial payments are allowed — invoice status tracks paid_amount vs total

---

## 20. Arabic Language Support

- All free-text fields accept Arabic input
- Arabic text must render correctly (right-to-left where appropriate within a field)
- UI chrome (labels, buttons, navigation) stays in English
- Fields that must support Arabic: client names, driver names, supplier names, delivery addresses, expense descriptions, notes fields, recipient names, contact person names
- Printing: receipts and invoices must render Arabic text correctly

---

## 21. Critical Constraints — Never Violate

These are hard rules. The system must enforce them at the data layer, not just the UI.

```
CONSTRAINT 1:  lot.kg_remaining >= 0 at all times
CONSTRAINT 2:  packed_stock.qty >= 0 at all times
CONSTRAINT 3:  session.kg_consumed <= lot.kg_remaining (before session starts)
CONSTRAINT 4:  shipment bag qty <= available packed_stock.qty per bag type
CONSTRAINT 5:  Every stock exit has: exit_type, bag_type_id, quantity, logged_by, date
CONSTRAINT 6:  Every stock adjustment has: reason, before, after, approved_by (owner only)
CONSTRAINT 7:  session.variance_kg < 0 is an error — requires explanation before session closes
CONSTRAINT 8:  Costs are never blended across lots — same type from different suppliers = separate lots
CONSTRAINT 9:  Container expenses can be added after arrival — cost_per_kg on lot must recalculate
CONSTRAINT 10: Price is set at time of sale — no pre-set price list enforced by system
CONSTRAINT 11: Total profit is visible to owner role only
CONSTRAINT 12: cost_per_kg is visible to owner and accountant only — never shown to sales rep or worker
CONSTRAINT 13: Physical count adjustments require owner approval — no silent auto-correction
CONSTRAINT 14: Phone numbers on clients are never deleted — only marked inactive
CONSTRAINT 15: Client balance is always computed from invoice and payment records — never manually set
```

---

*End of specification. Version 1.0. Update this document whenever business rules change.*
