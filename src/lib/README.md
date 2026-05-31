# Frontend API Layer (`src/lib`)

This directory holds the shared infrastructure that connects the React frontend
to the NestJS backend (`http://localhost:3001`, Swagger at `/api/docs`). Before
this layer existed, every page hardcoded its data inline; now pages fetch real
data through a single Axios instance and React Query.

## Files

| File | Purpose |
|------|---------|
| `api.ts` | The single shared Axios instance. Attaches the Clerk JWT and normalizes errors. |
| `auth.ts` | `useTokenSync()` — bridges Clerk's React `useAuth()` into the non-React Axios instance. |
| `queryClient.ts` | The shared React Query `QueryClient` with app-wide defaults. |
| `types.ts` | The authoritative TypeScript surface for every request DTO and response (copied from `backend-docs/types/api.ts`). |

Data-access hooks live in `src/hooks/` (e.g. `useClients.ts`, `useMe.ts`) and
import from here.

## `api.ts` — usage

Import the instance and call it with a path **relative to `/api/v1`** (the base
URL already includes that prefix):

```ts
import { api } from '../lib/api'
import type { PaginatedResponse, Client } from '../lib/types'

const res = await api.get<PaginatedResponse<Client>>('/clients', {
  params: { page: 1, limit: 25, search: 'rawda' },
})
const clients = res.data.data // PaginatedResponse -> { data, total, page, limit }
```

Prefer the typed hooks in `src/hooks/` over calling `api` directly inside
components, so caching and refetching are handled by React Query.

### Base URL

`baseURL` comes from `VITE_API_URL`, falling back to
`http://localhost:3001/api/v1`. The backend mounts **every** route under the
global prefix `/api/v1` (except `/health` and `/webhooks/clerk`), so the prefix
is baked into the base URL — never repeat it in call paths.

### How the auth token is attached

1. On startup, `main.tsx` renders `ClerkProvider`, then `AppWithAuthSync` calls
   `useTokenSync()` (from `auth.ts`).
2. `useTokenSync()` publishes Clerk's token getter onto
   `window.__clerk_token = () => getToken()`.
3. `api.ts`'s **request interceptor** runs on every request: it `await`s
   `window.__clerk_token?.()` and, if a token exists, sets
   `Authorization: Bearer <jwt>`.

Because `api.ts` runs outside React it cannot call hooks directly — the `window`
bridge is what lets a plain module read a fresh, auto-refreshed Clerk token.
Requests made before sign-in simply go out without an `Authorization` header.

### Error normalization

The **response interceptor** rejects with a flat, predictable shape so callers
never dig through Axios internals. It mirrors the backend error envelope
(`{ error, code, details? }`) and adds the HTTP status:

```ts
{
  status?: number,                       // e.g. 403
  error: string,                         // human-readable message
  code: string,                          // machine code, e.g. "FORBIDDEN"
  details?: Record<string, string[]>,    // field-level validation errors
}
```

```ts
try {
  await api.post('/clients', body)
} catch (e) {
  const err = e as { error: string; code: string }
  showToast(err.error) // safe to surface; English message from the backend
}
```

## `queryClient.ts` — config

The shared `QueryClient` defaults for all queries:

| Option | Value | Why |
|--------|-------|-----|
| `retry` | `1` | Retry a failed query once before surfacing the error. |
| `staleTime` | `30_000` (30s) | Treat data as fresh for 30s to avoid refetch storms. |
| `refetchOnWindowFocus` | `false` | Don't refetch every time the tab regains focus. |

Mutations should call `queryClient.invalidateQueries(...)` on success to refresh
affected lists (see `src/hooks/useClients.ts`).

## Provider order (`main.tsx`)

```
ClerkProvider            // auth context — outermost
  └─ QueryClientProvider // React Query cache
       └─ ToastProvider  // existing UI toasts
            └─ App
```

`ClerkProvider` is outermost so `useTokenSync()` / `useAuth()` work anywhere
inside the tree. Set `VITE_CLERK_PUBLISHABLE_KEY` in `.env` (the app throws on
startup if it is missing).
