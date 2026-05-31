# Authentication & Authorization

## Stack
- **Provider**: Clerk (https://clerk.com)
- **Token type**: JWT (Clerk-issued)
- **Role storage**: `publicMetadata.role` on each Clerk User object
- **Transport**: `Authorization: Bearer <token>` header on every protected request

---

## Authentication Flow

### 1. User signs in (web)
```
User submits credentials → Clerk validates → Clerk issues session JWT
→ @clerk/nextjs stores token in cookie
→ useAuth().getToken() returns the JWT on demand
```

### 2. Frontend sends a request
```
const { getToken } = useAuth();
const token = await getToken();
fetch("/api/v1/containers", {
  headers: { Authorization: `Bearer ${token}` }
});
```
The `setTokenProvider` in `services/api.ts` wires this automatically for all axios calls.

### 3. Backend validates the token (Next.js API route)
```typescript
import { getAuth } from "@clerk/nextjs/server";

export async function GET(req: Request) {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });

  const role = (sessionClaims?.metadata as { role?: string })?.role;
  if (!role) return Response.json({ error: "No role assigned", code: "NO_ROLE" }, { status: 403 });

  // proceed with role-gated logic
}
```

### 4. Mobile (Expo) flow
```
Expo app → @clerk/clerk-expo → SecureStore caches token
→ getToken() works the same way
→ Same Authorization header pattern
```

---

## Token Expiration & Refresh

Clerk handles token refresh automatically:
- Web: `@clerk/nextjs` middleware refreshes the session cookie transparently
- Mobile: `@clerk/clerk-expo` manages the token lifecycle via `SecureStore`
- **You do NOT need to implement refresh logic** — Clerk does it

Default JWT expiry: **60 seconds** (Clerk rotates frequently for security)  
Session lifetime: configurable in Clerk dashboard (default: 7 days inactivity)

---

## Role Assignment

Roles are stored in Clerk's `publicMetadata` on the user object:

```json
{
  "role": "owner"
}
```

**To assign a role:**
1. Clerk dashboard → Users → select user → Metadata tab
2. Under Public metadata, set: `{ "role": "owner" }`
3. Available values: `owner | accountant | sales_rep | worker | driver`

**Programmatic assignment** (owner-only API endpoint):
```
PATCH /api/v1/users/:id/role
Body: { "role": "sales_rep" }
```
This calls the Clerk Management API server-side to update `publicMetadata.role`.

---

## User Sync (Clerk → Database)

When a user is created in Clerk, a matching `User` record is created in PostgreSQL via webhook.

**Webhook endpoint**: `POST /api/webhooks/clerk`  
**Events handled**: `user.created`, `user.updated`

The database `User` model stores:
- `clerkId` — Clerk's user ID (unique, used for lookups)
- `email`, `name`, `role` — mirrored from Clerk
- `phone` — optional

**Important**: The `role` in the database must stay in sync with Clerk's `publicMetadata.role`. Always update both via the role-change API endpoint, not directly in the DB.

---

## Role Permission Matrix

| Resource / Action                  | owner | accountant | sales_rep | worker | driver |
|------------------------------------|:-----:|:----------:|:---------:|:------:|:------:|
| **Containers**                                                                       |
| View containers                    |  ✅   |     ✅     |    ✅     |   ❌   |   ❌   |
| Create/edit containers             |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| Add/edit expenses                  |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| View cost_per_kg                   |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| **Warehouse / Stock**                                                                |
| View stock lots                    |  ✅   |     ✅     |    ✅     |   ✅   |   ❌   |
| View cost_per_kg on lots           |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| Create direct stock lot            |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| Manage bag types                   |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| Log bag purchases                  |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| View packed stock counts           |  ✅   |     ✅     |    ✅     |   ✅   |   ❌   |
| **Packing Sessions**                                                                 |
| Create packing session             |  ✅   |     ❌     |    ❌     |   ✅   |   ❌   |
| View all packing sessions          |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| View own packing sessions          |  ✅   |     ❌     |    ❌     |   ✅   |   ❌   |
| **Stock Adjustments**                                                                |
| Trigger physical count             |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| Approve stock adjustments          |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| **Clients**                                                                          |
| View/create/edit clients           |  ✅   |     ❌     |    ✅     |   ❌   |   ❌   |
| View client balance                |  ✅   |     ✅     |    ✅     |   ❌   |   ❌   |
| View CRM overdue alerts            |  ✅   |     ❌     |    ✅     |   ❌   |   ❌   |
| **Orders & Invoicing**                                                               |
| Create/view orders                 |  ✅   |     ❌     |    ✅     |   ❌   |   ❌   |
| Create invoices                    |  ✅   |     ✅     |    ✅     |   ❌   |   ❌   |
| Cancel invoices                    |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| Log payments                       |  ✅   |     ✅     |    ✅     |   ❌   |   ❌   |
| View invoices/payments             |  ✅   |     ✅     |    ✅     |   ❌   |   ❌   |
| **Delivery**                                                                         |
| Create shipments                   |  ✅   |     ❌     |    ✅     |   ❌   |   ❌   |
| Create driver trips                |  ✅   |     ❌     |    ✅     |   ❌   |   ❌   |
| View own trips                     |  ✅   |     ❌     |    ❌     |   ❌   |   ✅   |
| Log actual weight                  |  ✅   |     ❌     |    ❌     |   ❌   |   ✅   |
| Confirm delivery                   |  ✅   |     ❌     |    ❌     |   ❌   |   ✅   |
| Log returns                        |  ✅   |     ❌     |    ❌     |   ❌   |   ✅   |
| Log trip expenses (fuel etc.)      |  ✅   |     ❌     |    ❌     |   ❌   |   ✅   |
| **Non-sale stock exits**                                                             |
| Log sample/gift/internal exits     |  ✅   |     ❌     |    ✅     |   ✅   |   ❌   |
| **Reports**                                                                          |
| P&L report (with gross profit)     |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| Stock value report                 |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| Variance report                    |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| Container cost report              |  ✅   |     ✅     |    ❌     |   ❌   |   ❌   |
| Client ledger report               |  ✅   |     ✅     |    ✅     |   ❌   |   ❌   |
| Worker earnings report             |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| **Users & Settings**                                                                 |
| Manage users (add/change roles)    |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |
| View users list                    |  ✅   |     ❌     |    ❌     |   ❌   |   ❌   |

---

## Protected vs Public Routes

### Public (no auth required)
```
POST /api/webhooks/clerk          — Clerk user sync webhook
GET  /api/v1/health               — Health check
```

### Protected (Bearer JWT required)
All other `/api/v1/*` routes require a valid Clerk JWT.

---

## Backend Middleware Pattern (Next.js App Router)

```typescript
// lib/auth.ts — reusable middleware helpers

import { getAuth } from "@clerk/nextjs/server";
import type { Role } from "@/types";

export function withAuth(
  handler: (req: Request, context: { userId: string; role: Role }) => Promise<Response>,
  allowedRoles?: Role[]
) {
  return async (req: Request) => {
    const { userId, sessionClaims } = getAuth(req);

    if (!userId) {
      return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }

    const role = (sessionClaims?.metadata as { role?: Role })?.role;
    if (!role) {
      return Response.json({ error: "No role assigned", code: "NO_ROLE" }, { status: 403 });
    }

    if (allowedRoles && !allowedRoles.includes(role)) {
      return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    return handler(req, { userId, role });
  };
}

// Usage in a route:
// export const GET = withAuth(async (req, { userId, role }) => {
//   // role is guaranteed to be one of the allowedRoles
// }, ["owner", "accountant"]);
```

---

## Error Response Format (Auth errors)

```json
// 401 — Not authenticated
{ "error": "Unauthorized", "code": "UNAUTHORIZED" }

// 403 — Authenticated but wrong role
{ "error": "Forbidden", "code": "FORBIDDEN" }

// 403 — No role assigned yet
{ "error": "No role assigned to this user", "code": "NO_ROLE" }
```
