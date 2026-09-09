-- DropIndex
DROP INDEX "stock_exits_idempotencyKey_key";

-- AlterTable
ALTER TABLE "container_trackings" ADD COLUMN     "etaChangeNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "etaChangedAt" TIMESTAMP(3),
ADD COLUMN     "previousEta" TIMESTAMP(3);
