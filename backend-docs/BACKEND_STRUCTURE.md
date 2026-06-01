# NestJS Backend — Folder Structure & Architecture

The backend is organized as a NestJS feature-module application.

---

## Directory Layout

```
apps/backend/
├── src/
│   ├── modules/
│   │   ├── auth/                      — Authentication & current user
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   └── dto/
│   │   │       └── current-user.dto.ts
│   │   │
│   │   ├── users/                     — User management (owner only)
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   └── dto/
│   │   │       ├── create-user.dto.ts
│   │   │       └── update-role.dto.ts
│   │   │
│   │   ├── containers/                — Container tracking & costs
│   │   │   ├── containers.controller.ts
│   │   │   ├── containers.service.ts
│   │   │   ├── container-expenses.service.ts
│   │   │   └── dto/
│   │   │       ├── create-container.dto.ts
│   │   │       ├── create-product-line.dto.ts
│   │   │       └── create-expense.dto.ts
│   │   │
│   │   ├── bag-types/                 — Bag type definitions
│   │   │   ├── bag-types.controller.ts
│   │   │   ├── bag-types.service.ts
│   │   │   └── dto/
│   │   │       └── create-bag-type.dto.ts
│   │   │
│   │   ├── bag-purchases/             — Empty bag inventory
│   │   │   ├── bag-purchases.controller.ts
│   │   │   ├── bag-purchases.service.ts
│   │   │   └── dto/
│   │   │       └── create-bag-purchase.dto.ts
│   │   │
│   │   ├── stock-lots/                — Raw charcoal stock
│   │   │   ├── stock-lots.controller.ts
│   │   │   ├── stock-lots.service.ts
│   │   │   └── dto/
│   │   │       └── create-stock-lot.dto.ts
│   │   │
│   │   ├── packing-sessions/          — Packing operations
│   │   │   ├── packing-sessions.controller.ts
│   │   │   ├── packing-sessions.service.ts
│   │   │   ├── packing-variance.service.ts
│   │   │   └── dto/
│   │   │       ├── create-packing-session.dto.ts
│   │   │       └── complete-packing-session.dto.ts
│   │   │
│   │   ├── packed-stock/              — Packed bag inventory
│   │   │   ├── packed-stock.controller.ts
│   │   │   ├── packed-stock.service.ts
│   │   │   └── dto/
│   │   │       └── summary.dto.ts
│   │   │
│   │   ├── stock-adjustments/         — Physical count adjustments
│   │   │   ├── stock-adjustments.controller.ts
│   │   │   ├── stock-adjustments.service.ts
│   │   │   └── dto/
│   │   │       └── create-adjustment.dto.ts
│   │   │
│   │   ├── warehouse/                 — Warehouse summary
│   │   │   ├── warehouse.controller.ts
│   │   │   ├── warehouse.service.ts
│   │   │   └── dto/
│   │   │       └── warehouse-summary.dto.ts
│   │   │
│   │   ├── clients/                   — Client CRM
│   │   │   ├── clients.controller.ts
│   │   │   ├── clients.service.ts
│   │   │   ├── client-balance.service.ts
│   │   │   └── dto/
│   │   │       ├── create-client.dto.ts
│   │   │       ├── add-phone.dto.ts
│   │   │       └── update-client.dto.ts
│   │   │
│   │   ├── orders/                    — Sales orders
│   │   │   ├── orders.controller.ts
│   │   │   ├── orders.service.ts
│   │   │   └── dto/
│   │   │       ├── create-order.dto.ts
│   │   │       └── update-order-status.dto.ts
│   │   │
│   │   ├── shipments/                 — Order shipments & delivery
│   │   │   ├── shipments.controller.ts
│   │   │   ├── shipments.service.ts
│   │   │   └── dto/
│   │   │       ├── create-shipment.dto.ts
│   │   │       ├── log-actual-weight.dto.ts
│   │   │       └── confirm-delivery.dto.ts
│   │   │
│   │   ├── driver-trips/              — Delivery trip management
│   │   │   ├── driver-trips.controller.ts
│   │   │   ├── driver-trips.service.ts
│   │   │   └── dto/
│   │   │       ├── create-driver-trip.dto.ts
│   │   │       └── log-expenses.dto.ts
│   │   │
│   │   ├── stock-exits/               — Stock removal (sales, gifts, samples)
│   │   │   ├── stock-exits.controller.ts
│   │   │   ├── stock-exits.service.ts
│   │   │   └── dto/
│   │   │       └── create-stock-exit.dto.ts
│   │   │
│   │   ├── invoices/                  — Invoice generation
│   │   │   ├── invoices.controller.ts
│   │   │   ├── invoices.service.ts
│   │   │   └── dto/
│   │   │       ├── create-invoice.dto.ts
│   │   │       └── issue-invoice.dto.ts
│   │   │
│   │   ├── payments/                  — Payment logging
│   │   │   ├── payments.controller.ts
│   │   │   ├── payments.service.ts
│   │   │   └── dto/
│   │   │       └── create-payment.dto.ts
│   │   │
│   │   ├── workers/                   — Warehouse worker management
│   │   │   ├── workers.controller.ts
│   │   │   ├── workers.service.ts
│   │   │   ├── worker-earnings.service.ts
│   │   │   └── dto/
│   │   │       ├── create-worker.dto.ts
│   │   │       └── set-worker-rates.dto.ts
│   │   │
│   │   ├── fill-jobs/                 — Client-provided bag filling
│   │   │   ├── fill-jobs.controller.ts
│   │   │   ├── fill-jobs.service.ts
│   │   │   └── dto/
│   │   │       ├── create-fill-job.dto.ts
│   │   │       └── log-fill-lot.dto.ts
│   │   │
│   │   ├── reports/                   — Financial & operational reports
│   │   │   ├── reports.controller.ts
│   │   │   ├── profit-loss.service.ts
│   │   │   ├── stock-value.service.ts
│   │   │   ├── variance.service.ts
│   │   │   ├── container-costs.service.ts
│   │   │   ├── client-ledger.service.ts
│   │   │   └── worker-earnings.service.ts
│   │   │
│   │   ├── common/                    — Shared utilities
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   └── roles.guard.ts
│   │   │   ├── decorators/
│   │   │   │   ├── current-user.decorator.ts
│   │   │   │   ├── roles.decorator.ts
│   │   │   │   └── current-role.decorator.ts
│   │   │   ├── filters/
│   │   │   │   └── exception.filter.ts
│   │   │   ├── interceptors/
│   │   │   │   └── logging.interceptor.ts
│   │   │   └── validators/
│   │   │       ├── constraint.validator.ts
│   │   │       └── decimal.validator.ts
│   │   │
│   │   ├── config/                    — Environment & configuration
│   │   │   └── clerk.config.ts
│   │   │
│   │   ├── prisma/                    — Database client
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts
│   │   │
│   │   ├── health/                    — Health check
│   │   │   ├── health.controller.ts
│   │   │   └── health.service.ts
│   │   │
│   │   └── webhooks/                  — Clerk webhooks
│   │       ├── webhooks.controller.ts
│   │       ├── clerk-webhook.service.ts
│   │       └── dto/
│   │           └── clerk-webhook-event.dto.ts
│   │
│   ├── app.module.ts                  — Root module
│   └── main.ts                        — NestJS bootstrap
│
├── prisma/
│   ├── schema.prisma                  — Database schema (30 models)
│   ├── migrations/                    — Migration history
│   └── seed.ts                        — Test data seed
│
├── package.json
├── tsconfig.json
└── .env                               — Environment variables
```

---

## Module Patterns

### Standard Module Structure

Each module exports a controller and service pair:

```typescript
// feature.module.ts
import { Module } from "@nestjs/common";
import { FeatureController } from "./feature.controller";
import { FeatureService } from "./feature.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [FeatureController],
  providers: [FeatureService],
  exports: [FeatureService],  // For use by other modules
})
export class FeatureModule {}
```

### Controller Pattern

```typescript
// feature.controller.ts
import { Controller, Get, Post, Patch, Delete, UseGuards, Param, Body, Query } from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { Roles } from "@/common/decorators/roles.decorator";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import { FeatureService } from "./feature.service";
import { CreateFeatureDTO } from "./dto/create-feature.dto";

@Controller("features")
@UseGuards(JwtAuthGuard)
export class FeatureController {
  constructor(private featureService: FeatureService) {}

  @Get()
  @Roles("owner", "accountant")
  async list(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20
  ) {
    return this.featureService.findMany((page - 1) * limit, limit);
  }

  @Get(":id")
  @Roles("owner", "accountant")
  async getOne(@Param("id") id: string) {
    return this.featureService.findOne(id);
  }

  @Post()
  @Roles("owner")
  async create(
    @Body() dto: CreateFeatureDTO,
    @CurrentUser() userId: string
  ) {
    return this.featureService.create(dto, userId);
  }

  @Patch(":id")
  @Roles("owner")
  async update(
    @Param("id") id: string,
    @Body() dto: Partial<CreateFeatureDTO>
  ) {
    return this.featureService.update(id, dto);
  }

  @Delete(":id")
  @Roles("owner")
  async delete(@Param("id") id: string) {
    return this.featureService.delete(id);
  }
}
```

### Service Pattern

```typescript
// feature.service.ts
import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";
import { CreateFeatureDTO } from "./dto/create-feature.dto";
import { Decimal } from "@prisma/client/runtime/library";

@Injectable()
export class FeatureService {
  constructor(private prisma: PrismaService) {}

  async findMany(skip: number, take: number) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.feature.findMany({
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.feature.count(),
    ]);

    return { data, total, page: Math.floor(skip / take) + 1, limit: take };
  }

  async findOne(id: string) {
    const feature = await this.prisma.feature.findUnique({ where: { id } });
    if (!feature) throw new NotFoundException("Feature not found");
    return feature;
  }

  async create(dto: CreateFeatureDTO, userId: string) {
    // Validate business rules (constraints)
    if (await this.prisma.feature.findUnique({ where: { name: dto.name } })) {
      throw new BadRequestException("Feature with this name already exists");
    }

    return this.prisma.feature.create({
      data: {
        ...dto,
        createdById: userId,
      },
    });
  }

  async update(id: string, dto: Partial<CreateFeatureDTO>) {
    const existing = await this.findOne(id);  // Throws if not found
    return this.prisma.feature.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    await this.findOne(id);  // Throws if not found
    return this.prisma.feature.delete({ where: { id } });
  }
}
```

### DTO Pattern

```typescript
// create-feature.dto.ts
import { IsString, IsUUID, IsOptional, IsDecimal, IsArray } from "class-validator";
import { Type } from "class-transformer";

export class CreateFeatureDTO {
  @IsString()
  name: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsDecimal()
  @Type(() => String)
  amount: string;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

// Update variants use Partial
export class UpdateFeatureDTO extends PartialType(CreateFeatureDTO) {}
```

---

## Key Classes & Utilities

### Guards

**JwtAuthGuard**: Applied globally to all routes

```typescript
// common/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);

    if (!token) throw new UnauthorizedException("Missing token");

    try {
      const decoded = await validateClerkJWT(token);  // JWKS validation
      req.userId = decoded.sub;
      req.role = decoded.metadata.role;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }

    return true;
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    return auth.slice(7);
  }
}
```

**RolesGuard**: Optional per-endpoint role check

```typescript
// common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = Reflect.getMetadata("roles", context.getHandler());
    if (!requiredRoles) return true;  // No @Roles() = public

    const { role } = context.switchToHttp().getRequest();
    return requiredRoles.includes(role);
  }
}
```

### Decorators

```typescript
// common/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req.userId;
  }
);

// common/decorators/roles.decorator.ts
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);

// common/decorators/current-role.decorator.ts
export const CurrentRole = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req.role;
  }
);
```

### Exception Handling

```typescript
// common/filters/exception.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ExecutionContext) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof BadRequestException) {
      return response.status(400).json({
        error: exception.message,
        code: "BAD_REQUEST",
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    // Default: 500 Internal Server Error
    response.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

---

## Common Dependencies

```json
{
  "dependencies": {
    "@nestjs/common": "^9.x",
    "@nestjs/core": "^9.x",
    "@nestjs/swagger": "^7.x",
    "@clerk/backend": "^latest",
    "@prisma/client": "^5.x",
    "class-validator": "^0.14.x",
    "class-transformer": "^0.5.x",
    "decimal.js": "^10.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "typescript": "^5.x",
    "prisma": "^5.x"
  }
}
```

---

## Constraints Validation

Services implement constraint checking before database operations:

```typescript
// Example: packing-sessions.service.ts

async create(dto: CreatePackingSessionDTO, userId: string) {
  const lot = await this.prisma.stockLot.findUniqueOrThrow({
    where: { id: dto.lotId }
  });

  // CONSTRAINT 3: kgConsumed <= lot.kgRemaining
  if (new Decimal(dto.kgConsumed).gt(lot.kgRemaining)) {
    throw new BadRequestException(
      "kgConsumed exceeds lot.kgRemaining (CONSTRAINT_3)"
    );
  }

  const kgOutput = this.computeKgOutput(dto.bagsOutput);
  const variance = new Decimal(dto.kgConsumed).sub(kgOutput);

  // CONSTRAINT 7: negative variance requires note
  if (variance.lt(0) && !dto.varianceNote) {
    throw new BadRequestException(
      "Negative variance requires explanation (CONSTRAINT_7)"
    );
  }

  // All checks passed, proceed with transaction
  return this.prisma.$transaction(async (tx) => {
    // ... create session, update lot, create packed stocks
  });
}
```

---

## Transaction Pattern

For multi-step operations, use Prisma transactions:

```typescript
return this.prisma.$transaction(async (tx) => {
  // Step 1
  const updated = await tx.container.update({ where: { id }, data: {...} });

  // Step 2
  for (const line of productLines) {
    await tx.stockLot.create({ data: {...} });
  }

  return updated;
});
```

All steps succeed or all fail — no partial updates.

---

## Testing

### Unit Test Example

```typescript
describe("ContainerService", () => {
  let service: ContainerService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ContainerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ContainerService>(ContainerService);
  });

  it("should create a container", async () => {
    const dto = { number: "CNT-001", supplierId: "supplier-id" };
    jest.spyOn(prisma.container, "create").mockResolvedValue({
      id: "container-id",
      ...dto,
    });

    const result = await service.create(dto, "user-id");
    expect(result.id).toBe("container-id");
  });
});
```

---

## Deployment

### Build

```bash
npm run build
```

Generates `dist/` folder with compiled JavaScript.

### Run Production

```bash
NODE_ENV=production npm run start
```

Listens on port 3001 (or `PORT` env variable).

---

## Resources

- **NestJS Docs**: https://docs.nestjs.com
- **Prisma Docs**: https://www.prisma.io/docs
- **Clerk API**: https://clerk.com/docs/backend-requests/handling/jwt-templates
- **Business Logic**: See `SPEC.md`

---

*For business logic details, refer to SPEC.md. For API contract details, refer to README.md.*
