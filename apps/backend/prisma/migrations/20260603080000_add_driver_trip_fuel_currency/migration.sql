-- BUG-M (P5): DriverTrip.fuelCost and each otherExpenses[].amount had no currency, so P&L
-- valued LBP fuel/incidentals as USD. Add a fuelCurrency column for fuelCost and embed a
-- per-item currency key in the otherExpenses JSONB; convert both to USD in getProfitLoss.

-- AlterTable
ALTER TABLE "driver_trips" ADD COLUMN "fuelCurrency" "Currency" NOT NULL DEFAULT 'USD';

-- Backfill fuelCurrency (documented one-time approximation): existing trips assumed USD
-- (column default stamps every row USD; no UPDATE needed).

-- Backfill otherExpenses: stamp every existing element that lacks a currency key with USD,
-- so the P&L conversion can read exp->>'currency' uniformly. Elements that already carry a
-- currency are left untouched. Empty / null arrays are normalised to '[]'.
UPDATE "driver_trips" dt
SET "otherExpenses" = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN elem ? 'currency' THEN elem
      ELSE elem || '{"currency":"USD"}'::jsonb
    END
  )
  FROM jsonb_array_elements(dt."otherExpenses") AS elem
), '[]'::jsonb)
WHERE jsonb_typeof(dt."otherExpenses") = 'array'
  AND jsonb_array_length(dt."otherExpenses") > 0;
