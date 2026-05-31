-- Add receiverId FK to payments (links payment to a User with role=receiver)
ALTER TABLE "payments" ADD COLUMN "receiverId" TEXT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_receiverId_fkey"
  FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "payments_receiverId_idx" ON "payments"("receiverId");

-- Add collectedById FK to stock_exits
ALTER TABLE "stock_exits" ADD COLUMN "collectedById" TEXT;
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_collectedById_fkey"
  FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "stock_exits_collectedById_idx" ON "stock_exits"("collectedById");

-- Add receiverId FK to cash_handovers
ALTER TABLE "cash_handovers" ADD COLUMN "receiverId" TEXT;
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_receiverId_fkey"
  FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cash_handovers_receiverId_idx" ON "cash_handovers"("receiverId");
