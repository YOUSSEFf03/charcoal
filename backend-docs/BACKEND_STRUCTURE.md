# Backend Folder Structure

Stack: **Next.js 14 App Router** — API routes live in `apps/web/src/app/api/`

---

## Directory Layout

```
apps/web/src/
├── app/
│   └── api/
│       ├── v1/
│       │   ├── auth/
│       │   │   └── me/
│       │   │       └── route.ts              GET /api/v1/auth/me
│       │   │
│       │   ├── users/
│       │   │   ├── route.ts                  GET  /api/v1/users  (owner only)
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET  /api/v1/users/:id
│       │   │       └── role/
│       │   │           └── route.ts          PATCH /api/v1/users/:id/role (owner only)
│       │   │
│       │   ├── containers/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET, PATCH, DELETE
│       │   │       ├── product-lines/
│       │   │       │   ├── route.ts          GET list, POST create
│       │   │       │   └── [lineId]/
│       │   │       │       └── route.ts      PATCH, DELETE
│       │   │       ├── expenses/
│       │   │       │   ├── route.ts          GET list, POST create
│       │   │       │   └── [expenseId]/
│       │   │       │       └── route.ts      PATCH, DELETE
│       │   │       ├── discount/
│       │   │       │   └── route.ts          GET, PUT, DELETE
│       │   │       └── stock-lots/
│       │   │           └── route.ts          GET (lots created on arrival)
│       │   │
│       │   ├── stock-lots/
│       │   │   ├── route.ts                  GET list, POST (direct addition)
│       │   │   └── [id]/
│       │   │       └── route.ts              GET
│       │   │
│       │   ├── bag-types/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       └── route.ts              GET, PATCH, DELETE
│       │   │
│       │   ├── bag-purchases/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       └── route.ts              GET
│       │   │
│       │   ├── packed-stock/
│       │   │   ├── route.ts                  GET list
│       │   │   └── summary/
│       │   │       └── route.ts              GET summary by bag type
│       │   │
│       │   ├── packing-sessions/
│       │   │   ├── route.ts                  GET list, POST create+complete
│       │   │   └── [id]/
│       │   │       └── route.ts              GET
│       │   │
│       │   ├── stock-adjustments/
│       │   │   ├── route.ts                  GET list, POST create (owner only)
│       │   │   └── [id]/
│       │   │       └── route.ts              GET
│       │   │
│       │   ├── warehouse/
│       │   │   └── summary/
│       │   │       └── route.ts              GET warehouse summary
│       │   │
│       │   ├── suppliers/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       └── route.ts              GET, PATCH, DELETE
│       │   │
│       │   ├── clients/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   ├── overdue/
│       │   │   │   └── route.ts              GET CRM overdue list
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET, PATCH
│       │   │       ├── phones/
│       │   │       │   ├── route.ts          POST add phone
│       │   │       │   └── deactivate/
│       │   │       │       └── route.ts      PATCH deactivate phone
│       │   │       ├── orders/
│       │   │       │   └── route.ts          GET orders for client
│       │   │       ├── invoices/
│       │   │       │   └── route.ts          GET invoices for client
│       │   │       ├── payments/
│       │   │       │   └── route.ts          GET payments for client
│       │   │       └── balance/
│       │   │           └── route.ts          GET computed balance
│       │   │
│       │   ├── orders/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       └── route.ts              GET, PATCH, DELETE
│       │   │
│       │   ├── shipments/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET, PATCH
│       │   │       ├── actual-weight/
│       │   │       │   └── route.ts          PATCH (driver logs weight)
│       │   │       ├── confirm-delivery/
│       │   │       │   └── route.ts          POST (driver confirms)
│       │   │       ├── return/
│       │   │       │   └── route.ts          POST (driver logs return)
│       │   │       └── receipt/
│       │   │           └── route.ts          GET receipt data for printing
│       │   │
│       │   ├── driver-trips/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET, PATCH
│       │   │       ├── start/
│       │   │       │   └── route.ts          POST start trip
│       │   │       └── complete/
│       │   │           └── route.ts          POST complete trip
│       │   │
│       │   ├── stock-exits/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       └── route.ts              GET
│       │   │
│       │   ├── invoices/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET, PATCH
│       │   │       ├── issue/
│       │   │       │   └── route.ts          POST issue invoice
│       │   │       └── cancel/
│       │   │           └── route.ts          POST cancel (owner only)
│       │   │
│       │   ├── payments/
│       │   │   ├── route.ts                  GET list, POST create
│       │   │   └── [id]/
│       │   │       └── route.ts              GET
│       │   │
│       │   ├── workers/
│       │   │   ├── route.ts                  GET list, POST create (owner only)
│       │   │   └── [id]/
│       │   │       ├── route.ts              GET, PATCH
│       │   │       ├── rates/
│       │   │       │   └── route.ts          PATCH set rates (owner only)
│       │   │       └── payments/
│       │   │           ├── route.ts          GET list, POST log payment (owner only)
│       │   │           └── [paymentId]/
│       │   │               └── route.ts      GET
│       │   │
│       │   └── reports/
│       │       ├── profit-loss/
│       │       │   └── route.ts              GET (owner only)
│       │       ├── stock-value/
│       │       │   └── route.ts              GET (owner + accountant)
│       │       ├── variance/
│       │       │   └── route.ts              GET (owner + accountant)
│       │       ├── container-costs/
│       │       │   └── route.ts              GET (owner + accountant)
│       │       ├── client-ledger/
│       │       │   └── [clientId]/
│       │       │       └── route.ts          GET (owner + accountant + sales_rep)
│       │       ├── worker-earnings/
│       │       │   └── [workerId]/
│       │       │       └── route.ts          GET (owner only)
│       │       └── physical-count/
│       │           └── route.ts              GET items, POST submit (owner only)
│       │
│       └── webhooks/
│           └── clerk/
│               └── route.ts                  POST user sync from Clerk
│
├── lib/
│   ├── prisma.ts           — Prisma client singleton
│   ├── auth.ts             — withAuth() middleware helper, role extraction
│   └── validate.ts         — Zod schema validation helpers
│
└── services/               — (backend-side, separate from frontend services/)
    ├── container.service.ts    — container cost calculations, lot creation on arrival
    ├── warehouse.service.ts    — stock lot guards, packed stock management
    ├── packing.service.ts      — session creation, variance, earnings
    ├── client.service.ts       — balance computation, avgOrderDays
    ├── order.service.ts        — order fulfillment flow
    ├── invoice.service.ts      — invoice generation, status transitions
    ├── payment.service.ts      — payment logging, balance update
    ├── delivery.service.ts     — trip management, delivery confirmation
    └── report.service.ts       — report data aggregation
```

---

## Route Handler Pattern

```typescript
// app/api/v1/containers/route.ts

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateContainerSchema = z.object({
  number: z.string().min(1),
  supplierId: z.string().uuid(),
  status: z.enum(["port", "transit", "arrived"]).default("port"),
  notes: z.string().optional(),
});

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const limit = Number(searchParams.get("limit") ?? 20);

  const [data, total] = await prisma.$transaction([
    prisma.container.findMany({
      skip: (page - 1) * limit,
      take: limit,
      include: { supplier: true, productLines: true, expenses: true, discount: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.container.count(),
  ]);

  return Response.json({ data, total, page, limit });
}, ["owner", "accountant", "sales_rep"]);

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = CreateContainerSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const container = await prisma.container.create({ data: { ...parsed.data, createdById: req.userId } });
  return Response.json(container, { status: 201 });
}, ["owner"]);
```

---

## Standard Response Formats

### Success (list)
```json
{
  "data": [...],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

### Success (single / created)
```json
{ ...entity fields }
```

### Success (action)
```json
{ "message": "Container marked as arrived. 3 stock lots created." }
```

### Error
```json
{
  "error": "Human-readable message",
  "code": "SNAKE_CASE_CODE",
  "details": { "fieldName": ["Validation error message"] }
}
```

---

## Error Codes Reference

| Code | HTTP | When |
|------|------|------|
| `UNAUTHORIZED` | 401 | No valid JWT |
| `NO_ROLE` | 403 | JWT valid but user has no role |
| `FORBIDDEN` | 403 | Role not permitted for this action |
| `NOT_FOUND` | 404 | Entity not found |
| `VALIDATION_ERROR` | 422 | Request body fails Zod schema |
| `CONSTRAINT_VIOLATION` | 400 | Business rule violated (e.g., kg would go negative) |
| `CONFLICT` | 409 | Unique constraint or state conflict |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Middleware Chain

Every protected route goes through:
```
Request → Clerk JWT validation → Role extraction → Role gating → Zod validation → Handler → Response
```

---

## Service Layer Pattern (backend services)

Business logic lives in `/lib/services/`, not in route handlers. Route handlers only:
1. Parse and validate input
2. Call service methods
3. Return the result

Example — `lib/services/packing.service.ts`:
```typescript
export async function createPackingSession(data: CreateSessionDTO, userId: string) {
  const lot = await prisma.stockLot.findUniqueOrThrow({ where: { id: data.lotId } });

  // CONSTRAINT 3
  if (new Decimal(data.kgConsumed).gt(lot.kgRemaining)) {
    throw new ConstraintError("CONSTRAINT_VIOLATION", "kgConsumed exceeds lot.kgRemaining");
  }

  const kgOutputTotal = computeKgOutputTotal(data.bagsOutput);
  const varianceKg = new Decimal(data.kgConsumed).sub(kgOutputTotal);

  // CONSTRAINT 7
  if (varianceKg.lt(0) && !data.varianceNote) {
    throw new ConstraintError("CONSTRAINT_VIOLATION", "Negative variance requires varianceNote");
  }

  return prisma.$transaction(async (tx) => {
    // deduct from lot
    await tx.stockLot.update({
      where: { id: data.lotId },
      data: { kgRemaining: { decrement: new Decimal(data.kgConsumed) } },
    });

    // create session
    const session = await tx.packingSession.create({ data: { ...data, kgOutputTotal, varianceKg, ... } });

    // create packed stock records
    for (const bagOut of data.bagsOutput) {
      await tx.packedStock.create({ data: { lotId: data.lotId, bagTypeId: bagOut.bagTypeId, quantity: bagOut.quantity, sessionId: session.id } });
    }

    // update worker totals
    await updateWorkerEarnings(tx, data.workerId, session.sessionEarnings, data.bagsOutput);

    return session;
  });
}
```
