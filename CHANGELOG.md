# Changelog

## Batch 5 — Shipment-keyed reservations & currency-correct P&L (2026-06-03)

### BUG-I (P1) — Reservations pinned to the shipment
- Added a keyed `ShipmentReservation` table (`shipmentId`, `packedStockId`, `quantity`; unique
  on `(shipmentId, packedStockId)`). `PackedStock.reservedQuantity` is now a denormalized cache
  equal to the sum of a row's reservation rows.
- `createShipment` upserts per-`(shipment, packedStock)` reservation rows FIFO; `confirmDelivery`
  drains and deletes only this shipment's reservation rows; `cancelShipment` deletes only this
  shipment's rows. A delivery/cancel can no longer release another pending shipment's reserved
  bags on a shared bag-type row.
- Migration `20260603040000_add_shipment_reservations` with a FIFO backfill that reconstructs
  per-shipment reservation rows for pending/loaded shipments (Σ per row preserved exactly).

### BUG-J (P5) — Per-invoice exchange-rate snapshot
- Added `invoices.exchangeRateSnapshot`, captured at issue time in every issue path
  (`InvoicesService.issue`, `WalkInSalesService.create`). P&L values each LBP invoice by its own
  snapshot so historical revenue is stable when the global rate changes.
- Migration `20260603050000_add_invoice_exchange_rate_snapshot`; issued rows backfilled with the
  current global rate (one-time approximation, output-neutral at migration time).

### BUG-K (P5) — Currency on stock-exit amounts
- Added `stock_exits.currency` (default USD), captured on amount-bearing exits. P&L converts LBP
  exits to USD. Invoice-linked walk-in exits remain `amount = null` (unaffected).
- Migration `20260603060000_add_stock_exit_currency`; existing rows default USD.

### BUG-L (P5) — Currency on bag purchases
- Added `bag_purchases.currency` (default USD), captured at purchase time. P&L converts LBP bag
  cost to USD.
- Migration `20260603070000_add_bag_purchase_currency`; existing rows default USD.

### BUG-M (P5) — Currency on driver-trip costs
- Added `driver_trips.fuelCurrency` (default USD) and a per-item `currency` key inside the
  `otherExpenses` JSONB. P&L converts both fuel and each incidental to USD.
- Migration `20260603080000_add_driver_trip_fuel_currency`; `fuelCurrency` defaults USD and
  existing `otherExpenses` items are stamped USD.

### Notes
- Frontend `src/lib/types.ts` extended with the new currency/snapshot fields.
- Remaining deferred item: `StockLot.costPerKg` (COGS/variance) still assumes USD — no currency
  column on `stock_lots`/`containers` yet (tracked in ISSUES.md).
