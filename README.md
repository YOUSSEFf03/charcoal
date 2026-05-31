# Charcoal Business Accounting System

## Database

PostgreSQL 16 running via Docker. Managed with Prisma ORM.

### Quick Start

```bash
# Start the database
docker compose up -d

# Verify it's running
docker compose ps
```

### Daily Workflow

```bash
# Start DB (if not already running)
docker compose up -d

# After changing schema.prisma — create and apply migration
cd apps/backend
npx prisma migrate dev --name describe_your_change

# Regenerate Prisma client after schema changes
npx prisma generate

# Open Prisma Studio (visual DB browser at http://localhost:5555)
npx prisma studio

# Re-seed the database
npx prisma db seed
```

### Reset Everything (local dev)

```bash
cd apps/backend
npx prisma migrate reset   # drops DB, re-runs all migrations, re-seeds
```

> ⚠️ This destroys all local data. Safe for development only.

### Switch to Production (Railway)

1. Get your Railway `DATABASE_URL` from the Railway dashboard
2. Set it in `apps/backend/.env`:
   ```
   DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db>?sslmode=require"
   ```
3. Run migrations against production:
   ```bash
   cd apps/backend
   npx prisma migrate deploy
   ```

> Never run `prisma migrate dev` or `prisma migrate reset` against production.

### Seed Data (local only)

The seed script populates baseline test data:
- 5 users (owner, accountant, sales_rep, worker, driver)
- 3 bag types (2kg, 5kg, 10kg)
- 2 suppliers
- 1 container with 2 product lines
- 1 stock lot (5000 kg)

Run: `cd apps/backend && npx prisma db seed`

### Migrations

Migration files live in `apps/backend/prisma/migrations/` and must be committed to git.

| Migration | Description |
|-----------|-------------|
| `20260527075241_init` | All 23 tables, enums, indexes |
| `20260527075255_add_check_constraints` | CHECK constraints: `kgRemaining >= 0`, `quantity >= 0` |

### Connection

Local Docker:
```
postgresql://charcoal:charcoal_secret@localhost:5432/charcoal_dev
```

> **WSL2 note:** If a local PostgreSQL instance is already bound to port 5432, use the WSL2 bridge IP instead of `localhost`. Run `docker inspect charcoal_db` to find the container's IP.
