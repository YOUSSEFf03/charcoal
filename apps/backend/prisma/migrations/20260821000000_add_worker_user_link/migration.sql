-- Migration: 20260821000000_add_worker_user_link
--
-- Links Worker (the packing-cost entity) to a real User account so a worker
-- can be selected as Payment.receiverId, which is a User FK, not a Worker FK
-- (see users.service.ts's validateCashCapable doc comment: "any user can be a
-- ledger holder ... owner/accountant/sales_rep/worker can all be picked as a
-- receiver/collector"). Before this, the frontend receiver picker had no
-- valid id to send whenever a worker (as opposed to a role='receiver' User)
-- was selected, so that receiverId was always silently dropped and the cash
-- was never credited to any ledger account for Cash Handover reconciliation.
--
-- Step 1: nullable column, no constraint yet — added only after backfill so
-- existing rows are never briefly invalid.
ALTER TABLE "workers" ADD COLUMN "userId" TEXT;

-- Step 2: backfill — one local (non-Clerk) User per existing worker with no
-- linked account yet, following the exact same synthetic-account convention
-- UsersService.createLocal() already uses for receivers (synthetic clerkId,
-- @local.internal email). clerkId/email are DETERMINISTIC from the worker id
-- (not gen_random_uuid()) specifically so this migration is idempotent: a
-- second run hits the clerkId/email unique constraint instead of silently
-- creating a duplicate User per worker.
INSERT INTO "users" ("id", "clerkId", "email", "name", "role", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'local_worker_' || w."id",
  'local_worker_' || w."id" || '@local.internal',
  w."name",
  'worker'::"Role",
  w."createdAt",
  now()
FROM "workers" w
WHERE w."userId" IS NULL;

UPDATE "workers" w
SET "userId" = u."id"
FROM "users" u
WHERE u."clerkId" = 'local_worker_' || w."id"
  AND w."userId" IS NULL;

-- Step 3: constraints, now that every existing row is populated (new workers
-- get userId set atomically at creation time going forward — see
-- WorkersService.create()).
CREATE UNIQUE INDEX "workers_userId_key" ON "workers"("userId");

ALTER TABLE "workers" ADD CONSTRAINT "workers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
