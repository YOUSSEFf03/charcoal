-- BUG-1 (P1): StockLot must reference its originating ContainerProductLine by a real FK,
-- never by createdAt array index. Add the FK column, backfill existing lots, index it.

-- AlterTable
ALTER TABLE "stock_lots" ADD COLUMN "productLineId" TEXT;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_productLineId_fkey"
  FOREIGN KEY ("productLineId") REFERENCES "container_product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "stock_lots_productLineId_idx" ON "stock_lots"("productLineId");

-- Backfill: map each existing container lot to its product line.
-- Match on (containerId, charcoalType, grade, supplierId). When a container has multiple
-- lines sharing the same triple, disambiguate by createdAt order (row_number) on both
-- sides so the nth matching lot binds to the nth matching line — preserving the legacy
-- positional mapping for already-arrived containers, but as a persisted FK going forward.
WITH ranked_lots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "containerId", "charcoalType", "grade", "supplierId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "stock_lots"
  WHERE "source" = 'container' AND "containerId" IS NOT NULL
),
ranked_lines AS (
  SELECT
    id,
    "containerId",
    "charcoalType",
    "grade",
    "supplierId",
    ROW_NUMBER() OVER (
      PARTITION BY "containerId", "charcoalType", "grade", "supplierId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "container_product_lines"
)
UPDATE "stock_lots" sl
SET "productLineId" = rl.line_id
FROM (
  SELECT
    rlot.id AS lot_id,
    rline.id AS line_id
  FROM ranked_lots rlot
  JOIN "stock_lots" s ON s.id = rlot.id
  JOIN ranked_lines rline
    ON rline."containerId" = s."containerId"
   AND rline."charcoalType" = s."charcoalType"
   AND rline."grade" = s."grade"
   AND rline."supplierId" = s."supplierId"
   AND rline.rn = rlot.rn
) rl
WHERE sl.id = rl.lot_id;
