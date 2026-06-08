-- Guarantees at most one non-cancelled invoice per order at the DB level.
-- A partial unique index (WHERE status != 'cancelled') is used so that a
-- cancelled invoice does not block a replacement: after cancellation, a new
-- invoice for the same order is permitted.
--
-- This is the DB-level backstop for the application-level idempotency guard in
-- InvoicesService.createFromOrder(). Together they prevent duplicate invoices
-- even under concurrent delivery calls.
CREATE UNIQUE INDEX "invoices_orderId_unique_active"
ON "invoices" ("orderId")
WHERE status != 'cancelled';
