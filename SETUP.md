# Charcoal Import ERP — Local Setup Guide

This guide walks you through setting up the complete development environment for the charcoal import, warehousing, and distribution system.

**Stack:**
- **Backend**: NestJS (TypeScript) at `apps/backend`, port 3001, global API prefix `/api/v1`
- **Frontend**: Vite + React SPA at `src/`, port 5173
- **Database**: PostgreSQL (local via Docker or Railway)
- **ORM**: Prisma
- **Authentication**: Clerk JWT (Authorization: Bearer header)
- **Package Manager**: npm (monorepo workspaces)

---

## Prerequisites

Before starting, install:

- **Node.js 18+** — https://nodejs.org
- **Git** — https://git-scm.com
- **Docker & Docker Compose** — https://docker.com (for local PostgreSQL)
- **VS Code** or **Cursor** — https://cursor.sh (recommended)
- **Clerk account** — https://clerk.com (free tier is fine)
- **Postman** (optional) — https://postman.com (for API testing)

Verify installations:
```bash
node --version    # v18.x.x or higher
git --version
docker --version
docker compose --version
```

---

## Step 1 — Clone the Repository

```bash
git clone <repository-url> charcoal-erp
cd charcoal-erp
```

---

## Step 2 — Install Dependencies

From the repo root, install all workspaces:

```bash
npm install
```

This installs:
- Root-level dev dependencies
- `apps/backend` NestJS dependencies
- `src/` (frontend) React + Vite dependencies
- Shared types and utilities

---

## Step 3 — Set Up PostgreSQL

### Local Development (Docker)

Start PostgreSQL in a container:

```bash
docker compose up -d
```

Verify it's running:
```bash
docker compose ps
```

You should see `charcoal_db` running on `localhost:5432`.

### Production (Railway)

If deploying to Railway, get your production `DATABASE_URL` from the Railway dashboard and set it in `apps/backend/.env` before running migrations.

---

## Step 4 — Environment Variables

### Backend (.env)

Create `apps/backend/.env`:

```env
# Database
DATABASE_URL="postgresql://charcoal:charcoal_secret@localhost:5432/charcoal_dev"

# Clerk JWT validation
CLERK_JWKS_URL="https://your-clerk-domain.clerk.accounts.com/.well-known/jwks.json"
CLERK_WEBHOOK_SECRET="whsec_your_webhook_secret_here"

# Environment
NODE_ENV="development"

# Required (in addition to NODE_ENV) to enable the dev auth bypass below —
# defense-in-depth so a forgotten/misconfigured NODE_ENV alone can't expose
# it. Set to "true" for local dev; NEVER set this in a deployed environment.
DEV_AUTH_BYPASS_ENABLED="true"
```

**Get these values from:**
- `DATABASE_URL`: Docker Compose service (see `docker-compose.yml`) or Railway
- `CLERK_JWKS_URL` and `CLERK_WEBHOOK_SECRET`: Clerk dashboard → API Keys

### Frontend (.env)

Create `.env` at repo root (for Vite):

```env
VITE_API_URL=http://localhost:3001/api/v1
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

**Get `VITE_CLERK_PUBLISHABLE_KEY` from** Clerk dashboard → API Keys.

---

## Step 5 — Database Setup

### Create Tables

From `apps/backend/`:

```bash
cd apps/backend
npx prisma migrate dev --name init
```

This:
1. Creates all 30 tables (users, containers, stock_lots, clients, invoices, etc.)
2. Applies all constraints
3. Generates Prisma client

### Verify Tables

Open Prisma Studio:

```bash
npx prisma studio
```

This opens a visual database browser at `http://localhost:5555`. Confirm all tables are present.

### Seed Data (Optional)

Populate baseline test data:

```bash
npx prisma db seed
```

This creates:
- 5 test users (owner, accountant, sales_rep, worker, driver)
- 3 bag types (2kg, 5kg, 10kg)
- 2 suppliers
- 1 container with 2 product lines
- 1 stock lot (5000 kg of charcoal)

---

## Step 6 — Configure Clerk

### Create Clerk Application

1. Go to https://clerk.com and log in
2. Click **Create Application**
3. Name it `charcoal-erp`
4. Enable **Email + Password** as sign-in method
5. Click **Create**

### Copy API Keys

From **API Keys** page:
- Copy `CLERK_PUBLISHABLE_KEY` → paste into `.env` as `VITE_CLERK_PUBLISHABLE_KEY`
- Copy `CLERK_SECRET_KEY` → NOT needed for this stack (backend validates via JWKS)

### Get JWKS URL

From **API Keys** → **Advanced** section, copy the **OpenID Configuration URL**. It looks like:
```
https://your-clerk-domain.clerk.accounts.com/.well-known/openid-configuration
```

Extract the domain and use it to build the JWKS endpoint for `CLERK_JWKS_URL`:
```
https://your-clerk-domain.clerk.accounts.com/.well-known/jwks.json
```

### Set Up Webhook

1. Go to **Webhooks** → **Create Endpoint**
2. Set endpoint URL to `http://localhost:3001/api/v1/webhooks/clerk` (or your deployment URL)
3. Subscribe to: `user.created`, `user.updated`
4. Copy `Signing Secret` → paste into `apps/backend/.env` as `CLERK_WEBHOOK_SECRET`

### Assign Roles

After creating your first user in Clerk:

1. Go to **Users** → select your user
2. Scroll to **Public metadata** → edit
3. Add:
   ```json
   {
     "role": "owner"
   }
   ```
4. Save

Available roles: `owner`, `accountant`, `sales_rep`, `worker`, `driver`, `receiver`

---

## Step 7 — Run the Backend

From `apps/backend/`:

```bash
npm run start:dev
```

The backend starts on `http://localhost:3001`.

**Test it:**
```bash
curl http://localhost:3001/api/v1/health
```

Expected response:
```json
{ "status": "ok", "database": "connected" }
```

**Swagger API docs:**
```
http://localhost:3001/api/docs
```

All endpoints are documented here with request/response examples.

---

## Step 8 — Run the Frontend

From repo root:

```bash
npm run dev
```

The frontend starts on `http://localhost:5173`.

Open http://localhost:5173 in your browser.

You should see the Clerk sign-in screen. Log in with your Clerk user (the one you assigned the `owner` role to).

---

## Step 9 — Verify the Full Stack

1. **Backend running?**
   ```bash
   curl http://localhost:3001/api/v1/health
   # Expected: { "status": "ok" }
   ```

2. **Database connected?**
   ```bash
   curl http://localhost:3001/api/v1/health
   # Look for: "database": "connected"
   ```

3. **Frontend loading?**
   - Open http://localhost:5173
   - Should see Clerk sign-in

4. **Clerk sign-in working?**
   - Sign in with your Clerk credentials
   - Redirect to dashboard

5. **API calls working?**
   - Open browser DevTools → Network
   - Navigate around the app
   - Should see requests to `http://localhost:3001/api/v1/...`

---

## Daily Development Commands

```bash
# Start database (if not already running)
docker compose up -d

# Start backend (from apps/backend/)
npm run start:dev

# Start frontend (from repo root)
npm run dev

# After changing schema.prisma
cd apps/backend
npx prisma migrate dev --name describe_your_change
npx prisma generate

# Open Prisma Studio (visual DB browser)
npx prisma studio

# Reset database to clean state (DEVELOPMENT ONLY)
npx prisma migrate reset
```

---

## Authentication

### For Web

1. User signs in via Clerk UI
2. Clerk issues a session JWT
3. Frontend calls `getToken()` to retrieve it
4. Frontend sends: `Authorization: Bearer <token>`
5. Backend validates the token via Clerk JWKS endpoint
6. Backend extracts userId and role from token claims
7. Role-based guards control access to endpoints

### Development Auth Bypass

With `NODE_ENV !== production` **and** `DEV_AUTH_BYPASS_ENABLED=true` both set, you can use dev tokens:

```bash
Authorization: Bearer dev:owner
```

This is useful for testing without signing in every time. Valid dev roles: `owner`, `accountant`, `sales_rep`, `worker`, `driver`.

Both conditions are required — neither `NODE_ENV` nor `DEV_AUTH_BYPASS_ENABLED` alone can enable the bypass. `DEV_AUTH_BYPASS_ENABLED` defaults to `false`, so it must be explicitly set in your local `.env`.

**NEVER set `DEV_AUTH_BYPASS_ENABLED=true` in production.**

---

## Troubleshooting

### Database Connection Failed

**Problem**: `error connect ECONNREFUSED 127.0.0.1:5432`

**Solution**:
1. Check Docker is running: `docker ps`
2. Check PostgreSQL container is running: `docker compose ps`
3. If not running: `docker compose up -d`
4. Verify `DATABASE_URL` in `apps/backend/.env` matches Docker config

### Clerk JWT Validation Fails

**Problem**: `401 Unauthorized` on all requests

**Solution**:
1. Verify `CLERK_JWKS_URL` is set correctly in `apps/backend/.env`
2. Verify user has a role assigned in Clerk dashboard (Metadata tab)
3. Try using a dev token: `Authorization: Bearer dev:owner`

### Prisma Migration Fails

**Problem**: `Error: P3008`

**Solution**:
```bash
cd apps/backend
npx prisma generate  # Regenerate client
npx prisma migrate resolve  # Resolve migration conflict if needed
```

### Frontend Can't Reach API

**Problem**: `CORS error` or `net::ERR_CONNECTION_REFUSED`

**Solution**:
1. Check backend is running: `curl http://localhost:3001/api/v1/health`
2. Check `VITE_API_URL=http://localhost:3001/api/v1` in `.env`
3. Hard refresh browser (Ctrl+Shift+R)
4. Check DevTools → Network for actual request URL

---

## File Checklist

Before considering setup complete, verify these files exist:

- [ ] `.env` (repo root) — `VITE_API_URL`, `VITE_CLERK_PUBLISHABLE_KEY`
- [ ] `apps/backend/.env` — `DATABASE_URL`, `CLERK_JWKS_URL`, `CLERK_WEBHOOK_SECRET`, `NODE_ENV`, `DEV_AUTH_BYPASS_ENABLED`
- [ ] `docker-compose.yml` (repo root) — defines PostgreSQL service
- [ ] `apps/backend/prisma/schema.prisma` — all 30 models defined
- [ ] `apps/backend/package.json` — NestJS dependencies installed
- [ ] `package.json` (repo root) — React + Vite dependencies installed
- [ ] Prisma migrations run: `apps/backend/prisma/migrations/` folder non-empty

---

## Next Steps

Once setup is complete:

1. **Read the SPEC** — `SPEC.md` covers all business logic and workflows
2. **Explore the API** — Swagger docs at http://localhost:3001/api/docs
3. **Review the schema** — `apps/backend/prisma/schema.prisma`
4. **Read auth docs** — `backend-docs/AUTH.md`
5. **Check backend structure** — `backend-docs/BACKEND_STRUCTURE.md`

---

*For issues, check the Troubleshooting section above or review the SPEC.md for business logic context.*
