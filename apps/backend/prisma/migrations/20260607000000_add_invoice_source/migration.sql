-- Phase 1 of the invoice architecture refactor.
--
-- Adds an InvoiceSource enum and a `source` column to the invoices table so
-- that every invoice carries an explicit record of which business flow created
-- it (ORDER vs WAREHOUSE_SALE).
--
-- Why ORDER is the safe default for historical rows:
--   The walk-in invoice path (POST /walk-in-sales) was introduced as a bug-fix
--   (BUG-A) after the initial schema. Any invoice created before that fix was
--   always linked to an order flow. Classifying orderId-linked rows as ORDER
--   and orderId-NULL rows as WAREHOUSE_SALE is therefore accurate for all
--   data created after BUG-A, and safe for all data created before it.
--
-- Execution strategy (no-downtime, fully reversible):
--   1. Create the PostgreSQL enum type.
--   2. Add the column as nullable (no constraint yet).
--   3. Backfill every row: orderId IS NOT NULL → ORDER, else WAREHOUSE_SALE.
--   4. Verify zero NULL rows remain, then add NOT NULL + DEFAULT constraints.
--
-- This migration does NOT touch any other table, service, DTO, or frontend file.
-- It is fully backward compatible: the Prisma @default(ORDER) means all existing
-- prisma.invoice.create() calls that omit `source` will automatically receive
-- the correct default without any service-layer changes.

-- ── Step 1: Create the enum type ──────────────────────────────────────────────
CREATE TYPE "InvoiceSource" AS ENUM ('ORDER', 'WAREHOUSE_SALE');

-- ── Step 2: Add nullable column (allows row-by-row backfill below) ────────────
ALTER TABLE "invoices" ADD COLUMN "source" "InvoiceSource";

-- ── Step 3: Backfill ──────────────────────────────────────────────────────────
-- Invoices linked to an order are ORDER.
UPDATE "invoices"
SET "source" = 'ORDER'
WHERE "orderId" IS NOT NULL;

-- Invoices with no order link are direct warehouse/walk-in sales.
UPDATE "invoices"
SET "source" = 'WAREHOUSE_SALE'
WHERE "orderId" IS NULL;

-- ── Step 4: Safety check — abort if any row is still NULL ─────────────────────
-- This DO block raises an exception (rolling back the migration) if the backfill
-- left any invoices without a source. Should never happen given the two UPDATE
-- statements above cover all rows, but this is a hard guard.
DO $$
DECLARE null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "invoices" WHERE "source" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % invoice row(s) still have source = NULL', null_count;
  END IF;
END $$;

-- ── Step 5: Enforce NOT NULL and set database-level default ───────────────────
ALTER TABLE "invoices" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "invoices" ALTER COLUMN "source" SET DEFAULT 'ORDER';
