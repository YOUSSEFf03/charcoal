# Known Issues

## Shipments Module

### Issue — logReturn missing status guard ✓ Fixed (BUG-D)

**Page:** Shipments → Log return

**Problem:** `logReturn` did not validate that a shipment had `status = 'delivered'` before
accepting a return. Pre-delivery shipments (status `pending`, `loaded`) could be marked as
`returned`, violating the business rule that only delivered goods can be returned.

**Root cause:** The guard was missing.

**Fix:** Added an atomic status check inside the transaction at the start of `logReturn`
(shipments.service.ts line 334–340). Any non-delivered shipment throws `BadRequestException`
with code `INVALID_TRANSITION`. The error message directs the caller to use `cancelShipment`
for pre-delivery cancellations.

**Invariant now enforced:** Only shipments with `status = 'delivered'` may transition to
`returned`; all other statuses are rejected.

## Warehouse Sales Module

### Issue — Walk-in sale to registered client creates no invoice ✓ Fixed (BUG-A)

**Page:** Warehouse sales → Enter sale (registered client, packed bags)

**Problem:** When a walk-in customer (any client, registered or not) purchased packed bags at the
warehouse, a `StockExit` with `amount` was created for revenue tracking. However, **invoiced walk-in
exits were never given a null amount**, so they mixed with true walk-in cash sales in P&L reporting.
Later, when the P&L aggregated walk-in revenue, it double-counted: exits linked to invoices contributed
their `amount` field, and the same revenue was counted again in the invoice-revenue sum.

**Root cause:** Pattern P4 — walk-in exits lacked an explicit convention to distinguish invoiced from
cash sales. The P&L report did not filter them.

**Fix:** Added a **structural invariant**: walk-in exits linked to invoices (via `WalkInSalesService`)
**always set `amount = null`**. This makes them invisible to the walk-in aggregate in `getProfitLoss`
(which filters `amount: { not: null }`, line 116). Revenue is counted once — in the invoice aggregate
using `paidAmount`. The `WalkInSalesService.create` now atomically creates the invoice, payment,
stock exit, and explicitly passes `amount: null` to the exit. Documented in reports.service.ts
lines 108–112.

**Invariant now enforced:** `exitType = 'walk_in'` AND linked to an invoice → `amount = null`.
P&L walk-in aggregate sums only non-null amounts, eliminating the double-count.

## Reports Module — P&L Currency Handling

### Issue — P&L components lack per-record currency metadata (invoices, stock_exits, bag_purchases, driver_trips ✓ Fixed; stock_lots/containers deferred)

**Affected method:** `ReportsService.getProfitLoss`

#### Invoice revenue ✓ Fixed (BUG-C closed)
**What changed:** Invoice revenue now sums `inv."paidAmount"` (cash basis) instead of
`jsonb_array_elements(inv."lines") → lineTotal` (accrual basis). The WHERE clause now reads
`status IN ('partially_paid', 'paid')` — `'issued'` invoices are excluded because they have
collected 0. LBP invoices are divided by the global exchange rate via
`CASE WHEN inv."currency" = 'LBP' THEN inv."paidAmount"::numeric / rate ELSE inv."paidAmount"::numeric END`.
The rate is resolved once per call from `SettingsService.getExchangeRate()`.

**Why:** Spec requires cash-basis revenue; the prior accrual approach inflated revenue with
unpaid (`issued`) invoices and counted full billed amounts even for partially-collected debts.

**Known residual:** Revenue (cash basis) and COGS (exit-accrual basis) use different timing.
Gross profit skews when payment lags stock exit — this asymmetry is accepted per spec.

#### Per-invoice exchange-rate snapshot ✓ Fixed (BUG-J, P5)
**Problem:** `getProfitLoss` converted historical LBP invoices at *today's* global rate, so
past revenue shifted whenever the rate changed.
**Fix:** Added `invoices.exchangeRateSnapshot` (Decimal; migration
`20260603050000_add_invoice_exchange_rate_snapshot`), populated at issue time from
`SettingsService.getExchangeRate` in **every** issue path — `InvoicesService.issue` and
`WalkInSalesService.create`. `getProfitLoss` now divides each LBP invoice by its OWN snapshot
(`COALESCE(inv."exchangeRateSnapshot", <global>)`), so past revenue is stable. USD invoices
unchanged.
**Backfill (one-time approximation):** all already-issued rows were stamped with the current
global rate — identical to the pre-fix behaviour, so P&L output is unchanged immediately after
migration; only invoices issued afterwards capture their true issue-time rate. Un-issued drafts
stay NULL and never reach P&L.

#### Walk-in / anonymous exit amounts ✓ Fixed (BUG-K, P5)
**Problem:** `StockExit.amount` had no currency, so P&L valued legacy anonymous LBP cash sales
as USD.
**Fix:** Added `stock_exits.currency` (Currency, default USD; migration
`20260603060000_add_stock_exit_currency`), captured on every amount-bearing exit
(`StockExitsService.create`). `getProfitLoss` converts LBP exits by the global rate. Invoice-
linked walk-in exits keep `amount = null` (BUG-A invariant) and contribute 0 regardless.
**Backfill:** column default stamps every existing row USD (prior P&L treated them as USD).

#### BagPurchase.totalCost ✓ Fixed (BUG-L, P5)
**Problem:** `BagPurchase.totalCost` had no currency; LBP packaging purchases were understated
when treated as USD.
**Fix:** Added `bag_purchases.currency` (Currency, default USD; migration
`20260603070000_add_bag_purchase_currency`), captured in `BagPurchasesService.create`. P&L
converts LBP bag cost by the global rate.
**Backfill:** column default stamps every existing row USD; reclassify genuinely-LBP historical
rows manually if records show otherwise.

#### DriverTrip fuelCost and otherExpenses ✓ Fixed (BUG-M, P5)
**Problem:** `DriverTrip.fuelCost` and each `otherExpenses[].amount` had no currency; LBP fuel
and incidentals were misvalued as USD.
**Fix:** Added `driver_trips.fuelCurrency` (Currency, default USD) and a per-item `currency` key
inside the `otherExpenses` JSONB (migration `20260603080000_add_driver_trip_fuel_currency`),
captured in `DriverTripsService.completeTrip`. `getProfitLoss` converts both `fuelCost` and each
`otherExpenses[].amount` to USD by the stored/embedded currency.
**Backfill:** `fuelCurrency` defaults USD; existing `otherExpenses` elements lacking a currency
key are stamped USD by the migration.

#### StockLot.costPerKg (COGS and variance_cost) — deferred (no currency column on stock_lots/containers)
`costPerKg` is derived from `ContainerProductLine.pricePerTon`. Neither `stock_lots` nor
`containers` nor `container_product_lines` has a `currency` column. Assumed USD because import
charcoal is priced in USD internationally.

**Migration needed:** Add `currency Currency @default(USD)` to `container_product_lines` (and
propagate to `stock_lots.costPerKg`) to make the assumption explicit and to support non-USD
import contracts.

#### Single global exchange rate — known limitation
All currency conversions use the single value returned by `SettingsService.getExchangeRate()`.
This is the current rate, applied retroactively to all historical records. A rate history table
with effective dates would allow accurate conversion of any past period.

## Packing Module

### Issue #8 — Incorrect stock deduction and waste handling with multiple charcoal types ✓ Fixed

**Page:** Packing → Add Packing Entry

**Problem:** Incorrect stock deduction and waste handling when packing uses multiple charcoal types.

**Example:**

| Input | Value |
|-------|-------|
| Type A used | 600 kg |
| Type B used | 410 kg |
| Total charcoal input | 1010 kg |
| Output | 100 bags × 10 kg = 1000 kg |
| Waste | 10 kg |

**Current Result:**

- The system deducts the entire 1000 kg output from only one charcoal type instead of distributing deductions according to the actual quantities used.
- The 10 kg waste/loss is not deducted from inventory.

**Expected:**

- Stock should be deducted from each charcoal lot/type based on the actual weight entered for that lot.
  - Type A: deduct **600 kg**
  - Type B: deduct **410 kg**
- The total inventory reduction should equal the total charcoal input (1010 kg).
- Waste/loss (10 kg) must be accounted for and removed from available stock.
- Inventory calculations must satisfy:
  - **Input Stock Consumed = Output Produced + Waste/Loss**
  - **1010 kg = 1000 kg + 10 kg**

## Containers Module

### Issue — Container cost assigned to the wrong lot ✓ Fixed

**Page:** Containers → Arrival / Costs

**Problem:** `recalculateContainerCosts` matched each product line to a stock lot by
`createdAt` array index (`productLines[i] → lots[i]`). When lots or lines were created
out of order — or two lines shared the same charcoal type, grade, and supplier — a lot
could be assigned the cost of a *different* line.

**Root cause (pattern P1 — positional identity):** join was by sort order, not a real key.

**Fix:** Added a real FK `StockLot.productLineId`. Lots are now created one-per-line with
their `productLineId` set, and cost recalculation joins lot → line on that key. Existing
lots were backfilled by `(containerId, charcoalType, grade, supplierId)` with row-number
disambiguation (migration `20260603000000_add_product_line_fk_to_stock_lot`).

**Invariant now enforced:** a lot's `costPerKg` always equals its own product line's
all-in cost — independent of `createdAt` ordering, line edits, or duplicate type/grade/supplier.

## Shipments Module

### Issue — Shipments over-allocate packed stock ✓ Fixed

**Page:** Shipments → Create / Confirm delivery / Cancel

**Problem:** `createShipment` validated that `Σ packedStock.quantity ≥ requested` but never
reserved anything. Two shipments created close together for the same bag type could each
pass the check and jointly commit more bags than exist — an over-allocation only noticed
when the second delivery failed to drain enough stock.

**Root cause (pattern P2 — check-then-act without atomic reserve):** the availability
read and the commit were not bound; nothing held the stock between them.

**Fix:** Added `PackedStock.reservedQuantity` (migration
`20260603010000_add_reserved_quantity_to_packed_stock`). `createShipment` now reserves
FIFO inside a transaction, atomically incrementing `reservedQuantity` and validating each
row against its FREE amount (`quantity − reservedQuantity`). `confirmDelivery` decrements
both `quantity` and `reservedQuantity` on the rows it drains. A new `POST /shipments/:id/cancel`
endpoint releases the reservation (decrement `reservedQuantity` only) and marks the
shipment `cancelled` (new enum value, migration `20260603020000_add_cancelled_shipment_status`).

**Invariant now enforced:** Σ reserved bags per bag type ≤ packed stock at all times;
concurrent shipments cannot jointly over-allocate.

## Warehouse Sales Module

### Issue — Walk-in sale to a registered client creates a payment with no invoice ✓ Fixed

**Page:** Warehouse sales → Enter sale (registered client, packed bags)

**Problem:** A packed-bag sale to a registered client created a `Payment` directly with
no `Invoice`, so the client balance (Σinvoices − Σpayments) went **negative** for a sale
that was never invoiced (BUG-3). The payment currency was also hardcoded `USD`, and when
the exchange rate was missing the converted amount silently became `$0` (BUG-4).

**Root cause:** BUG-3 — pattern P3 (a money movement skipped its canonical ledger record:
the invoice). BUG-4 — currency was not read from the client, and a missing rate was not
rejected.

**Fix:** New atomic endpoint `POST /walk-in-sales` (module `walk-in-sales`). In one Prisma
transaction it: drains packed stock (atomic decrement + `walk_in` StockExit), creates an
**issued** Invoice for the goods, and creates a Payment linked to that invoice. The invoice
and payment are always stored in the **client's assigned currency**; any conversion uses the
stored rate and the whole sale is **rejected** (`RATE_UNAVAILABLE`) if that rate is ≤ 0 —
never a $0 movement. A sale with nothing received still produces the issued invoice (the
full amount is legitimately owed) but writes no payment. The frontend `WarehouseSales.tsx`
now calls this endpoint for registered-client packed sales; the old separate
exit + USD-hardcoded payment block was removed. Anonymous walk-ins are unchanged.

**Invariants now enforced:** client balance = Σinvoices − Σpayments and never negative from
an un-invoiced sale; every payment is stored in the client's currency; no movement is
recorded with a 0 amount due to a missing rate.

## Inventory — Reservations & Stock Adjustments (Batch 4)

### Issue — Packed-stock consumers ignore reservedQuantity ✓ Fixed (BUG-E)

**Pages:** Warehouse sales (stock exit + walk-in), Physical count, Stock adjustments

**Problem:** The shipment fix (BUG-2) added `PackedStock.reservedQuantity` and taught
`createShipment`/`confirmDelivery`/`cancelShipment` to respect it, but every OTHER consumer
that drains packed stock still validated and decremented **raw** `quantity`, ignoring the
reserved portion. A sale or exit could therefore consume bags already committed to a pending
shipment, driving `reservedQuantity > quantity` and leaving the shipment unfulfillable.

**Root cause (pattern P2 — a concept enforced in one path but not all):** free-quantity was
checked only where the reservation was created, not where stock is otherwise consumed.

**Audited consumers and the fix (all now draw against FREE quantity = `quantity − reservedQuantity`):**
- `stock-exits.service.ts` MODE B (packed bags) — validates/decrements against free quantity.
- `walk-in-sales.service.ts` — same.
- `reports.service.ts` `submitPhysicalCount` — rejects a count below `reservedQuantity` and
  now applies the change as an atomic delta (also a P4 fix, see BUG-G).
- `stock-adjustments.service.ts` `create` — rejects a packed `qtyAfter` below `reservedQuantity`.
- `packed-stock.service.ts` `findSummary` — now returns `reservedBags` and `availableBags`
  so clients can show only sellable stock.
- Frontend `WarehouseSales.tsx` — availability map uses `availableBags`; FIFO drain loops draw
  `quantity − reservedQuantity` per record. `PackedStock`/`PackedStockSummary` types extended.

`confirmDelivery` is intentionally unchanged: it consumes the bags it itself reserved and
drains its own reservation in lockstep.

**Invariant now enforced:** Σ reservedQuantity ≤ Σ quantity at all times; no non-shipment
consumer can draw reserved stock, enforced on the backend AND in the frontend availability check.

**Known residual (design note) ✓ Fixed (BUG-I)** — see "Reservations are an unkeyed
aggregate counter" below.

### Issue — Reservations are an unkeyed aggregate counter ✓ Fixed (BUG-I)

**Pages:** Shipments → Create / Confirm delivery / Cancel / Log return

**Problem:** `PackedStock.reservedQuantity` was a single integer per row, not tied to any
shipment. `confirmDelivery` released the reservation proportionally
(`releaseReserved = min(take, row.reservedQuantity)`), so on a bag-type row shared by two
pending shipments it could release the WRONG shipment's reservation. Failure mode: shipment B
delivers and frees bags shipment A had reserved → a walk-in sells them → A then delivers short
despite having reserved. Σ reserved stayed correct, but per-shipment protection was lost.

**Root cause (pattern P1 — positional/aggregate identity instead of a real key):** the
reservation was an unkeyed counter, so a release had no way to know whose bags it was freeing.

**Fix:** Added a keyed `ShipmentReservation` table (`shipmentId`, `packedStockId`, `quantity`,
unique on `(shipmentId, packedStockId)`; migration `20260603040000_add_shipment_reservations`).
- `createShipment` walks packed stock FIFO and upserts a reservation row per
  `(shipment, packedStock)` chunk, incrementing the denormalized `reservedQuantity` cache in
  lockstep (cache = Σ of a row's reservations).
- `confirmDelivery` drains the EXACT rows this shipment reserved (its own reservation rows),
  decrements `quantity` and `reservedQuantity` by this shipment's hold only, and deletes the
  consumed reservation rows. The proportional cross-shipment release is gone.
- `cancelShipment` deletes only this shipment's reservation rows and decrements the cache by
  exactly what this shipment held.
- `logReturn` is unchanged for reservations — a delivered shipment already had its reservation
  rows consumed at delivery; the return only restores physical `quantity`.

`PackedStock.reservedQuantity` is retained as a denormalized cache so every BUG-E free-quantity
consumer (`quantity − reservedQuantity`) keeps working unchanged.

**Backfill (documented one-time approximation):** the exact original allocation was never
recorded, so for each still-pending/loaded shipment the migration replays the same FIFO
allocation against each row's current `reservedQuantity` capacity (in shipment-creation order)
and emits one reservation row per `(shipment, packedStock)` chunk. The reconstructed Σ per row
equals the existing `reservedQuantity` exactly, so the cache stays consistent and the BUG-E
invariant is unchanged — only the per-shipment attribution is reconstructed.

**Invariant now enforced:** each shipment's reservation is released only by that same shipment;
a walk-in/exit can never consume bags another pending shipment reserved. Σ reservations per row
≤ quantity at all times.

### Issue — Stock adjustment trusts client qtyBefore ✓ Fixed (BUG-F)

**Page:** Stock adjustments → Create

**Problem:** `create()` computed `difference = qtyAfter − dto.qtyBefore` and set the stock to
`dto.qtyAfter` absolutely, trusting the client's `qtyBefore` even though the field is
documented as "resolved server-side". A forged or stale `qtyBefore` fabricated the audit
`difference` and the system-vs-counted reconciliation, and any change between count and submit
was clobbered.

**Root cause (pattern P4 — absolute set-from-snapshot):** the before-value came from the
request, not the live row.

**Fix:** `qtyBefore` is now read from the live lot/packed-stock row **inside the transaction**;
`difference` is computed from that live value; the client `qtyBefore` is ignored entirely.

**Invariant now enforced:** a stock adjustment's `qtyBefore` equals the live system value at
apply time (server-resolved).

### Issue — Adjustment edit/reverse restores a stale absolute snapshot ✓ Fixed (BUG-G)

**Page:** Stock adjustments → Edit / Delete

**Problem:** `update()` set `kgRemaining/quantity = newQtyAfter` and `remove()` restored
`= qtyBefore` — absolute writes that ignored any activity since the adjustment. Deleting an
adjustment after a later sale fabricated or destroyed stock.

**Root cause (pattern P4):** reversal/edit wrote an absolute snapshot instead of an inverse delta.

**Fix (mirrors the packing-session reversal):** `remove()` applies the **inverse of the
adjustment's own `difference`** via atomic `{ increment }`; `update()` applies the **delta
between the new and old `qtyAfter`** atomically. Stock is never set absolutely. Reversal/edit
only touch stock for an **approved** adjustment (a pending one never moved stock — see BUG-H).

**Invariant now enforced:** adjustment create/edit/reverse change stock only via atomic deltas
against the live value; deleting/editing after later activity leaves that activity intact.

### Issue — No real physical-count approval flow ✓ Fixed (BUG-H)

**Page:** Stock adjustments → Submit / Approve

**Problem:** `create()` was owner-only, applied immediately, and set
`approvedById = countedById = caller`, so the two schema fields were always identical, there
was no "pending" state, the reconciliation report's "pending approvals" could never populate,
and a non-owner counter could not submit for owner approval.

**Fix:** Added `AdjustmentStatus { pending | approved | rejected }` and a `status` column
(migration `20260603030000_add_adjustment_status`; existing rows default to `approved`,
`approvedById` made nullable). Two-step flow:
- An **owner** caller self-approves (status `approved`, delta applied immediately) — legacy
  behaviour preserved, including the owner-driven `POST /reports/physical-count`.
- A **non-owner counter** (accountant/worker) `POST /stock-adjustments` creates a **pending**
  adjustment with **no stock change** and `approvedById = null`.
- `POST /stock-adjustments/:id/approve` (owner only) re-resolves `qtyBefore` from the live
  value, applies the atomic delta, sets `status = approved` and a distinct `approvedById`
  (must differ from `countedById`).
- `POST /stock-adjustments/:id/reject` (owner only) discards a pending adjustment, no stock change.
- `GET /stock-adjustments?status=pending` serves the reconciliation "pending approvals" list.

**Invariant now enforced:** a pending adjustment makes no stock change until an owner approves;
counter and approver are distinct identities.
