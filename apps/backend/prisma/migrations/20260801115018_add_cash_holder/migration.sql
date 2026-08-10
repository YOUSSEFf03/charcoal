-- CreateEnum
CREATE TYPE "CashHolderType" AS ENUM ('person', 'drawer', 'safe', 'vehicle', 'bank_account', 'branch');

-- CreateTable
CREATE TABLE "cash_holders" (
    "id" TEXT NOT NULL,
    "type" "CashHolderType" NOT NULL,
    "userId" TEXT,
    "label" TEXT NOT NULL,
    "branchId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_holders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_holders_userId_key" ON "cash_holders"("userId");

-- AddForeignKey
ALTER TABLE "cash_holders" ADD CONSTRAINT "cash_holders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
