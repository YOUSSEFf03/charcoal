-- Adds the display-only StockExit -> Invoice link already referenced by
-- WalkInSalesService (schema field + application code predate this migration;
-- this migration only makes the physical column catch up to match them).
-- Nullable, matching every other optional FK on this table (orderId,
-- clientId, packedStockId, bagTypeId, lotId) — same ON DELETE SET NULL /
-- ON UPDATE CASCADE pattern as those, so deleting an invoice never blocks
-- or cascades into deleting the stock-exit history that happened to be
-- linked to it; the exit row survives with invoiceId reset to null.

-- AlterTable
ALTER TABLE "stock_exits" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE INDEX "stock_exits_invoiceId_idx" ON "stock_exits"("invoiceId");

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
