-- CreateEnum
CREATE TYPE "WasteEntryType" AS ENUM ('packing_variance', 'sale', 'adjustment', 'disposal');

-- AlterEnum
ALTER TYPE "AdjustmentType" ADD VALUE 'waste';

-- NOTE: `prisma migrate dev` generated a `DROP INDEX "stock_exits_idempotencyKey_key"`
-- here, unrelated to this migration. That index is a real safety mechanism (prevents
-- double-deducting stock on a duplicate anonymous-walk-in-sale request) created via raw
-- SQL because schema.prisma's StockExit.idempotencyKey field has never been annotated
-- @unique — see 20260908110500_restore_stock_exits_idempotency_key_index's migration
-- comment for the full history of this exact drift recurring. Removed here, same as
-- that prior migration did, rather than silently dropping someone else's safety index
-- as a side effect of an unrelated waste-pool migration.

-- CreateTable
CREATE TABLE "waste_stock" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "kgOnHand" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_entries" (
    "id" TEXT NOT NULL,
    "type" "WasteEntryType" NOT NULL,
    "kg" DECIMAL(10,3) NOT NULL,
    "sessionId" TEXT,
    "stockExitId" TEXT,
    "invoiceId" TEXT,
    "adjustmentId" TEXT,
    "note" TEXT,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waste_entries_sessionId_key" ON "waste_entries"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "waste_entries_stockExitId_key" ON "waste_entries"("stockExitId");

-- CreateIndex
CREATE UNIQUE INDEX "waste_entries_invoiceId_key" ON "waste_entries"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "waste_entries_adjustmentId_key" ON "waste_entries"("adjustmentId");

-- CreateIndex
CREATE INDEX "waste_entries_date_idx" ON "waste_entries"("date");

-- CreateIndex
CREATE INDEX "waste_entries_type_idx" ON "waste_entries"("type");

-- CreateIndex
CREATE INDEX "waste_entries_stockExitId_idx" ON "waste_entries"("stockExitId");

-- CreateIndex
CREATE INDEX "waste_entries_invoiceId_idx" ON "waste_entries"("invoiceId");

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "packing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_stockExitId_fkey" FOREIGN KEY ("stockExitId") REFERENCES "stock_exits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
