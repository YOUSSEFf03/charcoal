-- BUG-J (P5): an invoice amount stored without the rate needed to interpret it. P&L was
-- converting historical LBP invoices at TODAY's global rate, so past revenue shifted when
-- the rate changed. Capture an LBP-per-USD snapshot at issue time and convert each LBP
-- invoice in P&L by its OWN snapshot.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "exchangeRateSnapshot" DECIMAL(18,6);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill (one-time documented approximation): existing issued invoices have no
-- historical rate recorded, so we stamp them with the CURRENT global rate from the
-- settings table (same source as SettingsService.getExchangeRate, default 89550 when
-- unset). This matches the pre-fix behaviour exactly (everything was converted at the
-- current global rate), so P&L output is unchanged immediately after migration; only
-- invoices issued AFTER this point capture their true issue-time rate. USD invoices get
-- a snapshot too (harmless — P&L only divides LBP invoices by it). Only rows that have
-- actually been issued (issuedAt IS NOT NULL) are stamped; un-issued drafts stay NULL
-- and never reach P&L.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "invoices"
SET "exchangeRateSnapshot" = COALESCE(
  (SELECT NULLIF("value", '')::numeric FROM "settings" WHERE "key" = 'exchange_rate'),
  89550
)
WHERE "issuedAt" IS NOT NULL
  AND "exchangeRateSnapshot" IS NULL;
