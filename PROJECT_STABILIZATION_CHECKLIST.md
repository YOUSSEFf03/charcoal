# Project Stabilization Checklist

Master tracking document for hardening the Ember charcoal ERP backend (`apps/backend`, NestJS + Prisma) toward production readiness. One section per backend module (from `apps/backend/src/app.module.ts`).

**Ground rule for updating this document:** a checkbox may only be marked `Verified` after the specific behavior was actually traced against source (or exercised by a passing test that covers it) — not because "the module generally seems fine" or "the overall test suite is green." A green `npm run jest` run proves the *asserted* behaviors are correct; it says nothing about behaviors nobody wrote a test for. Update this file incrementally, module by module, citing what was actually checked.

**Status definitions**
- **Not Started** — no targeted review has been done on this module yet.
- **In Progress** — some rows below are checked from direct investigation; others remain open.
- **Verified** — every row below has been traced against source or covered by a passing test, for this module.

**Legend for row values:** ✅ Verified (evidence-backed) · ⚠️ Partial (some paths checked, some not) · ❌ Not checked · N/A not applicable to this module

---

## How to read "Tests passed"

The full backend suite currently stands at **17 spec files / 297 tests, all passing** (`apps/backend`, run via `npx jest`), plus `tsc --noEmit` clean on both frontend and backend, and `eslint` on the backend at 0 errors / 290 pre-existing `no-explicit-any` warnings (verified this session — see Suppliers/BagTypes/Orders/Shipments/StockLots/Reports sections below for what's actually asserted where). Modules without a `*.spec.ts` file are marked "No dedicated tests" below — they are exercised only indirectly (e.g. through other modules' tests or manual/API-level checks), which is itself a stabilization gap worth closing before production.

---

## Suppliers

**Status:** In Progress

- Business logic verified: ⚠️ Partial — LBP supplier-payment conversion bug (previously silently excluded non-USD payments from `totalPaidUsd`/`outstandingUsd`) traced and confirmed fixed in both the list endpoint (raw SQL) and detail endpoint (in-memory reduce), using the same global-rate pattern as `getProfitLoss()`. Supplier CRUD (create/update/delete) itself not reviewed.
- CRUD verified: ❌ Not checked (only the balance-calculation read paths were traced, not create/update/delete).
- Permissions verified: ❌ Not checked.
- Validation verified: ❌ Not checked (DTOs not reviewed).
- Calculations verified: ✅ LBP→USD conversion via `SettingsService.getExchangeRate()` traced end-to-end for both list and detail balance figures.
- Reports verified: ⚠️ Partial — new `getSupplierLedger()` (in Reports module) traced architecturally: debits from `ContainerProductLine`/direct `StockLot`, credits from `SupplierPayment`, opening balance computed server-side, deliberately excludes `ContainerExpense`/`ContainerDiscount`/`BagPurchase`. Covered by new tests in `reports.service.spec.ts`, but the ledger's SQL/query logic itself was reviewed via summary, not re-derived line-by-line independently.
- Tests passed: ⚠️ No dedicated `suppliers.service.spec.ts` exists — the LBP fix has no unit test at the service level. `reports.service.spec.ts`'s new `getSupplierLedger()` block passes.
- Notes: **Gap** — add `suppliers.service.spec.ts` covering the LBP conversion fix directly; today it's only correct by manual code trace, not by regression test.

---

## BagTypes

**Status:** In Progress

- Business logic verified: ✅ `remove()` guard traced fully — checks references across `PackedStock`, `OrderBagLine`, `ShipmentBag`, `StockExit`, `ClientOrder`, and (newly added) `BagPurchase` before deleting; converts a raw Prisma `P2003` FK violation into a clean `409 ConflictException` as defense-in-depth.
- CRUD verified: ⚠️ Partial — only `remove()` traced; create/update/list not reviewed this session.
- Permissions verified: ❌ Not checked.
- Validation verified: ❌ Not checked.
- Calculations verified: N/A (no financial calculation in this module).
- Reports verified: N/A.
- Tests passed: ✅ `bag-types.service.spec.ts` (new this session) — not-found case, zero-reference success, one 409 per guarded relation, envelope-shape test, and two defense-in-depth tests (P2003→409 vs. other errors re-thrown). All passing.
- Notes: Frontend `Settings.tsx` delete flow (confirm dialog + friendly 409 message) traced and consistent with this.

---

## StockLots

**Status:** In Progress

- Business logic verified: ✅ The supplier-name-vs-lot-ID display bug fully traced: `findAll()`/`findOne()` both `include: { supplier: true }` unconditionally, so `Packing.tsx`/`NewOrder.tsx` correctly resolve `supplier.name`. Confirmed no other frontend surface leaks a raw lot/supplier ID in place of a name for lots sourced through this module's endpoints.
- CRUD verified: ⚠️ Partial — `create()` (direct-source lot) and both read methods traced; no update/delete endpoint exists in this service today (only create + read) — worth confirming that's intentional (lots are only ever mutated via stock-adjustments/stock-exits, not directly).
- Permissions verified: ⚠️ Partial — `maybeStrip()`'s role-based cost-field stripping (CONSTRAINT 12, hides `costPerKg` from `sales_rep`/`worker`) read directly in source; controller-level `@Roles` decorators not independently re-verified this session.
- Validation verified: ❌ Not checked (`CreateStockLotDto` not reviewed).
- Calculations verified: ❌ Cost-field stripping logic read but not exercised against a live scenario.
- Reports verified: N/A directly (feeds into Warehouse/Reports but not reviewed from that angle).
- Tests passed: ✅ `stock-lots.service.spec.ts` passing (part of the 297).
- Notes: Two **pre-existing, unrelated** frontend gaps found during the supplier-name search (not part of any fix, not modified): `Warehouse.tsx` resolves supplier via a separate `useSuppliers` lookup map (falls back to raw ID if that map is incomplete/loading) instead of the already-included `lot.supplier.name`; `WarehouseSales.tsx`'s lot-select label promises "type · supplier · grade" but the rendered option never actually includes supplier text. Neither has been fixed — flagged only.

---

## Orders

**Status:** ✅ VERIFIED (full audit + 4-phase remediation completed this session)

- Business logic verified: ✅ Full lifecycle traced: `create()` (always `draft`, DTO has no `status` field), `update()` (cannot change status; **Finding #1 fixed** — `clientId`/`pricePerBag`/`currency`/`totalKgRequested`/`bagTypeId` now locked once status leaves `draft`, via a `ConflictException` guard mirroring `remove()`'s pattern), `markDelivered()` (owner force-override, bypasses `partially_delivered`; **Finding #2 fixed** — shipment-status and order-status writes now atomic via `$transaction`, invoice creation deliberately still outside it), `remove()` (draft + no-shipments guard; **Finding #3 fixed** — a raw P2003 from the delete itself, e.g. a shipment created in the race window between the check and the delete, is now caught and converted to the same `ConflictException`, mirroring `BagTypesService.remove()` exactly). Confirmed **no code path anywhere transitions an order to `confirmed`** — enum value is still dead outside test fixtures and `prisma/seed.ts`'s hardcoded demo row (unrelated to this remediation, no change requested or made).
- CRUD verified: ✅ All four operations (`create`, `findAll`, `findOne`, `update`, `remove`) read directly and now fully unit-tested (see Tests passed).
- Permissions verified: ✅ `@Roles` read per endpoint: `create`/`update`/`findAll`/`findOne` → `owner, sales_rep`; `markDelivered`/`remove` → `owner` only; `generateInvoice` → `owner, accountant`. Unchanged by remediation.
- Validation verified: ✅ `CreateOrderDto`/`UpdateOrderDto` read in full (class-validator decorators, `bagTypeId` optional, `pricePerBag` free-entry per CONSTRAINT 10).
- Calculations verified: ✅ `create()`'s `avgOrderDays` rolling-average math now covered by deterministic tests (fake-timer-controlled first-order and rolling-average cases) — no rounding/multi-currency issue found.
- Reports verified: ✅ Dashboard "active orders" KPI bug found (accidental `draft`/`confirmed` filter swap) and fixed in an earlier session; `Clients.tsx`'s `trueBalance` dependency on order status traced.
- Tests passed: ✅ `orders.service.spec.ts` grew from 0 dedicated `create()`/`findAll()`/`findOne()` tests to full coverage across a 4-phase remediation: Phase 1 (13 tests, protected-field guard), Phase 2 (3 tests, transaction atomicity), Phase 3 (22 tests, `create()`/`findAll()`/`findOne()`/additional `update()` coverage), Phase 4 (2 tests, P2003→409). **52 tests in this file**, part of **379/379 passing across all 19 backend suites**. `tsc --noEmit` clean; `eslint` 0 errors, 291 warnings (unchanged baseline, zero new).
- Notes: **Finding #5 (dead `useUpdateOrder()` frontend hook) intentionally left unaddressed** — confirmed still unused anywhere in `src/` (re-checked this session). Correctly classified as frontend technical debt, not a backend correctness issue: the underlying `PATCH /orders/:id` endpoint is now fully guarded (Finding #1) and tested regardless of whether any UI ever calls it. The `NewOrder.tsx` "Confirm order" button naming quirk (creates as `draft`, not `confirmed`) and the still-unreachable `confirmed` status remain flagged from the original audit, unrelated to and unaffected by this remediation.

---

## Shipments

**Status:** In Progress

- Business logic verified: ✅ `createShipment` (FIFO reservation, keyed `ShipmentReservation` rows), `confirmDelivery` (FIFO drain, sibling-recompute of order status, auto-invoice on full delivery), `logReturn`, `cancelShipment` all read in full with their transaction boundaries.
- CRUD verified: ✅ All read/write paths traced.
- Permissions verified: ✅ `@Roles` read per endpoint: `create` → `owner, sales_rep`; `confirmDelivery`/`logReturn` → `driver, owner`; `cancel` → `owner, sales_rep`; `updateActualWeight` → `driver, owner`.
- Validation verified: ⚠️ Partial — DTOs referenced but not individually read line-by-line.
- Calculations verified: ✅ Reservation math (`quantity − reservedQuantity` free-stock check, FIFO walk, keyed increment/decrement in lockstep) traced directly.
- Reports verified: N/A directly.
- Tests passed: ✅ `shipments.service.spec.ts` — the shared `makeStore()` transaction-mock factory was read in full; confirmed it does **not** currently mock `tx.clientOrder.findUnique` (only `update`), which is the one concrete risk identified for the still-unimplemented auto-confirm-on-shipment change. All current tests passing.
- Notes: **Pending decision, not yet implemented:** auto-transition `draft→confirmed` when the first shipment is created. Full impact analysis completed (files: `shipments.service.ts` + `shipments.service.spec.ts` only; ~50-65 LOC estimated; no schema/permission/report/invoice impact; one real behavior change to `Clients.tsx`'s balance figure, intentionally). Recommended but awaiting your go-ahead to implement.

---

## Reports

**Status:** In Progress

- Business logic verified: ⚠️ Partial — `getSupplierLedger()` and the `getProfitLoss()` cash→accrual revenue-basis change reviewed via architecture summary and partial direct reads (confirmed the `Invoice.status notIn ['draft','cancelled']` filters at lines 640/659 operate on `Invoice`, not `ClientOrder`). Not every report method in this large service (`reports.service.ts`, 1000+ lines) has been independently read.
- CRUD verified: N/A (read-only reporting module).
- Permissions verified: ⚠️ Partial — `getSupplierLedger` confirmed `@Roles('owner','accountant')` only (narrower than client-ledger, since it exposes supplier cost data); other report endpoints' roles not re-verified this session.
- Validation verified: ❌ Not checked.
- Calculations verified: ⚠️ Partial — accrual-vs-cash revenue basis and the new `cashCollected` field (reported alongside, not subtracted from, gross profit) understood from the diff; not independently re-derived from raw data.
- Reports verified: ⚠️ Partial — this **is** the reports module; see above.
- Tests passed: ✅ `reports.service.spec.ts` (392 lines added/changed) — rewritten P&L tests (C1-C9) and new `getSupplierLedger()` block, all passing as part of the 297.
- Notes: This module is large and only partially traced — recommend a dedicated deep pass before production, given it drives the P&L and every ledger view.

---

## GeneralExpenses

**Status:** In Progress

- Business logic verified: ⚠️ Partial — understood via architecture-review summary only (not independently re-read this session): optional `dateFrom`/`dateTo` on `GET /general-expenses`; recurring expenses (`isRecurring=true`) always included regardless of range, one-time rows date-filtered via `OR` clause.
- CRUD verified: ❌ Not checked directly.
- Permissions verified: ❌ Not checked.
- Validation verified: ❌ Not checked.
- Calculations verified: N/A.
- Reports verified: N/A directly (feeds P&L expense side, not independently traced from that angle).
- Tests passed: ⚠️ No dedicated `general-expenses.service.spec.ts` found — no unit coverage for the recurring/date-range logic.
- Notes: **Gap** — this module's controller/service diff was summarized by a sub-agent during the initial architecture rebuild, not independently re-read by direct file inspection. Needs its own pass before being marked verified.

---

## StockExits

**Status:** In Progress

- Business logic verified: ⚠️ Partial — understood via architecture-review summary: `WORKER_ALLOWED_EXIT_TYPES` allowlist (`sample`, `internal`, `gift`) restricts `worker`-role exit creation, rejecting sale-type exits (`walk_in`, `client_bags_fill`) per SPEC.md §3.4. Not independently re-read line-by-line this session.
- CRUD verified: ❌ Not checked directly.
- Permissions verified: ⚠️ Partial — the worker-role restriction itself is a permissions rule, understood but not re-traced from source directly.
- Validation verified: ❌ Not checked.
- Calculations verified: ❌ Not checked.
- Reports verified: N/A directly.
- Tests passed: ✅ `stock-exits.service.spec.ts` passing (part of the 297).
- Notes: Interacts closely with Shipments (`confirmDelivery` creates `StockExit` rows with `exitType='order'`) — that intersection *was* directly traced via the Shipments module review.

---

## Invoices

**Status:** In Progress

- Business logic verified: ⚠️ Partial — only `createFromOrder()`'s delivery gate directly read and confirmed (`order.status !== 'delivered'` → `BadRequestException`; idempotent; always creates in `draft` status; `autoIssue` flag used by delivery-trigger callers). Rest of the invoice lifecycle (issuing, cancelling, invoice-calculator service) not reviewed this session.
- CRUD verified: ❌ Not checked beyond the one method above.
- Permissions verified: ❌ Not checked.
- Validation verified: ❌ Not checked.
- Calculations verified: ❌ `invoice-calculator.service.ts` referenced (grep hit for `status = 'paid'` logic) but not read.
- Reports verified: N/A directly.
- Tests passed: ✅ `invoices.service.spec.ts` passing (part of the 297).
- Notes: Confirmed this module's `Invoice.status` enum is entirely separate from `ClientOrder.status` — relevant to the Orders/confirmed analysis, not yet relevant to a dedicated Invoices review.

---

## Clients

**Status:** In Progress

- Business logic verified: ⚠️ Partial — only the frontend `trueBalance()` calculation in `Clients.tsx` (uninvoiced-order total added to `c.balance`, filtered by order status) directly read. Backend `ClientsService` itself not reviewed.
- CRUD verified: ❌ Not checked.
- Permissions verified: ❌ Not checked.
- Validation verified: ❌ Not checked.
- Calculations verified: ⚠️ Partial — the balance-filter logic (`['confirmed','partially_delivered','delivered']`) traced and its dependency on the (currently unreachable) `confirmed` status understood in depth.
- Reports verified: N/A directly.
- Tests passed: ✅ `clients.service.spec.ts` passing (part of the 297) — content not individually reviewed.
- Notes: This module's balance figure is the one concrete number that would change if the Orders "auto-confirm on shipment" decision is implemented — see Orders/Shipments notes.

---

## Payments

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `payments.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: Only touched via grep (confirming `Invoice.status='paid'` recompute pattern referenced elsewhere); no dedicated review done.

---

## Containers

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `containers.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: `ContainerProductLine` relation to `StockLot`/`Supplier` was traced during the architecture rebuild (schema-level only, not service logic); new composite index (`[supplierId, createdAt]`) added this session and covered by the new migration — index migration itself verified present and matches schema.

---

## StockAdjustments

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `stock-adjustments.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: None yet.

---

## Warehouse

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ⚠️ No dedicated `warehouse.service.spec.ts` found in the backend module.
- Notes: The **frontend** `Warehouse.tsx` page was reviewed (during the StockLot supplier-name search) and found to build its own supplier lookup independent of `stockLot.supplier` — see StockLots module notes. The backend `WarehouseModule` service itself has not been reviewed.

---

## PackingSessions

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `packing-sessions.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: None yet.

---

## PackedStock

**Status:** Not Started

- Business logic verified: ⚠️ Partial — only touched indirectly via `Shipments.createShipment()`/`confirmDelivery()`'s FIFO reservation/drain against `PackedStock` rows (that logic lives in and was traced from the Shipments module, not this one).
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ⚠️ No dedicated `packed-stock.service.spec.ts` found.
- Notes: **Gap** — no unit tests for this module directly; its only coverage is incidental, through Shipments' tests exercising the shared mock store.

---

## DriverTrips

**Status:** Not Started

- Business logic verified: ⚠️ Partial — confirmed via direct grep that this service has **zero** references to `ClientOrder`/order status (relevant fact established during the Orders lifecycle trace, not a full module review).
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `driver-trips.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: None yet.

---

## Workers

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `workers.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: None yet.

---

## FillJobs

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `fill-jobs.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: Frontend `FillClientDetail.tsx` was glanced at during the StockLot search (its lot-select dropdown shows no supplier at all, but also doesn't claim to) — not a backend module review.

---

## WalkInSales

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ✅ `walk-in-sales.service.spec.ts` passing (part of the 297) — content not reviewed.
- Notes: None yet.

---

## Settings

**Status:** Not Started

- Business logic verified: ⚠️ Partial — `SettingsService.getExchangeRate()` is consumed and confirmed working correctly by the Suppliers LBP fix, but the Settings module itself (rate storage/update/history) has not been reviewed.
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: N/A.
- Tests passed: ⚠️ No dedicated `settings.service.spec.ts` found.
- Notes: **Gap** — the exchange rate is load-bearing for Suppliers, Reports (P&L, ledgers), and Payments' currency conversion, yet has no dedicated test coverage of its own.

---

## Users / Auth / Webhooks

**Status:** ✅ VERIFIED (final verification pass completed this session — see final-verification notes below; two Medium-severity items accepted as known residual debt, not blocking)

- Business logic verified: ✅ Full trace of `JwtAuthGuard`, `RolesGuard`, `ClerkStrategy`, `UsersService`, `WebhooksController`. **Accepted residual (Medium, non-blocking):** the Postgres `User.role` column is not the authorization source of truth for any real request — `RolesGuard` reads `request.user.role`, populated only from JWT claims (via `ClerkStrategy`) or the dev-bypass token string, never from the DB. `UsersService.updateRole()` only syncs to Clerk (the actual source of truth) when `NODE_ENV==='production'`; outside production it silently no-ops on real authorization while still updating the DB mirror. Out of scope for the auth-hardening work performed; tracked for a future pass.
- CRUD verified: ✅ `UsersService` (`findAll`, `findOne`, `createLocal`, `updateRole`, `updateName`, `deleteLocal`) traced in full. **Accepted residual (Medium):** no "last owner" protection on `updateRole`/`deleteLocal`.
- Permissions verified: ✅ `APP_GUARD` ordering confirmed (`JwtAuthGuard` before `RolesGuard`). Swept all 26 controllers for `@Roles()` usage — `UsersController` (all routes) and `PUT /settings/exchange-rate` correctly `owner`-only. `PackedStockController`/`WarehouseController` have no `@Roles()` at all, confirmed safe because both are read-only (`WarehouseController` does in-service field masking instead, at `warehouse.service.ts:12,83-85`).
- Validation verified: ✅ `UpdateUserRoleDto` (`@IsEnum(Role)`), `SetRateDto` (`@IsInt() @Min(1)`), global `ValidationPipe` (`whitelist/forbidNonWhitelisted/transform`, 422) all confirmed.
- Calculations verified: N/A.
- Reports verified: N/A.
- Tests passed: ✅ `apps/backend/src/auth/auth.guard.spec.ts` (19 tests — full `JwtAuthGuard` coverage plus the `isDevAuthBypassEnabled()` truth table), `apps/backend/src/auth/clerk.strategy.spec.ts` (12 tests — JWKS resolution, all three role-claim shapes, every failure path), and `webhooks.controller.spec.ts`'s extended real (not mocked) Svix signature-verification suite (8 tests using the actual `svix` library) — valid signature, wrong secret, tampered payload, missing headers, missing configured secret, `user.deleted`, unknown event type. Final verification pass re-ran the full suite independently: **339/339 tests passing across 19 suites**, `tsc --noEmit` clean, `eslint` 0 errors / 291 pre-existing-style warnings (unchanged in nature, none newly introduced). `roles.guard.ts` already had 7 tests (in `test/constraints.e2e-spec.ts`, CONSTRAINT 11/12). No test file exists yet for `users.service.ts` (tracked as residual, non-blocking).
- Notes: **Closed (was Critical):** dev auth bypass now requires a second, independent env var (`DEV_AUTH_BYPASS_ENABLED`, verified defaults to `'false'` in `env.validation.ts`) in addition to `NODE_ENV !== 'production'` — confirmed by direct source re-read and by dedicated tests that neither condition alone can enable it. `main.ts` logs a loud startup warning when the bypass is active. **Closed (was High):** guard/strategy/webhook-signature test coverage added and independently re-verified passing. **Accepted residual (Medium, not blocking Verified status):** `updateRole()` no-op outside production; no last-owner safeguard; `User.role` DB/JWT duplication (Clerk's own docs describe "trust the JWT, don't re-check the DB" as intentional design, so this is an architectural note more than a bug). Production JWT verification path (`ClerkStrategy` → JWKS → RS256) and webhook signature verification confirmed unchanged and working via direct test re-run.

---

## BagPurchases

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ⚠️ No dedicated `bag-purchases.service.spec.ts` found.
- Notes: Referenced only as one of `BagTypesService.remove()`'s guarded relations (confirmed it's checked before delete) — no review of the module's own logic.

---

## CashHandovers

**Status:** Not Started

- Business logic verified: ❌
- CRUD verified: ❌
- Permissions verified: ❌
- Validation verified: ❌
- Calculations verified: ❌
- Reports verified: ❌
- Tests passed: ⚠️ No dedicated `cash-handovers.service.spec.ts` found.
- Notes: None yet.

---

## Frontend (cross-cutting, not a backend module)

Not itemized per-page in this checklist since the template above is shaped for backend business modules (CRUD/permissions/validation/calculations). Frontend has **no test runner configured** (no `vitest`/`jest` for `src/`, confirmed this session) — `tsc --noEmit` is the only automated frontend check currently running clean. Pages directly touched this session: `Packing.tsx`, `NewOrder.tsx` (StockLot fix, verified), `Dashboard.tsx` (KPI fix, verified), `Clients.tsx`, `Warehouse.tsx`, `WarehouseSales.tsx`, `FillClientDetail.tsx`, `Reports.tsx`, `Orders.tsx` (read for badge/status conventions). Every other page is unreviewed against this checklist's criteria.

**Gap** — recommend adding a frontend test runner before production; currently the only safety net for `src/` is manual verification and TypeScript's type checker.

---

## Cross-module gaps identified so far (not yet acted on)

1. `apps/web` — confirmed dead/abandoned Next.js scaffolding (1 commit, empty source, no CI/deploy config, undocumented). Awaiting decision on removal.
2. Orders `confirmed` status — currently unreachable; full options analysis done (implement / remove / auto-transition-on-shipment); auto-transition recommended but **not implemented**, awaiting go-ahead.
3. No dedicated tests for: Suppliers, GeneralExpenses, Warehouse, PackedStock, Settings, BagPurchases, CashHandovers, Auth, Users.
4. `Warehouse.tsx` and `WarehouseSales.tsx` have pre-existing, unrelated supplier-name display gaps (flagged, not fixed).
5. Frontend has no automated test runner.
