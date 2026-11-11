-- Fill Clients bag specs/pricing, previously stored only in browser localStorage.
ALTER TABLE "clients" ADD COLUMN "fillBags" JSONB;
