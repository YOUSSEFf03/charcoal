-- BUG-I (P1): reservations were an unkeyed aggregate counter on packed_stocks
-- (reservedQuantity), so confirmDelivery's proportional release could free a DIFFERENT
-- shipment's reservation on a bag-type row shared by two shipments. Pin each reservation
-- to its shipment with a keyed shipment_reservations table. packed_stocks.reservedQuantity
-- is retained as a denormalized cache = Σ(shipment_reservations.quantity) for the row.

-- CreateTable
CREATE TABLE "shipment_reservations" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "packedStockId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_reservations_shipmentId_packedStockId_key"
    ON "shipment_reservations"("shipmentId", "packedStockId");

-- CreateIndex
CREATE INDEX "shipment_reservations_shipmentId_idx" ON "shipment_reservations"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_reservations_packedStockId_idx" ON "shipment_reservations"("packedStockId");

-- AddForeignKey
ALTER TABLE "shipment_reservations" ADD CONSTRAINT "shipment_reservations_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_reservations" ADD CONSTRAINT "shipment_reservations_packedStockId_fkey"
    FOREIGN KEY ("packedStockId") REFERENCES "packed_stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: reconstruct per-shipment reservation rows for shipments that still hold
-- a live reservation. Only 'pending' and 'loaded' shipments hold reservations:
-- 'delivered'/'returned' already drained physical quantity, and 'cancelled' already
-- released. We re-walk the SAME FIFO allocation createShipment used — for each such
-- shipment's bag lines (ordered by shipment.createdAt, then bagType) we consume the
-- existing reservedQuantity capacity of each packed_stock row (FIFO by packed_stock
-- createdAt) and emit a reservation row per (shipment, packedStock) chunk.
--
-- ASSUMPTION (documented one-time approximation): the exact original allocation is not
-- recorded, so we reproduce it by replaying FIFO against the current reservedQuantity
-- capacity in shipment-creation order. The resulting Σ per packed_stock row exactly
-- equals the existing reservedQuantity, so the denormalized cache stays consistent and
-- the BUG-E free-quantity invariant (quantity − reservedQuantity) is unchanged. Only the
-- per-shipment attribution is reconstructed; the aggregate is preserved bit-for-bit.
-- ─────────────────────────────────────────────────────────────────────────────
WITH RECURSIVE
-- One row per (shipment bag line) for shipments that still hold reservations, with a
-- global FIFO ordering: older shipments first, then a stable order within a shipment.
demand AS (
  SELECT
    sb."bagTypeId"                                         AS bag_type_id,
    sb."shipmentId"                                        AS shipment_id,
    sb."quantity"                                          AS need,
    ROW_NUMBER() OVER (
      PARTITION BY sb."bagTypeId"
      ORDER BY s."createdAt" ASC, s."id" ASC, sb."id" ASC
    )                                                      AS d_rn
  FROM "shipment_bags" sb
  JOIN "shipments" s ON s."id" = sb."shipmentId"
  WHERE s."status" IN ('pending', 'loaded')
),
-- Capacity rows: each packed_stock with reservedQuantity > 0, FIFO by createdAt.
capacity AS (
  SELECT
    ps."id"                                                AS packed_stock_id,
    ps."bagTypeId"                                         AS bag_type_id,
    ps."reservedQuantity"                                  AS cap,
    ROW_NUMBER() OVER (
      PARTITION BY ps."bagTypeId"
      ORDER BY ps."createdAt" ASC, ps."id" ASC
    )                                                      AS c_rn
  FROM "packed_stocks" ps
  WHERE ps."reservedQuantity" > 0
),
-- Running prefix sums let us compute, per bag type, which capacity row each unit of
-- demand falls into. We expand demand and capacity into [start,end) intervals on a
-- shared per-bag-type number line and intersect them.
demand_intervals AS (
  SELECT
    bag_type_id, shipment_id, need, d_rn,
    COALESCE(SUM(need) OVER (
      PARTITION BY bag_type_id ORDER BY d_rn
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS start_pos,
    SUM(need) OVER (
      PARTITION BY bag_type_id ORDER BY d_rn
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)     AS end_pos
  FROM demand
),
capacity_intervals AS (
  SELECT
    bag_type_id, packed_stock_id, cap, c_rn,
    COALESCE(SUM(cap) OVER (
      PARTITION BY bag_type_id ORDER BY c_rn
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS start_pos,
    SUM(cap) OVER (
      PARTITION BY bag_type_id ORDER BY c_rn
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)     AS end_pos
  FROM capacity
),
-- Intersect demand and capacity intervals on the same number line. The overlap length is
-- the quantity of THIS shipment's line that sits in THIS packed_stock row.
allocation AS (
  SELECT
    d.shipment_id,
    c.packed_stock_id,
    SUM(LEAST(d.end_pos, c.end_pos) - GREATEST(d.start_pos, c.start_pos)) AS qty
  FROM demand_intervals d
  JOIN capacity_intervals c
    ON c.bag_type_id = d.bag_type_id
   AND d.start_pos < c.end_pos
   AND c.start_pos < d.end_pos
  GROUP BY d.shipment_id, c.packed_stock_id
)
INSERT INTO "shipment_reservations" ("id", "shipmentId", "packedStockId", "quantity", "createdAt")
SELECT
  gen_random_uuid(),
  a.shipment_id,
  a.packed_stock_id,
  a.qty::int,
  CURRENT_TIMESTAMP
FROM allocation a
WHERE a.qty > 0;
