-- AlterTable
ALTER TABLE "stock_exits" ADD COLUMN     "clientId" TEXT;

-- AddForeignKey
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
