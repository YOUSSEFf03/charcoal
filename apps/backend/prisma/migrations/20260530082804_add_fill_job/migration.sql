-- CreateTable
CREATE TABLE "fill_jobs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "workerEntityId" TEXT,
    "charcoalInputs" JSONB NOT NULL DEFAULT '[]',
    "bagOutputs" JSONB NOT NULL DEFAULT '[]',
    "totalCharcoalKg" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "totalBags" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fill_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fill_jobs_clientId_idx" ON "fill_jobs"("clientId");

-- CreateIndex
CREATE INDEX "fill_jobs_date_idx" ON "fill_jobs"("date");

-- AddForeignKey
ALTER TABLE "fill_jobs" ADD CONSTRAINT "fill_jobs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fill_jobs" ADD CONSTRAINT "fill_jobs_workerEntityId_fkey" FOREIGN KEY ("workerEntityId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
