-- CreateTable: proper many-to-many junction between fill_jobs and stock_lots.
-- Replaces the charcoalInputs JSON field with a normalized relation that includes
-- a cost snapshot (costPerKg, cost) so historical fill costs are preserved.
CREATE TABLE "fill_job_lots" (
    "id" TEXT NOT NULL,
    "fillJobId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "kgUsed" DECIMAL(10,3) NOT NULL,
    "costPerKg" DECIMAL(10,4) NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "fill_job_lots_pkey" PRIMARY KEY ("id")
);

-- DataMigration: expand the charcoalInputs JSON array into individual rows.
-- The stored JSON shape is: [{ "lotId": "...", "kg": 100, "costPerKg": 1.25, "cost": 125.0, ... }]
INSERT INTO "fill_job_lots" ("id", "fillJobId", "lotId", "kgUsed", "costPerKg", "cost")
SELECT
    gen_random_uuid()::text,
    fj.id,
    elem->>'lotId',
    (elem->>'kg')::DECIMAL(10,3),
    COALESCE((elem->>'costPerKg')::DECIMAL(10,4), 0),
    COALESCE((elem->>'cost')::DECIMAL(10,2), 0)
FROM "fill_jobs" fj,
    jsonb_array_elements(fj."charcoalInputs") AS elem
WHERE jsonb_array_length(fj."charcoalInputs") > 0;

-- AddForeignKey
ALTER TABLE "fill_job_lots" ADD CONSTRAINT "fill_job_lots_fillJobId_fkey"
    FOREIGN KEY ("fillJobId") REFERENCES "fill_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fill_job_lots" ADD CONSTRAINT "fill_job_lots_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "fill_job_lots_fillJobId_idx" ON "fill_job_lots"("fillJobId");
CREATE INDEX "fill_job_lots_lotId_idx" ON "fill_job_lots"("lotId");

-- DropColumn: charcoalInputs is now fully replaced by fill_job_lots
ALTER TABLE "fill_jobs" DROP COLUMN "charcoalInputs";
