# Backend Handoff Package — Charcoal Business Accounting System

Everything the backend team needs to start implementation immediately.

---

## Quick Start for the Backend Team

1. Read **SPEC.md** (root of project) — the full business spec
2. Read **schema.prisma** (root) — all 23 database entities
3. Read **AUTH.md** here — auth flow, roles, middleware pattern
4. Import **postman_collection.json** into Postman and set your `AUTH_TOKEN`
5. Review **SAMPLE_PAYLOADS.md** for realistic request/response examples
6. Start building routes following **BACKEND_STRUCTURE.md**

---

## File Index

| File | Purpose |
|------|---------|
| **openapi.yaml** | Full OpenAPI 3.0 spec — all endpoints, schemas, status codes |
| **postman_collection.json** | Postman collection — import directly, all requests ready |
| **API.md** | Human-readable API reference — every endpoint documented |
| **types/api.ts** | TypeScript interfaces for all request DTOs and responses |
| **AUTH.md** | Clerk JWT flow, role permissions matrix, middleware code |
| **DATABASE.md** | ERD summary, indexes, JSON field schemas, constraints |
| **BACKEND_STRUCTURE.md** | Folder layout, route pattern, service layer pattern |
| **SAMPLE_PAYLOADS.md** | Realistic JSON examples for every module |
| **.env.example** | All environment variables with descriptions |
| **mocks/db.ts** | Realistic seed data (suppliers, clients, orders, etc.) |
| **mocks/handlers.ts** | MSW request handlers — mock every endpoint |
| **services/api.ts** | Frontend base API client (axios + Clerk token injection) |
| **services/containers.service.ts** | Typed frontend service for containers module |
| **services/warehouse.service.ts** | Typed frontend service for warehouse + packing |
| **services/clients.service.ts** | Typed frontend service for clients + orders + invoices |
| **services/delivery.service.ts** | Typed frontend service for shipments + trips + suppliers |
| **services/reports.service.ts** | Typed frontend service for all reports |

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Database | PostgreSQL on Railway |
| ORM | Prisma |
| Auth | Clerk |
| Mobile | React Native + Expo |
| Monorepo | Turborepo |
| Packages | `packages/database` (Prisma schema), `packages/shared` (types) |

---

## API Conventions

- **Base URL**: `/api/v1/`
- **Auth**: `Authorization: Bearer <clerk_jwt>` on all routes except `/health` and `/webhooks/clerk`
- **Monetary values**: Always strings (e.g. `"8.50"`) — never numbers
- **Dates**: ISO 8601 (`2024-05-26T14:30:00.000Z`) or date-only (`2024-05-26`)
- **Pagination**: `{ data: T[], total: number, page: number, limit: number }`
- **Errors**: `{ error: string, code: string, details?: Record<string, string[]> }`

---

## The 15 Constraints — Never Violate

These must be enforced at the **API and database level**, not just the UI:

| # | Rule |
|---|------|
| 1 | `lot.kgRemaining >= 0` at all times |
| 2 | `packedStock.quantity >= 0` at all times |
| 3 | `session.kgConsumed <= lot.kgRemaining` before session starts |
| 4 | Shipment bags <= available packed stock per bag type |
| 5 | Every stock exit must have exitType, bagTypeId, quantity, loggedById, date |
| 6 | Every stock adjustment must have reason + owner's approvedById |
| 7 | `varianceKg < 0` requires `varianceNote` before session closes |
| 8 | Never merge lots from different suppliers (same type/grade from different suppliers = separate lots) |
| 9 | Container expenses can be added after arrival → must recalculate `costPerKg` on all linked lots |
| 10 | Price is set at time of sale — no pre-set price list enforced by system |
| 11 | Total profit (grossProfit) visible to **owner role only** |
| 12 | `costPerKg` visible to owner and accountant only — never returned to sales_rep or worker |
| 13 | Physical count adjustments require owner approval — no silent auto-correction |
| 14 | Client phone numbers are **never deleted** — only marked `isActive: false` |
| 15 | Client balance is always **computed** from invoice and payment records — never manually set |

---

## Key Business Logic

### Container cost calculation
When a container arrives, each product line's `allInCostPerKg` is calculated and stored as the stock lot's `costPerKg`. If expenses are added/edited after arrival, all linked lots must be recalculated immediately.

Formula:
```
all_in_cost_per_ton = pricePerTon + (expenseShare / tonnage) - (discountShare / tonnage)
all_in_cost_per_kg  = all_in_cost_per_ton / 1000
```

### Packing session
- `kgOutputTotal` = `Σ(bagsOutput[i].qty × bagType[i].nominalKg)`
- `varianceKg` = `kgConsumed - kgOutputTotal`
- `sessionEarnings` = `Σ(bagsOutput[i].qty × workerRate[i])`
- Positive variance = loss (normal). Negative variance = error (requires explanation).

### Client balance
Always computed: `Σ invoice.total - Σ payment.amount`

### P&L (owner only)
```
gross_profit = revenue - cogs - bag_cost - variance_cost - delivery_cost
```

---

## Role Summary

| Role | Key Access |
|------|-----------|
| `owner` | Full access. Only role that sees gross profit and cost_per_kg. Manages users, stock adjustments. |
| `accountant` | Financial reports, expenses, invoices, client ledger. No gross profit. No stock adjustments. |
| `sales_rep` | Orders, clients, invoices, payments, shipments. No cost data. |
| `worker` | Packing sessions only. No prices, costs, or client data. |
| `driver` | Own delivery trips, confirm deliveries, print receipts, log expenses. No prices/costs. |
