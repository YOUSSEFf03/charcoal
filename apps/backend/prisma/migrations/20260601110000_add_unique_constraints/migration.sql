-- Migration: 20260601110000_add_unique_constraints
--
-- Adds UNIQUE constraints to:
--   containers.number  — shipping container reference numbers are globally unique
--   bag_types.name     — each bag-type name (e.g. "2kg bag") must be distinct
--
-- PRE-MIGRATION DUPLICATE DETECTION
-- Run the queries below against the target database BEFORE applying this
-- migration. If either query returns rows, resolve the duplicates first
-- (rename the duplicate, or merge the records) so the ALTER TABLE succeeds.
--
-- Duplicate container numbers:
--   SELECT number, COUNT(*) AS n
--   FROM containers
--   GROUP BY number
--   HAVING COUNT(*) > 1;
--
-- Duplicate bag-type names:
--   SELECT name, COUNT(*) AS n
--   FROM bag_types
--   GROUP BY name
--   HAVING COUNT(*) > 1;

-- Add UNIQUE constraint to containers.number
ALTER TABLE "containers" ADD CONSTRAINT "containers_number_key" UNIQUE ("number");

-- Add UNIQUE constraint to bag_types.name
ALTER TABLE "bag_types" ADD CONSTRAINT "bag_types_name_key" UNIQUE ("name");
