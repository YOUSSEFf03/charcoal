-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "receiverName" TEXT;

-- AlterTable
ALTER TABLE "stock_exits" ADD COLUMN     "collectedBy" TEXT;

-- CreateIndex
CREATE INDEX "payments_receiverName_idx" ON "payments"("receiverName");
