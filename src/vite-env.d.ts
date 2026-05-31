/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Installed by useTokenSync() (lib/auth.ts) so the Axios request interceptor in
// lib/api.ts can fetch a fresh Clerk JWT without importing React hooks.
interface Window {
  __clerk_token?: () => Promise<string | null>
}
