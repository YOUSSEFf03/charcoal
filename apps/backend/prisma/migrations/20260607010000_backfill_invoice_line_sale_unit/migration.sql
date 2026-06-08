-- Phase 1 continuation: tag all existing invoice line items with saleUnit = "BAG".
--
-- Context:
--   invoice.lines is a JSONB array. Each element currently has the shape:
--     { bagTypeId, bagTypeName, qty, pricePerBag, lineTotal }
--
--   Phase 3 (invoice line extension) will introduce a discriminated union:
--     BAG lines: { saleUnit:"BAG", bagTypeId, bagTypeName, qty, pricePerBag, lineTotal }
--     KG  lines: { saleUnit:"KG",  kgQuantity, description, pricePerKg, lineTotal }
--
--   This migration adds saleUnit:"BAG" to every existing line element so that
--   Phase 3 renderers can rely on the discriminator without guessing. Without
--   this backfill, the Phase 3 InvoicePrint.tsx change would need to null-coalesce
--   every line read as `line.saleUnit ?? "BAG"`, which is error-prone. With this
--   backfill, the discriminator is always present and the Phase 3 code can use
--   a clean equality check.
--
-- Safety properties:
--   * IDEMPOTENT: line elements that already carry saleUnit are left unchanged
--     (the CASE expression only adds the key when it is absent). Safe to re-run.
--   * ADDITIVE: no existing key is removed or overwritten. invoice.total,
--     invoice.subtotal, and all pricing fields are untouched.
--   * BOUNDED: only rows with at least one line element are updated.
--     Invoices with lines = '[]' are skipped.
--   * NO SCHEMA CHANGE: the `lines` column type (JSONB) is unchanged.
--   * BACKWARD COMPATIBLE: code that reads lines before Phase 3 still finds
--     bagTypeId, bagTypeName, qty, pricePerBag, lineTotal — all unchanged.
--     The new saleUnit key is simply ignored by existing readers.
--
-- This migration does NOT touch any other table, column, service, or frontend file.

UPDATE "invoices"
SET "lines" = (
    SELECT jsonb_agg(
        CASE
            -- If this line element already has a saleUnit key, leave it as-is.
            WHEN (elem -> 'saleUnit') IS NOT NULL THEN elem
            -- Otherwise inject saleUnit:"BAG" as the first key in the object.
            ELSE '{"saleUnit":"BAG"}'::jsonb || elem
        END
    )
    FROM jsonb_array_elements("lines") AS elem
)
WHERE jsonb_array_length("lines") > 0;
