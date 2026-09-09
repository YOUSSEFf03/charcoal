-- Client-generated idempotency key for one logical sale-creation attempt.
-- Nullable + a plain unique index: Postgres allows unlimited NULLs in a
-- unique index, so every existing invoice (and every non-walk-in creation
-- path) is unaffected. This is the DB-level backstop for the
-- application-level idempotency guard in WalkInSalesService.create() — see
-- that method's doc comment. Mirrors the existing
-- invoices_orderId_unique_active pattern (20260608000000_add_invoice_order_unique)
-- used for the same class of problem on the ORDER-invoice path.
ALTER TABLE "invoices" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "invoices_idempotencyKey_key" ON "invoices"("idempotencyKey");
