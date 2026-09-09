-- AlterTable
ALTER TABLE "containers" ADD COLUMN     "sealine" TEXT,
ADD COLUMN     "sealineName" TEXT;

-- CreateTable
CREATE TABLE "container_trackings" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'traqo',
    "referenceNumber" TEXT NOT NULL,
    "sealine" TEXT NOT NULL,
    "sealineName" TEXT,
    "status" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "vessel" TEXT,
    "voyage" TEXT,
    "currentLocation" TEXT,
    "eta" TIMESTAMP(3),
    "isDelayed" BOOLEAN,
    "shipmentUid" TEXT,
    "shipmentPublicUrl" TEXT,
    "providerUpdatedAt" TIMESTAMP(3),
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "rawResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "container_trackings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "trackingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "container_trackings_containerId_key" ON "container_trackings"("containerId");

-- CreateIndex
CREATE INDEX "tracking_events_trackingId_idx" ON "tracking_events"("trackingId");

-- AddForeignKey
ALTER TABLE "container_trackings" ADD CONSTRAINT "container_trackings_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_trackingId_fkey" FOREIGN KEY ("trackingId") REFERENCES "container_trackings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
