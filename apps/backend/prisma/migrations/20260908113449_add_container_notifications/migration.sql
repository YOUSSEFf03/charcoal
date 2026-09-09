-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android');

-- NOTE: Prisma's auto-generated diff also proposed `DROP INDEX
-- "stock_exits_idempotencyKey_key"` here. That is NOT a Phase C change —
-- it's the same pre-existing, unrelated schema.prisma drift already
-- identified and deliberately left untouched during Phase B (see that
-- phase's report and migration 20260908110500_restore_stock_exits_idempotency_key_index).
-- schema.prisma's StockExit.idempotencyKey field still lacks the @unique
-- its own doc comment says it should have; until whoever owns that
-- in-progress work resolves it, every future `prisma migrate dev` run will
-- keep proposing this same drop. Removed here deliberately — do not
-- reintroduce it as part of an unrelated migration again.

-- AlterTable
ALTER TABLE "containers" ADD COLUMN     "arrivalNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "appVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");
