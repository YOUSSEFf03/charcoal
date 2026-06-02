-- BUG-2 (P2): the new POST /shipments/:id/cancel endpoint needs a terminal "cancelled"
-- state so a released shipment is no longer treated as active. Add the enum value.

ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'cancelled';
