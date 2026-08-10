-- Migration: 20260729182848_backfill_worker_attendance_to_cost
-- One-time backfill: convert every existing WorkerAttendance row into an
-- equivalent WorkerCost row (category = 'daily_wage', amount = the worker's
-- dailyRate AT THE TIME THIS MIGRATION RUNS — dailyRate was never snapshotted
-- per-day under the old model, so this is the best available reconstruction).
--
-- Additive only: does NOT drop worker_attendance or workers."dailyRate" — see
-- the paired 20260729183500_drop_worker_attendance migration, which must only
-- run after this backfill has been verified (compare old-formula totalEarned
-- vs new-formula totalEarned per worker — see workers.service backfill notes).
--
-- createdById is required (NOT NULL FK) but WorkerAttendance never recorded
-- who marked a day attended, so every backfilled row is attributed to the
-- earliest-created 'owner' user — the only role that could have created
-- attendance rows in the first place (WorkersController was @Roles('owner')
-- only). Guarded with WHERE NOT EXISTS so re-running this migration is safe.

INSERT INTO "worker_costs" ("id", "workerId", "date", "amount", "category", "notes", "fileId", "created_by_id", "createdAt")
SELECT
  gen_random_uuid(),
  wa."workerId",
  wa."date",
  w."dailyRate",
  'daily_wage'::"WorkerCostCategory",
  'Migrated from attendance calendar',
  NULL,
  (SELECT id FROM "users" WHERE "role" = 'owner' ORDER BY "createdAt" ASC LIMIT 1),
  wa."createdAt"
FROM "worker_attendance" wa
JOIN "workers" w ON w."id" = wa."workerId"
WHERE NOT EXISTS (
  SELECT 1 FROM "worker_costs" wc
  WHERE wc."workerId" = wa."workerId"
    AND wc."date" = wa."date"
    AND wc."notes" = 'Migrated from attendance calendar'
);
