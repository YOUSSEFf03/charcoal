-- Add 'receiver' to the Role enum.
-- PostgreSQL requires a separate ALTER TYPE statement (cannot be inside a transaction
-- that also modifies the enum column — but since no column changes here, it is safe).
ALTER TYPE "Role" ADD VALUE 'receiver';
