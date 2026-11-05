-- Migration: 20261105000000_backfill_driver_employees
--
-- Every driver is also an employee: a User with role 'driver' gets a linked
-- Worker row (Worker.userId) so the driver appears on the Employees page and
-- can be given wages/payments. New drivers get it at creation/role-change time
-- (see src/common/utils/driver-employee.ts ensureDriverEmployee()); this
-- backfills drivers that existed before.
--
-- Data only, no schema change. Idempotent: only drivers that are not deleted
-- and have no linked Worker yet are inserted, so a re-run inserts nothing.
-- ratesPerBagType / totalBagsPacked / totalEarned / totalPaid / createdAt use
-- their column defaults.
INSERT INTO "workers" ("id", "name", "phone", "userId", "updatedAt")
SELECT gen_random_uuid(), u."name", u."phone", u."id", now()
FROM "users" u
WHERE u."role" = 'driver'
  AND u."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "workers" w WHERE w."userId" = u."id");
