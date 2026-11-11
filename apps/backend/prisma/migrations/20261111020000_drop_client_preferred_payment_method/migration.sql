-- Preferred payment was removed from the app (unused; column was empty when dropped).
ALTER TABLE "clients" DROP COLUMN IF EXISTS "preferredPaymentMethod";
