-- BUG-2 (P2): shipments must RESERVE packed stock at creation so concurrent shipments
-- cannot jointly over-allocate the same bag type. Add a reservation counter; existing
-- rows default to 0 reserved.

-- AlterTable
ALTER TABLE "packed_stocks" ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0;
