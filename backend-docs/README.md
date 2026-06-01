# NestJS Backend — Charcoal ERP

Complete API backend for the charcoal import, warehousing, and distribution system.

---

## Quick Start

1. **Prerequisites**: Node 18+, PostgreSQL (Docker or Railway), Clerk account
2. **Install**: `npm install` (from repo root)
3. **Database**: `cd apps/backend && npx prisma migrate dev`
4. **Run**: `npm run start:dev` (from apps/backend/)
5. **Test**: `curl http://localhost:3001/api/v1/health`
6. **API Docs**: http://localhost:3001/api/docs (Swagger UI)

---

## Stack

- **Framework**: NestJS 9+ (TypeScript)
- **ORM**: Prisma with PostgreSQL
- **Authentication**: Clerk JWT via JWKS validation
- **API Documentation**: Swagger/OpenAPI 3.0
- **Global Prefix**: `/api/v1`
- **Port**: 3001 (development)

---

## Architecture

### Request Flow

```
HTTP Request
    ↓
NestJS Global Guard (JwtAuthGuard)
    ↓
Clerk JWKS validation
    ↓
User ID + Role extraction from JWT
    ↓
@Roles() decorator (optional role gating)
    ↓
Route Handler
    ↓
Service (business logic, constraints)
    ↓
Prisma Client (database)
    ↓
Response
```

### Core Concepts

- **Modules**: Feature-based (containers, warehouse, clients, orders, delivery, etc.)
- **Controllers**: HTTP request handling, validation, response formatting
- **Services**: Business logic, constraint enforcement, data transformation
- **Guards**: `@Roles()` for role-based access control
- **DTOs**: Request/response validation with class-validator
- **Exceptions**: Custom exception handling with error codes

---

## Modules (19 total)

| Module | Purpose | Main Resources |
|--------|---------|-----------------|
| `auth` | Authentication, current user | `/auth/me` |
| `users` | User management (owner only) | `/users`, `/users/:id` |
| `containers` | Container tracking, costs | `/containers`, `/containers/:id` |
| `bag-types` | Bag type definitions | `/bag-types` |
| `bag-purchases` | Empty bag purchases | `/bag-purchases` |
| `stock-lots` | Raw charcoal stock | `/stock-lots` |
| `packing-sessions` | Packing operations | `/packing-sessions` |
| `packed-stock` | Packed bag inventory | `/packed-stock` |
| `stock-adjustments` | Physical count adjustments | `/stock-adjustments` |
| `warehouse` | Warehouse summary | `/warehouse/summary` |
| `clients` | Client CRM | `/clients`, `/clients/:id` |
| `orders` | Sales orders | `/orders` |
| `shipments` | Order shipments | `/shipments` |
| `driver-trips` | Delivery trips | `/driver-trips` |
| `stock-exits` | Stock removal (sales, samples, gifts) | `/stock-exits` |
| `invoices` | Invoice generation | `/invoices` |
| `payments` | Payment logging | `/payments` |
| `workers` | Warehouse worker management | `/workers` |
| `fill-jobs` | Client-provided bag filling | `/fill-jobs` |
| `reports` | Financial and operational reports | `/reports/*` |

---

## Authentication

### Token Flow

1. **Frontend**: User signs in via Clerk UI
2. **Clerk**: Issues a JWT (expiry: 60 seconds, rotates continuously)
3. **Frontend**: Stores token in secure memory via `window.__clerk_token` (set by `useTokenSync()` in `src/lib/auth.ts`)
4. **API Call**: Send `Authorization: Bearer <token>` header
5. **Backend**: 
   - Extract JWT from Authorization header
   - Validate signature via Clerk JWKS endpoint
   - Extract userId (sub) and role from claims
   - Allow request or reject based on role

### Development Bypass

In `NODE_ENV !== "production"`, you can use dev tokens:

```bash
Authorization: Bearer dev:owner
```

Valid roles: `owner`, `accountant`, `sales_rep`, `worker`, `driver`, `receiver`

### Role Extraction

From the JWT claims:
```typescript
sessionClaims.metadata.role  // owner | accountant | sales_rep | worker | driver | receiver
```

Role is stored in **Clerk's public metadata** and included in every JWT.

---

## Key Guards & Decorators

### @Roles()

Restrict endpoint to specific roles:

```typescript
@Get()
@Roles('owner', 'accountant')
getContainers() { ... }
```

### @CurrentUser()

Inject current user info:

```typescript
@Post()
createOrder(@CurrentUser() userId: string, @Body() dto: CreateOrderDTO) {
  // userId is guaranteed to be present
  return this.ordersService.create(dto, userId);
}
```

### JwtAuthGuard

Applied globally to all routes. Automatically:
- Validates Bearer token
- Extracts userId and role
- Rejects 401 if token invalid
- Rejects 403 if no role assigned

---

## Database Schema

**30 models** in `apps/backend/prisma/schema.prisma`:

**User & Auth:**
- User, UserAccount, AccountEntry

**Sourcing & Containers:**
- Supplier, Container, ContainerProductLine, ContainerExpense, ContainerDiscount

**Warehouse & Stock:**
- StockLot, BagType, BagPurchase, PackedStock, StockAdjustment

**Packing & Workers:**
- PackingSession, PackingSessionLot, Worker, WorkerPayment

**Fill Jobs:**
- FillJob, FillJobLot

**Clients & Sales:**
- Client, ClientOrder, OrderBagLine

**Delivery:**
- Shipment, ShipmentBag, DriverTrip

**Financial:**
- StockExit, Invoice, Payment

**Cash Management:**
- CashHandover

**System:**
- Setting

---

## API Conventions

### Base URL
```
http://localhost:3001/api/v1
```

### Authentication
```
Authorization: Bearer <clerk_jwt>
```

Required on all endpoints except `/health` and `/webhooks/clerk`.

### Request Body Format

```json
{
  "number": "CNT-2024-001",
  "supplierId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "port",
  "notes": "Container from Lebanon"
}
```

### Response Format (Success)

**List:**
```json
{
  "data": [...],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

**Single/Created:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "number": "CNT-2024-001",
  "status": "port",
  ...
}
```

**Action:**
```json
{
  "message": "Container marked as arrived. 3 stock lots created."
}
```

### Error Format

```json
{
  "error": "Human-readable message",
  "code": "SNAKE_CASE_ERROR_CODE",
  "details": {
    "fieldName": ["Validation error message"]
  },
  "timestamp": "2024-05-26T14:30:00.000Z",
  "path": "/api/v1/containers"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success (GET, PATCH, PUT) |
| 201 | Created (POST) |
| 204 | No content (DELETE) |
| 400 | Business logic violation (constraint error) |
| 401 | Unauthorized (no valid JWT) |
| 403 | Forbidden (wrong role) |
| 404 | Not found |
| 422 | Validation error (malformed request) |
| 500 | Unexpected server error |

---

## Constraints (Enforced at API Level)

These 15 business rules are validated in services before any database operation:

| # | Constraint |
|---|-----------|
| 1 | `lot.kg_remaining >= 0` at all times |
| 2 | `packed_stock.qty >= 0` at all times |
| 3 | Packing session cannot consume more than `lot.kg_remaining` |
| 4 | Shipment bags cannot exceed available `packed_stock` |
| 5 | Every stock exit requires: exitType, bagTypeId, qty, loggedById, date |
| 6 | Every adjustment requires: reason, before, after, approvedBy |
| 7 | Negative variance requires explanation before session closes |
| 8 | Lots from different suppliers never merge (same type/grade = separate lots) |
| 9 | Container expenses added post-arrival recalculate `cost_per_kg` on linked lots |
| 10 | Price set at sale time (no pre-set price list) |
| 11 | Gross profit visible to **owner role only** |
| 12 | `cost_per_kg` visible to **owner and accountant only** |
| 13 | Physical count adjustments require **owner approval** (no auto-correction) |
| 14 | Client phone numbers **never deleted**, only marked inactive |
| 15 | Client balance always **computed** from invoices − payments |

---

## Common Patterns

### Service Pattern

```typescript
// container.service.ts
@Injectable()
export class ContainerService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateContainerDTO, userId: string) {
    return this.prisma.container.create({
      data: {
        number: dto.number,
        supplierId: dto.supplierId,
        status: dto.status,
        createdById: userId,
      },
      include: {
        supplier: true,
        productLines: true,
        expenses: true,
      },
    });
  }

  async markArrived(id: string) {
    const container = await this.prisma.container.findUniqueOrThrow({
      where: { id },
      include: { productLines: true, expenses: true, discount: true },
    });

    // Validate
    if (container.status === "arrived") {
      throw new BadRequestException("Already arrived");
    }

    // Calculate costs for each product line
    const productLines = container.productLines.map(line => ({
      ...line,
      allInCostPerKg: this.calculateCostPerKg(line, container),
    }));

    // Create stock lots
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.container.update({
        where: { id },
        data: { status: "arrived", arrivalDate: new Date() },
      });

      for (const line of productLines) {
        await tx.stockLot.create({
          data: {
            charcoalType: line.charcoalType,
            grade: line.grade,
            supplierId: line.supplierId,
            kgReceived: new Decimal(line.paidBags).times(line.kgPerBag),
            kgRemaining: new Decimal(line.paidBags).times(line.kgPerBag),
            costPerKg: new Decimal(line.allInCostPerKg),
            source: "container",
            containerId: id,
            dateReceived: updated.arrivalDate,
          },
        });
      }

      return updated;
    });
  }

  private calculateCostPerKg(
    line: ContainerProductLine,
    container: Container & { expenses: ContainerExpense[], discount: ContainerDiscount }
  ) {
    // Implementation of cost allocation formula
    // See SPEC.md for exact formula
  }
}
```

### Controller Pattern

```typescript
// container.controller.ts
@Controller("containers")
@UseGuards(JwtAuthGuard)
export class ContainerController {
  constructor(private containerService: ContainerService) {}

  @Get()
  @Roles("owner", "accountant", "sales_rep")
  async list(@Query("page") page = 1, @Query("limit") limit = 20) {
    return this.containerService.findMany(
      (page - 1) * limit,
      limit
    );
  }

  @Get(":id")
  @Roles("owner", "accountant", "sales_rep")
  async getOne(@Param("id") id: string) {
    return this.containerService.findOne(id);
  }

  @Post()
  @Roles("owner")
  async create(@Body() dto: CreateContainerDTO, @CurrentUser() userId: string) {
    return this.containerService.create(dto, userId);
  }

  @Patch(":id/mark-arrived")
  @Roles("owner")
  async markArrived(@Param("id") id: string) {
    return this.containerService.markArrived(id);
  }
}
```

### DTO Pattern

```typescript
// create-container.dto.ts
import { IsString, IsUUID, IsEnum, IsOptional } from "class-validator";

export class CreateContainerDTO {
  @IsString()
  number: string;

  @IsUUID()
  supplierId: string;

  @IsEnum(["port", "transit", "arrived"])
  @IsOptional()
  status?: string = "port";

  @IsString()
  @IsOptional()
  notes?: string;
}
```

---

## Common Endpoints

### Containers

```
GET    /api/v1/containers              List all containers (paginated)
POST   /api/v1/containers              Create container
GET    /api/v1/containers/:id          Get one container
PATCH  /api/v1/containers/:id          Update container
PATCH  /api/v1/containers/:id/mark-arrived    Mark arrived, create lots
POST   /api/v1/containers/:id/expenses         Add expense
GET    /api/v1/containers/:id/expenses        List expenses
```

### Packing Sessions

```
POST   /api/v1/packing-sessions            Create + complete session
GET    /api/v1/packing-sessions            List sessions
GET    /api/v1/packing-sessions/:id        Get one session
```

### Clients & Orders

```
GET    /api/v1/clients                 List clients
POST   /api/v1/clients                 Create client
GET    /api/v1/clients/:id             Get client profile
POST   /api/v1/orders                  Create order
PATCH  /api/v1/orders/:id              Update order status
```

### Invoices & Payments

```
POST   /api/v1/invoices                Generate invoice
GET    /api/v1/invoices/:id            Get invoice
POST   /api/v1/invoices/:id/issue      Issue invoice
POST   /api/v1/payments                Log payment
```

### Reports

```
GET    /api/v1/reports/profit-loss     P&L report (owner only)
GET    /api/v1/reports/stock-value     Stock value report
GET    /api/v1/reports/variance        Variance report
GET    /api/v1/reports/container-costs Container cost report
```

---

## Testing

### Health Check

```bash
curl http://localhost:3001/api/v1/health
```

Expected:
```json
{ "status": "ok", "database": "connected" }
```

### Authenticated Request

```bash
# Dev token (development only)
curl -H "Authorization: Bearer dev:owner" \
  http://localhost:3001/api/v1/containers

# Real Clerk JWT
curl -H "Authorization: Bearer <actual_jwt>" \
  http://localhost:3001/api/v1/containers
```

---

## Debugging

### Logs

```bash
# Start with debug logs
DEBUG=* npm run start:dev

# Or in .env
DEBUG=charcoal:*
```

### Database

```bash
# Open Prisma Studio
cd apps/backend
npx prisma studio
# Opens http://localhost:5555
```

### Swagger UI

```
http://localhost:3001/api/docs
```

Try endpoints directly from this UI.

---

## Deployment

### Environment Variables (Production)

```env
DATABASE_URL=postgresql://...
CLERK_JWKS_URL=https://your-domain.clerk.accounts.com/.well-known/jwks.json
CLERK_WEBHOOK_SECRET=whsec_...
NODE_ENV=production
```

### Build & Run

```bash
npm run build
NODE_ENV=production npm run start
```

---

## Resources

- **Business Spec**: `SPEC.md` (root)
- **Setup Guide**: `SETUP.md` (root)
- **Auth Details**: `backend-docs/AUTH.md`
- **Module Layout**: `backend-docs/BACKEND_STRUCTURE.md`
- **Database Schema**: `apps/backend/prisma/schema.prisma`

---

*For detailed business logic, refer to SPEC.md. For module-specific code patterns, see BACKEND_STRUCTURE.md.*
