-- Migration: 20260729183500_drop_worker_attendance
-- Final step of the employee module redesign: removes the calendar-based
-- attendance mechanism now that WorkerCost fully replaces it.
--
-- MUST NOT run before 20260729182848_backfill_worker_attendance_to_cost has
-- been applied AND verified (Σ old-formula totalEarned per worker == Σ
-- new-formula totalEarned per worker, for every worker). This migration is
-- irreversible — worker_attendance and workers."dailyRate" are dropped, not
-- archived. If verification ever fails, do not run this file; investigate
-- the discrepancy first (see workers.service.ts history for the old formula).

ALTER TABLE "workers" DROP COLUMN "dailyRate";

DROP TABLE "worker_attendance";
