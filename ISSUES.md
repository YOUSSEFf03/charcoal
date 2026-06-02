# Known Issues

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
