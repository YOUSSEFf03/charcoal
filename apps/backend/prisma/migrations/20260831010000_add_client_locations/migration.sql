-- Migration: 20260831010000_add_client_locations
--
-- Forensic audit (2026-08-31), "Client Multiple Locations with ONE shared
-- client balance": adds an opt-in ClientLocation entity purely for provenance
-- on normal Orders (which branch an order/delivery is for). NOT an
-- accounting entity — no balance, no ledger table, no AccountEntry ever
-- references it; the client's existing single financial account
-- (Client.balance / getClientLedger()) is completely untouched by this
-- migration. No backfill: every existing client gets
-- multiLocationEnabled=false (unchanged single-location behavior) and every
-- existing order gets locationId=NULL (never a fabricated location — see
-- ClientOrder.locationId's schema doc comment).

-- Step 1: opt-in switch on Client — defaults false, so every existing client
-- is completely unaffected (Order forms never show a location selector
-- unless this is explicitly true).
ALTER TABLE "clients" ADD COLUMN "multiLocationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Step 2: the location table itself.
CREATE TABLE "client_locations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_locations_pkey" PRIMARY KEY ("id")
);

-- Location names are unique PER CLIENT, not globally — two different clients
-- may each have their own "Main Branch".
CREATE UNIQUE INDEX "client_locations_clientId_name_key" ON "client_locations"("clientId", "name");
CREATE INDEX "client_locations_clientId_idx" ON "client_locations"("clientId");

ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 3: nullable FK on the order/delivery transaction itself — see this
-- column's schema.prisma doc comment for why ClientOrder (not Invoice) is
-- where location provenance belongs, and why it can never affect the
-- client's shared balance.
ALTER TABLE "client_orders" ADD COLUMN "locationId" TEXT;

CREATE INDEX "client_orders_locationId_idx" ON "client_orders"("locationId");

-- SET NULL (not the default RESTRICT): a location is only ever deactivated,
-- never hard-deleted through the app, but this keeps a direct DB-level
-- delete from being blocked by/corrupting historical orders regardless.
ALTER TABLE "client_orders" ADD CONSTRAINT "client_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "client_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
