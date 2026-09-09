-- Migration: 20260831000000_add_expense_category
--
-- Forensic audit (2026-08-31), "Expenses + Cash Handover expense selection
-- redesign": CashHandoverExpense.description has always been free text
-- ("fuel", "Fuel", "gas for delivery"…) with no reusable category concept —
-- confirmed by inspecting real dev data, which had THREE distinct spellings
-- for what is likely the same real-world category ("fuel", "benzin", "gaz").
-- ExpenseCategory is the smallest clean addition that makes categories
-- genuinely reusable (a dropdown, "+ Add new expense") without inventing a
-- new accounting concept — CashHandoverExpense itself remains the one
-- authoritative expense-occurrence record; this only adds a lookup FK.
--
-- Step 1: create the category table + nullable FK column on the existing
-- expense table — nullable so no existing row is ever briefly invalid before
-- the backfill below runs.
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

ALTER TABLE "cash_handover_expenses" ADD COLUMN "categoryId" TEXT;

-- Step 2: backfill — one ExpenseCategory per DISTINCT existing description,
-- deduplicated ONLY case/whitespace-insensitively (lower(trim(x))). This is a
-- purely MECHANICAL, lossless dedup — "Fuel" and "fuel" collapse into one
-- category (exactly the "do not create Fuel/fuel/FUEL duplicates" rule), but
-- genuinely different words ("fuel" vs "benzin" vs "gaz" — real values found
-- in the existing dev data, plausibly the same real-world category in
-- Arabic/French/English) are deliberately NOT merged: recognizing them as
-- synonyms is a business/language judgment this migration cannot make on its
-- own, so each is preserved as its own category using its original existing
-- text — zero data loss, zero incorrect merging, every historical row stays
-- exactly as correctly categorized/visible as its own description already
-- made it. The business owner can rename/consolidate these later via
-- ordinary category selection if "benzin"/"gaz" turn out to mean "Fuel".
--
-- DISTINCT ON + ORDER BY createdAt picks the EARLIEST original casing as the
-- new category's display name, deterministically (never gen_random_uuid()-
-- ordered), so a second run of this migration is idempotent by construction
-- (ON CONFLICT DO NOTHING backstops the same guarantee at the SQL level).
INSERT INTO "expense_categories" ("id", "name", "createdAt")
SELECT gen_random_uuid(), rep.description, now()
FROM (
  SELECT DISTINCT ON (lower(trim(description))) description
  FROM "cash_handover_expenses"
  ORDER BY lower(trim(description)), "createdAt" ASC
) rep
ON CONFLICT ("name") DO NOTHING;

UPDATE "cash_handover_expenses" che
SET "categoryId" = ec."id"
FROM "expense_categories" ec
WHERE lower(trim(che."description")) = lower(trim(ec."name"))
  AND che."categoryId" IS NULL;

-- Step 3: index + FK, now that the backfill above has run. SET NULL (not the
-- default RESTRICT) — no category-deletion feature exists today, but a
-- historical expense occurrence must never be blocked or destroyed by a
-- future category-management change.
CREATE INDEX "cash_handover_expenses_categoryId_idx" ON "cash_handover_expenses"("categoryId");

ALTER TABLE "cash_handover_expenses" ADD CONSTRAINT "cash_handover_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
