-- CreateEnum
CREATE TYPE "TraqoAccountStatus" AS ENUM ('healthy', 'rate_limited', 'auth_failed');

-- AlterTable
ALTER TABLE "container_trackings" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN,
ADD COLUMN     "traqoShipmentName" TEXT;

-- CreateTable
CREATE TABLE "traqo_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "envKeyName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxContainers" INTEGER NOT NULL DEFAULT 4,
    "priority" INTEGER NOT NULL,
    "status" "TraqoAccountStatus" NOT NULL DEFAULT 'healthy',
    "unavailableUntil" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traqo_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_tracking_assignments" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "traqoAccountId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "container_tracking_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "traqo_accounts_envKeyName_key" ON "traqo_accounts"("envKeyName");

-- CreateIndex
CREATE INDEX "container_tracking_assignments_traqoAccountId_releasedAt_idx" ON "container_tracking_assignments"("traqoAccountId", "releasedAt");

-- CreateIndex
CREATE INDEX "container_tracking_assignments_containerId_idx" ON "container_tracking_assignments"("containerId");

-- AddForeignKey
ALTER TABLE "container_tracking_assignments" ADD CONSTRAINT "container_tracking_assignments_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_tracking_assignments" ADD CONSTRAINT "container_tracking_assignments_traqoAccountId_fkey" FOREIGN KEY ("traqoAccountId") REFERENCES "traqo_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one ACTIVE (releasedAt IS NULL) assignment
-- per container. This is the DB-level concurrency backstop for allocation —
-- even a future application bug bypassing TraqoAccountAllocationService
-- cannot create two simultaneous active assignments for one container.
-- Prisma's schema DSL cannot express a partial index, so this is hand-added.
CREATE UNIQUE INDEX "container_tracking_assignments_one_active_per_container"
  ON "container_tracking_assignments"("containerId")
  WHERE "releasedAt" IS NULL;
