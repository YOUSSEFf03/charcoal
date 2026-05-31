import * as Joi from 'joi';

/**
 * Joi schema for environment variables.
 *
 * Wired into ConfigModule.forRoot in app.module.ts. With
 * validationOptions.abortEarly = true the server fails fast on the first
 * missing/invalid variable at startup rather than surfacing errors later at
 * request time.
 *
 * required()  — startup aborts if absent.
 * optional w/ default — safe to omit; the default is applied.
 */
export const envValidationSchema = Joi.object({
  // Node runtime environment. Not strictly required by code today, but
  // validating it keeps deployments explicit.
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Postgres connection string consumed by Prisma. Required — the app cannot
  // function without a database.
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),

  // Server-side Clerk key consumed by @clerk/clerk-sdk-node at SDK init.
  // Required for user-management calls (e.g. updating role metadata).
  CLERK_SECRET_KEY: Joi.string().required(),

  // Svix shared secret used to verify Clerk webhook signatures.
  CLERK_WEBHOOK_SECRET: Joi.string().required(),

  // Clerk JWKS endpoint used to verify session JWTs. Optional: the code
  // falls back to the Clerk default, but prod instances usually set this.
  CLERK_JWKS_URL: Joi.string()
    .uri()
    .default('https://api.clerk.com/v1/jwks'),

  // Frontend (Vite) Clerk publishable key. Not consumed by the backend, but
  // it lives in the shared .env, so it is allowed and documented here.
  // Optional on purpose — requiring it would impose a false constraint on the
  // backend.
  CLERK_PUBLISHABLE_KEY: Joi.string().optional(),

  // HTTP port. Optional with a default for local dev; platforms typically
  // inject this in production.
  PORT: Joi.number().port().default(3001),
});
