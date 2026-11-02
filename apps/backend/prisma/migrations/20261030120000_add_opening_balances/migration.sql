-- Go-live opening balances for clients (incl. Fill Clients) and suppliers.
-- NOTE: `prisma migrate diff` also emitted DROP INDEX "stock_exits_idempotencyKey_key" —
-- the known raw-SQL safety index drift (see 20260908110500_restore_stock_exits_idempotency_key_index).
-- Removed here so this migration never drops it.

-- CreateTable
CREATE TABLE "supplier_opening_balances" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_opening_balances" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_opening_balances_supplierId_key" ON "supplier_opening_balances"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "client_opening_balances_clientId_key" ON "client_opening_balances"("clientId");

-- AddForeignKey
ALTER TABLE "supplier_opening_balances" ADD CONSTRAINT "supplier_opening_balances_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_opening_balances" ADD CONSTRAINT "supplier_opening_balances_setById_fkey" FOREIGN KEY ("setById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_opening_balances" ADD CONSTRAINT "client_opening_balances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_opening_balances" ADD CONSTRAINT "client_opening_balances_setById_fkey" FOREIGN KEY ("setById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

