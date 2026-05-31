# Sample API Payloads

Realistic JSON examples for every module. All monetary values are strings.

---

## Standard Response Wrappers

### Paginated List
```json
{
  "data": [...],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

### Validation Error (422)
```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "supplierId": ["Required"],
    "kgPerBag": ["Must be a positive number"],
    "pricePerTon": ["Must be a positive number"]
  }
}
```

### Unauthorized (401)
```json
{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

### Forbidden (403)
```json
{
  "error": "Forbidden",
  "code": "FORBIDDEN"
}
```

### Business Constraint Violation (400)
```json
{
  "error": "kgConsumed (520.000) exceeds lot kgRemaining (500.000)",
  "code": "CONSTRAINT_VIOLATION"
}
```

### Not Found (404)
```json
{
  "error": "Container not found",
  "code": "NOT_FOUND"
}
```

---

## Module 1 — Containers

### GET /api/v1/containers (list)
```json
{
  "data": [
    {
      "id": "c1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "number": "CONT-2024-001",
      "supplierId": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "supplier": { "id": "...", "name": "Saudi Charcoal Factory", "country": "Saudi Arabia" },
      "status": "arrived",
      "arrivalDate": "2024-02-15",
      "notes": "First container of 2024",
      "createdById": "u1a2b3c4-...",
      "createdAt": "2024-01-20T08:00:00.000Z",
      "updatedAt": "2024-02-15T08:00:00.000Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

### GET /api/v1/containers/:id (single with all details)
```json
{
  "id": "c1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "number": "CONT-2024-001",
  "status": "arrived",
  "arrivalDate": "2024-02-15",
  "supplier": { "id": "...", "name": "Saudi Charcoal Factory", "country": "Saudi Arabia" },
  "productLines": [
    {
      "id": "pl-001",
      "charcoalType": "BBQ hardwood",
      "grade": "A",
      "paidBags": 800,
      "giftBags": 20,
      "kgPerBag": "10.000",
      "pricePerTon": "280.00",
      "computed": {
        "tonnage": "8.000",
        "baseCost": "2240.00",
        "expenseShare": "800.00",
        "discountShare": "66.67",
        "expensePerTon": "100.00",
        "discountPerTon": "8.33",
        "allInCostPerTon": "371.67",
        "allInCostPerKg": "0.3717"
      }
    }
  ],
  "expenses": [
    { "id": "e-001", "description": "Freight", "amount": "600.00", "addedAt": "2024-01-21T08:00:00.000Z" },
    { "id": "e-002", "description": "Beirut port fees", "amount": "350.00", "addedAt": "2024-02-01T08:00:00.000Z" }
  ],
  "discount": { "id": "d-001", "amount": "100.00" },
  "totals": {
    "totalTonnage": "12.000",
    "totalProductCost": "3600.00",
    "totalExpenses": "1200.00",
    "totalDiscount": "100.00",
    "averageCostPerTon": "391.67",
    "averageCostPerKg": "0.3917"
  }
}
```

### POST /api/v1/containers (request body)
```json
{
  "number": "CONT-2024-003",
  "supplierId": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "status": "port",
  "notes": "Arriving end of month"
}
```

### POST /api/v1/containers/:id/expenses (request body)
```json
{
  "description": "Late invoice — worker unloading fees",
  "amount": "75.00"
}
```

---

## Module 2 — Warehouse & Stock

### GET /api/v1/warehouse/summary
```json
{
  "totalRawKg": "5000.000",
  "totalPackedNominalKg": "1230.000",
  "totalSystemKg": "6230.000",
  "lotCount": 3,
  "packedSummary": [
    { "bagTypeId": "...", "bagTypeName": "2kg bag", "nominalKg": "2.000", "totalQuantity": 200, "totalNominalKg": "400.000" },
    { "bagTypeId": "...", "bagTypeName": "5kg bag", "nominalKg": "5.000", "totalQuantity": 30,  "totalNominalKg": "150.000" },
    { "bagTypeId": "...", "bagTypeName": "10kg bag","nominalKg": "10.000","totalQuantity": 68,  "totalNominalKg": "680.000" }
  ]
}
```

### GET /api/v1/stock-lots
```json
{
  "data": [
    {
      "id": "l1a2b3c4-...",
      "charcoalType": "BBQ hardwood",
      "grade": "A",
      "supplierId": "...",
      "supplier": { "name": "Saudi Charcoal Factory" },
      "kgReceived": "8000.000",
      "kgRemaining": "3200.000",
      "costPerKg": "0.3717",
      "source": "container",
      "containerId": "c1a2b3c4-...",
      "dateReceived": "2024-02-15"
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 20
}
```

### POST /api/v1/stock-lots (direct addition, no container)
```json
{
  "charcoalType": "restaurant grade",
  "grade": "B",
  "supplierId": "s1a2b3c4-...",
  "kgReceived": "2000.000",
  "costPerKg": "0.2900",
  "dateReceived": "2024-05-10",
  "notes": "Local purchase from surplus stock"
}
```

### POST /api/v1/bag-types (request)
```json
{
  "name": "1.9kg bag",
  "nominalKg": "1.900",
  "costPerBag": "0.0800",
  "workerRate": "0.0500",
  "note": "Same physical bag as 2kg — different nominal weight"
}
```

---

## Module 3 — Packing Sessions

### POST /api/v1/packing-sessions (request body)
```json
{
  "lotId": "l1a2b3c4-...",
  "mode": "stock",
  "kgConsumed": "300.000",
  "bagsOutput": [
    { "bagTypeId": "bt-2kg-id", "quantity": 100 },
    { "bagTypeId": "bt-5kg-id", "quantity": 20 }
  ],
  "date": "2024-05-15",
  "notes": "Morning shift"
}
```

### POST /api/v1/packing-sessions (response)
```json
{
  "id": "ps1a2b3c4-...",
  "lotId": "l1a2b3c4-...",
  "workerId": "u1a2b3c4-...",
  "mode": "stock",
  "kgConsumed": "300.000",
  "bagsOutput": [
    { "bagTypeId": "bt-2kg-id", "quantity": 100 },
    { "bagTypeId": "bt-5kg-id", "quantity": 20 }
  ],
  "kgOutputTotal": "300.000",
  "varianceKg": "0.000",
  "sessionEarnings": "6.60",
  "date": "2024-05-15",
  "startedAt": "2024-05-15T08:00:00.000Z",
  "completedAt": "2024-05-15T11:00:00.000Z"
}
```

### Packing session with negative variance (requires explanation)
```json
{
  "lotId": "l1a2b3c4-...",
  "mode": "stock",
  "kgConsumed": "200.000",
  "bagsOutput": [
    { "bagTypeId": "bt-10kg-id", "quantity": 21 }
  ],
  "varianceNote": "Scale was off — recalibrated after session. Extra 10kg counted.",
  "date": "2024-05-15"
}
```

### Error: negative variance without note (400)
```json
{
  "error": "Negative variance (-10.000 kg) requires a variance note explanation",
  "code": "CONSTRAINT_VIOLATION"
}
```

---

## Module 4 — Client CRM

### POST /api/v1/clients (request body)
```json
{
  "name": "مطعم الشرق",
  "type": "restaurant",
  "currency": "USD",
  "phones": [
    { "number": "+961 70 123456", "label": "mobile", "isActive": true, "dateAdded": "2024-05-15" }
  ],
  "preferredTypes": [
    { "charcoalType": "BBQ hardwood", "grade": "A" }
  ],
  "paymentTerms": "net 15",
  "notes": "Buys every 2 weeks. Owner speaks Arabic."
}
```

### GET /api/v1/clients/overdue
```json
[
  {
    "clientId": "c1a2b3c4-...",
    "clientName": "Al-Nakheel Restaurant",
    "clientType": "restaurant",
    "lastOrderDate": "2024-04-28",
    "daysSinceLastOrder": 27,
    "avgOrderDays": "14.50",
    "daysOverdue": 12,
    "balance": "350.00",
    "currency": "USD"
  },
  {
    "clientId": "c2a2b3c4-...",
    "clientName": "مطعم الكرم",
    "clientType": "restaurant",
    "lastOrderDate": "2024-03-15",
    "daysSinceLastOrder": 70,
    "avgOrderDays": "21.00",
    "daysOverdue": 49,
    "balance": "1800000.00",
    "currency": "LBP"
  }
]
```

### POST /api/v1/clients/:id/phones (add phone, never deleted)
```json
{
  "number": "+961 1 999888",
  "label": "office"
}
```

---

## Module 5 — Orders & Invoicing

### POST /api/v1/orders (restaurant delivery order)
```json
{
  "clientId": "c1a2b3c4-...",
  "charcoalType": "BBQ hardwood",
  "grade": "A",
  "totalKgRequested": "200.000",
  "bagTypeId": "bt-10kg-id",
  "pricePerBag": "8.50",
  "bagLines": [
    { "bagTypeId": "bt-10kg-id", "quantity": 20 }
  ],
  "notes": "Urgent delivery before weekend"
}
```

### POST /api/v1/invoices (request body)
```json
{
  "clientId": "c1a2b3c4-...",
  "orderId": "o1a2b3c4-...",
  "currency": "USD",
  "lines": [
    {
      "bagTypeId": "bt-10kg-id",
      "bagTypeName": "10kg bag",
      "qty": 20,
      "pricePerBag": "8.50"
    }
  ],
  "dueDate": "2024-06-01"
}
```

### GET /api/v1/invoices/:id (single invoice with payments)
```json
{
  "id": "i1a2b3c4-...",
  "orderId": "o1a2b3c4-...",
  "clientId": "c1a2b3c4-...",
  "client": { "name": "Al-Nakheel Restaurant", "currency": "USD" },
  "lines": [
    { "bagTypeId": "bt-10kg-id", "bagTypeName": "10kg bag", "qty": 20, "pricePerBag": "8.50", "lineTotal": "170.00" }
  ],
  "subtotal": "170.00",
  "total": "170.00",
  "currency": "USD",
  "status": "partially_paid",
  "paidAmount": "100.00",
  "issuedAt": "2024-05-01T08:00:00.000Z",
  "dueDate": "2024-06-01",
  "payments": [
    {
      "id": "p1a2b3c4-...",
      "amount": "100.00",
      "currency": "USD",
      "method": "cash",
      "date": "2024-05-10",
      "loggedById": "u-sales-001"
    }
  ]
}
```

### POST /api/v1/payments (log a payment)
```json
{
  "clientId": "c1a2b3c4-...",
  "invoiceId": "i1a2b3c4-...",
  "amount": "70.00",
  "currency": "USD",
  "method": "whish",
  "date": "2024-05-20",
  "notes": "Final payment via Whish transfer"
}
```

---

## Module 6 — Delivery

### POST /api/v1/shipments (create shipment within order)
```json
{
  "orderId": "o1a2b3c4-...",
  "address": "Mar Elias Street, Beirut, near the roundabout",
  "bags": [
    { "bagTypeId": "bt-10kg-id", "quantity": 20 }
  ],
  "notes": "Ring doorbell — restaurant entrance is at the back"
}
```

### POST /api/v1/driver-trips (create trip)
```json
{
  "driverId": "u-driver-001",
  "shipmentIds": ["sh-001", "sh-002", "sh-003"],
  "notes": "Beirut south route"
}
```

### PATCH /api/v1/shipments/:id/actual-weight (driver logs weight at loading)
```json
{
  "actualKg": "202.500"
}
```

### POST /api/v1/shipments/:id/confirm-delivery
```json
{
  "deliveredAt": "2024-05-15T14:30:00.000Z",
  "paymentMethod": "cash",
  "paymentAmount": "170.00"
}
```

### GET /api/v1/shipments/:id/receipt (printed at delivery)
```json
{
  "receiptId": "REC-ABC123",
  "companyName": "Charcoal Imports Lebanon",
  "date": "15/05/2024",
  "time": "2:30 PM",
  "clientName": "Al-Nakheel Restaurant",
  "address": "Mar Elias Street, Beirut",
  "lines": [
    {
      "bagTypeName": "10kg bag",
      "quantity": 20,
      "pricePerBag": "8.50",
      "lineTotal": "170.00"
    }
  ],
  "subtotal": "170.00",
  "currency": "USD",
  "paymentStatus": "paid",
  "driverName": "Khalil Mansour"
}
```

### POST /api/v1/shipments/:id/return (driver logs return)
```json
{
  "bags": [
    { "bagTypeId": "bt-10kg-id", "quantity": 3 }
  ],
  "reason": "Client refused — wrong grade delivered"
}
```

### POST /api/v1/driver-trips/:id/complete
```json
{
  "fuelCost": "15.00",
  "otherExpenses": [
    { "description": "Toll - Nahr el Kalb", "amount": "3.00" },
    { "description": "Parking Hamra", "amount": "2.00" }
  ]
}
```

---

## Module 7 — Suppliers

### POST /api/v1/suppliers
```json
{
  "name": "Gulf Charcoal Trading",
  "country": "UAE",
  "contactPersons": [
    { "name": "Mohammed Al-Mansoori", "phone": "+971 50 000001", "role": "Sales Director" }
  ],
  "charcoalTypes": [
    { "type": "BBQ hardwood", "grade": "A" },
    { "type": "BBQ hardwood", "grade": "B" }
  ],
  "bankDetails": {
    "bankName": "Emirates NBD",
    "accountNumber": "1234567890",
    "iban": "AE07 0331 2345 6789 0123 456",
    "swift": "EBILAEAD"
  },
  "paymentTerms": "50% upfront, 50% on BL",
  "leadTimeDays": 30
}
```

---

## Module 8 — Reports

### GET /api/v1/reports/profit-loss (owner only)
```json
{
  "revenue": "560.00",
  "cogs": "74.34",
  "bagCost": "5.20",
  "varianceCost": "52.72",
  "deliveryCost": "18.00",
  "grossProfit": "409.74",
  "filters": {
    "dateFrom": "2024-01-01",
    "dateTo": "2024-05-31"
  },
  "generatedAt": "2024-05-26T12:00:00.000Z"
}
```

### GET /api/v1/reports/stock-value
```json
{
  "rawStockValue": "1834.94",
  "packedStockValue": "220.28",
  "totalWarehouseValue": "2055.22",
  "lots": [
    {
      "lotId": "l1a2b3c4-...",
      "charcoalType": "BBQ hardwood",
      "grade": "A",
      "supplierName": "Saudi Charcoal Factory",
      "kgRemaining": "3200.000",
      "costPerKg": "0.3717",
      "value": "1189.44"
    }
  ],
  "packedBreakdown": [
    {
      "bagTypeId": "bt-10kg-id",
      "bagTypeName": "10kg bag",
      "totalQuantity": 23,
      "nominalKg": "10.000",
      "costPerKg": "0.3717",
      "value": "85.49"
    }
  ],
  "generatedAt": "2024-05-26T12:00:00.000Z"
}
```

### GET /api/v1/reports/variance
```json
{
  "sessions": [
    {
      "sessionId": "s1a2b3c4-...",
      "date": "2024-02-20",
      "workerName": "Hassan Nassar",
      "lotId": "l1a2b3c4-...",
      "charcoalType": "BBQ hardwood",
      "grade": "A",
      "kgConsumed": "500.000",
      "kgOutput": "550.000",
      "varianceKg": "-50.000",
      "variancePercent": "-10.00%"
    }
  ],
  "byCharcoalType": [
    {
      "charcoalType": "BBQ hardwood",
      "grade": "A",
      "totalVarianceKg": "-140.000",
      "totalVarianceCost": "52.00"
    }
  ],
  "byWorker": [
    {
      "workerId": "w1a2b3c4-...",
      "workerName": "Hassan Nassar",
      "totalVarianceKg": "-140.000"
    }
  ],
  "generatedAt": "2024-05-26T12:00:00.000Z"
}
```

### POST /api/v1/reports/physical-count (submit count)
Request:
```json
{
  "items": [
    {
      "type": "lot",
      "id": "l1a2b3c4-...",
      "countedQty": "3150.000",
      "reason": "Physical count found 50kg less — dust and spillage at lot edges"
    },
    {
      "type": "packed_stock",
      "id": "ps1a2b3c4-...",
      "countedQty": "118"
    }
  ]
}
```
Response:
```json
{
  "adjustmentsCreated": 1,
  "adjustments": [
    {
      "id": "adj-001",
      "type": "lot",
      "name": "BBQ hardwood Grade A",
      "before": "3200.000",
      "after": "3150.000",
      "difference": "-50.000"
    }
  ]
}
```

---

## Non-sale Stock Exits

### POST /api/v1/stock-exits (sample)
```json
{
  "packedStockId": "ps1a2b3c4-...",
  "bagTypeId": "bt-2kg-id",
  "quantity": 5,
  "exitType": "sample",
  "reason": "Product sample for new corporate client",
  "recipient": "Levant Events Co.",
  "date": "2024-05-15"
}
```

### POST /api/v1/stock-exits (internal use)
```json
{
  "packedStockId": "ps1a2b3c4-...",
  "bagTypeId": "bt-2kg-id",
  "quantity": 2,
  "exitType": "internal",
  "reason": "Used for staff BBQ event",
  "date": "2024-05-20"
}
```

---

## Workers

### POST /api/v1/workers/:id/payments (owner pays worker)
```json
{
  "amount": "150.00",
  "date": "2024-05-31",
  "notes": "May settlement"
}
```

### GET /api/v1/reports/worker-earnings/:workerId
```json
{
  "workerId": "w1a2b3c4-...",
  "workerName": "Hassan Nassar",
  "bagBreakdown": [
    { "bagTypeId": "bt-2kg-id", "bagTypeName": "2kg bag", "totalBagsPacked": 3200, "ratePerBag": "0.0500", "totalEarned": "160.00" },
    { "bagTypeId": "bt-5kg-id", "bagTypeName": "5kg bag", "totalBagsPacked": 800,  "ratePerBag": "0.0800", "totalEarned": "64.00"  },
    { "bagTypeId": "bt-10kg-id","bagTypeName": "10kg bag","totalBagsPacked": 420,  "ratePerBag": "0.1200", "totalEarned": "50.40" }
  ],
  "totalEarned": "274.40",
  "totalPaid": "200.00",
  "totalOwed": "74.40",
  "filters": {},
  "generatedAt": "2024-05-26T12:00:00.000Z"
}
```
