-- DropForeignKey
ALTER TABLE "stock_exits" DROP CONSTRAINT "stock_exits_bagTypeId_fkey";

-- DropForeignKey
ALTER TABLE "stock_exits" DROP CONSTRAINT "stock_exits_packedStockId_fkey";

-- AlterTable
ALTER TABLE "stock_exits" ADD COLUMN     "kgQuantity" DECIMAL(10,3),
ADD COLUMN     "lotId" TEXT,
ALTER COLUMN "packedStockId" DROP NOT NULL,
ALTER COLUMN "bagTypeId" DROP NOT NULL,
ALTER COLUMN "quantity" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_packedStockId_fkey" FOREIGN KEY ("packedStockId") REFERENCES "packed_stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_bagTypeId_fkey" FOREIGN KEY ("bagTypeId") REFERENCES "bag_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
