-- BUG-H (workflow): introduce a real two-step physical-count approval flow.
-- A counter submits a PENDING adjustment (no stock change); an owner APPROVES it
-- (applies the atomic delta, records a distinct approvedById) or REJECTS it.
--
-- Migration strategy:
--   1) New enum AdjustmentStatus.
--   2) status column DEFAULT 'approved' so every pre-existing row (which was applied
--      immediately under the old owner-self-approve model) remains semantically valid.
--   3) approvedById becomes NULLABLE — a pending row has no approver yet.

-- 1) Enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdjustmentStatus') THEN
    CREATE TYPE "AdjustmentStatus" AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END$$;

-- 2) status column (existing rows backfilled to 'approved' via DEFAULT)
ALTER TABLE "stock_adjustments"
  ADD COLUMN IF NOT EXISTS "status" "AdjustmentStatus" NOT NULL DEFAULT 'approved';

-- 3) approvedById nullable
ALTER TABLE "stock_adjustments"
  ALTER COLUMN "approvedById" DROP NOT NULL;

-- 4) index on status for the pending-approvals report
CREATE INDEX IF NOT EXISTS "stock_adjustments_status_idx" ON "stock_adjustments"("status");
