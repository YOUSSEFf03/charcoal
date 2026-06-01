# Authentication & Authorization — NestJS Backend

Complete guide to how authentication and role-based access control work in the charcoal ERP backend.

---

## Overview

- **Auth Provider**: Clerk (https://clerk.com)
- **Token Type**: JWT (issued by Clerk)
- **Transport**: `Authorization: Bearer <token>` header
- **Validation**: JWKS endpoint (no secret key needed server-side)
- **Roles**: Stored in Clerk's public metadata on user object
- **Guards**: Global `JwtAuthGuard` on all protected routes
- **Role Gating**: Optional `@Roles()` decorator per endpoint

---

## Authentication Flow

### 1. User Sign-In (Frontend)

User opens the app and sees Clerk sign-in UI:

```
┌─────────────────────────────────────┐
│  Frontend (Vite + React)            │
│                                     │
│  Clerk.SignIn component             │
│  ↓                                  │
│  User enters email + password       │
│  ↓                                  │
│  Clerk validates credentials        │
└─────────────────────────────────────┘
         ↓
    Clerk Auth Server
         ↓ issues JWT
┌─────────────────────────────────────┐
│  Frontend (Vite + React)            │
│                                     │
│  useAuth().getToken() available     │
│  Session stored in secure memory    │
│  (handled by @clerk/react)          │
└─────────────────────────────────────┘
```

### 2. API Request with JWT

Frontend makes API call with Bearer token:

```typescript
// In frontend service (e.g., services/api.ts)
const { getToken } = useAuth();
const token = await getToken();

const response = await fetch("http://localhost:3001/api/v1/containers", {
  headers: {
    "Authorization": `Bearer ${token}`,
  }
});
```

### 3. Backend Validates Token

```
┌────────────────────────────────────────┐
│  NestJS Backend                        │
│                                        │
│  Request arrives with:                 │
│  Authorization: Bearer eyJhbGc...      │
└────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────┐
│  JwtAuthGuard (global)                 │
│                                        │
│  1. Extract token from header          │
│  2. Call validateClerkJWT(token)       │
└────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────┐
│  Clerk JWKS Endpoint                   │
│  (https://your-clerk-domain.clerk...   │
│   .accounts.com/.well-known/jwks.json) │
│                                        │
│  Validates signature using public key  │
│  ↓                                     │
│  Returns decoded JWT:                  │
│  {                                     │
│    sub: "user_123",                    │
│    email: "user@example.com",          │
│    metadata: {                         │
│      role: "owner"                     │
│    }                                   │
│  }                                     │
└────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────┐
│  Request context updated:              │
│  req.userId = "user_123"               │
│  req.role = "owner"                    │
│  ↓                                     │
│  Route handler executes                │
└────────────────────────────────────────┘
```

### 4. Token Expiry & Refresh

Clerk tokens expire **every 60 seconds** by design. The frontend handles refresh automatically:

- **Web** (@clerk/nextjs): Session cookie refreshed transparently
- **Mobile** (@clerk/clerk-expo): Token refreshed via SecureStore

**You do not need to implement refresh logic** — Clerk handles it.

---

## JWT Claims

A Clerk JWT contains:

```json
{
  "sub": "user_12345",
  "email": "owner@example.com",
  "email_verified": true,
  "metadata": {
    "role": "owner"
  },
  "iat": 1622548800,
  "exp": 1622548860,
  "iss": "https://your-clerk-domain.clerk.accounts.com",
  "aud": "your-clerk-domain"
}
```

Key claims:
- `sub` — User ID (unique per user, assigned by Clerk)
- `email` — User email
- `metadata.role` — **User's role** (owner, accountant, sales_rep, worker, driver, receiver)
- `exp` — Token expiration timestamp (60 seconds from issue)

The `role` claim is synchronized from Clerk's **public metadata** on the user object.

---

## Clerk Setup

### 1. Create Application

1. Go to https://clerk.com
2. Click **Create Application**
3. Name: `charcoal-erp`
4. Sign-in methods: **Email + Password**
5. Click **Create**

### 2. Get API Keys

From Clerk dashboard **API Keys** section:
- Copy **Publishable Key** → `VITE_CLERK_PUBLISHABLE_KEY` (frontend .env)
- Copy **Secret Key** → NOT needed for this backend (we use JWKS)

### 3. Get JWKS URL

From **API Keys** → **Advanced**:
- Find **OpenID Configuration URL**: `https://your-clerk-domain.clerk.accounts.com/.well-known/openid-configuration`
- Build JWKS endpoint: `https://your-clerk-domain.clerk.accounts.com/.well-known/jwks.json`
- Add to `apps/backend/.env`: `CLERK_JWKS_URL=<that_url>`

### 4. Create Webhook

From **Webhooks**:
1. Click **Create Endpoint**
2. URL: `http://localhost:3001/api/v1/webhooks/clerk` (or production URL)
3. Subscribe to: `user.created`, `user.updated`
4. Copy **Signing Secret** → `CLERK_WEBHOOK_SECRET` in `apps/backend/.env`

---

## Role Assignment

Roles are stored in **Clerk's public metadata** on the user object.

### Manual Assignment (Clerk Dashboard)

1. Go to Clerk dashboard → **Users**
2. Click on a user
3. Scroll to **Public Metadata** → Edit
4. Add:
   ```json
   {
     "role": "owner"
   }
   ```
5. Save

### Programmatic Assignment (API)

Endpoint: `PATCH /api/v1/users/:userId/role`

```bash
curl -X PATCH http://localhost:3001/api/v1/users/user_123/role \
  -H "Authorization: Bearer dev:owner" \
  -H "Content-Type: application/json" \
  -d '{"role": "accountant"}'
```

This:
1. Updates Clerk's public metadata via Clerk Management API
2. User's next JWT will include new role

### Available Roles

```typescript
type Role = 
  | "owner"           // Full access
  | "accountant"      // Financial only
  | "sales_rep"       // Sales only
  | "worker"          // Packing only
  | "driver"          // Delivery only
  | "receiver"        // Cash handovers
```

---

## Guard Implementation

### JwtAuthGuard (Global)

Applied to ALL routes at `src/main.ts`:

```typescript
// src/main.ts
const app = await NestFactory.create(AppModule);

app.useGlobalGuards(new JwtAuthGuard());
app.useGlobalFilters(new AllExceptionsFilter());

await app.listen(3001);
```

**What it does:**
1. Extracts `Authorization: Bearer <token>` header
2. Calls Clerk JWKS to validate signature
3. Extracts `userId` and `role` from JWT
4. Attaches to `request` object
5. Allows request to proceed (or rejects with 401/403)

**Source code:**

```typescript
// src/common/guards/jwt-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private jwksUrl: string;

  constructor(private configService: ConfigService) {
    this.jwksUrl = this.configService.get<string>("CLERK_JWKS_URL");
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException("Missing Authorization header");
    }

    // Allow dev tokens in non-production
    if (process.env.NODE_ENV !== "production" && token.startsWith("dev:")) {
      const role = token.slice(4);  // "dev:owner" → "owner"
      req.userId = `dev_${role}`;
      req.role = role;
      return true;
    }

    // Validate real JWT
    try {
      const JWKS = createRemoteJWKSet(new URL(this.jwksUrl));
      const verified = await jwtVerify(token, JWKS);

      req.userId = verified.payload.sub;
      req.role = (verified.payload.metadata as any)?.role;

      if (!req.role) {
        throw new UnauthorizedException("No role assigned to this user");
      }

      return true;
    } catch (error) {
      throw new UnauthorizedException(`Invalid JWT: ${error.message}`);
    }
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return null;
    return auth.slice(7);
  }
}
```

### RolesGuard (Optional Per-Endpoint)

Used with `@Roles()` decorator to restrict endpoints:

```typescript
// src/common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = Reflect.getMetadata("roles", context.getHandler());
    if (!requiredRoles) return true;  // No @Roles() = no restriction

    const { role } = context.switchToHttp().getRequest();
    const hasRole = requiredRoles.includes(role);

    if (!hasRole) {
      throw new ForbiddenException(
        `This action requires one of these roles: ${requiredRoles.join(", ")}`
      );
    }

    return true;
  }
}
```

Applied in controller:

```typescript
@Get("profit-loss")
@UseGuards(RolesGuard)
@Roles("owner")
getProfitLoss() { ... }
```

---

## Decorators

### @CurrentUser()

Inject current user's ID:

```typescript
@Post()
async create(@CurrentUser() userId: string, @Body() dto: CreateDTO) {
  // userId is guaranteed to be present and valid
  return this.service.create(dto, userId);
}
```

**Source:**

```typescript
import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req.userId;
  }
);
```

### @CurrentRole()

Inject current user's role:

```typescript
@Get()
async getMyData(@CurrentRole() role: string) {
  // role is "owner" | "accountant" | "sales_rep" | etc.
  return this.service.getByRole(role);
}
```

### @Roles()

Restrict endpoint to specific roles:

```typescript
@Post()
@Roles("owner", "accountant")
async createContainer(@Body() dto: CreateDTO) { ... }
```

**Source:**

```typescript
import { SetMetadata } from "@nestjs/common";

export const Roles = (...roles: string[]) => SetMetadata("roles", roles);
```

---

## Error Responses

### 401 Unauthorized

Missing or invalid JWT:

```json
{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED",
  "message": "Missing Authorization header",
  "timestamp": "2024-05-26T14:30:00.000Z",
  "path": "/api/v1/containers"
}
```

### 403 Forbidden

Valid JWT but user has wrong role:

```json
{
  "error": "Forbidden",
  "code": "FORBIDDEN",
  "message": "This action requires one of these roles: owner",
  "timestamp": "2024-05-26T14:30:00.000Z",
  "path": "/api/v1/containers"
}
```

### 403 No Role

Valid JWT but user has no role assigned:

```json
{
  "error": "Forbidden",
  "code": "NO_ROLE",
  "message": "No role assigned to this user",
  "timestamp": "2024-05-26T14:30:00.000Z",
  "path": "/api/v1/containers"
}
```

---

## Role Permission Matrix

| Action | owner | accountant | sales_rep | worker | driver | receiver |
|--------|:-----:|:----------:|:---------:|:------:|:------:|:--------:|
| **Containers** |
| View | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/Edit | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Add expenses | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Warehouse** |
| View stock | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Adjust stock | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Packing** |
| Create session | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| View sessions | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Clients** |
| Create/Edit | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| View balance | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Orders & Invoices** |
| Create order | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Create invoice | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Log payment | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Delivery** |
| Create trip | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| View own trips | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Confirm delivery | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Reports** |
| P&L (profit) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Stock value | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Client ledger | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Users** |
| Manage users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Development Bypass

In development (`NODE_ENV !== "production"`), use dev tokens to skip Clerk:

```bash
curl -H "Authorization: Bearer dev:owner" \
  http://localhost:3001/api/v1/containers
```

This:
- Bypasses JWKS validation
- Sets `req.userId` to `dev_owner`
- Sets `req.role` to `owner`

**Useful for:**
- Testing without signing in
- Scripting
- Load testing

**Never in production** — dev tokens are rejected when `NODE_ENV=production`.

---

## Webhook Handling

When a user is created or updated in Clerk, a webhook fires:

```json
{
  "data": {
    "id": "user_123",
    "email_addresses": [{"email_address": "owner@example.com"}],
    "first_name": "John",
    "last_name": "Doe",
    "public_metadata": {
      "role": "owner"
    }
  },
  "type": "user.created"
}
```

**Backend webhook handler** (`webhooks.controller.ts`) processes this:

```typescript
async handleClerkWebhook(@Body() event: ClerkWebhookEvent) {
  if (event.type === "user.created") {
    // Create matching User record in database
    await this.prisma.user.create({
      data: {
        clerkId: event.data.id,
        email: event.data.email_addresses[0].email_address,
        name: `${event.data.first_name} ${event.data.last_name}`,
        role: event.data.public_metadata.role,
      }
    });
  }
}
```

This ensures the database `users` table stays in sync with Clerk.

---

## Best Practices

1. **Always use @CurrentUser()** to get the user ID from JWT, not from request body
2. **Validate role early** with @Roles() — don't gate logic inside the service
3. **Use transactions** when multiple operations depend on role checks (don't let unauthorized state slip through)
4. **Log authentication events** for security audits (sign-in, failed attempts, role changes)
5. **Never log the full JWT** — it contains sensitive claims
6. **Rotate webhook secrets periodically** in Clerk dashboard
7. **Keep CLERK_JWKS_URL secret** on backend (never expose in frontend)
8. **Trust the JWT** once verified — don't query the database to re-check the role

---

## Testing

### Unit Test with Dev Token

```typescript
it("should list containers for owner", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/v1/containers")
    .set("Authorization", "Bearer dev:owner")
    .expect(200);

  expect(response.body).toHaveProperty("data");
});
```

### Postman

Set a variable:

```
Authorization: Bearer dev:owner
```

Use it in headers:
```
Authorization: {{Authorization}}
```

---

## Resources

- **Clerk Docs**: https://clerk.com/docs
- **JWT.io**: https://jwt.io (decode JWT to inspect claims)
- **NestJS Guards**: https://docs.nestjs.com/guards
- **JWKS Explanation**: https://tools.ietf.org/html/rfc7517

---

*For role-specific features, refer to SPEC.md. For API endpoint details, refer to the Swagger docs at `/api/docs`.*
