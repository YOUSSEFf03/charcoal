# API Reference

Base URL: `/api/v1`  
Auth: `Authorization: Bearer <clerk_jwt>` on all protected routes  
Error format: `{ "error": string, "code": string, "details"?: Record<string, string[]> }`  
Pagination: `{ "data": T[], "total": number, "page": number, "limit": number }`  
All monetary values are decimal **strings**.

---

## Health

### `GET /api/v1/health`
**Auth**: None  
**Response 200**:
```json
{ "status": "ok", "database": "connected" }
```

---

## Auth / Users

### `GET /api/v1/auth/me`
**Auth**: Bearer  
**Description**: Get the currently authenticated user's profile and role.  
**Response 200**: User object with role.

### `GET /api/v1/users`
**Auth**: Bearer | **Roles**: owner  
**Description**: List all system users.  
**Response 200**: `User[]`

### `GET /api/v1/users/:id`
**Auth**: Bearer | **Roles**: owner  
**Path**: `id` — user UUID  
**Response 200**: User object.

### `PATCH /api/v1/users/:id/role`
**Auth**: Bearer | **Roles**: owner  
**Path**: `id` — user UUID  
**Body**:
```json
{ "role": "sales_rep" }
```
**Response 200**: Updated User.  
**Response 400**: Invalid role value.  
**Side effect**: Updates Clerk `publicMetadata.role` via Clerk Management API.

---

## Suppliers

### `GET /api/v1/suppliers`
**Auth**: Bearer | **Roles**: all  
**Query**: `page`, `limit`, `search` (name)  
**Response 200**: `PaginatedResponse<Supplier>`

### `GET /api/v1/suppliers/:id`
**Auth**: Bearer | **Roles**: all  
**Response 200**: Supplier with `purchaseHistory` (linked containers).

### `POST /api/v1/suppliers`
**Auth**: Bearer | **Roles**: owner, accountant  
**Body**: `CreateSupplierRequest`  
**Response 201**: Created Supplier.

### `PATCH /api/v1/suppliers/:id`
**Auth**: Bearer | **Roles**: owner, accountant  
**Body**: Partial `Supplier` fields  
**Response 200**: Updated Supplier.

### `DELETE /api/v1/suppliers/:id`
**Auth**: Bearer | **Roles**: owner  
**Response 204**: No content.  
**Response 409**: Supplier has linked containers or lots — cannot delete.

---

## Containers

### `GET /api/v1/containers`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Query**: `page`, `limit`, `status` (port|transit|arrived), `supplierId`, `search`  
**Response 200**: `PaginatedResponse<Container>`

### `GET /api/v1/containers/:id`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Response 200**: Full Container with `productLines`, `expenses`, `discount`, `totals`.  
**Note**: `totals.averageCostPerKg` is hidden from sales_rep in response.

### `POST /api/v1/containers`
**Auth**: Bearer | **Roles**: owner  
**Body**:
```json
{ "number": "CONT-2024-003", "supplierId": "uuid", "status": "port", "notes": "optional" }
```
**Response 201**: Created Container.

### `PATCH /api/v1/containers/:id`
**Auth**: Bearer | **Roles**: owner  
**Body**: Any subset of Container fields.  
**Special**: Setting `status` to `"arrived"` auto-creates StockLots for all product lines.  
**Response 200**: Updated Container.

### `DELETE /api/v1/containers/:id`
**Auth**: Bearer | **Roles**: owner  
**Response 204**: Only allowed if status ≠ arrived.  
**Response 409**: Cannot delete arrived container.

---

## Container Product Lines

### `GET /api/v1/containers/:id/product-lines`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Response 200**: `ContainerProductLine[]` with computed cost fields.  
**Note**: `computed.allInCostPerKg` hidden from sales_rep.

### `POST /api/v1/containers/:id/product-lines`
**Auth**: Bearer | **Roles**: owner  
**Body**: `CreateProductLineRequest`  
**Response 201**: Created product line with computed fields.

### `PATCH /api/v1/containers/:id/product-lines/:lineId`
**Auth**: Bearer | **Roles**: owner  
**Response 200**: Updated product line. Triggers cost recalculation on linked lots.

### `DELETE /api/v1/containers/:id/product-lines/:lineId`
**Auth**: Bearer | **Roles**: owner  
**Response 204**: Only allowed before container arrival.

---

## Container Expenses

### `GET /api/v1/containers/:id/expenses`
**Auth**: Bearer | **Roles**: owner, accountant  
**Response 200**: `ContainerExpense[]`

### `POST /api/v1/containers/:id/expenses`
**Auth**: Bearer | **Roles**: owner, accountant  
**Body**:
```json
{ "description": "Late invoice — agent fees", "amount": "120.00" }
```
**Response 201**: Created expense.  
**Side effect**: Recalculates `costPerKg` on all linked StockLots immediately.

### `PATCH /api/v1/containers/:id/expenses/:expenseId`
**Auth**: Bearer | **Roles**: owner, accountant  
**Response 200**: Updated expense. Triggers recalculation.

### `DELETE /api/v1/containers/:id/expenses/:expenseId`
**Auth**: Bearer | **Roles**: owner  
**Response 204**: Triggers recalculation.

---

## Container Discount

### `GET /api/v1/containers/:id/discount`
**Auth**: Bearer | **Roles**: owner, accountant  
**Response 200**: `ContainerDiscount | null`

### `PUT /api/v1/containers/:id/discount`
**Auth**: Bearer | **Roles**: owner  
**Body**: `{ "amount": "100.00" }`  
**Response 200**: Created or updated discount. Triggers recalculation.

### `DELETE /api/v1/containers/:id/discount`
**Auth**: Bearer | **Roles**: owner  
**Response 204**: Removes discount. Triggers recalculation.

---

## Container → Stock Lots

### `GET /api/v1/containers/:id/stock-lots`
**Auth**: Bearer | **Roles**: owner, accountant  
**Response 200**: `StockLot[]` created from this container on arrival.

---

## Stock Lots

### `GET /api/v1/stock-lots`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep, worker  
**Query**: `page`, `limit`, `charcoalType`, `grade`, `supplierId`, `source`, `hasStock` (boolean)  
**Note**: `costPerKg` field omitted for sales_rep and worker.  
**Response 200**: `PaginatedResponse<StockLot>`

### `GET /api/v1/stock-lots/:id`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep, worker  
**Response 200**: StockLot with supplier.

### `POST /api/v1/stock-lots`
**Auth**: Bearer | **Roles**: owner  
**Description**: Direct stock addition (source = "direct", no container).  
**Body**: `CreateDirectStockLotRequest`  
**Response 201**: Created StockLot.

---

## Warehouse Summary

### `GET /api/v1/warehouse/summary`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep, worker  
**Description**: Live totals for the entire warehouse.  
**Response 200**:
```json
{
  "totalRawKg": "5000.000",
  "totalPackedNominalKg": "1230.000",
  "totalSystemKg": "6230.000",
  "lotCount": 3,
  "packedSummary": [...]
}
```

---

## Bag Types

### `GET /api/v1/bag-types`
**Auth**: Bearer | **Roles**: all  
**Response 200**: `BagType[]`

### `GET /api/v1/bag-types/:id`
**Auth**: Bearer | **Roles**: all  
**Response 200**: BagType.

### `POST /api/v1/bag-types`
**Auth**: Bearer | **Roles**: owner  
**Body**: `CreateBagTypeRequest`  
**Response 201**: Created BagType.

### `PATCH /api/v1/bag-types/:id`
**Auth**: Bearer | **Roles**: owner  
**Response 200**: Updated BagType.

### `DELETE /api/v1/bag-types/:id`
**Auth**: Bearer | **Roles**: owner  
**Response 409**: Cannot delete if packed stock or sessions reference it.

---

## Bag Purchases

### `GET /api/v1/bag-purchases`
**Auth**: Bearer | **Roles**: owner, accountant  
**Query**: `page`, `limit`, `bagTypeId`  
**Response 200**: `PaginatedResponse<BagPurchase>`

### `POST /api/v1/bag-purchases`
**Auth**: Bearer | **Roles**: owner, accountant  
**Body**: `CreateBagPurchaseRequest`  
**Response 201**: Created BagPurchase.

---

## Packed Stock

### `GET /api/v1/packed-stock`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep, worker  
**Query**: `bagTypeId`, `lotId`  
**Response 200**: `PackedStock[]` with bagType and lot.

### `GET /api/v1/packed-stock/summary`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep, worker  
**Response 200**: `PackedStockSummary[]` — totals per bag type.

---

## Packing Sessions

### `GET /api/v1/packing-sessions`
**Auth**: Bearer | **Roles**: owner, accountant, worker  
**Note**: Worker role sees only their own sessions; owner/accountant see all.  
**Query**: `page`, `limit`, `workerId`, `lotId`, `dateFrom`, `dateTo`  
**Response 200**: `PaginatedResponse<PackingSession>`

### `GET /api/v1/packing-sessions/:id`
**Auth**: Bearer | **Roles**: owner, accountant, worker (own only)  
**Response 200**: PackingSession with lot and worker.

### `POST /api/v1/packing-sessions`
**Auth**: Bearer | **Roles**: owner, worker  
**Body**: `CreatePackingSessionRequest`  
**Response 201**: Completed session with computed `kgOutputTotal`, `varianceKg`, `sessionEarnings`.  
**Enforces**:
- `kgConsumed <= lot.kgRemaining` (400 if violated)
- `varianceKg < 0` requires `varianceNote` (400 if missing)
- Immediately reduces `lot.kgRemaining`
- Creates PackedStock records
- Updates `worker.totalEarned` and `worker.totalBagsPacked`

---

## Stock Adjustments

### `GET /api/v1/stock-adjustments`
**Auth**: Bearer | **Roles**: owner  
**Query**: `page`, `limit`, `adjustmentType`, `dateFrom`, `dateTo`  
**Response 200**: `PaginatedResponse<StockAdjustment>`

### `POST /api/v1/stock-adjustments`
**Auth**: Bearer | **Roles**: owner  
**Body**: `CreateStockAdjustmentRequest`  
**Response 201**: Created adjustment.  
**Side effects**: Updates `lot.kgRemaining` or `packedStock.quantity`, sets `approvedById` = caller.  
**Note**: Only the owner can call this endpoint — approval is implicit.

---

## Clients

### `GET /api/v1/clients`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Query**: `page`, `limit`, `type`, `search`  
**Response 200**: `PaginatedResponse<Client>`

### `GET /api/v1/clients/overdue`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Description**: CRM alert list — clients past their average order interval.  
**Response 200**: `CRMOverdueClient[]` sorted by most overdue first.

### `GET /api/v1/clients/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Response 200**: Full Client profile with computed `balance`.

### `POST /api/v1/clients`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: `CreateClientRequest`  
**Response 201**: Created Client.

### `PATCH /api/v1/clients/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: Updatable Client fields  
**Response 200**: Updated Client.

### `POST /api/v1/clients/:id/phones`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: `{ "number": "+961 70 ...", "label": "mobile" }`  
**Response 200**: Updated Client with new phone added.  
**Note**: Phone numbers are **never deleted** (CONSTRAINT 14).

### `PATCH /api/v1/clients/:id/phones/deactivate`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: `{ "phoneNumber": "+961 70 ..." }`  
**Response 200**: Phone marked `isActive: false`. Phone record preserved.

### `GET /api/v1/clients/:id/balance`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Response 200**: `{ "balance": "350.00", "currency": "USD" }`  
**Note**: Always computed from invoices/payments. Never manually set (CONSTRAINT 15).

### `GET /api/v1/clients/:id/orders`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Query**: `page`, `limit`  
**Response 200**: `PaginatedResponse<ClientOrder>`

### `GET /api/v1/clients/:id/invoices`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Response 200**: `PaginatedResponse<Invoice>`

### `GET /api/v1/clients/:id/payments`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Response 200**: `PaginatedResponse<Payment>`

---

## Orders

### `GET /api/v1/orders`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Query**: `page`, `limit`, `clientId`, `status`, `dateFrom`, `dateTo`  
**Response 200**: `PaginatedResponse<ClientOrder>`

### `GET /api/v1/orders/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Response 200**: Order with `client`, `shipments`, `bagLines`.

### `POST /api/v1/orders`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: `CreateClientOrderRequest`  
**Response 201**: Created Order.  
**Note**: Price entered at time of sale — no pre-set list (CONSTRAINT 10).  
**Side effect**: Updates `client.lastOrderDate`, recalculates `client.avgOrderDays`.

### `PATCH /api/v1/orders/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Response 200**: Updated Order.

### `DELETE /api/v1/orders/:id`
**Auth**: Bearer | **Roles**: owner  
**Response 204**: Only draft orders can be deleted.

---

## Shipments

### `GET /api/v1/shipments`
**Auth**: Bearer | **Roles**: owner, sales_rep, driver (own trip shipments only)  
**Query**: `page`, `limit`, `orderId`, `tripId`, `status`, `driverId`  
**Response 200**: `PaginatedResponse<Shipment>`

### `GET /api/v1/shipments/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep, driver  
**Response 200**: Shipment with `bags`.

### `POST /api/v1/shipments`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: `CreateShipmentRequest`  
**Response 201**: Created Shipment.  
**Enforces**: Total bags per bag type ≤ available `packedStock.quantity` (CONSTRAINT 4).

### `PATCH /api/v1/shipments/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep, driver (limited fields)  
**Response 200**: Updated Shipment.

### `PATCH /api/v1/shipments/:id/actual-weight`
**Auth**: Bearer | **Roles**: driver, owner  
**Body**: `{ "actualKg": "202.500" }`  
**Description**: Driver logs weight at warehouse loading. Used for reconciliation only — billing is based on bag count.

### `POST /api/v1/shipments/:id/confirm-delivery`
**Auth**: Bearer | **Roles**: driver, owner  
**Body**: `ConfirmDeliveryRequest`  
**Side effects**: Sets status = delivered, removes bags from packed stock, updates order/invoice status, optionally logs payment.

### `POST /api/v1/shipments/:id/return`
**Auth**: Bearer | **Roles**: driver, owner  
**Body**: `LogReturnRequest`  
**Side effects**: Returned bags re-enter packed stock.

### `GET /api/v1/shipments/:id/receipt`
**Auth**: Bearer | **Roles**: driver, owner, sales_rep  
**Response 200**: Receipt data formatted for thermal printer.

---

## Driver Trips

### `GET /api/v1/driver-trips`
**Auth**: Bearer | **Roles**: owner, sales_rep, driver (own trips)  
**Query**: `page`, `limit`, `driverId`, `status`, `dateFrom`, `dateTo`  
**Response 200**: `PaginatedResponse<DriverTrip>`

### `GET /api/v1/driver-trips/:id`
**Auth**: Bearer | **Roles**: owner, sales_rep, driver  
**Response 200**: DriverTrip with shipments.

### `POST /api/v1/driver-trips`
**Auth**: Bearer | **Roles**: owner, sales_rep  
**Body**: `CreateDriverTripRequest`  
**Response 201**: Created trip. Assigns shipments to this trip.

### `PATCH /api/v1/driver-trips/:id`
**Auth**: Bearer | **Roles**: owner, driver  

### `POST /api/v1/driver-trips/:id/start`
**Auth**: Bearer | **Roles**: driver, owner  
**Side effect**: Sets status = in_progress, stamps startedAt.

### `POST /api/v1/driver-trips/:id/complete`
**Auth**: Bearer | **Roles**: driver, owner  
**Body**: `{ "fuelCost": "15.00", "otherExpenses": [...] }`  
**Side effect**: Sets status = completed, stamps completedAt.

---

## Stock Exits

### `GET /api/v1/stock-exits`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Query**: `page`, `limit`, `exitType`, `bagTypeId`, `dateFrom`, `dateTo`  
**Response 200**: `PaginatedResponse<StockExit>`

### `POST /api/v1/stock-exits`
**Auth**: Bearer | **Roles**: owner, sales_rep, worker  
**Body**: `CreateStockExitRequest`  
**Description**: Log a non-sale exit (sample, gift, internal, client bags fill).  
**Enforces**: `packedStock.quantity >= 0` after exit (CONSTRAINT 2).  
**Side effect**: Decrements `packedStock.quantity`.

---

## Invoices

### `GET /api/v1/invoices`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Query**: `page`, `limit`, `clientId`, `status`, `dateFrom`, `dateTo`  
**Response 200**: `PaginatedResponse<Invoice>`

### `GET /api/v1/invoices/:id`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Response 200**: Invoice with `client`, `payments`.

### `POST /api/v1/invoices`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Body**: `CreateInvoiceRequest`  
**Response 201**: Draft Invoice. `subtotal` and `total` computed from lines.

### `PATCH /api/v1/invoices/:id`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  

### `POST /api/v1/invoices/:id/issue`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Side effect**: Sets status = issued, stamps issuedAt.

### `POST /api/v1/invoices/:id/cancel`
**Auth**: Bearer | **Roles**: owner  
**Side effect**: Sets status = cancelled.

---

## Payments

### `GET /api/v1/payments`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Query**: `page`, `limit`, `clientId`, `invoiceId`, `dateFrom`, `dateTo`

### `GET /api/v1/payments/:id`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep

### `POST /api/v1/payments`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Body**: `CreatePaymentRequest`  
**Side effects**: Updates `invoice.paidAmount`, updates `invoice.status`, triggers `client.balance` recalculation.

---

## Workers

### `GET /api/v1/workers`
**Auth**: Bearer | **Roles**: owner  
**Response 200**: `Worker[]` with `totalOwed` computed.

### `GET /api/v1/workers/:id`
**Auth**: Bearer | **Roles**: owner  

### `POST /api/v1/workers`
**Auth**: Bearer | **Roles**: owner  

### `PATCH /api/v1/workers/:id`
**Auth**: Bearer | **Roles**: owner  

### `PATCH /api/v1/workers/:id/rates`
**Auth**: Bearer | **Roles**: owner  
**Body**: `{ "ratesPerBagType": [{ "bagTypeId": "uuid", "ratePerBag": "0.05" }] }`  
**Description**: Replaces the entire rates array.

### `GET /api/v1/workers/:id/payments`
**Auth**: Bearer | **Roles**: owner  

### `POST /api/v1/workers/:id/payments`
**Auth**: Bearer | **Roles**: owner  
**Body**: `CreateWorkerPaymentRequest`  
**Side effect**: Increments `worker.totalPaid`.

---

## Reports

### `GET /api/v1/reports/profit-loss`
**Auth**: Bearer | **Roles**: owner ONLY  
**Query**: `dateFrom`, `dateTo`, `charcoalType`, `grade`, `clientId`, `clientType`  
**Response 200**: `ProfitLossReport`

### `GET /api/v1/reports/stock-value`
**Auth**: Bearer | **Roles**: owner, accountant  
**Response 200**: `StockValueReport`

### `GET /api/v1/reports/variance`
**Auth**: Bearer | **Roles**: owner, accountant  
**Query**: `dateFrom`, `dateTo`, `workerId`  
**Response 200**: `VarianceReport`

### `GET /api/v1/reports/container-costs`
**Auth**: Bearer | **Roles**: owner, accountant  
**Query**: `dateFrom`, `dateTo`, `supplierId`  
**Response 200**: `ContainerCostReport`

### `GET /api/v1/reports/client-ledger/:clientId`
**Auth**: Bearer | **Roles**: owner, accountant, sales_rep  
**Query**: `dateFrom`, `dateTo`  
**Response 200**: `ClientLedger`

### `GET /api/v1/reports/worker-earnings/:workerId`
**Auth**: Bearer | **Roles**: owner ONLY  
**Query**: `dateFrom`, `dateTo`  
**Response 200**: `WorkerEarningsReport`

### `GET /api/v1/reports/physical-count`
**Auth**: Bearer | **Roles**: owner ONLY  
**Response 200**: `PhysicalCountItem[]` — current system quantities for all lots and packed stock.

### `POST /api/v1/reports/physical-count`
**Auth**: Bearer | **Roles**: owner ONLY  
**Body**: `SubmitPhysicalCountRequest`  
**Response 200**: Summary of adjustments created.

---

## Webhooks

### `POST /api/webhooks/clerk`
**Auth**: Svix signature verification (not Bearer)  
**Description**: Receives Clerk webhook events to sync users to the database.  
**Handles**: `user.created`, `user.updated`  
**Response 200**: `"OK"`
