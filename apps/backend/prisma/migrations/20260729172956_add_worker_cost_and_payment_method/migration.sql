-- Migration: 20260729172956_add_worker_cost_and_payment_method
-- Adds the WorkerCost earnings ledger (replaces WorkerAttendance as the
-- second earnings source, alongside PackingSession.sessionEarnings which is
-- untouched) plus method/referenceNumber on WorkerPayment.
--
-- Additive only: WorkerAttendance and Worker.dailyRate are NOT touched here.
-- They are dropped in a later migration once WorkerCost data has been
-- backfilled from WorkerAttendance and verified to match (see Phase 6 of the
-- employee module redesign).

-- CreateEnum
CREATE TYPE "WorkerCostCategory" AS ENUM ('daily_wage', 'weekly_wage', 'monthly_salary', 'bonus', 'deduction', 'fuel', 'food', 'transport', 'advance', 'correction', 'other');

-- AlterTable
ALTER TABLE "worker_payments" ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'cash',
ADD COLUMN     "reference_number" TEXT;

-- CreateTable
CREATE TABLE "worker_costs" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "category" "WorkerCostCategory" NOT NULL,
    "notes" TEXT,
    "fileId" TEXT,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worker_costs_workerId_idx" ON "worker_costs"("workerId");

-- CreateIndex
CREATE INDEX "worker_costs_date_idx" ON "worker_costs"("date");

-- AddForeignKey
ALTER TABLE "worker_costs" ADD CONSTRAINT "worker_costs_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_costs" ADD CONSTRAINT "worker_costs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
