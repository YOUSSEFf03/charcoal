# Charcoal Import & Distribution ERP System

A complete accounting and warehouse management system for charcoal import, storage, repackaging, and distribution operations. Built for a single-warehouse business with multiple user roles, real-time stock reconciliation, and comprehensive financial reporting.

---

## The Problem It Solves

Charcoal imports are tracked by weight (kg) in containers. Once in the warehouse, raw charcoal is repackaged into bags of various sizes — but individual bags are never weighed. The system must reconcile:

- **Raw stock**: total kg in each lot
- **Packed stock**: total bags by type × nominal weight
- **Stock variance**: loss during packing (dust, breakage) or errors
- **Financial accuracy**: cost per kg must stay correct even after expenses are added post-arrival

This system enforces full traceability from container arrival to final sale, with real-time balance verification.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Backend API** | NestJS (TypeScript) at `apps/backend/`, port 3001 |
| **Frontend SPA** | Vite + React at `src/`, port 5173 |
| **Database** | PostgreSQL with Prisma ORM |
| **Authentication** | Clerk JWT (Authorization: Bearer header) |
| **Package Manager** | npm (monorepo workspaces) |

---

## System Architecture

```
┌─────────────────────────────────────────────────┐
│  Vite + React Frontend (src/)                   │
│  Port: 5173                                      │
└────────────────────┬────────────────────────────┘
                     │ HTTP + Clerk JWT Bearer
                     ↓
┌─────────────────────────────────────────────────┐
│  NestJS Backend (apps/backend/)                 │
│  Port: 3001, Global prefix: /api/v1             │
│  - 19 modules (containers, warehouse, clients)  │
│  - Swagger docs: /api/docs                      │
│  - Clerk JWKS validation                        │
│  - 15 business constraint guards                │
└────────────────────┬────────────────────────────┘
                     │ Prisma ORM
                     ↓
┌─────────────────────────────────────────────────┐
│  PostgreSQL Database                            │
│  30 models / tables (each model maps 1:1)        │
│  Full ACID transactions                         │
└─────────────────────────────────────────────────┘
```

---

## Database Models (30 total)

**Core:**
- `User` (with Clerk sync)
- `Supplier`, `Container`, `ContainerProductLine`, `ContainerExpense`, `ContainerDiscount`

**Warehouse & Stock:**
- `StockLot`, `BagType`, `BagPurchase`, `PackedStock`

**Packing Operations:**
- `PackingSession`, `PackingSessionLot`, `Worker`, `WorkerPayment`

**Fill Jobs (client-provided bags):**
- `FillJob`, `FillJobLot`

**Clients & Orders:**
- `Client`, `ClientOrder`, `OrderBagLine`, `Shipment`, `ShipmentBag`

**Delivery:**
- `DriverTrip`, `StockExit`

**Financial:**
- `Invoice`, `Payment`, `StockAdjustment`

**Cash Management:**
- `CashHandover`, `UserAccount`, `AccountEntry`

**System:**
- `Setting`

---

## User Roles & Permissions

| Role | Key Access |
|------|-----------|
| **owner** | Full access. Only role that sees total profit, manages users, approves adjustments. |
| **accountant** | Expenses, invoices, financial reports, client ledgers. No profit visibility. |
| **sales_rep** | Orders, clients, shipments, payments. No cost or profit data. |
| **worker** | Packing sessions only. No prices, costs, or client information. |
| **driver** | Delivery trips, confirm deliveries, print receipts, log expenses. |
| **receiver** | Cash handovers, payments collection. |

---

## Core Features

### 1. Container Tracking

Import containers from suppliers with:
- Multiple product lines per container
- Expenses (freight, port fees, etc.) added before or after arrival
- Automatic cost-per-kg allocation across product lines
- Stock lots created automatically on arrival
- Live cost recalculation when expenses are added post-arrival

### 2. Warehouse Management

Two-zone warehouse:
- **Raw zone**: stock lots tracked by kg
- **Packed zone**: bags tracked by type and quantity

Full traceability with packing sessions:
- Input measured (kg consumed from lot)
- Output counted (bags produced per type)
- Variance logged (normal loss, or flagged if negative)
- Physical count reconciliation with owner approval

### 3. Client CRM

Client profiles with:
- Phone history (old numbers never deleted)
- Preferred charcoal types
- Debit balance computation
- Order frequency tracking
- CRM overdue alerts

### 4. Orders & Invoicing

Multiple order types:
- **Restaurant delivery** — split into shipments, driver assigns to trips
- **Walk-in warehouse sales** — weighed on spot, invoice printed immediately
- **Client-provided bags** — fill and track bag count
- **Non-sale exits** — samples, gifts, internal use

Invoices track:
- Line items (bag type, quantity, price per bag)
- Partial payments
- Currency per client (USD or LBP)
- Outstanding balance

### 5. Delivery & Logistics

Driver-centric workflow:
- Assign shipments to trips (one trip covers multiple stops)
- Log actual weight per shipment at loading
- Confirm delivery at each stop
- Print receipt on mobile printer
- Log returns with reason
- Track trip expenses (fuel, tolls)

### 6. Fill Jobs

**Client brings own bags workflow:**
- Client supplies empty bags
- Worker fills them with charcoal
- System tracks: bags brought, bags filled, charcoal kg used, cost per lot
- No bag purchase cost applied (client owns bags)

### 7. Financial Reports

- **Profit & Loss**: Revenue, COGS, bag cost, variance, delivery expenses
- **Stock Value**: Raw + packed stock value, warehouse total
- **Variance Report**: Per session, per charcoal type, per worker
- **Container Costs**: Full breakdown with cost-per-ton/kg
- **Client Ledger**: Invoices, payments, outstanding balance
- **Physical Count Reconciliation**: System vs. counted qty, pending approvals

---

## Quick Start

### Setup

```bash
# 1. Clone and install
git clone <repo> charcoal-erp
cd charcoal-erp
npm install

# 2. Start database
docker compose up -d

# 3. Set up .env (see SETUP.md)
# - DATABASE_URL in apps/backend/.env
# - CLERK_JWKS_URL in apps/backend/.env
# - VITE_API_URL in .env (repo root)

# 4. Database setup
cd apps/backend
npx prisma migrate dev --name init

# 5. Seed test data (optional)
npx prisma db seed
```

### Run Locally

```bash
# Terminal 1: Backend (from apps/backend/)
npm run start:dev
# → http://localhost:3001

# Terminal 2: Frontend (from repo root)
npm run dev
# → http://localhost:5173

# Terminal 3 (optional): Prisma Studio
cd apps/backend
npx prisma studio
# → http://localhost:5555
```

---

## API Documentation

Full interactive API docs at **http://localhost:3001/api/docs** (Swagger UI).

Key endpoints:

```
POST   /api/v1/auth/me                    — Current user info
GET    /api/v1/containers                — List containers (paginated)
POST   /api/v1/containers                — Create container
PATCH  /api/v1/containers/:id            — Update container status / add expenses
POST   /api/v1/packing-sessions          — Start + complete packing session
GET    /api/v1/clients                   — List clients
POST   /api/v1/orders                    — Create order
POST   /api/v1/shipments/:id/confirm     — Confirm delivery
POST   /api/v1/invoices                  — Generate invoice
GET    /api/v1/reports/profit-loss       — P&L report (owner only)
```

See `backend-docs/` for detailed endpoint documentation.

---

## Authentication

All requests (except `/health` and webhooks) require:

```bash
Authorization: Bearer <clerk_jwt>
```

**Development bypass:** Use `Authorization: Bearer dev:owner` to skip Clerk (development only).

Roles are stored in Clerk's `publicMetadata` and extracted from the JWT on each request.

---

## Database Constraints (Enforced at API Level)

1. `lot.kg_remaining >= 0` at all times
2. `packed_stock.qty >= 0` at all times
3. Packing sessions cannot consume more than available in lot
4. No path consumes more than FREE packed stock (qty − reserved_quantity); reserved bags are protected
5. Every stock exit must have: exit_type, bag_type, qty, logged_by, date
6. Every adjustment must have: reason, server-resolved before, after, status; approved_by ≠ counted_by, set on approval
7. Negative variance requires explanation before session closes
8. Lots from different suppliers are never merged
9. Container expenses added post-arrival recalculate cost_per_kg on all linked lots
10. Physical count adjustments require owner approval (no auto-correction); a non-owner counter submits a pending adjustment that applies no stock change until an owner approves it
11. Phone numbers never deleted, only marked inactive
12. Client balance always computed from invoices − payments

---

## Project Structure

```
charcoal-erp/
├── apps/
│   └── backend/                        ← NestJS API
│       ├── src/
│       │   ├── modules/                ← 19 feature modules
│       │   │   ├── auth/
│       │   │   ├── containers/
│       │   │   ├── warehouse/
│       │   │   ├── clients/
│       │   │   ├── orders/
│       │   │   ├── delivery/
│       │   │   ├── packing-sessions/
│       │   │   └── ...
│       │   ├── common/                 ← Guards, filters, decorators
│       │   ├── config/                 ← Env config
│       │   └── main.ts                 ← NestJS entry point
│       ├── prisma/
│       │   ├── schema.prisma           ← Database schema (30 models)
│       │   └── migrations/             ← Migration history
│       └── package.json                ← NestJS dependencies
│
├── src/                                ← Vite + React Frontend
│   ├── pages/                          ← React pages
│   ├── components/                     ← Reusable components
│   ├── services/                       ← API client services
│   ├── types/                          ← TypeScript types
│   └── main.tsx                        ← React entry point
│
├── SETUP.md                            ← Installation guide (START HERE)
├── SPEC.md                             ← Full business specification
├── README.md                           ← This file
├── docker-compose.yml                  ← Local PostgreSQL
├── package.json                        ← Monorepo root
└── .env                                ← Frontend environment variables
```

---

## Development Workflow

### Adding a Feature

1. **Design**: Update database schema in `apps/backend/prisma/schema.prisma`
2. **Migrate**: `npx prisma migrate dev --name feature_name`
3. **Backend**: Create/update NestJS module with controller + service
4. **Frontend**: Add React page/component and API service calls
5. **Test**: Run locally, verify against SPEC.md constraints

### Code Style

- **Backend**: NestJS conventions (providers, modules, decorators)
- **Frontend**: React hooks, functional components, TypeScript
- **Database**: Prisma — use transactions for multi-step operations
- **Types**: Shared types in each module's `dto/` folder

---

## Deployment

### Railway (Production)

1. Set environment variables on Railway (DATABASE_URL, Clerk keys, etc.)
2. Push to main branch
3. Railway auto-deploys both backend and frontend
4. Set `NODE_ENV=production` to disable dev auth bypass

See `backend-docs/` for deployment configuration details.

---

## Key Business Rules

**Never violate these** (system enforces at API level):

- Raw stock (kg) and packed stock (bags) always reconcile to a physical count
- Costs are never blended across suppliers — same type/grade from different suppliers = separate lots
- Container expenses added after arrival recalculate cost_per_kg on all linked lots
- Price is set at time of sale — no pre-set price list
- Total profit is visible to owner role only
- Cost per kg is visible to owner and accountant only
- Physical count adjustments require owner approval
- Phone numbers are never deleted, only marked inactive
- Client balance is always computed from invoice and payment records

---

## Documentation

- **SETUP.md** — Installation and local development setup
- **SPEC.md** — Complete business specification (read first)
- **backend-docs/README.md** — Backend overview and handoff
- **backend-docs/BACKEND_STRUCTURE.md** — NestJS module layout
- **backend-docs/AUTH.md** — Authentication and role-based access control

---

## Support

For questions about:
- **Business logic**: See `SPEC.md`
- **API endpoints**: Visit Swagger docs at `/api/docs` (when running locally)
- **Setup issues**: See `SETUP.md` → Troubleshooting
- **Database schema**: See `apps/backend/prisma/schema.prisma`

---

## Version

**v1.0** — Initial release with all 8 core modules (containers, warehouse, packing, clients, orders, delivery, fill jobs, reports).

---

*Last updated: 2026-06-01*
