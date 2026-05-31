-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'accountant', 'sales_rep', 'worker', 'driver');

-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('port', 'transit', 'arrived');

-- CreateEnum
CREATE TYPE "StockSource" AS ENUM ('container', 'direct');

-- CreateEnum
CREATE TYPE "PackingMode" AS ENUM ('stock', 'order');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('restaurant', 'shop', 'wholesale', 'walk_in', 'corporate', 'export');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'LBP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'confirmed', 'partially_delivered', 'delivered', 'invoiced', 'paid');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('pending', 'loaded', 'delivered', 'returned');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('planned', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('order', 'walk_in', 'sample', 'gift', 'internal', 'client_bags_fill');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'whish', 'omt');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('lot', 'packed_stock');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contactPersons" JSONB NOT NULL DEFAULT '[]',
    "charcoalTypes" JSONB NOT NULL DEFAULT '[]',
    "bankDetails" JSONB,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "containers" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'port',
    "arrivalDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_product_lines" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "charcoalType" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paidBags" INTEGER NOT NULL,
    "giftBags" INTEGER NOT NULL DEFAULT 0,
    "kgPerBag" DECIMAL(10,3) NOT NULL,
    "pricePerTon" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "container_product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_expenses" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "container_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_discounts" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "container_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "charcoalType" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kgReceived" DECIMAL(10,3) NOT NULL,
    "kgRemaining" DECIMAL(10,3) NOT NULL,
    "costPerKg" DECIMAL(10,4) NOT NULL,
    "source" "StockSource" NOT NULL,
    "containerId" TEXT,
    "dateReceived" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bag_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nominalKg" DECIMAL(10,3) NOT NULL,
    "costPerBag" DECIMAL(10,4) NOT NULL,
    "workerRate" DECIMAL(10,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bag_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bag_purchases" (
    "id" TEXT NOT NULL,
    "bagTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "totalCost" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "addedById" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "bag_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packed_stocks" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "bagTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packed_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_sessions" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "mode" "PackingMode" NOT NULL,
    "orderId" TEXT,
    "kgConsumed" DECIMAL(10,3) NOT NULL,
    "bagsOutput" JSONB NOT NULL DEFAULT '[]',
    "kgOutputTotal" DECIMAL(10,3) NOT NULL,
    "varianceKg" DECIMAL(10,3) NOT NULL,
    "varianceNote" TEXT,
    "sessionEarnings" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "packing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "adjustmentType" "AdjustmentType" NOT NULL,
    "lotId" TEXT,
    "packedStockId" TEXT,
    "qtyBefore" DECIMAL(10,3) NOT NULL,
    "qtyAfter" DECIMAL(10,3) NOT NULL,
    "difference" DECIMAL(10,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "countedById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "phones" JSONB NOT NULL DEFAULT '[]',
    "preferredTypes" JSONB NOT NULL DEFAULT '[]',
    "avgOrderDays" DECIMAL(10,2),
    "lastOrderDate" DATE,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_orders" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "charcoalType" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "totalKgRequested" DECIMAL(10,3) NOT NULL,
    "bagTypeId" TEXT,
    "pricePerBag" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "client_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_bag_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bagTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_bag_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tripId" TEXT,
    "address" TEXT NOT NULL,
    "nominalKg" DECIMAL(10,3) NOT NULL,
    "actualKg" DECIMAL(10,3),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'pending',
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_bags" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "bagTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "shipment_bags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_trips" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'planned',
    "fuelCost" DECIMAL(10,2),
    "otherExpenses" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_exits" (
    "id" TEXT NOT NULL,
    "packedStockId" TEXT NOT NULL,
    "bagTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "exitType" "ExitType" NOT NULL,
    "reason" TEXT,
    "recipient" TEXT,
    "orderId" TEXT,
    "loggedById" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "clientId" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "date" DATE NOT NULL,
    "loggedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "ratesPerBagType" JSONB NOT NULL DEFAULT '[]',
    "totalBagsPacked" JSONB NOT NULL DEFAULT '[]',
    "totalEarned" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_payments" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "containers_status_idx" ON "containers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "container_discounts_containerId_key" ON "container_discounts"("containerId");

-- CreateIndex
CREATE INDEX "stock_lots_charcoalType_grade_idx" ON "stock_lots"("charcoalType", "grade");

-- CreateIndex
CREATE INDEX "stock_lots_supplierId_idx" ON "stock_lots"("supplierId");

-- CreateIndex
CREATE INDEX "stock_lots_kgRemaining_idx" ON "stock_lots"("kgRemaining");

-- CreateIndex
CREATE INDEX "packed_stocks_bagTypeId_idx" ON "packed_stocks"("bagTypeId");

-- CreateIndex
CREATE INDEX "packed_stocks_lotId_idx" ON "packed_stocks"("lotId");

-- CreateIndex
CREATE INDEX "packing_sessions_workerId_idx" ON "packing_sessions"("workerId");

-- CreateIndex
CREATE INDEX "packing_sessions_date_idx" ON "packing_sessions"("date");

-- CreateIndex
CREATE INDEX "client_orders_clientId_idx" ON "client_orders"("clientId");

-- CreateIndex
CREATE INDEX "client_orders_status_idx" ON "client_orders"("status");

-- CreateIndex
CREATE INDEX "client_orders_createdAt_idx" ON "client_orders"("createdAt");

-- CreateIndex
CREATE INDEX "shipments_tripId_idx" ON "shipments"("tripId");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "driver_trips_driverId_idx" ON "driver_trips"("driverId");

-- CreateIndex
CREATE INDEX "driver_trips_status_idx" ON "driver_trips"("status");

-- CreateIndex
CREATE INDEX "stock_exits_date_idx" ON "stock_exits"("date");

-- CreateIndex
CREATE INDEX "stock_exits_exitType_idx" ON "stock_exits"("exitType");

-- CreateIndex
CREATE INDEX "invoices_clientId_idx" ON "invoices"("clientId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_issuedAt_idx" ON "invoices"("issuedAt");

-- CreateIndex
CREATE INDEX "payments_clientId_idx" ON "payments"("clientId");

-- CreateIndex
CREATE INDEX "payments_date_idx" ON "payments"("date");

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_product_lines" ADD CONSTRAINT "container_product_lines_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_product_lines" ADD CONSTRAINT "container_product_lines_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_expenses" ADD CONSTRAINT "container_expenses_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_expenses" ADD CONSTRAINT "container_expenses_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_discounts" ADD CONSTRAINT "container_discounts_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_purchases" ADD CONSTRAINT "bag_purchases_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_purchases" ADD CONSTRAINT "bag_purchases_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packed_stocks" ADD CONSTRAINT "packed_stocks_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packed_stocks" ADD CONSTRAINT "packed_stocks_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packed_stocks" ADD CONSTRAINT "packed_stocks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "packing_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "client_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_packedStockId_fkey" FOREIGN KEY ("packedStockId") REFERENCES "packed_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_orders" ADD CONSTRAINT "client_orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_orders" ADD CONSTRAINT "client_orders_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_orders" ADD CONSTRAINT "client_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bag_lines" ADD CONSTRAINT "order_bag_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "client_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_bag_lines" ADD CONSTRAINT "order_bag_lines_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "client_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "driver_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_bags" ADD CONSTRAINT "shipment_bags_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_bags" ADD CONSTRAINT "shipment_bags_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_trips" ADD CONSTRAINT "driver_trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_packedStockId_fkey" FOREIGN KEY ("packedStockId") REFERENCES "packed_stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "client_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "client_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_payments" ADD CONSTRAINT "worker_payments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
