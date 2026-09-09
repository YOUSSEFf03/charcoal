-- Fixes the confirmed forensic-audit bug (2026-08-27): a walk-in sale's
-- idempotencyKey could not safely be reused after its invoice was cancelled
-- — the plain unique index permanently bound that key to the (now dead)
-- cancelled row, so a legitimate retry silently got the cancelled invoice
-- back instead of a fresh live sale.
--
-- Replaces the plain unique index with a PARTIAL one, WHERE status <>
-- 'cancelled' — exactly mirroring invoices_orderId_unique_active
-- (20260608000000_add_invoice_order_unique), which solves the identical
-- problem for order-generated invoices. A cancelled invoice keeps its
-- idempotencyKey permanently (for audit/history), but no longer blocks a new
-- non-cancelled invoice from reusing that same key. Two LIVE (non-cancelled)
-- invoices can still never share a key — the partial index still enforces
-- that.
--
-- Pre-migration verification (2026-08-27, read-only, see forensic audit
-- report): zero rows currently have a non-null idempotencyKey in the dev DB,
-- so this migration is a pure constraint change — no data was modified, and
-- there is nothing to conflict with the new partial index.
DROP INDEX "invoices_idempotencyKey_key";

CREATE UNIQUE INDEX "invoices_idempotencyKey_unique_active"
ON "invoices" ("idempotencyKey")
WHERE status <> 'cancelled';
