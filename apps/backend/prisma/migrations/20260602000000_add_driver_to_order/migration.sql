-- AlterTable
ALTER TABLE "client_orders" ADD COLUMN "driver_id" TEXT;

-- AddForeignKey
ALTER TABLE "client_orders" ADD CONSTRAINT "client_orders_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "client_orders_driver_id_idx" ON "client_orders"("driver_id");
