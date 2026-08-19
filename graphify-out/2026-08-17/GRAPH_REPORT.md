# Graph Report - my-app  (2026-08-17)

## Corpus Check
- 323 files · ~269,789 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2575 nodes · 5839 edges · 122 communities (102 shown, 20 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 215 edges (avg confidence: 0.79)
- Token cost: 3,200 input · 5,400 output

## Community Hubs (Navigation)
- Reports & Analytics Queries
- Backend App & Cash Handovers Module
- Containers Module & Controller
- Physical Count & Walk-In Sales
- Physical Count & Expenses Backend
- Driver Trips Controller
- Order Creation DTO
- Payment Allocation & Ledger
- Drivers & Current User Hooks
- Supplier Creation DTO
- Cash Handover Hooks
- Bag Types Controller
- Revenue Charts
- Clerk Auth Config Docs
- Fill Job DTO
- UserMenu & Topbar UI
- Auth Controller & Clerk Strategy
- Container Expenses Hooks
- Log Return DTO
- Web App Package Manifest
- Clients & Rate Hooks
- Auth Guard & Health Check
- Client Detail & Xlsx Export
- Cash Handovers Service
- Packing Sessions Hooks
- Invoice Creation DTO
- Worker History & Earnings Hooks
- Bag Purchases Controller
- General Expense DTO
- Stock Adjustments Controller
- Containers Controller
- Client Balance Service
- Web App TS Config
- Update User Role DTO
- Backend Dev Dependencies
- Invoice Calculator Service
- Orders Hooks
- Swagger API Decorators
- Backend Runtime Dependencies
- App Module & JWT Guard
- Walk-In Sale DTO
- API Controller Decorators
- Suppliers Hooks
- Stock Exits Controller
- Driver Trips Hooks
- Invoices Controller
- Client Balance & Fill Jobs Hooks
- Balance Computation Backend
- Orders Controller
- App Shell & Rate Context
- Packing Session DTO
- Roles Guard
- Packing Sessions Controller
- Worker & Earning DTOs
- Backend TS Config
- Clients Controller
- Workers Service
- New Order Page
- Fill Client Detail Page
- Supplier Ledger Page
- Cash Handovers Controller
- Shipment Creation DTO
- Stock Lots Controller
- Bag Types Hooks
- Swagger Decorators (Misc)
- Payments Controller
- Protected Route & Dev Auth
- Client Balances Hooks
- Clients Controller (Phones)
- New Container Page
- Receivers & Users Hooks
- Packed Stock & Shipments Tests
- Backend NPM Scripts
- Stock Exit DTO
- Set Rates DTO
- Bag Purchases Hooks
- FIFO Lot Consumption
- Payment Creation DTO
- Stock Lot Creation DTO
- Containers List Page
- Auth Controller (Me)
- Client Creation DTO
- Misc Validation Decorators
- Confirm Delivery DTO
- Stock Lots Service
- Supplier Payment DTO
- Worker Creation DTO
- Worker Payment DTO
- Settings Page
- Packing Sessions Tests
- Layout & Sidebar
- NestJS CLI Config
- Backend Package Manifest
- Payment Allocation Backfill Script
- Local User DTO
- Workers Service Tests
- Vite Env Types
- Backend ESLint Config
- Prisma Seed Script
- Auth Module
- Create Endpoint (Misc)
- Create Endpoint (Misc 2)
- Submit Physical Count Endpoint
- Modal Component
- Joi Validation Library
- NestJS Common Package
- NestJS Core Package
- NestJS Mapped Types Package
- NestJS Passport Package
- Swagger UI Package
- Jest Package
- Express Types Package
- Database URL Config
- Next.js Config
- Next.js Env Types
- Node Env Var

## God Nodes (most connected - your core abstractions)
1. `Roles()` - 144 edges
2. `PrismaService` - 98 edges
3. `ClerkUser` - 70 edges
4. `CurrentUser` - 63 edges
5. `ClientDetail()` - 43 edges
6. `FillClientDetail()` - 35 edges
7. `Packing()` - 32 edges
8. `formatUsd()` - 31 edges
9. `ContainersService` - 29 edges
10. `UsersService` - 29 edges

## Surprising Connections (you probably didn't know these)
- `src/config/env.validation.ts` --semantically_similar_to--> `VITE_CLERK_PUBLISHABLE_KEY`  [INFERRED] [semantically similar]
  apps/backend/README.md → src/lib/README.md
- `NestJS backend (http://localhost:3001)` --references--> `Charcoal Business API (Backend) README`  [EXTRACTED]
  src/lib/README.md → apps/backend/README.md
- `CLERK_PUBLISHABLE_KEY` --references--> `VITE_CLERK_PUBLISHABLE_KEY`  [INFERRED]
  apps/backend/README.md → src/lib/README.md
- `VITE_API_URL` --references--> `PORT`  [INFERRED]
  src/lib/README.md → apps/backend/README.md
- `Frontend API Layer (src/lib) README` --references--> `Swagger`  [EXTRACTED]
  src/lib/README.md → apps/backend/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **React Provider Nesting Order** — src_lib_readme_clerkprovider, src_lib_readme_queryclientprovider, src_lib_readme_toastprovider, src_lib_readme_app [EXTRACTED 1.00]
- **Environment Variable Validation & Config Flow** — apps_backend_readme_joi, apps_backend_readme_env_validation_ts, apps_backend_readme_configuration_ts, apps_backend_readme_configservice [EXTRACTED 1.00]
- **Clerk Auth Token Attachment Flow** — src_lib_readme_usetokensync, src_lib_readme_useauth, src_lib_readme_clerk_token_bridge, src_lib_readme_request_interceptor [EXTRACTED 1.00]

## Communities (122 total, 20 thin omitted)

### Community 0 - "Reports & Analytics Queries"
Cohesion: 0.03
Nodes (73): ActivityItem, ClientLedgerQuery, ContainerCostsQuery, DailyRevenueQuery, PnlByTypeQuery, ProfitLossQuery, RevenueByTypeQuery, SupplierLedgerQuery (+65 more)

### Community 1 - "Backend App & Cash Handovers Module"
Cohesion: 0.06
Nodes (45): CashHandoversModule, Module, AppConfig, envValidationSchema, DriverTripsModule, Module, FillJobsModule, Module (+37 more)

### Community 2 - "Containers Module & Controller"
Cohesion: 0.05
Nodes (38): ContainersModule, Module, ContainersService, fn(), makeMockTx(), Injectable, CreateContainerDto, ApiProperty (+30 more)

### Community 3 - "Physical Count & Walk-In Sales"
Cohesion: 0.05
Nodes (51): usePhysicalCount(), useSubmitPhysicalCount(), CreateWalkInSaleDto, useCreateWalkInSale(), WalkInBagLine, WalkInKgLine, ClientWarehouseSummary, FifoDrawItem (+43 more)

### Community 4 - "Physical Count & Expenses Backend"
Cohesion: 0.08
Nodes (25): buildGeneralExpenseWhere(), PhysicalCountItemDto, SubmitPhysicalCountDto, ApiProperty, IsArray, IsInt, IsUUID, Min (+17 more)

### Community 5 - "Driver Trips Controller"
Cohesion: 0.07
Nodes (35): DriverTripsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+27 more)

### Community 6 - "Order Creation DTO"
Cohesion: 0.06
Nodes (26): CreateOrderDto, ApiProperty, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID (+18 more)

### Community 7 - "Payment Allocation & Ledger"
Cohesion: 0.10
Nodes (22): AllocationResult, PaymentAllocationService, Injectable, LedgerWriteService, Injectable, PaymentsService, fn(), makeTx() (+14 more)

### Community 8 - "Drivers & Current User Hooks"
Cohesion: 0.06
Nodes (39): DriverOption, shipmentsKey(), ShipmentsQuery, useShipments(), CreateSaleResult, salesKey(), useWarehouseSales(), WarehouseSalesQuery (+31 more)

### Community 9 - "Supplier Creation DTO"
Cohesion: 0.07
Nodes (32): CreateSupplierDto, ApiProperty, IsArray, IsInt, IsObject, IsOptional, IsString, Min (+24 more)

### Community 10 - "Cash Handover Hooks"
Cohesion: 0.07
Nodes (40): AggregatedCashHandoverExpense, useAllBalances(), useAllCashHandoverExpenses(), useCashHandovers(), useCreateCashHandover(), useDailyPayments(), UserBalance, useReceiverBalance() (+32 more)

### Community 11 - "Bag Types Controller"
Cohesion: 0.08
Nodes (24): BagTypesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+16 more)

### Community 12 - "Revenue Charts"
Cohesion: 0.10
Nodes (33): DailyRevenueChart(), RevenueByTypeChart(), useToast(), ordersKey(), useOrders(), useActivity(), useContainerCosts(), useDailyRevenue() (+25 more)

### Community 13 - "Clerk Auth Config Docs"
Cohesion: 0.05
Nodes (44): Charcoal Business API (Backend) README, Clerk, CLERK_JWKS_URL, CLERK_PUBLISHABLE_KEY, @clerk/clerk-sdk-node, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, ConfigModule.forRoot (+36 more)

### Community 14 - "Fill Job DTO"
Cohesion: 0.07
Nodes (31): CreateFillJobDto, FillJobBagOutputDto, FillJobCharcoalInputDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsInt (+23 more)

### Community 15 - "UserMenu & Topbar UI"
Cohesion: 0.09
Nodes (33): ROLE_LABELS, UserMenu(), Topbar(), TopbarProps, useClients(), invoicesKey(), InvoicesQuery, useCancelInvoice() (+25 more)

### Community 16 - "Auth Controller & Clerk Strategy"
Cohesion: 0.18
Nodes (13): ClerkUser, ROLES_KEY, CurrentUser, MAX_PAGE_LIMIT, ParseLimitPipe, ParsePagePipe, Injectable, IMPORTANT: must come before GET /:id so NestJS does not treat "summary" (+5 more)

### Community 17 - "Container Expenses Hooks"
Cohesion: 0.07
Nodes (27): ContainersQuery, useAddExpense(), useAddProductLine(), useContainer(), useDeleteContainer(), useDeleteExpense(), useDeleteProductLine(), useUpdateContainer() (+19 more)

### Community 18 - "Log Return DTO"
Cohesion: 0.10
Nodes (22): LogReturnDto, ApiProperty, IsOptional, IsString, ApiProperty, IsNotEmpty, IsNumberString, UpdateActualWeightDto (+14 more)

### Community 19 - "Web App Package Manifest"
Cohesion: 0.05
Nodes (40): dependencies, @charcoal/shared, @clerk/nextjs, next, @prisma/client, react, react-dom, svix (+32 more)

### Community 20 - "Clients & Rate Hooks"
Cohesion: 0.07
Nodes (35): useRate(), ClientsCounts, clientsKey(), ClientsQuery, TODO: verify against Swagger — API.md names this CRMOverdueClient[], useAddPhone(), useClientsCounts(), useCreateClient() (+27 more)

### Community 21 - "Auth Guard & Health Check"
Cohesion: 0.06
Nodes (24): IS_PUBLIC_KEY, Public(), HealthController, ApiOperation, ApiResponse, ApiTags, Controller, Get (+16 more)

### Community 22 - "Client Detail & Xlsx Export"
Cohesion: 0.09
Nodes (27): useClientWarehouseSummary(), formatDateTime(), exportSheet(), AccountChart(), CHARCOAL_TYPES, ChartPt, ClientDetail(), exitDisplayAmountUsd() (+19 more)

### Community 23 - "Cash Handovers Service"
Cohesion: 0.08
Nodes (12): CashHandoversService, fn(), makeTx(), Injectable, BalanceQueryService, Injectable, PrismaService, Injectable (+4 more)

### Community 24 - "Packing Sessions Hooks"
Cohesion: 0.10
Nodes (35): packingKey(), PackingSessionsQuery, useCreatePackingSession(), usePackingSession(), usePackingSessions(), useUpdatePackingSession(), CreatePackingSessionDto, PackingSession (+27 more)

### Community 25 - "Invoice Creation DTO"
Cohesion: 0.08
Nodes (27): CreateInvoiceDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsEnum, IsOptional, IsUUID (+19 more)

### Community 26 - "Worker History & Earnings Hooks"
Cohesion: 0.08
Nodes (30): useWorkerPackingSessionsHistory(), nextPageParam(), useCreateWorker(), useCreateWorkerEarning(), useDeleteWorker(), useUpdateWorker(), useWorkerEarnings(), useWorkerPayments() (+22 more)

### Community 27 - "Bag Purchases Controller"
Cohesion: 0.07
Nodes (26): BagPurchasesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+18 more)

### Community 28 - "General Expense DTO"
Cohesion: 0.08
Nodes (25): CreateGeneralExpenseDto, ApiProperty, IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString (+17 more)

### Community 29 - "Stock Adjustments Controller"
Cohesion: 0.12
Nodes (16): StockAdjustmentsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+8 more)

### Community 30 - "Containers Controller"
Cohesion: 0.22
Nodes (16): Roles(), ContainersController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller (+8 more)

### Community 31 - "Client Balance Service"
Cohesion: 0.09
Nodes (20): ClientBalanceService, Injectable, ClientsModule, Module, ClientsService, PhoneEntry, Injectable, CreateStockAdjustmentDto (+12 more)

### Community 32 - "Web App TS Config"
Cohesion: 0.06
Nodes (30): compilerOptions, allowJs, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx (+22 more)

### Community 33 - "Update User Role DTO"
Cohesion: 0.11
Nodes (16): ApiProperty, IsEnum, UpdateUserRoleDto, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body (+8 more)

### Community 34 - "Backend Dev Dependencies"
Cohesion: 0.07
Nodes (29): devDependencies, eslint, @nestjs/cli, @nestjs/schematics, @nestjs/testing, prisma, ts-jest, ts-node (+21 more)

### Community 35 - "Invoice Calculator Service"
Cohesion: 0.13
Nodes (4): InvoiceCalculatorService, Injectable, InvoicesService, Injectable

### Community 36 - "Orders Hooks"
Cohesion: 0.14
Nodes (25): useBagTypes(), OrdersQuery, useDeleteOrder(), useGenerateOrderInvoice(), useMarkOrderDelivered(), useOrder(), useUpdateOrder(), useConfirmDelivery() (+17 more)

### Community 37 - "Swagger API Decorators"
Cohesion: 0.11
Nodes (14): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, Get, Param, WarehouseController (+6 more)

### Community 38 - "Backend Runtime Dependencies"
Cohesion: 0.07
Nodes (27): dependencies, class-transformer, class-validator, @clerk/clerk-sdk-node, decimal.js, jsonwebtoken, jwks-rsa, @nestjs/config (+19 more)

### Community 39 - "App Module & JWT Guard"
Cohesion: 0.10
Nodes (12): AppModule, Module, isDevAuthBypassEnabled(), JwtAuthGuard, Injectable, ClerkStrategy, Injectable, HttpExceptionFilter (+4 more)

### Community 40 - "Walk-In Sale DTO"
Cohesion: 0.11
Nodes (24): CreateWalkInSaleDto, ApiProperty, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumberString (+16 more)

### Community 41 - "API Controller Decorators"
Cohesion: 0.22
Nodes (14): ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete, Get (+6 more)

### Community 42 - "Suppliers Hooks"
Cohesion: 0.11
Nodes (21): suppliersKey(), SuppliersQuery, useCreateSupplier(), useSuppliers(), useUpdateSupplier(), ContactPerson, CreateSupplierDto, CreateSupplierPaymentDto (+13 more)

### Community 43 - "Stock Exits Controller"
Cohesion: 0.14
Nodes (11): StockExitsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+3 more)

### Community 44 - "Driver Trips Hooks"
Cohesion: 0.12
Nodes (18): DriverTripsQuery, tripsKey(), useCompleteTrip(), useDriverTrips(), useStartTrip(), CreateDriverTripDto, ShipmentStatus, DriverMobile() (+10 more)

### Community 45 - "Invoices Controller"
Cohesion: 0.17
Nodes (14): InvoicesController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+6 more)

### Community 46 - "Client Balance & Fill Jobs Hooks"
Cohesion: 0.11
Nodes (21): useClientBalance(), ConfirmFillPickupDto, CreateFillJobDto, FillJob, FillJobBagOutput, FillJobLot, FillJobYtdSummary, FillPriceStats (+13 more)

### Community 47 - "Balance Computation Backend"
Cohesion: 0.22
Nodes (5): ApiOperation, ApiResponse, Get, Param, Query

### Community 48 - "Orders Controller"
Cohesion: 0.19
Nodes (14): OrdersController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Delete (+6 more)

### Community 49 - "App Shell & Rate Context"
Cohesion: 0.16
Nodes (12): App(), RateContext, RateCtx, RateProvider(), ToastContext, ToastCtx, ToastProvider(), useExchangeRate() (+4 more)

### Community 50 - "Packing Session DTO"
Cohesion: 0.15
Nodes (17): BagOutputLineDto, CreatePackingSessionDto, LotInputDto, ApiProperty, ArrayMinSize, IsArray, IsDateString, IsInt (+9 more)

### Community 51 - "Roles Guard"
Cohesion: 0.13
Nodes (10): RolesGuard, Injectable, DEFAULT_LOOKBACK_DAYS, dec(), fn(), makeContainer(), setupArSummary(), setupPnL() (+2 more)

### Community 52 - "Packing Sessions Controller"
Cohesion: 0.16
Nodes (12): PackingSessionsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+4 more)

### Community 53 - "Worker & Earning DTOs"
Cohesion: 0.20
Nodes (10): CreateWorkerEarningDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+2 more)

### Community 54 - "Backend TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+10 more)

### Community 55 - "Clients Controller"
Cohesion: 0.15
Nodes (10): IMPORTANT: these routes MUST come before /:id to avoid NestJS routing, AddPhoneDto, ApiProperty, IsNotEmpty, IsString, DeactivatePhoneDto, ApiProperty, IsNotEmpty (+2 more)

### Community 57 - "New Order Page"
Cohesion: 0.14
Nodes (9): useClient(), useCreateOrder(), StockLot, BagLine, KgLine, NewOrder(), showToast(), submitOrder() (+1 more)

### Community 58 - "Fill Client Detail Page"
Cohesion: 0.18
Nodes (12): useUpdateClient(), FillClientDetail(), saveContact(), saveEditClient(), saveFillJob(), saveNotes(), savePickup(), setBags() (+4 more)

### Community 59 - "Supplier Ledger Page"
Cohesion: 0.21
Nodes (15): useSupplierLedger(), useCreateSupplierPayment(), useSupplier(), useSupplierPayments(), formatDate(), fmtDate(), initialsOf(), money() (+7 more)

### Community 60 - "Cash Handovers Controller"
Cohesion: 0.17
Nodes (10): CashHandoversController, ApiBearerAuth, ApiOperation, ApiTags, Body, Controller, Get, Param (+2 more)

### Community 61 - "Shipment Creation DTO"
Cohesion: 0.14
Nodes (14): CreateShipmentDto, ShipmentBagInputDto, ApiProperty, IsArray, IsInt, IsNotEmpty, IsNumberString, IsOptional (+6 more)

### Community 62 - "Stock Lots Controller"
Cohesion: 0.19
Nodes (11): StockLotsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Body, Controller, Get (+3 more)

### Community 63 - "Bag Types Hooks"
Cohesion: 0.16
Nodes (13): useCreateBagType(), useDeleteBagType(), useUpdateBagType(), BagType, CreateBagTypeDto, UpdateBagTypeDto, INIT_PREFS, NAV (+5 more)

### Community 64 - "Swagger Decorators (Misc)"
Cohesion: 0.17
Nodes (9): ApiOperation, ApiResponse, ApiTags, Controller, HttpCode, Post, WebhooksController, Headers (+1 more)

### Community 65 - "Payments Controller"
Cohesion: 0.18
Nodes (9): PaymentsController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, Get, Param (+1 more)

### Community 66 - "Protected Route & Dev Auth"
Cohesion: 0.24
Nodes (11): ProtectedRoute(), DEV, devToken(), getDevRole(), setDevRole(), ROLE_EMAILS, ROLE_HOME, SignIn() (+3 more)

### Community 67 - "Client Balances Hooks"
Cohesion: 0.26
Nodes (12): balancesKey(), ClientBalancesQuery, useClientAging(), useClientBalances(), Client, Balances(), daysSince(), fmtDate() (+4 more)

### Community 68 - "Clients Controller (Phones)"
Cohesion: 0.22
Nodes (7): ClientsController, ApiBearerAuth, ApiTags, Body, Controller, Patch, Post

### Community 69 - "New Container Page"
Cohesion: 0.17
Nodes (8): useCreateContainer(), ContainerStatus, CreateContainerProductLineDto, GRADES, NewContainer(), PLine, STATUS_STEPS, StepKey

### Community 70 - "Receivers & Users Hooks"
Cohesion: 0.28
Nodes (11): Receiver, useReceivers(), useCreateLocalUser(), useDeleteLocalUser(), usersKey(), UsersQuery, useUpdateUserName(), useUpdateUserRole() (+3 more)

### Community 71 - "Packed Stock & Shipments Tests"
Cohesion: 0.23
Nodes (7): fn(), makeReturnTx(), makeStore(), PsRow, ResRow, setUpDelivery(), twoShipmentsSharingARow()

### Community 72 - "Backend NPM Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, lint, prisma:generate, start, start:debug, start:dev, test (+3 more)

### Community 73 - "Stock Exit DTO"
Cohesion: 0.18
Nodes (11): CreateStockExitDto, ApiProperty, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional (+3 more)

### Community 74 - "Set Rates DTO"
Cohesion: 0.18
Nodes (11): SetRatesDto, ApiProperty, ArrayMinSize, IsArray, Type, ValidateNested, ApiProperty, IsNotEmpty (+3 more)

### Community 75 - "Bag Purchases Hooks"
Cohesion: 0.31
Nodes (9): useBagPurchases(), useCreateBagPurchase(), BagPurchase, CreateBagPurchaseDto, BagPurchases(), showToast(), submitBrand(), submitForType() (+1 more)

### Community 76 - "FIFO Lot Consumption"
Cohesion: 0.27
Nodes (6): ConsumedLot, consumeLots(), LotConsumptionInput, fn(), makeTx(), splitBagsAcrossLots()

### Community 77 - "Payment Creation DTO"
Cohesion: 0.20
Nodes (9): CreatePaymentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString (+1 more)

### Community 78 - "Stock Lot Creation DTO"
Cohesion: 0.20
Nodes (8): CreateStockLotDto, ApiProperty, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID

### Community 79 - "Containers List Page"
Cohesion: 0.24
Nodes (9): containersKey(), useContainers(), Container, ContainerDetail, Containers(), CtrStatus, fmtEta(), STATUS_BADGE (+1 more)

### Community 80 - "Auth Controller (Me)"
Cohesion: 0.22
Nodes (7): AuthController, ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, Controller, Get

### Community 81 - "Client Creation DTO"
Cohesion: 0.25
Nodes (8): CreateClientDto, ApiProperty, IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString

### Community 82 - "Misc Validation Decorators"
Cohesion: 0.25
Nodes (8): ApiProperty, IsArray, IsDateString, IsOptional, IsString, Type, ValidateNested, UpdatePackingSessionDto

### Community 83 - "Confirm Delivery DTO"
Cohesion: 0.25
Nodes (7): ConfirmDeliveryDto, ApiProperty, IsDateString, IsEnum, IsNumberString, IsOptional, IsString

### Community 85 - "Supplier Payment DTO"
Cohesion: 0.25
Nodes (8): CreateSupplierPaymentDto, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID

### Community 86 - "Worker Creation DTO"
Cohesion: 0.25
Nodes (8): CreateWorkerDto, ApiProperty, IsArray, IsNotEmpty, IsOptional, IsString, Type, ValidateNested

### Community 87 - "Worker Payment DTO"
Cohesion: 0.25
Nodes (8): CreateWorkerPaymentDto, ApiProperty, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString

### Community 88 - "Settings Page"
Cohesion: 0.36
Nodes (6): initialsOf(), Settings(), saveBagRates(), saveEditBag(), showToast(), updateRate()

### Community 89 - "Packing Sessions Tests"
Cohesion: 0.43
Nodes (4): fn(), makeTx(), setupTransaction(), setupTx()

### Community 90 - "Layout & Sidebar"
Cohesion: 0.33
Nodes (3): Layout(), NavItemProps, Sidebar()

### Community 91 - "NestJS CLI Config"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 92 - "Backend Package Manifest"
Cohesion: 0.33
Nodes (5): name, prisma, seed, private, version

### Community 93 - "Payment Allocation Backfill Script"
Cohesion: 0.40
Nodes (5): APPLY, main(), prisma, ReportRow, statusFromPaid()

### Community 94 - "Local User DTO"
Cohesion: 0.47
Nodes (6): CreateLocalUserDto, ApiProperty, IsEnum, IsOptional, IsString, UpdateUserNameDto

### Community 95 - "Workers Service Tests"
Cohesion: 0.53
Nodes (4): dec(), makeWorker(), mockAggregates(), mockGroupBy()

### Community 96 - "Vite Env Types"
Cohesion: 0.50
Nodes (3): ImportMeta, ImportMetaEnv, Window

### Community 99 - "Auth Module"
Cohesion: 0.67
Nodes (3): AuthModule, Global, Module

## Knowledge Gaps
- **347 isolated node(s):** `tsPlugin`, `tsParser`, `$schema`, `collection`, `sourceRoot` (+342 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Roles()` connect `Containers Controller` to `Containers Module & Controller`, `Physical Count & Expenses Backend`, `Driver Trips Controller`, `Supplier Creation DTO`, `Bag Types Controller`, `Fill Job DTO`, `Auth Controller & Clerk Strategy`, `Log Return DTO`, `Auth Guard & Health Check`, `Invoice Creation DTO`, `Bag Purchases Controller`, `General Expense DTO`, `Stock Adjustments Controller`, `Update User Role DTO`, `Swagger API Decorators`, `Walk-In Sale DTO`, `API Controller Decorators`, `Stock Exits Controller`, `Invoices Controller`, `Balance Computation Backend`, `Orders Controller`, `Packing Sessions Controller`, `Worker & Earning DTOs`, `Clients Controller`, `Cash Handovers Controller`, `Stock Lots Controller`, `Payments Controller`, `Clients Controller (Phones)`, `Create Endpoint (Misc)`, `Create Endpoint (Misc 2)`, `Submit Physical Count Endpoint`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Why does `PrismaService` connect `Cash Handovers Service` to `Backend App & Cash Handovers Module`, `Containers Module & Controller`, `Driver Trips Controller`, `Order Creation DTO`, `Payment Allocation & Ledger`, `Bag Types Controller`, `Fill Job DTO`, `Auth Controller & Clerk Strategy`, `Log Return DTO`, `Auth Guard & Health Check`, `Invoice Creation DTO`, `Bag Purchases Controller`, `General Expense DTO`, `Stock Adjustments Controller`, `Client Balance Service`, `Invoice Calculator Service`, `Swagger API Decorators`, `App Module & JWT Guard`, `Packing Session DTO`, `Roles Guard`, `Worker & Earning DTOs`, `Workers Service`, `Swagger Decorators (Misc)`, `Packed Stock & Shipments Tests`, `Auth Controller (Me)`, `Stock Lots Service`, `Packing Sessions Tests`, `Workers Service Tests`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `ClerkUser` connect `Auth Controller & Clerk Strategy` to `Containers Module & Controller`, `Driver Trips Controller`, `Order Creation DTO`, `Supplier Creation DTO`, `Bag Types Controller`, `Log Return DTO`, `General Expense DTO`, `Stock Adjustments Controller`, `Containers Controller`, `Swagger API Decorators`, `Walk-In Sale DTO`, `API Controller Decorators`, `Orders Controller`, `Packing Session DTO`, `Packing Sessions Controller`, `Worker & Earning DTOs`, `Cash Handovers Controller`, `Stock Lots Controller`, `Create Endpoint (Misc)`, `Create Endpoint (Misc 2)`, `Submit Physical Count Endpoint`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `tsPlugin`, `tsParser`, `$schema` to the rest of the system?**
  _347 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Reports & Analytics Queries` be split into smaller, more focused modules?**
  _Cohesion score 0.03027027027027027 - nodes in this community are weakly interconnected._
- **Should `Backend App & Cash Handovers Module` be split into smaller, more focused modules?**
  _Cohesion score 0.06416275430359937 - nodes in this community are weakly interconnected._
- **Should `Containers Module & Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.051643192488262914 - nodes in this community are weakly interconnected._