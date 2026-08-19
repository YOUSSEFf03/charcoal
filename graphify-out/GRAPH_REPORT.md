# Graph Report - my-app  (2026-08-18)

## Corpus Check
- 354 files · ~753,947 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3657 nodes · 6843 edges · 206 communities (191 shown, 15 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 202 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191

## God Nodes (most connected - your core abstractions)
1. `Roles()` - 107 edges
2. `PrismaService` - 89 edges
3. `ClerkUser` - 67 edges
4. `CurrentUser` - 60 edges
5. `ClientDetail()` - 36 edges
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
- `CLERK_PUBLISHABLE_KEY` --references--> `VITE_CLERK_PUBLISHABLE_KEY`  [INFERRED]
  apps/backend/README.md → src/lib/README.md
- `VITE_API_URL` --references--> `PORT`  [INFERRED]
  src/lib/README.md → apps/backend/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Environment Variable Validation & Config Flow** — apps_backend_readme_joi, apps_backend_readme_env_validation_ts, apps_backend_readme_configuration_ts, apps_backend_readme_configservice [EXTRACTED 1.00]
- **Clerk Auth Token Attachment Flow** — src_lib_readme_usetokensync, src_lib_readme_useauth, src_lib_readme_clerk_token_bridge, src_lib_readme_request_interceptor [EXTRACTED 1.00]
- **React Provider Nesting Order** — src_lib_readme_clerkprovider, src_lib_readme_queryclientprovider, src_lib_readme_toastprovider, src_lib_readme_app [EXTRACTED 1.00]

## Communities (206 total, 15 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (77): AddClientPhoneDto, AdjustmentType, ApiError, ArSummary, BagInvoiceLine, BagsOutputLine, BankDetails, ClerkWebhookEvent (+69 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (30): fn(), makeTx(), buildGeneralExpenseWhere(), AllocationResult, PaymentAllocationService, Injectable, LedgerWriteService, Injectable (+22 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (38): ClientBalanceService, Injectable, ClientsController, IMPORTANT: these routes MUST come before /:id to avoid NestJS routing, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags (+30 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (29): RolesGuard, Injectable, ReportsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (54): DriverOption, DriverTripsQuery, tripsKey(), useCompleteTrip(), useDriverTrips(), useStartTrip(), ordersKey(), useOrders() (+46 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (37): CashHandoversModule, Module, CashHandoversService, Injectable, AppConfig, envValidationSchema, FillJobsModule, Module (+29 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (37): DriverTripsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+29 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (44): usePhysicalCount(), useSubmitPhysicalCount(), useCreateWalkInSale(), ClientWarehouseSummary, FifoDrawItem, FifoDrawResult, OnAccountSummary, PackedStockQuery (+36 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (37): App(), RateContext, RateCtx, RateProvider(), useRate(), ToastContext, ToastCtx, ToastProvider() (+29 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (43): SortHeader(), toggleSort(), ClientsCounts, clientsKey(), ClientsQuery, TODO: verify against Swagger — API.md names this CRMOverdueClient[], useAddPhone(), useClientBalance() (+35 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (37): ConsumedLot, consumeLots(), LotConsumptionInput, fn(), makeTx(), BagOutputLineDto, CreatePackingSessionDto, LotInputDto (+29 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (31): containersKey(), ContainersQuery, useAddExpense(), useAddProductLine(), useContainer(), useContainers(), useDeleteContainer(), useDeleteExpense() (+23 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (24): BagTypesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+16 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (45): 0. Executive Summary, 10. Final Validation Rules, 11. Final Scalability Strategy, 12. Final Migration Plan, 13. Final Testing Strategy, 14. Final Development Rules, 15. Deliverable Checklist, 1. Resolved Conflicts (+37 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (45): 0. Executive Summary, 10. Consistency Audit — duplicate/divergent balance calculations, 11. Security Audit, 12. Dependency Map — what depends on receiver balances, 13. Potential Risks (evidence-backed), 14. Final Architecture Summary, 1.1 Warehouse Sales — registered client, packed bags (works correctly), 1.2 Warehouse Sales — registered client, by-kg (works correctly) (+37 more)

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (36): ActivityItem, ClientLedgerQuery, ContainerCostsQuery, DailyRevenueQuery, PnlByTypeQuery, ProfitLossQuery, RevenueByTypeQuery, SupplierLedgerQuery (+28 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (45): @clerk/clerk-sdk-node, Charcoal Business API (Backend) README, Clerk, CLERK_JWKS_URL, CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, ConfigModule.forRoot (+37 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (42): API Conventions, Architecture, Authenticated Request, Authentication, Base URL, Build & Run, Clients & Orders, Common Endpoints (+34 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (35): ConfirmFillPickupDto, CreateFillJobDto, FillJob, FillJobBagOutput, FillJobLot, FillJobYtdSummary, FillPriceStats, useConfirmFillPickup() (+27 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (41): AdjustmentType, AuthContext, BagOutputLine, BagTypeDTO, ClientBalanceDTO, ClientDTO, ClientPhone, ClientType (+33 more)

### Community 20 - "Community 20"
Cohesion: 0.22
Nodes (12): ClerkUser, Roles(), ROLES_KEY, CurrentUser, MAX_PAGE_LIMIT, ParseLimitPipe, ParsePagePipe, Injectable (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (23): CreateStockLotDto, ApiProperty, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID (+15 more)

### Community 22 - "Community 22"
Cohesion: 0.06
Nodes (24): IS_PUBLIC_KEY, Public(), HealthController, ApiOperation, ApiResponse, ApiTags, Controller, Get (+16 more)

### Community 23 - "Community 23"
Cohesion: 0.08
Nodes (28): CreateFillJobDto, FillJobBagOutputDto, FillJobCharcoalInputDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsInt (+20 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (28): CreateStockAdjustmentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+20 more)

### Community 25 - "Community 25"
Cohesion: 0.08
Nodes (31): useWorkerPackingSessionsHistory(), nextPageParam(), useCreateWorker(), useCreateWorkerEarning(), useDeleteWorker(), useUpdateWorker(), useWorkerEarnings(), useWorkerPayments() (+23 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (26): BagPurchasesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+18 more)

### Community 27 - "Community 27"
Cohesion: 0.08
Nodes (25): CreateGeneralExpenseDto, ApiProperty, IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString (+17 more)

### Community 28 - "Community 28"
Cohesion: 0.05
Nodes (33): 1. Create Application, 1. User Sign-In (Frontend), 2. API Request with JWT, 2. Get API Keys, 3. Backend Validates Token, 3. Get JWKS URL, 401 Unauthorized, 403 Forbidden (+25 more)

### Community 29 - "Community 29"
Cohesion: 0.10
Nodes (33): packingKey(), PackingSessionsQuery, useCreatePackingSession(), usePackingSession(), usePackingSessions(), useUpdatePackingSession(), PackingSession, CharRow (+25 more)

### Community 30 - "Community 30"
Cohesion: 0.11
Nodes (18): StockAdjustmentsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+10 more)

### Community 31 - "Community 31"
Cohesion: 0.06
Nodes (35): dependencies, class-transformer, class-validator, decimal.js, joi, jsonwebtoken, jwks-rsa, @nestjs/common (+27 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (17): InvoicesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+9 more)

### Community 33 - "Community 33"
Cohesion: 0.06
Nodes (34): Assign Roles, Authentication, Backend (.env), Charcoal Import ERP — Local Setup Guide, Clerk JWT Validation Fails, Copy API Keys, Create Clerk Application, Create Tables (+26 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (28): useCreateBagType(), useDeleteBagType(), useUpdateBagType(), Receiver, useReceivers(), useCreateLocalUser(), useDeleteLocalUser(), usersKey() (+20 more)

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (20): LogReturnDto, ApiProperty, IsOptional, IsString, ApiProperty, IsNotEmpty, IsNumberString, UpdateActualWeightDto (+12 more)

### Community 36 - "Community 36"
Cohesion: 0.09
Nodes (27): CreateInvoiceDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsEnum, IsOptional, IsUUID (+19 more)

### Community 37 - "Community 37"
Cohesion: 0.08
Nodes (24): CreatePaymentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+16 more)

### Community 38 - "Community 38"
Cohesion: 0.13
Nodes (16): OrdersController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+8 more)

### Community 39 - "Community 39"
Cohesion: 0.06
Nodes (30): 1. Container Tracking, 2. Warehouse Management, 3. Client CRM, 4. Orders & Invoicing, 5. Delivery & Logistics, 6. Fill Jobs, 7. Financial Reports, Adding a Feature (+22 more)

### Community 40 - "Community 40"
Cohesion: 0.21
Nodes (14): ContainersController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+6 more)

### Community 41 - "Community 41"
Cohesion: 0.11
Nodes (16): ApiProperty, IsEnum, UpdateUserRoleDto, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body (+8 more)

### Community 42 - "Community 42"
Cohesion: 0.10
Nodes (16): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, CurrentUser, Get, Param (+8 more)

### Community 43 - "Community 43"
Cohesion: 0.10
Nodes (24): suppliersKey(), SuppliersQuery, useCreateSupplier(), useCreateSupplierPayment(), useSupplier(), useSupplierPayments(), useSuppliers(), useUpdateSupplier() (+16 more)

### Community 44 - "Community 44"
Cohesion: 0.13
Nodes (19): ContainersModule, Module, CreateExpenseDto, ApiProperty, IsNotEmpty, IsNumberString, IsString, CreateProductLineDto (+11 more)

### Community 45 - "Community 45"
Cohesion: 0.07
Nodes (28): 10. Security Rules, 11. Reporting Architecture, 12. Future Scalability, 13. Data Integrity — Invariants, 14. Final Blueprint, 1. Business Concepts, 2. Single Source of Truth, 3. Cash Flow Specification (+20 more)

### Community 46 - "Community 46"
Cohesion: 0.07
Nodes (28): BagPurchases, BagTypes, CashHandovers, Clients, Containers, Cross-module gaps identified so far (not yet acted on), DriverTrips, FillJobs (+20 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (24): useBagTypes(), OrdersQuery, useDeleteOrder(), useGenerateOrderInvoice(), useMarkOrderDelivered(), useOrder(), useUpdateOrder(), CreateSaleResult (+16 more)

### Community 48 - "Community 48"
Cohesion: 0.10
Nodes (12): AppModule, Module, isDevAuthBypassEnabled(), JwtAuthGuard, Injectable, ClerkStrategy, Injectable, HttpExceptionFilter (+4 more)

### Community 49 - "Community 49"
Cohesion: 0.07
Nodes (27): devDependencies, eslint, jest, @nestjs/cli, @nestjs/schematics, @nestjs/testing, ts-jest, ts-node (+19 more)

### Community 50 - "Community 50"
Cohesion: 0.09
Nodes (4): InvoiceCalculatorService, Injectable, ShipmentsService, Injectable

### Community 51 - "Community 51"
Cohesion: 0.14
Nodes (22): AccountChart(), App(), buildLedger(), ClientDetail(), fmt(), InvoiceModal(), genId(), save() (+14 more)

### Community 52 - "Community 52"
Cohesion: 0.07
Nodes (26): BagPurchase.totalCost ✓ Fixed (BUG-L, P5), Containers Module, DriverTrip fuelCost and otherExpenses ✓ Fixed (BUG-M, P5), Inventory — Reservations & Stock Adjustments (Batch 4), Invoice revenue ✓ Fixed (BUG-C closed), Issue #8 — Incorrect stock deduction and waste handling with multiple charcoal types ✓ Fixed, Issue — Adjustment edit/reverse restores a stale absolute snapshot ✓ Fixed (BUG-G), Issue — Container cost assigned to the wrong lot ✓ Fixed (+18 more)

### Community 53 - "Community 53"
Cohesion: 0.12
Nodes (20): useAllCashHandoverExpenses(), AggregatedContainerExpense, AggregatedWorkerPayment, ExpensesQuery, useAllExpenses(), useAllWorkerPayments(), useCreateGeneralExpense(), useDriverExpenses() (+12 more)

### Community 54 - "Community 54"
Cohesion: 0.16
Nodes (20): DailyRevenueChart(), RevenueByTypeChart(), balancesKey(), ClientBalancesQuery, useClientAging(), useClientBalances(), categoricalPalette(), cssVar() (+12 more)

### Community 56 - "Community 56"
Cohesion: 0.16
Nodes (11): StockExitsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+3 more)

### Community 57 - "Community 57"
Cohesion: 0.22
Nodes (13): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete, Get (+5 more)

### Community 58 - "Community 58"
Cohesion: 0.12
Nodes (18): ROLE_LABELS, UserMenu(), Topbar(), TopbarProps, useBagPurchases(), useCreateBagPurchase(), BagPurchase, CreateBagPurchaseDto (+10 more)

### Community 59 - "Community 59"
Cohesion: 0.09
Nodes (23): axios, chart.js, @clerk/clerk-react, jspdf, jspdf-autotable, next, dependencies, axios (+15 more)

### Community 60 - "Community 60"
Cohesion: 0.19
Nodes (14): SuppliersController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+6 more)

### Community 61 - "Community 61"
Cohesion: 0.09
Nodes (21): Additional Indexes to Create, `clients.phones`, `clients.preferredTypes`, Computed Fields (Never Stored — Always Calculated), Critical Business Rules at the Data Layer, Database-Level Constraints, Database Planning, `driver_trips.otherExpenses` (+13 more)

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (21): 10. Reporting — Not Everything Comes From the Ledger, 11. Currency — Gaps in the Original Strategy, 12. Security — Refinements, 13. Operational Concerns, 14. Scalability at 30 Branches / 500 Users / Thousands of Transactions per Day, 15. Final Verdict, 1. Challenging the Assumptions, 2. Service Boundaries (+13 more)

### Community 63 - "Community 63"
Cohesion: 0.14
Nodes (14): CreateOrderDto, ApiProperty, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID (+6 more)

### Community 64 - "Community 64"
Cohesion: 0.15
Nodes (10): PackedStockController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, Get, Query (+2 more)

### Community 65 - "Community 65"
Cohesion: 0.10
Nodes (21): autoprefixer, jsdom, devDependencies, autoprefixer, jsdom, postcss, tailwindcss, @testing-library/jest-dom (+13 more)

### Community 66 - "Community 66"
Cohesion: 0.10
Nodes (20): Build, Common Dependencies, Constraints Validation, Controller Pattern, Decorators, Deployment, Directory Layout, DTO Pattern (+12 more)

### Community 67 - "Community 67"
Cohesion: 0.10
Nodes (20): ✅ Acceptance Criteria, 🏗️ Architecture Decisions, Before recommending from memory, Behavioral Rules, Core Identity, 📋 Feature Overview, 📁 File & Folder Structure, How to save memories (+12 more)

### Community 68 - "Community 68"
Cohesion: 0.19
Nodes (10): CreateWorkerEarningDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+2 more)

### Community 69 - "Community 69"
Cohesion: 0.10
Nodes (20): 16. Entity Reference — All 30 Entities, Bag purchase, Bag type, Client, Client order, Container, Container discount, Container expense (+12 more)

### Community 70 - "Community 70"
Cohesion: 0.19
Nodes (18): AggregatedCashHandoverExpense, useAllBalances(), useCashHandovers(), useCreateCashHandover(), useDailyPayments(), UserBalance, useReceiverBalance(), CashHandover (+10 more)

### Community 71 - "Community 71"
Cohesion: 0.11
Nodes (18): @prisma/client, prisma, DATABASE_URL, @prisma/client, prisma, dependencies, @prisma/client, devDependencies (+10 more)

### Community 72 - "Community 72"
Cohesion: 0.16
Nodes (12): PackingSessionsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+4 more)

### Community 73 - "Community 73"
Cohesion: 0.11
Nodes (18): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+10 more)

### Community 74 - "Community 74"
Cohesion: 0.11
Nodes (18): API Reference, Container → Stock Lots, `GET /api/v1/containers/:id/stock-lots`, `GET /api/v1/health`, `GET /api/v1/packed-stock`, `GET /api/v1/packed-stock/summary`, `GET /api/v1/stock-adjustments`, `GET /api/v1/stock-exits` (+10 more)

### Community 75 - "Community 75"
Cohesion: 0.12
Nodes (9): useDeactivatePhone(), ClientDetail(), exitDisplayAmountUsd(), saveEdit(), saveOrder(), savePayment(), fmt(), fmtDate() (+1 more)

### Community 76 - "Community 76"
Cohesion: 0.12
Nodes (17): ^build, dist/**, **/.env, .next/**, !.next/cache/**, dependsOn, outputs, cache (+9 more)

### Community 77 - "Community 77"
Cohesion: 0.12
Nodes (16): name, prisma, seed, private, scripts, build, lint, prisma:generate (+8 more)

### Community 78 - "Community 78"
Cohesion: 0.12
Nodes (17): @types/node, typescript, devDependencies, @types/node, @types/react, @types/react-dom, typescript, vitest (+9 more)

### Community 79 - "Community 79"
Cohesion: 0.21
Nodes (16): CreateWalkInSaleDto, ApiProperty, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumberString (+8 more)

### Community 80 - "Community 80"
Cohesion: 0.14
Nodes (9): useClient(), useCreateOrder(), StockLot, BagLine, KgLine, NewOrder(), showToast(), submitOrder() (+1 more)

### Community 81 - "Community 81"
Cohesion: 0.17
Nodes (10): CashHandoversController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, Param (+2 more)

### Community 82 - "Community 82"
Cohesion: 0.14
Nodes (14): CreateShipmentDto, ShipmentBagInputDto, ApiProperty, IsArray, IsInt, IsNotEmpty, IsNumberString, IsOptional (+6 more)

### Community 83 - "Community 83"
Cohesion: 0.12
Nodes (16): dependencies, @charcoal/shared, @clerk/nextjs, next, react, react-dom, svix, zod (+8 more)

### Community 84 - "Community 84"
Cohesion: 0.12
Nodes (16): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx (+8 more)

### Community 85 - "Community 85"
Cohesion: 0.17
Nodes (9): ApiOperation, ApiResponse, ApiTags, Controller, HttpCode, Post, WebhooksController, Headers (+1 more)

### Community 86 - "Community 86"
Cohesion: 0.18
Nodes (9): ExportColumnsModal(), ExportColumnsModalProps, ExportColumnsModalState, columns, Row, TestHarness(), useExportColumnsModal(), Row (+1 more)

### Community 87 - "Community 87"
Cohesion: 0.19
Nodes (12): buildWorkbook(), defaultAlign(), defaultWidth(), estimateLines(), ExcelColumnType, ExcelExportConfig, numberFormat(), basicColumns (+4 more)

### Community 88 - "Community 88"
Cohesion: 0.13
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+7 more)

### Community 90 - "Community 90"
Cohesion: 0.14
Nodes (14): PHASE 3 — Harden the ledger (rename, currency, typed references, exchange-rate history), PR 18 — Rename `AccountEntry` → `LedgerEntry` (pure rename, no behavior change), PR 19 — Add `currency` to `LedgerEntry`, backfill `USD`, PR 20 — Pass real currency from `PaymentsService`, PR 21 — Pass real currency from `StockExitsService` / `WalkInSalesService`, PR 22 — Pass real currency from `CashHandoversService`, PR 23 — Add nullable per-source-type FKs to `LedgerEntry` (dual-populate alongside `referenceId`), PR 24 — Add the "exactly one reference" check constraint (+6 more)

### Community 91 - "Community 91"
Cohesion: 0.24
Nodes (11): ProtectedRoute(), DEV, devToken(), getDevRole(), setDevRole(), ROLE_EMAILS, ROLE_HOME, SignIn() (+3 more)

### Community 92 - "Community 92"
Cohesion: 0.18
Nodes (9): CreateWorkerDto, ApiProperty, IsArray, IsNotEmpty, IsOptional, IsString, Type, ValidateNested (+1 more)

### Community 93 - "Community 93"
Cohesion: 0.15
Nodes (12): name, private, scripts, build, dev, preview, test, type (+4 more)

### Community 94 - "Community 94"
Cohesion: 0.15
Nodes (13): 5. Module 1 — Container Tracker, 7. Module 3 — Packing Sessions, Container lifecycle, Cost report (live, recalculates on every change), Direct warehouse addition (no container), Discount, Expense allocation logic, Expenses (+5 more)

### Community 95 - "Community 95"
Cohesion: 0.17
Nodes (8): useCreateContainer(), ContainerStatus, CreateContainerProductLineDto, GRADES, NewContainer(), PLine, STATUS_STEPS, StepKey

### Community 96 - "Community 96"
Cohesion: 0.26
Nodes (11): useSupplierLedger(), fmtDate(), initialsOf(), money(), NOTE: this is an inventory-cost-basis figure (raw StockLot.costPerKg, which for, SupplierDetail(), copyText(), exportStatement() (+3 more)

### Community 98 - "Community 98"
Cohesion: 0.17
Nodes (12): Clients, `GET /api/v1/clients`, `GET /api/v1/clients/:id`, `GET /api/v1/clients/:id/balance`, `GET /api/v1/clients/:id/invoices`, `GET /api/v1/clients/:id/orders`, `GET /api/v1/clients/:id/payments`, `GET /api/v1/clients/overdue` (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.17
Nodes (11): Cash Management System — Implementation Roadmap, Cleanup PRs (non-blocking, run once each phase's verification window has passed), Critical Path, Dependency Graph (phase level), Estimated Timeline, Highest-Risk Tasks, Implementation Order (recommended), PHASE 3.5 — Centralized cash reporting (closes the Dashboard/Reports inconsistency) (+3 more)

### Community 100 - "Community 100"
Cohesion: 0.17
Nodes (11): 18. Print Templates, 19. Currency & Payments, 1. Business Overview, 20. Arabic Language Support, 21. Critical Constraints — Never Violate, 2. Technology Constraints, Charcoal Business Accounting System — Full Specification, Delivery receipt (printed by driver at restaurant) (+3 more)

### Community 101 - "Community 101"
Cohesion: 0.18
Nodes (11): CreateContainerDto, ApiProperty, ApiPropertyOptional, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString (+3 more)

### Community 102 - "Community 102"
Cohesion: 0.18
Nodes (11): SetRatesDto, ApiProperty, ArrayMinSize, IsArray, Type, ValidateNested, ApiProperty, IsNotEmpty (+3 more)

### Community 103 - "Community 103"
Cohesion: 0.18
Nodes (10): name, private, scripts, build, dev, lint, start, test (+2 more)

### Community 104 - "Community 104"
Cohesion: 0.18
Nodes (11): PHASE 6 — New flows: Transfer, Opening Float, Cash Count, Advance, PR 40 — `CashTransfer` table, PR 41 — `LedgerWriteService.recordTransfer()` + `CashTransferService`/controller/DTO, PR 42 — Frontend: Cash Transfer UI, PR 43 — `OpeningFloat` table + service + `getExpectedCash` float-netting, PR 44 — Frontend: assign/supersede opening float (owner-only), PR 45 — `CashCount` table + service/controller/DTO (no ledger entries), PR 46 — Frontend: spot-check count action (+3 more)

### Community 105 - "Community 105"
Cohesion: 0.22
Nodes (9): PhysicalCountItemDto, SubmitPhysicalCountDto, ApiProperty, IsArray, IsInt, IsUUID, Min, Type (+1 more)

### Community 106 - "Community 106"
Cohesion: 0.20
Nodes (8): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Post, WalkInSalesController

### Community 107 - "Community 107"
Cohesion: 0.22
Nodes (8): CreateWorkerPaymentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString

### Community 108 - "Community 108"
Cohesion: 0.20
Nodes (9): GET /api/v1/reports/worker-earnings/:workerId, Module 7 — Suppliers, Non-sale Stock Exits, POST /api/v1/stock-exits (internal use), POST /api/v1/stock-exits (sample), POST /api/v1/suppliers, POST /api/v1/workers/:id/payments (owner pays worker), Sample API Payloads (+1 more)

### Community 109 - "Community 109"
Cohesion: 0.20
Nodes (10): 11. Module 7 — Delivery, 12. Module 8 — Suppliers, 9. Module 5 — Orders & Invoicing, Delivery flow, Invoice structure, Order types by sales scenario, Payment logging, Purpose (+2 more)

### Community 110 - "Community 110"
Cohesion: 0.20
Nodes (10): 4.1 Charcoal identity, 4.2 Stock lot, 4.3 Bag type, 4.4 Packing session, 4.5 Packed stock, 4.6 Client debit balance, 4.7 Price at time of sale, 4.8 Packed-stock reservations (shipment-keyed) (+2 more)

### Community 111 - "Community 111"
Cohesion: 0.22
Nodes (7): AuthController, ApiBearerAuth, ApiTags, Controller, AuthModule, Global, Module

### Community 112 - "Community 112"
Cohesion: 0.22
Nodes (8): CreateSupplierDto, ApiProperty, IsArray, IsInt, IsObject, IsOptional, IsString, Min

### Community 113 - "Community 113"
Cohesion: 0.22
Nodes (8): ApiProperty, IsArray, IsInt, IsObject, IsOptional, IsString, Min, UpdateSupplierDto

### Community 114 - "Community 114"
Cohesion: 0.22
Nodes (9): `GET /api/v1/reports/client-ledger/:clientId`, `GET /api/v1/reports/container-costs`, `GET /api/v1/reports/physical-count`, `GET /api/v1/reports/profit-loss`, `GET /api/v1/reports/stock-value`, `GET /api/v1/reports/variance`, `GET /api/v1/reports/worker-earnings/:workerId`, `POST /api/v1/reports/physical-count` (+1 more)

### Community 115 - "Community 115"
Cohesion: 0.22
Nodes (9): `GET /api/v1/shipments`, `GET /api/v1/shipments/:id`, `GET /api/v1/shipments/:id/receipt`, `PATCH /api/v1/shipments/:id`, `PATCH /api/v1/shipments/:id/actual-weight`, `POST /api/v1/shipments`, `POST /api/v1/shipments/:id/confirm-delivery`, `POST /api/v1/shipments/:id/return` (+1 more)

### Community 116 - "Community 116"
Cohesion: 0.22
Nodes (9): PHASE 2 — Introduce `CashHolder`, PR 10 — `CashHolder` table (additive, no other table touched), PR 11 — `CashHolderService` + backfill script, PR 12 — Wire `LedgerWriteService` validation to `CashHolderService`, PR 13 — Add nullable `holderId` to `Payment` (dual-write), PR 14 — Add nullable `holderId` to `StockExit` (dual-write), PR 15 — Add nullable `holderId` to `CashHandover` (dual-write), PR 16 — Switch reads to prefer `holderId`, verify against legacy fields (+1 more)

### Community 117 - "Community 117"
Cohesion: 0.22
Nodes (8): Batch 5 — Shipment-keyed reservations & currency-correct P&L (2026-06-03), BUG-I (P1) — Reservations pinned to the shipment, BUG-J (P5) — Per-invoice exchange-rate snapshot, BUG-K (P5) — Currency on stock-exit amounts, BUG-L (P5) — Currency on bag purchases, BUG-M (P5) — Currency on driver-trip costs, Changelog, Notes

### Community 118 - "Community 118"
Cohesion: 0.22
Nodes (8): vite.config.ts, compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 119 - "Community 119"
Cohesion: 0.22
Nodes (9): 13. Module 9 — Reports & Reconciliation, Report: Client ledger, Report: Container cost report, Report: Physical count reconciliation, Report: Profit & Loss, Report: Stock value, Report: Variance report, Report: Worker earnings (+1 more)

### Community 120 - "Community 120"
Cohesion: 0.22
Nodes (9): 17. Business Logic & Formulas, Client avg_order_days, Client balance, Container cost allocation, P&L gross profit, Packing session variance, Session earnings, Stock lot kg remaining (+1 more)

### Community 121 - "Community 121"
Cohesion: 0.47
Nodes (9): openExportModal(), exportExcel(), exportInvoices(), exportOrders(), exportPayments(), exportStatement(), exportWarehouse(), showToast() (+1 more)

### Community 122 - "Community 122"
Cohesion: 0.32
Nodes (5): FILL_JOB_INCLUDE, baseTx(), fn(), makeTx(), StoredBagOutput

### Community 123 - "Community 123"
Cohesion: 0.25
Nodes (7): ConfirmDeliveryDto, ApiProperty, IsDateString, IsEnum, IsNumberString, IsOptional, IsString

### Community 124 - "Community 124"
Cohesion: 0.25
Nodes (8): CreateSupplierPaymentDto, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID

### Community 125 - "Community 125"
Cohesion: 0.25
Nodes (7): exclude, include, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx

### Community 126 - "Community 126"
Cohesion: 0.25
Nodes (8): `GET /api/v1/workers`, `GET /api/v1/workers/:id`, `GET /api/v1/workers/:id/payments`, `PATCH /api/v1/workers/:id`, `PATCH /api/v1/workers/:id/rates`, `POST /api/v1/workers`, `POST /api/v1/workers/:id/payments`, Workers

### Community 127 - "Community 127"
Cohesion: 0.25
Nodes (8): GET /api/v1/shipments/:id/receipt (printed at delivery), Module 6 — Delivery, PATCH /api/v1/shipments/:id/actual-weight (driver logs weight at loading), POST /api/v1/driver-trips (create trip), POST /api/v1/driver-trips/:id/complete, POST /api/v1/shipments (create shipment within order), POST /api/v1/shipments/:id/confirm-delivery, POST /api/v1/shipments/:id/return (driver logs return)

### Community 128 - "Community 128"
Cohesion: 0.25
Nodes (7): exports, ./types, main, name, private, types, version

### Community 129 - "Community 129"
Cohesion: 0.25
Nodes (8): 10. Module 6 — Fill Jobs (Client-Provided Bags), Client Type, Difference from Packing Sessions, Fill Job vs Walk-in Sale, Fill Job Workflow, FillJob Fields, FillJobLot, Stock Deduction

### Community 131 - "Community 131"
Cohesion: 0.33
Nodes (5): Put, ApiProperty, IsNotEmpty, IsNumberString, UpsertDiscountDto

### Community 132 - "Community 132"
Cohesion: 0.43
Nodes (4): fn(), makeTx(), setupTransaction(), setupTx()

### Community 133 - "Community 133"
Cohesion: 0.29
Nodes (7): lib, dom, DOM, DOM.Iterable, ES2020, ES2022, lib

### Community 134 - "Community 134"
Cohesion: 0.29
Nodes (7): Driver Trips, `GET /api/v1/driver-trips`, `GET /api/v1/driver-trips/:id`, `PATCH /api/v1/driver-trips/:id`, `POST /api/v1/driver-trips`, `POST /api/v1/driver-trips/:id/complete`, `POST /api/v1/driver-trips/:id/start`

### Community 135 - "Community 135"
Cohesion: 0.29
Nodes (7): `GET /api/v1/invoices`, `GET /api/v1/invoices/:id`, Invoices, `PATCH /api/v1/invoices/:id`, `POST /api/v1/invoices`, `POST /api/v1/invoices/:id/cancel`, `POST /api/v1/invoices/:id/issue`

### Community 136 - "Community 136"
Cohesion: 0.29
Nodes (7): Business Constraint Violation (400), Forbidden (403), Not Found (404), Paginated List, Standard Response Wrappers, Unauthorized (401), Validation Error (422)

### Community 137 - "Community 137"
Cohesion: 0.29
Nodes (7): PHASE 5 — Redesign Cash Handover, PR 34 — Extend `LedgerEntry.type` with correction types, PR 35 — `BalanceQueryService.getExpectedCash()`, PR 36 — Real `CreateCashHandoverDto`, PR 37 — Server-computed Expected Cash in `CashHandoversService.create`, PR 38 — Frontend: stop sending `expectedAmt`; display server-computed value, PR 39 — Remove the unpersisted expense-subtraction UI (interim step)

### Community 138 - "Community 138"
Cohesion: 0.29
Nodes (6): ADR-001: Why `CashHolder` Exists as a Dedicated Entity, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 139 - "Community 139"
Cohesion: 0.29
Nodes (6): ADR-002: Why the Ledger Is Append-Only, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 140 - "Community 140"
Cohesion: 0.29
Nodes (6): ADR-003: Why Balances Are Computed, Not Stored, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 141 - "Community 141"
Cohesion: 0.29
Nodes (6): ADR-004: Why Read and Write Services Are Separated, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 142 - "Community 142"
Cohesion: 0.29
Nodes (6): ADR-005: Why Idempotency Is Enforced at the Business-Document Layer, Alternatives Considered, Consequences, Context, Decision, Why This Matters Later

### Community 143 - "Community 143"
Cohesion: 0.29
Nodes (7): 14. Sales Scenarios, S1 — Walk-in warehouse buyer, S2 — Restaurant delivery (primary flow), S3 — Bags sold as-is from supplier, S4 — Client brings own bags, S5 — Sample / gift / internal use, S6 — Export / corporate order

### Community 144 - "Community 144"
Cohesion: 0.33
Nodes (3): Layout(), NavItemProps, Sidebar()

### Community 145 - "Community 145"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 146 - "Community 146"
Cohesion: 0.40
Nodes (5): APPLY, main(), prisma, ReportRow, statusFromPaid()

### Community 147 - "Community 147"
Cohesion: 0.47
Nodes (6): CreateLocalUserDto, ApiProperty, IsEnum, IsOptional, IsString, UpdateUserNameDto

### Community 148 - "Community 148"
Cohesion: 0.53
Nodes (4): dec(), makeWorker(), mockAggregates(), mockGroupBy()

### Community 149 - "Community 149"
Cohesion: 0.33
Nodes (6): Bag Types, `DELETE /api/v1/bag-types/:id`, `GET /api/v1/bag-types`, `GET /api/v1/bag-types/:id`, `PATCH /api/v1/bag-types/:id`, `POST /api/v1/bag-types`

### Community 150 - "Community 150"
Cohesion: 0.33
Nodes (6): Containers, `DELETE /api/v1/containers/:id`, `GET /api/v1/containers`, `GET /api/v1/containers/:id`, `PATCH /api/v1/containers/:id`, `POST /api/v1/containers`

### Community 151 - "Community 151"
Cohesion: 0.33
Nodes (6): `DELETE /api/v1/orders/:id`, `GET /api/v1/orders`, `GET /api/v1/orders/:id`, Orders, `PATCH /api/v1/orders/:id`, `POST /api/v1/orders`

### Community 152 - "Community 152"
Cohesion: 0.33
Nodes (6): `DELETE /api/v1/suppliers/:id`, `GET /api/v1/suppliers`, `GET /api/v1/suppliers/:id`, `PATCH /api/v1/suppliers/:id`, `POST /api/v1/suppliers`, Suppliers

### Community 153 - "Community 153"
Cohesion: 0.33
Nodes (6): PHASE 0 — Centralize, change nothing behaviorally, PR 1 — Extract `LedgerWriteService` + `BalanceQueryService` (wrapping today's functions), PR 2 — Migrate `PaymentsService` to `LedgerWriteService`, PR 3 — Migrate `StockExitsService` to `LedgerWriteService`, PR 4 — Migrate `WalkInSalesService` (Warehouse Sale) to `LedgerWriteService`, PR 5 — Retire the loose functions; finalize read-side centralization

### Community 154 - "Community 154"
Cohesion: 0.33
Nodes (6): PHASE 1 — Close the receiver-resolution gap (on today's identity model), PR 6 — Server-side holder validation inside `LedgerWriteService`, PR 6b — Move holder validation before the write in each `creditAccount` caller, PR 7 — Fix `ClientDetail.tsx` "Record Payment" receiver resolution, PR 8 — Fix `FillClientDetail.tsx` "Record Payment" receiver resolution, PR 9 — Fix `WarehouseSales.tsx` anonymous-sale "Received by" resolution

### Community 155 - "Community 155"
Cohesion: 0.33
Nodes (6): 3.1 Owner, 3.2 Sales Rep, 3.3 Accountant, 3.4 Worker, 3.5 Driver, 3. User Roles & Permissions

### Community 156 - "Community 156"
Cohesion: 0.40
Nodes (5): Auth / Users, `GET /api/v1/auth/me`, `GET /api/v1/users`, `GET /api/v1/users/:id`, `PATCH /api/v1/users/:id/role`

### Community 157 - "Community 157"
Cohesion: 0.40
Nodes (5): Container Expenses, `DELETE /api/v1/containers/:id/expenses/:expenseId`, `GET /api/v1/containers/:id/expenses`, `PATCH /api/v1/containers/:id/expenses/:expenseId`, `POST /api/v1/containers/:id/expenses`

### Community 158 - "Community 158"
Cohesion: 0.40
Nodes (5): Container Product Lines, `DELETE /api/v1/containers/:id/product-lines/:lineId`, `GET /api/v1/containers/:id/product-lines`, `PATCH /api/v1/containers/:id/product-lines/:lineId`, `POST /api/v1/containers/:id/product-lines`

### Community 159 - "Community 159"
Cohesion: 0.40
Nodes (5): Error: negative variance without note (400), Module 3 — Packing Sessions, Packing session with negative variance (requires explanation), POST /api/v1/packing-sessions (request body), POST /api/v1/packing-sessions (response)

### Community 160 - "Community 160"
Cohesion: 0.40
Nodes (5): GET /api/v1/containers/:id (single with all details), GET /api/v1/containers (list), Module 1 — Containers, POST /api/v1/containers/:id/expenses (request body), POST /api/v1/containers (request body)

### Community 161 - "Community 161"
Cohesion: 0.40
Nodes (5): GET /api/v1/invoices/:id (single invoice with payments), Module 5 — Orders & Invoicing, POST /api/v1/invoices (request body), POST /api/v1/orders (restaurant delivery order), POST /api/v1/payments (log a payment)

### Community 162 - "Community 162"
Cohesion: 0.40
Nodes (5): GET /api/v1/reports/profit-loss (owner only), GET /api/v1/reports/stock-value, GET /api/v1/reports/variance, Module 8 — Reports, POST /api/v1/reports/physical-count (submit count)

### Community 163 - "Community 163"
Cohesion: 0.40
Nodes (5): GET /api/v1/stock-lots, GET /api/v1/warehouse/summary, Module 2 — Warehouse & Stock, POST /api/v1/bag-types (request), POST /api/v1/stock-lots (direct addition, no container)

### Community 164 - "Community 164"
Cohesion: 0.40
Nodes (5): PHASE 7 — Scale hardening (deferred; not urgent at current scale), PR 50 — `LedgerCheckpoint` table, PR 51 — Reconciliation job + owner-only manual recalculate endpoint, PR 52 — `BalanceQueryService` uses checkpoints to bound scan range, PR 53 — `CashHolder.branchId` + branch-scoped queries

### Community 165 - "Community 165"
Cohesion: 0.70
Nodes (4): init(), lucideToSvg(), nodeToString(), replaceIcons()

### Community 166 - "Community 166"
Cohesion: 0.40
Nodes (5): 15. Stock Reconciliation Rules, How every movement is tracked, Rules the system must enforce, The formula, Variance

### Community 167 - "Community 167"
Cohesion: 0.40
Nodes (5): 6. Module 2 — Warehouse & Stock, Bag purchases, Physical stock count, System stock formula, Two zones

### Community 168 - "Community 168"
Cohesion: 0.40
Nodes (5): 8. Module 4 — Client CRM, Client history, Client profile fields, Client types, CRM alert page

### Community 169 - "Community 169"
Cohesion: 0.50
Nodes (3): ApiOperation, ApiResponse, Get

### Community 170 - "Community 170"
Cohesion: 0.50
Nodes (4): Container Discount, `DELETE /api/v1/containers/:id/discount`, `GET /api/v1/containers/:id/discount`, `PUT /api/v1/containers/:id/discount`

### Community 171 - "Community 171"
Cohesion: 0.50
Nodes (4): `GET /api/v1/packing-sessions`, `GET /api/v1/packing-sessions/:id`, Packing Sessions, `POST /api/v1/packing-sessions`

### Community 172 - "Community 172"
Cohesion: 0.50
Nodes (4): `GET /api/v1/payments`, `GET /api/v1/payments/:id`, Payments, `POST /api/v1/payments`

### Community 173 - "Community 173"
Cohesion: 0.50
Nodes (4): `GET /api/v1/stock-lots`, `GET /api/v1/stock-lots/:id`, `POST /api/v1/stock-lots`, Stock Lots

### Community 174 - "Community 174"
Cohesion: 0.50
Nodes (4): GET /api/v1/clients/overdue, Module 4 — Client CRM, POST /api/v1/clients/:id/phones (add phone, never deleted), POST /api/v1/clients (request body)

### Community 175 - "Community 175"
Cohesion: 0.50
Nodes (4): PHASE 4 — Idempotency, PR 31 — Idempotency key columns, PR 32 — Backend dedup logic, PR 33 — Frontend idempotency key generation

### Community 177 - "Community 177"
Cohesion: 0.50
Nodes (3): src, include, references

### Community 178 - "Community 178"
Cohesion: 0.50
Nodes (3): ImportMeta, ImportMetaEnv, Window

### Community 182 - "Community 182"
Cohesion: 0.67
Nodes (3): paths, @charcoal/shared/*, ../../packages/shared/*

### Community 183 - "Community 183"
Cohesion: 0.67
Nodes (3): Bag Purchases, `GET /api/v1/bag-purchases`, `POST /api/v1/bag-purchases`

## Knowledge Gaps
- **1143 isolated node(s):** `AppConfig`, `DriverTripsQuery`, `ExpensesQuery`, `Expense`, `Screen` (+1138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Roles()` connect `Community 20` to `Community 2`, `Community 131`, `Community 6`, `Community 12`, `Community 21`, `Community 22`, `Community 23`, `Community 26`, `Community 27`, `Community 30`, `Community 35`, `Community 38`, `Community 40`, `Community 41`, `Community 44`, `Community 56`, `Community 57`, `Community 60`, `Community 68`, `Community 72`, `Community 81`, `Community 106`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `PrismaService` connect `Community 1` to `Community 2`, `Community 130`, `Community 132`, `Community 5`, `Community 6`, `Community 3`, `Community 10`, `Community 12`, `Community 148`, `Community 21`, `Community 22`, `Community 24`, `Community 26`, `Community 27`, `Community 30`, `Community 32`, `Community 36`, `Community 42`, `Community 44`, `Community 48`, `Community 50`, `Community 181`, `Community 55`, `Community 63`, `Community 68`, `Community 85`, `Community 89`, `Community 111`, `Community 122`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `ClerkUser` connect `Community 20` to `Community 64`, `Community 35`, `Community 68`, `Community 6`, `Community 38`, `Community 40`, `Community 72`, `Community 10`, `Community 106`, `Community 12`, `Community 44`, `Community 92`, `Community 81`, `Community 21`, `Community 23`, `Community 27`, `Community 60`, `Community 30`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `AppConfig`, `DriverTripsQuery`, `ExpensesQuery` to the rest of the system?**
  _1143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.025632911392405065 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0673274094326726 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06479081821547575 - nodes in this community are weakly interconnected._