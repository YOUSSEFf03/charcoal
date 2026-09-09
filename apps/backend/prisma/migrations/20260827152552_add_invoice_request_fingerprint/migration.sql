-- Companion to idempotencyKey (20260827144629_add_invoice_idempotency_key):
-- stores a SHA-256 fingerprint of the request that created this invoice, so a
-- second request reusing the same idempotencyKey with genuinely different
-- sale data can be detected and rejected (IDEMPOTENCY_KEY_REUSED) rather than
-- silently returning the wrong caller's sale. No uniqueness constraint —
-- purely compared in application code (WalkInSalesService.create()).
ALTER TABLE "invoices" ADD COLUMN "requestFingerprint" TEXT;
