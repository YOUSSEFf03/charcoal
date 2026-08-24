-- DropForeignKey
ALTER TABLE "stock_adjustments" DROP CONSTRAINT "stock_adjustments_approvedById_fkey";

-- DropIndex
DROP INDEX "client_orders_driver_id_idx";

-- DropIndex
DROP INDEX "payments_receiverId_idx";

-- DropIndex
DROP INDEX "stock_exits_collectedById_idx";

-- AlterTable
ALTER TABLE "client_orders" ALTER COLUMN "display_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "address" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(10,2),
ADD COLUMN     "nameAr" TEXT,
ADD COLUMN     "notesEn" TEXT;

-- AlterTable
ALTER TABLE "general_expenses" ALTER COLUMN "date" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "display_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "display_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "supplier_payments" ALTER COLUMN "display_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "user_accounts" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
