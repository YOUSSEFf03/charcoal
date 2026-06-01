-- Migration: 20260601120000_user_soft_delete
--
-- Adds a nullable deletedAt column to the users table to support soft-delete
-- for Clerk users removed via the user.deleted webhook event.
--
-- Hard-deleting a User is unsafe: the User record is referenced by 13+
-- FK columns across containers, packing_sessions, stock_exits, payments,
-- cash_handovers, stock_adjustments, and more. Setting deletedAt preserves
-- all referencing rows while making the deletion visible to application code.
--
-- Soft-deleted users are kept in the DB and continue to satisfy FK constraints.
-- The application should treat any user with deletedAt IS NOT NULL as inactive.

ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
