# Charcoal Business API (Backend)

NestJS API for the Charcoal Business Accounting System.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in real values
npm run start:dev
```

The API listens on `PORT` (default `3001`). Swagger docs are served at
`/api/docs`.

## Environment variables

Environment variables are validated at startup with [Joi](https://joi.dev)
(wired into `ConfigModule.forRoot` in `src/app.module.ts`). Application code
reads configuration through `ConfigService` rather than `process.env` directly.

> **The server will throw an error on startup if any required env var is
> missing** (or invalid). Validation runs with `abortEarly: true`, so the boot
> fails fast on the first offending variable.

| Variable | Required | Description | Example value |
|---|:---:|---|---|
| `DATABASE_URL` | Yes | Postgres connection string used by Prisma. | `postgresql://user:password@localhost:5432/charcoal` |
| `CLERK_SECRET_KEY` | Yes | Server-side Clerk API key (used by `@clerk/clerk-sdk-node`). Use `sk_live_...` in production. | `sk_test_...` |
| `CLERK_WEBHOOK_SECRET` | Yes | Svix signing secret used to verify Clerk webhook signatures. | `whsec_...` |
| `CLERK_JWKS_URL` | No | Clerk JWKS endpoint used to verify session JWTs. Defaults to `https://api.clerk.com/v1/jwks`. | `https://your-app.clerk.accounts.dev/.well-known/jwks.json` |
| `CLERK_PUBLISHABLE_KEY` | No | Frontend (Vite) Clerk publishable key. Not consumed by the backend, but shared via `.env`. Use `pk_live_...` in production. | `pk_test_...` |
| `NODE_ENV` | No | Runtime environment: `development`, `production`, or `test`. Defaults to `development`. | `development` |
| `PORT` | No | HTTP port the API listens on. Defaults to `3001`. | `3001` |

See [`.env.example`](./.env.example) for a copy-paste template.

### Adding a new environment variable

1. Add it to the Joi schema in `src/config/env.validation.ts` (mark
   `.required()` or give it a default).
2. Map it into the typed config object in `src/config/configuration.ts`.
3. Document it in `.env.example` and in the table above.
4. Read it via `ConfigService.get(...)` — never via `process.env` directly.
