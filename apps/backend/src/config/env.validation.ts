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

  // Second, independent gate for the local-dev auth bypass in auth.guard.ts
  // (Authorization: Bearer dev:<role>). The bypass requires BOTH
  // NODE_ENV !== 'production' AND this set to the literal string 'true' —
  // defaults to 'false' so a forgotten or misconfigured NODE_ENV can never
  // expose the bypass on its own. Set to 'true' in your own local .env to
  // use dev tokens; never set this in any deployed environment.
  DEV_AUTH_BYPASS_ENABLED: Joi.string().valid('true', 'false').default('false'),

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

  // Comma-separated list of allowed CORS origins. Optional — defaults to the
  // Vite dev server so local development works without any configuration.
  // In production set this to the real frontend URL, e.g.
  // CORS_ORIGINS="https://app.example.com"
  // Multiple origins: CORS_ORIGINS="https://app.example.com,https://staging.example.com"
  // Do NOT use "*" together with credentials:true — browsers reject that.
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),

  // Server-side API key for Traqo Ocean (https://traqocontainer.com), used
  // by ContainerTrackingService for the "Refresh tracking" feature on
  // Container Detail. Optional — deliberately NOT required at startup:
  // container tracking is an informational add-on, and the app (including
  // core container/cost/accounting flows) must keep working with it unset.
  // When absent, refresh requests fail with a clear "not configured" error
  // instead of the server crashing. Never sent to the frontend, never logged.
  TRAQO_API_KEY: Joi.string().optional(),

  // Multi-account Traqo Ocean keys (see TraqoKeyResolver / TraqoAccount).
  // Account 1 falls back to TRAQO_API_KEY above if TRAQO_API_KEY_1 is unset
  // — this preserves continuity for the pre-existing single-account
  // deployment without forcing an env var rename. Accounts 2 and 3 have no
  // such fallback since they never existed before. All optional for the same
  // reason TRAQO_API_KEY is: an account with no configured key simply can't
  // be allocated to (excluded at the resolver level), it never crashes boot.
  TRAQO_API_KEY_1: Joi.string().optional(),
  TRAQO_API_KEY_2: Joi.string().optional(),
  TRAQO_API_KEY_3: Joi.string().optional(),

  // Optional override for Traqo's API base URL — defaults to the documented
  // production endpoint. Present for the same reason CLERK_JWKS_URL is
  // overridable (e.g. pointing at a sandbox during manual testing).
  TRAQO_BASE_URL: Joi.string().uri().default('https://traqocontainer.com/api/v1'),

  // Google Cloud project ID for the Cloud Translation API (v3 Advanced),
  // used by GoogleTranslateProvider (see apps/backend/src/translation/) to
  // build the required `projects/{id}/locations/global` resource path.
  // Optional at the Joi level (mirrors TRAQO_API_KEY's pattern above) —
  // translation is a non-critical add-on feature (see
  // TranslationController's doc comment), so the app must keep booting with
  // it unset; GoogleTranslateProvider instead fails cleanly with a clear
  // "not configured" business error at call time, never crashing the server.
  GOOGLE_CLOUD_PROJECT_ID: Joi.string().optional(),

  // Shared, high-entropy secret protecting the mobile-only endpoints (see
  // MobileApiSecretGuard) — the mobile app is a private, single-user,
  // login-free client (no Clerk session), so this static credential is its
  // entire authorization story, sent as the X-Mobile-Api-Secret header and
  // baked into the app at build time, never typed by a user. Optional at
  // the Joi level for the same reason TRAQO_API_KEY is: the mobile surface
  // is not built yet, and the rest of the server must keep booting/working
  // with this unset — MobileApiSecretGuard instead fails cleanly (503) at
  // request time. Generate with e.g. `openssl rand -base64 32`. Never log
  // this value; never commit a real one.
  MOBILE_API_SECRET: Joi.string().optional(),

  // Optional Expo push "enhanced security" access token (see
  // ExpoPushProvider) — not required for Expo's basic push-send API, so
  // left unset-safe like every other optional integration credential here.
  EXPO_ACCESS_TOKEN: Joi.string().optional(),

  // Path to a Google Cloud service-account JSON key file — standard
  // Application Default Credentials (ADC), read directly by the
  // @google-cloud/translate client library itself from this exact env var
  // name (never read/proxied by this app's own code, so no credential
  // material ever passes through it). Only needed where ADC isn't already
  // ambient: e.g. a local dev machine that hasn't run
  // `gcloud auth application-default login`. Unnecessary — leave unset — on
  // GCP-hosted infrastructure with an attached service account (Cloud Run,
  // GKE Workload Identity, etc.), which provides ADC automatically. NEVER
  // commit the file this points to.
  GOOGLE_APPLICATION_CREDENTIALS: Joi.string().optional(),
});
