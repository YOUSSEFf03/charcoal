-- CreateTable
CREATE TABLE "cash_handover_expenses" (
    "id" TEXT NOT NULL,
    "cashHandoverId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_handover_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_handover_expenses_cashHandoverId_idx" ON "cash_handover_expenses"("cashHandoverId");

-- AddForeignKey
ALTER TABLE "cash_handover_expenses" ADD CONSTRAINT "cash_handover_expenses_cashHandoverId_fkey" FOREIGN KEY ("cashHandoverId") REFERENCES "cash_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
