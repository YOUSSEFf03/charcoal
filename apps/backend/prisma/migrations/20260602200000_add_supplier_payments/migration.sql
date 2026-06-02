-- Step 1: extend enum (must commit before use)
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'bank_transfer';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'cheque';
