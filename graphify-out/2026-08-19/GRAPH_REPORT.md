# Graph Report - my-app  (2026-08-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3697 nodes · 6896 edges · 218 communities (185 shown, 33 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 217 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `02dfcf65`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ReportsService
- types.ts
- ClientsService
- PrismaService
- app.module.ts
- types/api.ts
- driver-trips.controller.ts
- packing-sessions.service.ts
- Settings.tsx
- orders.service.spec.ts
- SuppliersController
- useOrders.ts
- ClientDetail.tsx
- BagTypesService
- Reports.tsx
- Cash Management System — Final Implementation Blueprint
- Receiver Balance & Cash Handover — Architecture Audit
- NestJS Backend — Charcoal ERP
- useContainers.ts
- CreateFillJobDto
- Roles
- shipments.controller.ts
- stock-lots.controller.ts
- ShipmentsService
- index.ts
- useWorkers.ts
- Topbar.tsx
- excelExport.ts
- useSuppliers.ts
- CreateGeneralExpenseDto
- FillClientDetail.tsx
- CreateBagPurchaseDto
- settings.controller.ts
- Authentication & Authorization — NestJS Backend
- Packing
- StockAdjustmentsService
- dependencies
- Charcoal Import ERP — Local Setup Guide
- InvoicesService
- Expenses.tsx
- Charcoal Import & Distribution ERP System
- ContainersController
- constraints.e2e-spec.ts
- containers.controller.ts
- Cash Management System — Final Architecture Specification
- Project Stabilization Checklist
- Warehouse.tsx
- Invoices.tsx
- devDependencies
- CreateWalkInSaleDto
- WorkersController
- app.jsx
- Issue — P&L components lack per-record currency metadata (invoices, stock_exits, bag_purchases, driver_trips ✓ Fixed; stock_lots/containers deferred)
- DriverMobile.tsx
- StockExitsController
- UsersController
- formatUsd
- ContainersService
- InvoicesController
- WarehouseService
- devDependencies
- App.tsx
- auth.guard.ts
- dependencies
- NewContainer.tsx
- PaymentsService
- JSON Field Schemas
- Cash Management System — Specification Peer Review
- devDependencies
- ClerkStrategy
- NestJS Backend — Folder Structure & Architecture
- Persistent Agent Memory
- CashHandover.tsx
- workers.controller.ts
- 16. Entity Reference — All 30 Entities
- compilerOptions
- API Reference
- shipments.service.spec.ts
- .update
- pipeline
- CashHandoversService
- CashHandoversController
- CreateShipmentDto
- dependencies
- compilerOptions
- PackedStockController
- WebhooksController
- compilerOptions
- WorkersService
- PHASE 3 — Harden the ledger (rename, currency, typed references, exchange-rate history)
- devAuth.ts
- database/package.json
- package.json
- 5. Module 1 — Container Tracker
- Clients
- Cash Management System — Implementation Roadmap
- Charcoal Business Accounting System — Full Specification
- scripts
- api.ts
- CreateContainerDto
- CreateWorkerDto
- SetRatesDto
- PHASE 6 — New flows: Transfer, Opening Float, Cash Count, Advance
- Frontend API Layer (src/lib) README
- CreatePaymentDto
- Sample API Payloads
- Purpose
- 4. Core Concepts & Definitions
- ClerkProvider
- CreateWorkerPaymentDto
- Reports
- Shipments
- PHASE 2 — Introduce `CashHolder`
- Batch 5 — Shipment-keyed reservations & currency-correct P&L (2026-06-03)
- compilerOptions
- 13. Module 9 — Reports & Reconciliation
- 17. Business Logic & Formulas
- CreateSupplierPaymentDto
- include
- Workers
- Module 6 — Delivery
- shared/package.json
- 10. Module 6 — Fill Jobs (Client-Provided Bags)
- Clerk
- src/config/env.validation.ts
- .upsertDiscount
- lib
- Driver Trips
- Invoices
- Standard Response Wrappers
- PHASE 5 — Redesign Cash Handover
- ADR-001: Why `CashHolder` Exists as a Dedicated Entity
- ADR-002: Why the Ledger Is Append-Only
- ADR-003: Why Balances Are Computed, Not Stored
- ADR-004: Why Read and Write Services Are Separated
- ADR-005: Why Idempotency Is Enforced at the Business-Document Layer
- 14. Sales Scenarios
- Layout.tsx
- nest-cli.json
- backend/package.json
- SupplierDetail.tsx
- backfill-payment-allocations.ts
- CreateLocalUserDto
- workers.service.spec.ts
- Bag Types
- Containers
- Orders
- Suppliers
- PHASE 0 — Centralize, change nothing behaviorally
- PHASE 1 — Close the receiver-resolution gap (on today's identity model)
- 3. User Roles & Permissions
- Auth / Users
- Container Expenses
- Container Product Lines
- Module 3 — Packing Sessions
- Module 1 — Containers
- Module 5 — Orders & Invoicing
- Module 8 — Reports
- Module 2 — Warehouse & Stock
- PHASE 7 — Scale hardening (deferred; not urgent at current scale)
- designs2/icons.js
- 15. Stock Reconciliation Rules
- 6. Module 2 — Warehouse & Stock
- webhooks.controller.ts
- typescript
- Container Discount
- Packing Sessions
- Payments
- Stock Lots
- Module 4 — Client CRM
- PHASE 4 — Idempotency
- components.jsx
- tsconfig.json
- vite-env.d.ts
- eslint.config.js
- seed.ts
- containers.service.spec.ts
- paths
- Bag Purchases
- sidebar.js
- next.config.mjs
- next-env.d.ts
- NODE_ENV
- ApiBearerAuth
- ApiOperation
- ApiResponse
- ApiTags
- Body
- Controller
- Get
- Param
- Patch
- Post
- Query
- Roles
- Injectable
- Delete
- HttpCode
- Module
- IsDateString
- IsEnum
- IsNotEmpty
- IsNumberString
- IsOptional
- IsString
- IsUUID
- packing-sessions.service.spec.ts

## God Nodes (most connected - your core abstractions)
1. `Roles()` - 100 edges
2. `PrismaService` - 88 edges
3. `ClerkUser` - 63 edges
4. `CurrentUser` - 56 edges
5. `ClientDetail()` - 45 edges
6. `FillClientDetail()` - 35 edges
7. `Packing()` - 32 edges
8. `ContainersService` - 29 edges
9. `ContainerDetail()` - 29 edges
10. `WarehouseSales()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `src/config/env.validation.ts` --semantically_similar_to--> `VITE_CLERK_PUBLISHABLE_KEY`  [INFERRED] [semantically similar]
  apps/backend/README.md → src/lib/README.md
- `DATABASE_URL` --references--> `prisma`  [EXTRACTED]
  apps/backend/README.md → packages/database/package.json
- `Clerk` --references--> `Clerk`  [INFERRED]
  apps/backend/README.md → src/lib/README.md
- `Frontend API Layer (src/lib) README` --references--> `Swagger`  [EXTRACTED]
  src/lib/README.md → apps/backend/README.md
- `NestJS backend (http://localhost:3001)` --references--> `Charcoal Business API (Backend) README`  [EXTRACTED]
  src/lib/README.md → apps/backend/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Environment Variable Validation & Config Flow** — apps_backend_readme_joi, apps_backend_readme_env_validation_ts, apps_backend_readme_configuration_ts, apps_backend_readme_configservice [EXTRACTED 1.00]
- **Clerk Auth Token Attachment Flow** — src_lib_readme_usetokensync, src_lib_readme_useauth, src_lib_readme_clerk_token_bridge, src_lib_readme_request_interceptor [EXTRACTED 1.00]
- **React Provider Nesting Order** — src_lib_readme_clerkprovider, src_lib_readme_queryclientprovider, src_lib_readme_toastprovider, src_lib_readme_app [EXTRACTED 1.00]

## Communities (218 total, 33 thin omitted)

### Community 0 - "ReportsService"
Cohesion: 0.05
Nodes (40): RolesGuard, Injectable, buildGeneralExpenseWhere(), PhysicalCountItemDto, SubmitPhysicalCountDto, ApiProperty, IsArray, IsInt (+32 more)

### Community 1 - "types.ts"
Cohesion: 0.02
Nodes (81): AddClientPhoneDto, AdjustmentType, ApiError, ArSummary, BagInvoiceLine, BagPurchase, BagsOutputLine, BankDetails (+73 more)

### Community 2 - "ClientsService"
Cohesion: 0.06
Nodes (38): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ClientBalanceService, Injectable, ClientsController, IMPORTANT: these routes MUST come before /:id to avoid NestJS routing (+30 more)

### Community 3 - "PrismaService"
Cohesion: 0.07
Nodes (24): AllocationResult, PaymentAllocationService, Injectable, LedgerWriteService, Injectable, fn(), makeTx(), PrismaService (+16 more)

### Community 4 - "app.module.ts"
Cohesion: 0.08
Nodes (35): CashHandoversModule, Module, AppConfig, envValidationSchema, FillJobsModule, Module, InvoicesModule, Module (+27 more)

### Community 5 - "types/api.ts"
Cohesion: 0.05
Nodes (48): useRate(), CreateWalkInSaleDto, useCreateWalkInSale(), WalkInBagLine, WalkInKgLine, ClientWarehouseSummary, FifoDrawItem, FifoDrawResult (+40 more)

### Community 6 - "driver-trips.controller.ts"
Cohesion: 0.07
Nodes (37): DriverTripsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+29 more)

### Community 7 - "packing-sessions.service.ts"
Cohesion: 0.06
Nodes (39): ConsumedLot, consumeLots(), LotConsumptionInput, fn(), makeTx(), FILL_JOB_INCLUDE, StoredBagOutput, BagOutputLineDto (+31 more)

### Community 8 - "Settings.tsx"
Cohesion: 0.07
Nodes (37): useBagTypes(), useCreateBagType(), useDeleteBagType(), useUpdateBagType(), useCreateOrder(), Receiver, useReceivers(), useCreateLocalUser() (+29 more)

### Community 9 - "orders.service.spec.ts"
Cohesion: 0.07
Nodes (30): CreateOrderDto, ApiProperty, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID (+22 more)

### Community 10 - "SuppliersController"
Cohesion: 0.07
Nodes (34): CreateSupplierDto, ApiProperty, IsArray, IsInt, IsObject, IsOptional, IsString, Min (+26 more)

### Community 11 - "useOrders.ts"
Cohesion: 0.07
Nodes (39): DriverOption, ordersKey(), OrdersQuery, useDeleteOrder(), useGenerateOrderInvoice(), useMarkOrderDelivered(), useOrder(), useOrders() (+31 more)

### Community 12 - "ClientDetail.tsx"
Cohesion: 0.07
Nodes (35): openExportModal(), ClientsCounts, ClientsQuery, TODO: verify against Swagger — API.md names this CRMOverdueClient[], useAddPhone(), useClient(), useDeactivatePhone(), useUpdateClient() (+27 more)

### Community 13 - "BagTypesService"
Cohesion: 0.07
Nodes (26): BagTypesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, CurrentUser (+18 more)

### Community 14 - "Reports.tsx"
Cohesion: 0.08
Nodes (36): useExportColumnsModal(), useOverdueClients(), ActivityItem, ClientLedgerQuery, ContainerCostsQuery, DailyRevenueQuery, PnlByTypeQuery, ProfitLossQuery (+28 more)

### Community 15 - "Cash Management System — Final Implementation Blueprint"
Cohesion: 0.04
Nodes (45): 0. Executive Summary, 10. Final Validation Rules, 11. Final Scalability Strategy, 12. Final Migration Plan, 13. Final Testing Strategy, 14. Final Development Rules, 15. Deliverable Checklist, 1. Resolved Conflicts (+37 more)

### Community 16 - "Receiver Balance & Cash Handover — Architecture Audit"
Cohesion: 0.04
Nodes (45): 0. Executive Summary, 10. Consistency Audit — duplicate/divergent balance calculations, 11. Security Audit, 12. Dependency Map — what depends on receiver balances, 13. Potential Risks (evidence-backed), 14. Final Architecture Summary, 1.1 Warehouse Sales — registered client, packed bags (works correctly), 1.2 Warehouse Sales — registered client, by-kg (works correctly) (+37 more)

### Community 17 - "NestJS Backend — Charcoal ERP"
Cohesion: 0.05
Nodes (42): API Conventions, Architecture, Authenticated Request, Authentication, Base URL, Build & Run, Clients & Orders, Common Endpoints (+34 more)

### Community 18 - "useContainers.ts"
Cohesion: 0.06
Nodes (37): containersKey(), ContainersQuery, useAddExpense(), useAddProductLine(), useContainer(), useContainers(), useDeleteContainer(), useDeleteExpense() (+29 more)

### Community 19 - "CreateFillJobDto"
Cohesion: 0.07
Nodes (31): CreateFillJobDto, FillJobBagOutputDto, FillJobCharcoalInputDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsInt (+23 more)

### Community 20 - "Roles"
Cohesion: 0.19
Nodes (14): ClerkUser, Roles(), ROLES_KEY, CurrentUser, MAX_PAGE_LIMIT, ParseLimitPipe, ParsePagePipe, Injectable (+6 more)

### Community 21 - "shipments.controller.ts"
Cohesion: 0.09
Nodes (27): ConfirmDeliveryDto, ApiProperty, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, LogReturnDto (+19 more)

### Community 22 - "stock-lots.controller.ts"
Cohesion: 0.08
Nodes (24): CreateStockLotDto, ApiProperty, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID (+16 more)

### Community 23 - "ShipmentsService"
Cohesion: 0.10
Nodes (13): ShipmentsService, Injectable, CreateStockExitDto, ApiProperty, IsDateString, IsEnum, IsInt, IsNotEmpty (+5 more)

### Community 24 - "index.ts"
Cohesion: 0.05
Nodes (41): AdjustmentType, AuthContext, BagOutputLine, BagTypeDTO, ClientBalanceDTO, ClientDTO, ClientPhone, ClientType (+33 more)

### Community 25 - "useWorkers.ts"
Cohesion: 0.07
Nodes (34): useToast(), useWorkerPackingSessionsHistory(), nextPageParam(), useCreateWorker(), useCreateWorkerEarning(), useDeleteWorker(), useLogWorkerPayment(), useUpdateWorker() (+26 more)

### Community 26 - "Topbar.tsx"
Cohesion: 0.07
Nodes (26): ROLE_LABELS, UserMenu(), Topbar(), TopbarProps, toggleSort(), useClientsCounts(), useCreateClient(), Clients() (+18 more)

### Community 27 - "excelExport.ts"
Cohesion: 0.07
Nodes (25): ExportColumnsModal(), ExportColumnsModalProps, ExportColumnsModalState, columns, Row, TestHarness(), ModalProps, Row (+17 more)

### Community 28 - "useSuppliers.ts"
Cohesion: 0.11
Nodes (21): suppliersKey(), SuppliersQuery, useCreateSupplier(), useSuppliers(), useUpdateSupplier(), ContactPerson, CreateSupplierDto, CreateSupplierPaymentDto (+13 more)

### Community 29 - "CreateGeneralExpenseDto"
Cohesion: 0.08
Nodes (25): CreateGeneralExpenseDto, ApiProperty, IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString (+17 more)

### Community 30 - "FillClientDetail.tsx"
Cohesion: 0.08
Nodes (32): useClientBalance(), ConfirmFillPickupDto, CreateFillJobDto, FillJob, FillJobBagOutput, FillJobLot, FillJobYtdSummary, FillPriceStats (+24 more)

### Community 31 - "CreateBagPurchaseDto"
Cohesion: 0.07
Nodes (26): BagPurchasesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+18 more)

### Community 32 - "settings.controller.ts"
Cohesion: 0.09
Nodes (18): Public(), HealthController, ApiOperation, ApiResponse, ApiTags, Controller, Get, SetRateDto (+10 more)

### Community 33 - "Authentication & Authorization — NestJS Backend"
Cohesion: 0.05
Nodes (33): 1. Create Application, 1. User Sign-In (Frontend), 2. API Request with JWT, 2. Get API Keys, 3. Backend Validates Token, 3. Get JWKS URL, 401 Unauthorized, 403 Forbidden (+25 more)

### Community 34 - "Packing"
Cohesion: 0.10
Nodes (33): packingKey(), PackingSessionsQuery, useCreatePackingSession(), usePackingSession(), usePackingSessions(), useUpdatePackingSession(), PackingSession, CharRow (+25 more)

### Community 35 - "StockAdjustmentsService"
Cohesion: 0.11
Nodes (18): StockAdjustmentsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+10 more)

### Community 36 - "dependencies"
Cohesion: 0.06
Nodes (35): dependencies, class-transformer, class-validator, decimal.js, joi, jsonwebtoken, jwks-rsa, @nestjs/common (+27 more)

### Community 37 - "Charcoal Import ERP — Local Setup Guide"
Cohesion: 0.06
Nodes (34): Assign Roles, Authentication, Backend (.env), Charcoal Import ERP — Local Setup Guide, Clerk JWT Validation Fails, Copy API Keys, Create Clerk Application, Create Tables (+26 more)

### Community 38 - "InvoicesService"
Cohesion: 0.06
Nodes (31): CreateInvoiceDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsEnum, IsOptional, IsUUID (+23 more)

### Community 39 - "Expenses.tsx"
Cohesion: 0.10
Nodes (25): useAllCashHandoverExpenses(), AggregatedContainerExpense, AggregatedWorkerPayment, ExpensesQuery, useAllExpenses(), useAllWorkerPayments(), useCreateGeneralExpense(), useDriverExpenses() (+17 more)

### Community 40 - "Charcoal Import & Distribution ERP System"
Cohesion: 0.06
Nodes (30): 1. Container Tracking, 2. Warehouse Management, 3. Client CRM, 4. Orders & Invoicing, 5. Delivery & Logistics, 6. Fill Jobs, 7. Financial Reports, Adding a Feature (+22 more)

### Community 41 - "ContainersController"
Cohesion: 0.21
Nodes (14): ContainersController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+6 more)

### Community 42 - "constraints.e2e-spec.ts"
Cohesion: 0.15
Nodes (13): CreateStockAdjustmentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+5 more)

### Community 43 - "containers.controller.ts"
Cohesion: 0.13
Nodes (19): ContainersModule, Module, CreateExpenseDto, ApiProperty, IsNotEmpty, IsNumberString, IsString, CreateProductLineDto (+11 more)

### Community 44 - "Cash Management System — Final Architecture Specification"
Cohesion: 0.07
Nodes (28): 10. Security Rules, 11. Reporting Architecture, 12. Future Scalability, 13. Data Integrity — Invariants, 14. Final Blueprint, 1. Business Concepts, 2. Single Source of Truth, 3. Cash Flow Specification (+20 more)

### Community 45 - "Project Stabilization Checklist"
Cohesion: 0.07
Nodes (28): BagPurchases, BagTypes, CashHandovers, Clients, Containers, Cross-module gaps identified so far (not yet acted on), DriverTrips, FillJobs (+20 more)

### Community 46 - "Warehouse.tsx"
Cohesion: 0.12
Nodes (23): useBagPurchases(), useCreateBagPurchase(), usePhysicalCount(), useSubmitPhysicalCount(), useCreateStockAdjustment(), useDeleteStockAdjustment(), useLotMaterialFlow(), useStockAdjustments() (+15 more)

### Community 47 - "Invoices.tsx"
Cohesion: 0.15
Nodes (21): clientsKey(), useClients(), invoicesKey(), InvoicesQuery, useCancelInvoice(), useInvoices(), useIssueInvoice(), paymentsKey() (+13 more)

### Community 48 - "devDependencies"
Cohesion: 0.07
Nodes (27): devDependencies, eslint, jest, @nestjs/cli, @nestjs/schematics, @nestjs/testing, ts-jest, ts-node (+19 more)

### Community 49 - "CreateWalkInSaleDto"
Cohesion: 0.11
Nodes (24): CreateWalkInSaleDto, ApiProperty, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumberString (+16 more)

### Community 50 - "WorkersController"
Cohesion: 0.20
Nodes (14): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete, Get (+6 more)

### Community 51 - "app.jsx"
Cohesion: 0.14
Nodes (22): AccountChart(), App(), buildLedger(), ClientDetail(), fmt(), InvoiceModal(), genId(), save() (+14 more)

### Community 52 - "Issue — P&L components lack per-record currency metadata (invoices, stock_exits, bag_purchases, driver_trips ✓ Fixed; stock_lots/containers deferred)"
Cohesion: 0.07
Nodes (26): BagPurchase.totalCost ✓ Fixed (BUG-L, P5), Containers Module, DriverTrip fuelCost and otherExpenses ✓ Fixed (BUG-M, P5), Inventory — Reservations & Stock Adjustments (Batch 4), Invoice revenue ✓ Fixed (BUG-C closed), Issue #8 — Incorrect stock deduction and waste handling with multiple charcoal types ✓ Fixed, Issue — Adjustment edit/reverse restores a stale absolute snapshot ✓ Fixed (BUG-G), Issue — Container cost assigned to the wrong lot ✓ Fixed (+18 more)

### Community 53 - "DriverMobile.tsx"
Cohesion: 0.11
Nodes (20): DriverTripsQuery, tripsKey(), useCompleteTrip(), useDriverTrips(), useStartTrip(), shipmentsKey(), useShipments(), CreateDriverTripDto (+12 more)

### Community 54 - "StockExitsController"
Cohesion: 0.14
Nodes (11): StockExitsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+3 more)

### Community 55 - "UsersController"
Cohesion: 0.14
Nodes (13): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete, Get (+5 more)

### Community 56 - "formatUsd"
Cohesion: 0.17
Nodes (19): DailyRevenueChart(), RevenueByTypeChart(), balancesKey(), ClientBalancesQuery, useClientAging(), useClientBalances(), categoricalPalette(), cssVar() (+11 more)

### Community 58 - "InvoicesController"
Cohesion: 0.18
Nodes (15): InvoicesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+7 more)

### Community 59 - "WarehouseService"
Cohesion: 0.13
Nodes (14): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, CurrentUser, Get, Param (+6 more)

### Community 60 - "devDependencies"
Cohesion: 0.08
Nodes (24): @types/react, autoprefixer, jsdom, devDependencies, autoprefixer, jsdom, postcss, tailwindcss (+16 more)

### Community 61 - "App.tsx"
Cohesion: 0.14
Nodes (14): App(), RateContext, RateCtx, RateProvider(), ToastContext, ToastCtx, ToastProvider(), useInvoice() (+6 more)

### Community 62 - "auth.guard.ts"
Cohesion: 0.13
Nodes (11): AppModule, Module, isDevAuthBypassEnabled(), JwtAuthGuard, Injectable, IS_PUBLIC_KEY, HttpExceptionFilter, STATUS_CODE_MAP (+3 more)

### Community 63 - "dependencies"
Cohesion: 0.09
Nodes (23): axios, chart.js, @clerk/clerk-react, jspdf, jspdf-autotable, next, dependencies, axios (+15 more)

### Community 64 - "NewContainer.tsx"
Cohesion: 0.18
Nodes (7): useCreateContainer(), CreateContainerProductLineDto, GRADES, NewContainer(), PLine, STATUS_STEPS, StepKey

### Community 65 - "PaymentsService"
Cohesion: 0.13
Nodes (15): PaymentsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, CurrentUser (+7 more)

### Community 66 - "JSON Field Schemas"
Cohesion: 0.09
Nodes (21): Additional Indexes to Create, `clients.phones`, `clients.preferredTypes`, Computed Fields (Never Stored — Always Calculated), Critical Business Rules at the Data Layer, Database-Level Constraints, Database Planning, `driver_trips.otherExpenses` (+13 more)

### Community 67 - "Cash Management System — Specification Peer Review"
Cohesion: 0.09
Nodes (21): 10. Reporting — Not Everything Comes From the Ledger, 11. Currency — Gaps in the Original Strategy, 12. Security — Refinements, 13. Operational Concerns, 14. Scalability at 30 Branches / 500 Users / Thousands of Transactions per Day, 15. Final Verdict, 1. Challenging the Assumptions, 2. Service Boundaries (+13 more)

### Community 68 - "devDependencies"
Cohesion: 0.10
Nodes (20): @types/node, devDependencies, @types/node, @types/react-dom, vitest, vitest, name, private (+12 more)

### Community 69 - "ClerkStrategy"
Cohesion: 0.10
Nodes (12): AuthController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, Get, AuthModule (+4 more)

### Community 70 - "NestJS Backend — Folder Structure & Architecture"
Cohesion: 0.10
Nodes (20): Build, Common Dependencies, Constraints Validation, Controller Pattern, Decorators, Deployment, Directory Layout, DTO Pattern (+12 more)

### Community 71 - "Persistent Agent Memory"
Cohesion: 0.10
Nodes (20): ✅ Acceptance Criteria, 🏗️ Architecture Decisions, Before recommending from memory, Behavioral Rules, Core Identity, 📋 Feature Overview, 📁 File & Folder Structure, How to save memories (+12 more)

### Community 72 - "CashHandover.tsx"
Cohesion: 0.18
Nodes (19): AggregatedCashHandoverExpense, useAllBalances(), useCashHandovers(), useCreateCashHandover(), useDailyPayments(), UserBalance, useReceiverBalance(), useStockExits() (+11 more)

### Community 73 - "workers.controller.ts"
Cohesion: 0.19
Nodes (10): CreateWorkerEarningDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+2 more)

### Community 74 - "16. Entity Reference — All 30 Entities"
Cohesion: 0.10
Nodes (20): 16. Entity Reference — All 30 Entities, Bag purchase, Bag type, Client, Client order, Container, Container discount, Container expense (+12 more)

### Community 75 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+10 more)

### Community 76 - "API Reference"
Cohesion: 0.11
Nodes (18): API Reference, Container → Stock Lots, `GET /api/v1/containers/:id/stock-lots`, `GET /api/v1/health`, `GET /api/v1/packed-stock`, `GET /api/v1/packed-stock/summary`, `GET /api/v1/stock-adjustments`, `GET /api/v1/stock-exits` (+10 more)

### Community 77 - "shipments.service.spec.ts"
Cohesion: 0.14
Nodes (9): PackedStockService, Injectable, fn(), makeReturnTx(), makeStore(), PsRow, ResRow, setUpDelivery() (+1 more)

### Community 78 - ".update"
Cohesion: 0.17
Nodes (12): PackingSessionsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+4 more)

### Community 79 - "pipeline"
Cohesion: 0.12
Nodes (17): ^build, dist/**, **/.env, .next/**, !.next/cache/**, dependsOn, outputs, cache (+9 more)

### Community 80 - "CashHandoversService"
Cohesion: 0.18
Nodes (6): CashHandoversService, fn(), makeTx(), Injectable, BalanceQueryService, Injectable

### Community 81 - "CashHandoversController"
Cohesion: 0.17
Nodes (10): CashHandoversController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, Param (+2 more)

### Community 82 - "CreateShipmentDto"
Cohesion: 0.14
Nodes (14): CreateShipmentDto, ShipmentBagInputDto, ApiProperty, IsArray, IsInt, IsNotEmpty, IsNumberString, IsOptional (+6 more)

### Community 83 - "dependencies"
Cohesion: 0.12
Nodes (16): dependencies, @charcoal/shared, @clerk/nextjs, next, react, react-dom, svix, zod (+8 more)

### Community 84 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx (+8 more)

### Community 85 - "PackedStockController"
Cohesion: 0.22
Nodes (10): PackedStockController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, CurrentUser, Get (+2 more)

### Community 86 - "WebhooksController"
Cohesion: 0.17
Nodes (9): ApiOperation, ApiResponse, ApiTags, Controller, HttpCode, Post, WebhooksController, Headers (+1 more)

### Community 87 - "compilerOptions"
Cohesion: 0.13
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+7 more)

### Community 89 - "PHASE 3 — Harden the ledger (rename, currency, typed references, exchange-rate history)"
Cohesion: 0.14
Nodes (14): PHASE 3 — Harden the ledger (rename, currency, typed references, exchange-rate history), PR 18 — Rename `AccountEntry` → `LedgerEntry` (pure rename, no behavior change), PR 19 — Add `currency` to `LedgerEntry`, backfill `USD`, PR 20 — Pass real currency from `PaymentsService`, PR 21 — Pass real currency from `StockExitsService` / `WalkInSalesService`, PR 22 — Pass real currency from `CashHandoversService`, PR 23 — Add nullable per-source-type FKs to `LedgerEntry` (dual-populate alongside `referenceId`), PR 24 — Add the "exactly one reference" check constraint (+6 more)

### Community 90 - "devAuth.ts"
Cohesion: 0.24
Nodes (11): ProtectedRoute(), DEV, devToken(), getDevRole(), setDevRole(), ROLE_EMAILS, ROLE_HOME, SignIn() (+3 more)

### Community 91 - "database/package.json"
Cohesion: 0.11
Nodes (18): @prisma/client, prisma, DATABASE_URL, @prisma/client, prisma, dependencies, @prisma/client, devDependencies (+10 more)

### Community 92 - "package.json"
Cohesion: 0.15
Nodes (12): name, private, scripts, build, dev, preview, test, type (+4 more)

### Community 93 - "5. Module 1 — Container Tracker"
Cohesion: 0.15
Nodes (13): 5. Module 1 — Container Tracker, 7. Module 3 — Packing Sessions, Container lifecycle, Cost report (live, recalculates on every change), Direct warehouse addition (no container), Discount, Expense allocation logic, Expenses (+5 more)

### Community 94 - "Clients"
Cohesion: 0.17
Nodes (12): Clients, `GET /api/v1/clients`, `GET /api/v1/clients/:id`, `GET /api/v1/clients/:id/balance`, `GET /api/v1/clients/:id/invoices`, `GET /api/v1/clients/:id/orders`, `GET /api/v1/clients/:id/payments`, `GET /api/v1/clients/overdue` (+4 more)

### Community 95 - "Cash Management System — Implementation Roadmap"
Cohesion: 0.17
Nodes (11): Cash Management System — Implementation Roadmap, Cleanup PRs (non-blocking, run once each phase's verification window has passed), Critical Path, Dependency Graph (phase level), Estimated Timeline, Highest-Risk Tasks, Implementation Order (recommended), PHASE 3.5 — Centralized cash reporting (closes the Dashboard/Reports inconsistency) (+3 more)

### Community 96 - "Charcoal Business Accounting System — Full Specification"
Cohesion: 0.17
Nodes (11): 18. Print Templates, 19. Currency & Payments, 1. Business Overview, 20. Arabic Language Support, 21. Critical Constraints — Never Violate, 2. Technology Constraints, Charcoal Business Accounting System — Full Specification, Delivery receipt (printed by driver at restaurant) (+3 more)

### Community 97 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, lint, prisma:generate, start, start:debug, start:dev, test (+3 more)

### Community 98 - "api.ts"
Cohesion: 0.18
Nodes (11): PORT, api.ts, Axios, window.__clerk_token bridge, Error envelope shape ({error, code, details}), src/hooks/, api.ts request interceptor, api.ts response interceptor (+3 more)

### Community 99 - "CreateContainerDto"
Cohesion: 0.18
Nodes (11): CreateContainerDto, ApiProperty, ApiPropertyOptional, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString (+3 more)

### Community 100 - "CreateWorkerDto"
Cohesion: 0.20
Nodes (8): CreateWorkerDto, ApiProperty, IsArray, IsNotEmpty, IsOptional, IsString, Type, ValidateNested

### Community 101 - "SetRatesDto"
Cohesion: 0.18
Nodes (11): SetRatesDto, ApiProperty, ArrayMinSize, IsArray, Type, ValidateNested, ApiProperty, IsNotEmpty (+3 more)

### Community 102 - "PHASE 6 — New flows: Transfer, Opening Float, Cash Count, Advance"
Cohesion: 0.18
Nodes (11): PHASE 6 — New flows: Transfer, Opening Float, Cash Count, Advance, PR 40 — `CashTransfer` table, PR 41 — `LedgerWriteService.recordTransfer()` + `CashTransferService`/controller/DTO, PR 42 — Frontend: Cash Transfer UI, PR 43 — `OpeningFloat` table + service + `getExpectedCash` float-netting, PR 44 — Frontend: assign/supersede opening float (owner-only), PR 45 — `CashCount` table + service/controller/DTO (no ledger entries), PR 46 — Frontend: spot-check count action (+3 more)

### Community 103 - "Frontend API Layer (src/lib) README"
Cohesion: 0.22
Nodes (10): Charcoal Business API (Backend) README, .env.example, NestJS, Swagger, backend-docs/types/api.ts, Frontend API Layer (src/lib) README, NestJS backend (http://localhost:3001), queryClient.ts (+2 more)

### Community 104 - "CreatePaymentDto"
Cohesion: 0.20
Nodes (9): CreatePaymentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+1 more)

### Community 105 - "Sample API Payloads"
Cohesion: 0.20
Nodes (9): GET /api/v1/reports/worker-earnings/:workerId, Module 7 — Suppliers, Non-sale Stock Exits, POST /api/v1/stock-exits (internal use), POST /api/v1/stock-exits (sample), POST /api/v1/suppliers, POST /api/v1/workers/:id/payments (owner pays worker), Sample API Payloads (+1 more)

### Community 106 - "Purpose"
Cohesion: 0.13
Nodes (15): 11. Module 7 — Delivery, 12. Module 8 — Suppliers, 8. Module 4 — Client CRM, 9. Module 5 — Orders & Invoicing, Client history, Client profile fields, Client types, CRM alert page (+7 more)

### Community 107 - "4. Core Concepts & Definitions"
Cohesion: 0.20
Nodes (10): 4.1 Charcoal identity, 4.2 Stock lot, 4.3 Bag type, 4.4 Packing session, 4.5 Packed stock, 4.6 Client debit balance, 4.7 Price at time of sale, 4.8 Packed-stock reservations (shipment-keyed) (+2 more)

### Community 108 - "ClerkProvider"
Cohesion: 0.22
Nodes (10): App, AppWithAuthSync, auth.ts, Clerk, ClerkProvider, main.tsx, QueryClientProvider, ToastProvider (+2 more)

### Community 109 - "CreateWorkerPaymentDto"
Cohesion: 0.22
Nodes (8): CreateWorkerPaymentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString

### Community 110 - "Reports"
Cohesion: 0.22
Nodes (9): `GET /api/v1/reports/client-ledger/:clientId`, `GET /api/v1/reports/container-costs`, `GET /api/v1/reports/physical-count`, `GET /api/v1/reports/profit-loss`, `GET /api/v1/reports/stock-value`, `GET /api/v1/reports/variance`, `GET /api/v1/reports/worker-earnings/:workerId`, `POST /api/v1/reports/physical-count` (+1 more)

### Community 111 - "Shipments"
Cohesion: 0.22
Nodes (9): `GET /api/v1/shipments`, `GET /api/v1/shipments/:id`, `GET /api/v1/shipments/:id/receipt`, `PATCH /api/v1/shipments/:id`, `PATCH /api/v1/shipments/:id/actual-weight`, `POST /api/v1/shipments`, `POST /api/v1/shipments/:id/confirm-delivery`, `POST /api/v1/shipments/:id/return` (+1 more)

### Community 112 - "PHASE 2 — Introduce `CashHolder`"
Cohesion: 0.22
Nodes (9): PHASE 2 — Introduce `CashHolder`, PR 10 — `CashHolder` table (additive, no other table touched), PR 11 — `CashHolderService` + backfill script, PR 12 — Wire `LedgerWriteService` validation to `CashHolderService`, PR 13 — Add nullable `holderId` to `Payment` (dual-write), PR 14 — Add nullable `holderId` to `StockExit` (dual-write), PR 15 — Add nullable `holderId` to `CashHandover` (dual-write), PR 16 — Switch reads to prefer `holderId`, verify against legacy fields (+1 more)

### Community 113 - "Batch 5 — Shipment-keyed reservations & currency-correct P&L (2026-06-03)"
Cohesion: 0.22
Nodes (8): Batch 5 — Shipment-keyed reservations & currency-correct P&L (2026-06-03), BUG-I (P1) — Reservations pinned to the shipment, BUG-J (P5) — Per-invoice exchange-rate snapshot, BUG-K (P5) — Currency on stock-exit amounts, BUG-L (P5) — Currency on bag purchases, BUG-M (P5) — Currency on driver-trip costs, Changelog, Notes

### Community 114 - "compilerOptions"
Cohesion: 0.22
Nodes (8): vite.config.ts, compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 115 - "13. Module 9 — Reports & Reconciliation"
Cohesion: 0.22
Nodes (9): 13. Module 9 — Reports & Reconciliation, Report: Client ledger, Report: Container cost report, Report: Physical count reconciliation, Report: Profit & Loss, Report: Stock value, Report: Variance report, Report: Worker earnings (+1 more)

### Community 116 - "17. Business Logic & Formulas"
Cohesion: 0.22
Nodes (9): 17. Business Logic & Formulas, Client avg_order_days, Client balance, Container cost allocation, P&L gross profit, Packing session variance, Session earnings, Stock lot kg remaining (+1 more)

### Community 117 - "CreateSupplierPaymentDto"
Cohesion: 0.25
Nodes (8): CreateSupplierPaymentDto, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID

### Community 118 - "include"
Cohesion: 0.25
Nodes (7): exclude, include, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx

### Community 119 - "Workers"
Cohesion: 0.25
Nodes (8): `GET /api/v1/workers`, `GET /api/v1/workers/:id`, `GET /api/v1/workers/:id/payments`, `PATCH /api/v1/workers/:id`, `PATCH /api/v1/workers/:id/rates`, `POST /api/v1/workers`, `POST /api/v1/workers/:id/payments`, Workers

### Community 120 - "Module 6 — Delivery"
Cohesion: 0.25
Nodes (8): GET /api/v1/shipments/:id/receipt (printed at delivery), Module 6 — Delivery, PATCH /api/v1/shipments/:id/actual-weight (driver logs weight at loading), POST /api/v1/driver-trips (create trip), POST /api/v1/driver-trips/:id/complete, POST /api/v1/shipments (create shipment within order), POST /api/v1/shipments/:id/confirm-delivery, POST /api/v1/shipments/:id/return (driver logs return)

### Community 121 - "shared/package.json"
Cohesion: 0.25
Nodes (7): exports, ./types, main, name, private, types, version

### Community 122 - "10. Module 6 — Fill Jobs (Client-Provided Bags)"
Cohesion: 0.25
Nodes (8): 10. Module 6 — Fill Jobs (Client-Provided Bags), Client Type, Difference from Packing Sessions, Fill Job vs Walk-in Sale, Fill Job Workflow, FillJob Fields, FillJobLot, Stock Deduction

### Community 123 - "Clerk"
Cohesion: 0.29
Nodes (7): @clerk/clerk-sdk-node, Clerk, CLERK_JWKS_URL, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, Svix, @clerk/clerk-sdk-node

### Community 124 - "src/config/env.validation.ts"
Cohesion: 0.29
Nodes (7): CLERK_PUBLISHABLE_KEY, ConfigModule.forRoot, ConfigService, src/config/configuration.ts, src/config/env.validation.ts, Joi, VITE_CLERK_PUBLISHABLE_KEY

### Community 125 - ".upsertDiscount"
Cohesion: 0.33
Nodes (5): Put, ApiProperty, IsNotEmpty, IsNumberString, UpsertDiscountDto

### Community 126 - "lib"
Cohesion: 0.29
Nodes (7): lib, dom, DOM, DOM.Iterable, ES2020, ES2022, lib

### Community 127 - "Driver Trips"
Cohesion: 0.29
Nodes (7): Driver Trips, `GET /api/v1/driver-trips`, `GET /api/v1/driver-trips/:id`, `PATCH /api/v1/driver-trips/:id`, `POST /api/v1/driver-trips`, `POST /api/v1/driver-trips/:id/complete`, `POST /api/v1/driver-trips/:id/start`

### Community 128 - "Invoices"
Cohesion: 0.29
Nodes (7): `GET /api/v1/invoices`, `GET /api/v1/invoices/:id`, Invoices, `PATCH /api/v1/invoices/:id`, `POST /api/v1/invoices`, `POST /api/v1/invoices/:id/cancel`, `POST /api/v1/invoices/:id/issue`

### Community 129 - "Standard Response Wrappers"
Cohesion: 0.29
Nodes (7): Business Constraint Violation (400), Forbidden (403), Not Found (404), Paginated List, Standard Response Wrappers, Unauthorized (401), Validation Error (422)

### Community 130 - "PHASE 5 — Redesign Cash Handover"
Cohesion: 0.29
Nodes (7): PHASE 5 — Redesign Cash Handover, PR 34 — Extend `LedgerEntry.type` with correction types, PR 35 — `BalanceQueryService.getExpectedCash()`, PR 36 — Real `CreateCashHandoverDto`, PR 37 — Server-computed Expected Cash in `CashHandoversService.create`, PR 38 — Frontend: stop sending `expectedAmt`; display server-computed value, PR 39 — Remove the unpersisted expense-subtraction UI (interim step)

### Community 131 - "ADR-001: Why `CashHolder` Exists as a Dedicated Entity"
Cohesion: 0.29
Nodes (6): ADR-001: Why `CashHolder` Exists as a Dedicated Entity, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 132 - "ADR-002: Why the Ledger Is Append-Only"
Cohesion: 0.29
Nodes (6): ADR-002: Why the Ledger Is Append-Only, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 133 - "ADR-003: Why Balances Are Computed, Not Stored"
Cohesion: 0.29
Nodes (6): ADR-003: Why Balances Are Computed, Not Stored, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 134 - "ADR-004: Why Read and Write Services Are Separated"
Cohesion: 0.29
Nodes (6): ADR-004: Why Read and Write Services Are Separated, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 135 - "ADR-005: Why Idempotency Is Enforced at the Business-Document Layer"
Cohesion: 0.29
Nodes (6): ADR-005: Why Idempotency Is Enforced at the Business-Document Layer, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 136 - "14. Sales Scenarios"
Cohesion: 0.29
Nodes (7): 14. Sales Scenarios, S1 — Walk-in warehouse buyer, S2 — Restaurant delivery (primary flow), S3 — Bags sold as-is from supplier, S4 — Client brings own bags, S5 — Sample / gift / internal use, S6 — Export / corporate order

### Community 137 - "Layout.tsx"
Cohesion: 0.33
Nodes (3): Layout(), NavItemProps, Sidebar()

### Community 138 - "nest-cli.json"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 139 - "backend/package.json"
Cohesion: 0.33
Nodes (5): name, prisma, seed, private, version

### Community 140 - "SupplierDetail.tsx"
Cohesion: 0.20
Nodes (13): useCreateSupplierPayment(), useSupplier(), useSupplierPayments(), fmtDate(), initialsOf(), money(), NOTE: this is an inventory-cost-basis figure (raw StockLot.costPerKg, which for, SupplierDetail() (+5 more)

### Community 141 - "backfill-payment-allocations.ts"
Cohesion: 0.40
Nodes (5): APPLY, main(), prisma, ReportRow, statusFromPaid()

### Community 142 - "CreateLocalUserDto"
Cohesion: 0.47
Nodes (6): CreateLocalUserDto, ApiProperty, IsEnum, IsOptional, IsString, UpdateUserNameDto

### Community 143 - "workers.service.spec.ts"
Cohesion: 0.53
Nodes (4): dec(), makeWorker(), mockAggregates(), mockGroupBy()

### Community 144 - "Bag Types"
Cohesion: 0.33
Nodes (6): Bag Types, `DELETE /api/v1/bag-types/:id`, `GET /api/v1/bag-types`, `GET /api/v1/bag-types/:id`, `PATCH /api/v1/bag-types/:id`, `POST /api/v1/bag-types`

### Community 145 - "Containers"
Cohesion: 0.33
Nodes (6): Containers, `DELETE /api/v1/containers/:id`, `GET /api/v1/containers`, `GET /api/v1/containers/:id`, `PATCH /api/v1/containers/:id`, `POST /api/v1/containers`

### Community 146 - "Orders"
Cohesion: 0.33
Nodes (6): `DELETE /api/v1/orders/:id`, `GET /api/v1/orders`, `GET /api/v1/orders/:id`, Orders, `PATCH /api/v1/orders/:id`, `POST /api/v1/orders`

### Community 147 - "Suppliers"
Cohesion: 0.33
Nodes (6): `DELETE /api/v1/suppliers/:id`, `GET /api/v1/suppliers`, `GET /api/v1/suppliers/:id`, `PATCH /api/v1/suppliers/:id`, `POST /api/v1/suppliers`, Suppliers

### Community 148 - "PHASE 0 — Centralize, change nothing behaviorally"
Cohesion: 0.33
Nodes (6): PHASE 0 — Centralize, change nothing behaviorally, PR 1 — Extract `LedgerWriteService` + `BalanceQueryService` (wrapping today's functions), PR 2 — Migrate `PaymentsService` to `LedgerWriteService`, PR 3 — Migrate `StockExitsService` to `LedgerWriteService`, PR 4 — Migrate `WalkInSalesService` (Warehouse Sale) to `LedgerWriteService`, PR 5 — Retire the loose functions; finalize read-side centralization

### Community 149 - "PHASE 1 — Close the receiver-resolution gap (on today's identity model)"
Cohesion: 0.33
Nodes (6): PHASE 1 — Close the receiver-resolution gap (on today's identity model), PR 6 — Server-side holder validation inside `LedgerWriteService`, PR 6b — Move holder validation before the write in each `creditAccount` caller, PR 7 — Fix `ClientDetail.tsx` "Record Payment" receiver resolution, PR 8 — Fix `FillClientDetail.tsx` "Record Payment" receiver resolution, PR 9 — Fix `WarehouseSales.tsx` anonymous-sale "Received by" resolution

### Community 150 - "3. User Roles & Permissions"
Cohesion: 0.33
Nodes (6): 3.1 Owner, 3.2 Sales Rep, 3.3 Accountant, 3.4 Worker, 3.5 Driver, 3. User Roles & Permissions

### Community 151 - "Auth / Users"
Cohesion: 0.40
Nodes (5): Auth / Users, `GET /api/v1/auth/me`, `GET /api/v1/users`, `GET /api/v1/users/:id`, `PATCH /api/v1/users/:id/role`

### Community 152 - "Container Expenses"
Cohesion: 0.40
Nodes (5): Container Expenses, `DELETE /api/v1/containers/:id/expenses/:expenseId`, `GET /api/v1/containers/:id/expenses`, `PATCH /api/v1/containers/:id/expenses/:expenseId`, `POST /api/v1/containers/:id/expenses`

### Community 153 - "Container Product Lines"
Cohesion: 0.40
Nodes (5): Container Product Lines, `DELETE /api/v1/containers/:id/product-lines/:lineId`, `GET /api/v1/containers/:id/product-lines`, `PATCH /api/v1/containers/:id/product-lines/:lineId`, `POST /api/v1/containers/:id/product-lines`

### Community 154 - "Module 3 — Packing Sessions"
Cohesion: 0.40
Nodes (5): Error: negative variance without note (400), Module 3 — Packing Sessions, Packing session with negative variance (requires explanation), POST /api/v1/packing-sessions (request body), POST /api/v1/packing-sessions (response)

### Community 155 - "Module 1 — Containers"
Cohesion: 0.40
Nodes (5): GET /api/v1/containers/:id (single with all details), GET /api/v1/containers (list), Module 1 — Containers, POST /api/v1/containers/:id/expenses (request body), POST /api/v1/containers (request body)

### Community 156 - "Module 5 — Orders & Invoicing"
Cohesion: 0.40
Nodes (5): GET /api/v1/invoices/:id (single invoice with payments), Module 5 — Orders & Invoicing, POST /api/v1/invoices (request body), POST /api/v1/orders (restaurant delivery order), POST /api/v1/payments (log a payment)

### Community 157 - "Module 8 — Reports"
Cohesion: 0.40
Nodes (5): GET /api/v1/reports/profit-loss (owner only), GET /api/v1/reports/stock-value, GET /api/v1/reports/variance, Module 8 — Reports, POST /api/v1/reports/physical-count (submit count)

### Community 158 - "Module 2 — Warehouse & Stock"
Cohesion: 0.40
Nodes (5): GET /api/v1/stock-lots, GET /api/v1/warehouse/summary, Module 2 — Warehouse & Stock, POST /api/v1/bag-types (request), POST /api/v1/stock-lots (direct addition, no container)

### Community 159 - "PHASE 7 — Scale hardening (deferred; not urgent at current scale)"
Cohesion: 0.40
Nodes (5): PHASE 7 — Scale hardening (deferred; not urgent at current scale), PR 50 — `LedgerCheckpoint` table, PR 51 — Reconciliation job + owner-only manual recalculate endpoint, PR 52 — `BalanceQueryService` uses checkpoints to bound scan range, PR 53 — `CashHolder.branchId` + branch-scoped queries

### Community 160 - "designs2/icons.js"
Cohesion: 0.70
Nodes (4): init(), lucideToSvg(), nodeToString(), replaceIcons()

### Community 161 - "15. Stock Reconciliation Rules"
Cohesion: 0.40
Nodes (5): 15. Stock Reconciliation Rules, How every movement is tracked, Rules the system must enforce, The formula, Variance

### Community 162 - "6. Module 2 — Warehouse & Stock"
Cohesion: 0.40
Nodes (5): 6. Module 2 — Warehouse & Stock, Bag purchases, Physical stock count, System stock formula, Two zones

### Community 163 - "webhooks.controller.ts"
Cohesion: 0.18
Nodes (5): ClerkEmailAddress, ClerkUserData, ClerkWebhookEvent, Module, WebhooksModule

### Community 164 - "typescript"
Cohesion: 0.50
Nodes (4): typescript, typescript, typescript, typescript

### Community 165 - "Container Discount"
Cohesion: 0.50
Nodes (4): Container Discount, `DELETE /api/v1/containers/:id/discount`, `GET /api/v1/containers/:id/discount`, `PUT /api/v1/containers/:id/discount`

### Community 166 - "Packing Sessions"
Cohesion: 0.50
Nodes (4): `GET /api/v1/packing-sessions`, `GET /api/v1/packing-sessions/:id`, Packing Sessions, `POST /api/v1/packing-sessions`

### Community 167 - "Payments"
Cohesion: 0.50
Nodes (4): `GET /api/v1/payments`, `GET /api/v1/payments/:id`, Payments, `POST /api/v1/payments`

### Community 168 - "Stock Lots"
Cohesion: 0.50
Nodes (4): `GET /api/v1/stock-lots`, `GET /api/v1/stock-lots/:id`, `POST /api/v1/stock-lots`, Stock Lots

### Community 169 - "Module 4 — Client CRM"
Cohesion: 0.50
Nodes (4): GET /api/v1/clients/overdue, Module 4 — Client CRM, POST /api/v1/clients/:id/phones (add phone, never deleted), POST /api/v1/clients (request body)

### Community 170 - "PHASE 4 — Idempotency"
Cohesion: 0.50
Nodes (4): PHASE 4 — Idempotency, PR 31 — Idempotency key columns, PR 32 — Backend dedup logic, PR 33 — Frontend idempotency key generation

### Community 172 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): src, include, references

### Community 173 - "vite-env.d.ts"
Cohesion: 0.50
Nodes (3): ImportMeta, ImportMetaEnv, Window

### Community 177 - "paths"
Cohesion: 0.67
Nodes (3): paths, @charcoal/shared/*, ../../packages/shared/*

### Community 178 - "Bag Purchases"
Cohesion: 0.67
Nodes (3): Bag Purchases, `GET /api/v1/bag-purchases`, `POST /api/v1/bag-purchases`

### Community 217 - "packing-sessions.service.spec.ts"
Cohesion: 0.43
Nodes (4): fn(), makeTx(), setupTransaction(), setupTx()

## Knowledge Gaps
- **1147 isolated node(s):** `DateRangeFilter`, `AddClientPhoneDto`, `AdjustmentType`, `ApiError`, `ArSummary` (+1142 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Roles()` connect `Roles` to `ClientsService`, `driver-trips.controller.ts`, `orders.service.spec.ts`, `CreateFillJobDto`, `shipments.controller.ts`, `stock-lots.controller.ts`, `CreateGeneralExpenseDto`, `CreateBagPurchaseDto`, `settings.controller.ts`, `StockAdjustmentsService`, `InvoicesService`, `ContainersController`, `containers.controller.ts`, `CreateWalkInSaleDto`, `WorkersController`, `StockExitsController`, `UsersController`, `workers.controller.ts`, `.update`, `CashHandoversController`, `.upsertDiscount`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `PrismaService` connect `PrismaService` to `ReportsService`, `ClientsService`, `app.module.ts`, `driver-trips.controller.ts`, `packing-sessions.service.ts`, `orders.service.spec.ts`, `BagTypesService`, `workers.service.spec.ts`, `CreateFillJobDto`, `stock-lots.controller.ts`, `ShipmentsService`, `CreateGeneralExpenseDto`, `CreateBagPurchaseDto`, `settings.controller.ts`, `webhooks.controller.ts`, `InvoicesService`, `constraints.e2e-spec.ts`, `containers.controller.ts`, `containers.service.spec.ts`, `ContainersService`, `auth.guard.ts`, `ClerkStrategy`, `workers.controller.ts`, `shipments.service.spec.ts`, `CashHandoversService`, `WebhooksController`, `WorkersService`, `packing-sessions.service.spec.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `ClerkUser` connect `Roles` to `PrismaService`, `StockAdjustmentsService`, `driver-trips.controller.ts`, `packing-sessions.service.ts`, `ContainersController`, `orders.service.spec.ts`, `containers.controller.ts`, `workers.controller.ts`, `.update`, `CashHandoversController`, `CreateWalkInSaleDto`, `CreateFillJobDto`, `WorkersController`, `shipments.controller.ts`, `stock-lots.controller.ts`, `CreateGeneralExpenseDto`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `DateRangeFilter`, `AddClientPhoneDto`, `AdjustmentType` to the rest of the system?**
  _1147 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ReportsService` be split into smaller, more focused modules?**
  _Cohesion score 0.05041797283176593 - nodes in this community are weakly interconnected._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.02438324727481354 - nodes in this community are weakly interconnected._
- **Should `ClientsService` be split into smaller, more focused modules?**
  _Cohesion score 0.0625694187338023 - nodes in this community are weakly interconnected._