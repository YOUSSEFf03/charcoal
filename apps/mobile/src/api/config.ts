/**
 * Build-time configuration. Expo inlines any `EXPO_PUBLIC_*` env var into
 * the JS bundle at build time (no extra package needed since SDK 49) — the
 * exact mechanism the mobile-app product decision already specified for the
 * shared API secret: "generated once... baked into the mobile app at build
 * time... never typed by a user, ever." That decision's own documented
 * tradeoff still applies here: this value ships inside the compiled app
 * bundle. It is never committed to source (see .env.example — the real
 * value lives only in a local, gitignored .env or an EAS secret for real
 * builds), never logged, and never rendered in any screen.
 */

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
const MOBILE_API_SECRET = process.env.EXPO_PUBLIC_MOBILE_API_SECRET;

if (!MOBILE_API_SECRET && __DEV__) {
  // A loud, one-time dev-console warning — never thrown, since the app must
  // still be able to render its "can't reach the server" error state rather
  // than crash at startup. Mirrors TraqoKeyResolver/MobileApiSecretGuard's
  // own "missing config fails cleanly, never crashes" discipline.
  // eslint-disable-next-line no-console
  console.warn(
    '[config] EXPO_PUBLIC_MOBILE_API_SECRET is not set — every API request will be rejected with 401. See .env.example.',
  );
}

export const config = {
  apiBaseUrl: API_BASE_URL,
  mobileApiSecret: MOBILE_API_SECRET,
};
