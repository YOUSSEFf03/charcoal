-- Anonymous-walk-in idempotency gap fix (forensic audit, 2026-08-28): the
-- Invoice.idempotencyKey/requestFingerprint protection added for
-- registered-client walk-in sales (POST /walk-in-sales) never covered
-- anonymous walk-in sales, which go through a completely different endpoint
-- (POST /stock-exits) with zero dedup — a duplicate request there double-
-- deducts stock AND double-credits the collector's ledger account.
--
-- Client-generated idempotency key for one logical anonymous-sale-creation
-- attempt. Nullable + a plain unique index: Postgres allows unlimited NULLs
-- in a unique index, so every existing stock exit (and every non-sale exit
-- type: sample/internal/gift/fill-job pickup) is unaffected. Mirrors
-- invoices_idempotencyKey_key (20260827144629_add_invoice_idempotency_key)
-- exactly — a PLAIN (not partial) unique index is correct here since
-- StockExit, unlike Invoice, has no cancel/void state that would need a key
-- to become reusable after cancellation.
ALTER TABLE "stock_exits" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "stock_exits_idempotencyKey_key" ON "stock_exits"("idempotencyKey");
