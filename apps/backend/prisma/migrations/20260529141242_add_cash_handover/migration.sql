-- CreateTable
CREATE TABLE "cash_handovers" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "receiverName" TEXT NOT NULL,
    "expectedAmt" DECIMAL(10,2) NOT NULL,
    "handedAmt" DECIMAL(10,2) NOT NULL,
    "difference" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "loggedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_handovers_date_idx" ON "cash_handovers"("date");

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
