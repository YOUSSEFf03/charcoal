-- Add human-readable display IDs to key document tables
-- SO = Sales Order (client_orders)
-- SI = Sale Invoice (invoices)
-- RV = Receipt Voucher (payments)
-- PI = Purchase Invoice (supplier_payments)
--
-- Strategy:
--   1. Create one sequence per document type
--   2. Add nullable display_id column
--   3. Backfill existing rows in creation order
--   4. Advance each sequence past the backfilled count
--   5. Add UNIQUE index
--   6. Install a BEFORE INSERT trigger that assigns the next formatted ID

-- ── Sequences ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS client_orders_display_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoices_display_seq START 1;
CREATE SEQUENCE IF NOT EXISTS payments_display_seq START 1;
CREATE SEQUENCE IF NOT EXISTS supplier_payments_display_seq START 1;

-- ── Columns ───────────────────────────────────────────────────────────────────
ALTER TABLE "client_orders"     ADD COLUMN "display_id" VARCHAR(20);
ALTER TABLE "invoices"          ADD COLUMN "display_id" VARCHAR(20);
ALTER TABLE "payments"          ADD COLUMN "display_id" VARCHAR(20);
ALTER TABLE "supplier_payments" ADD COLUMN "display_id" VARCHAR(20);

-- ── Backfill existing rows (chronological order) ──────────────────────────────
UPDATE "client_orders" t
SET "display_id" = sub.new_id
FROM (
  SELECT id,
         'SO-' || LPAD(ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC)::TEXT, 4, '0') AS new_id
  FROM "client_orders"
) sub
WHERE t.id = sub.id;

UPDATE "invoices" t
SET "display_id" = sub.new_id
FROM (
  SELECT id,
         'SI-' || LPAD(ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC)::TEXT, 4, '0') AS new_id
  FROM "invoices"
) sub
WHERE t.id = sub.id;

UPDATE "payments" t
SET "display_id" = sub.new_id
FROM (
  SELECT id,
         'RV-' || LPAD(ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC)::TEXT, 4, '0') AS new_id
  FROM "payments"
) sub
WHERE t.id = sub.id;

UPDATE "supplier_payments" t
SET "display_id" = sub.new_id
FROM (
  SELECT id,
         'PI-' || LPAD(ROW_NUMBER() OVER (ORDER BY "created_at" ASC, id ASC)::TEXT, 4, '0') AS new_id
  FROM "supplier_payments"
) sub
WHERE t.id = sub.id;

-- ── Advance sequences past backfilled count ────────────────────────────────────
DO $$
DECLARE v BIGINT;
BEGIN
  SELECT COUNT(*) INTO v FROM "client_orders";
  IF v > 0 THEN PERFORM setval('client_orders_display_seq', v); END IF;

  SELECT COUNT(*) INTO v FROM "invoices";
  IF v > 0 THEN PERFORM setval('invoices_display_seq', v); END IF;

  SELECT COUNT(*) INTO v FROM "payments";
  IF v > 0 THEN PERFORM setval('payments_display_seq', v); END IF;

  SELECT COUNT(*) INTO v FROM "supplier_payments";
  IF v > 0 THEN PERFORM setval('supplier_payments_display_seq', v); END IF;
END $$;

-- ── Unique indexes ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "client_orders_display_id_key"     ON "client_orders"("display_id");
CREATE UNIQUE INDEX "invoices_display_id_key"           ON "invoices"("display_id");
CREATE UNIQUE INDEX "payments_display_id_key"           ON "payments"("display_id");
CREATE UNIQUE INDEX "supplier_payments_display_id_key" ON "supplier_payments"("display_id");

-- ── Trigger function ──────────────────────────────────────────────────────────
-- TG_ARGV[0] = prefix (e.g. 'SO'), TG_ARGV[1] = sequence name
CREATE OR REPLACE FUNCTION assign_display_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := TG_ARGV[0] || '-' || LPAD(nextval(TG_ARGV[1])::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Per-table triggers ────────────────────────────────────────────────────────
CREATE TRIGGER trg_client_orders_display_id
  BEFORE INSERT ON "client_orders"
  FOR EACH ROW EXECUTE FUNCTION assign_display_id('SO', 'client_orders_display_seq');

CREATE TRIGGER trg_invoices_display_id
  BEFORE INSERT ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION assign_display_id('SI', 'invoices_display_seq');

CREATE TRIGGER trg_payments_display_id
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION assign_display_id('RV', 'payments_display_seq');

CREATE TRIGGER trg_supplier_payments_display_id
  BEFORE INSERT ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION assign_display_id('PI', 'supplier_payments_display_seq');
