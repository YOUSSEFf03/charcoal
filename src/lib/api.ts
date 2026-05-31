import axios from 'axios'
import { devToken } from './devAuth'

// Single shared Axios instance for the whole app.
// baseURL points at the NestJS backend. The backend mounts every route under
// the global prefix `/api/v1` (see backend-docs/API.md), so VITE_API_URL must
// include that prefix. The fallback below keeps local dev working out of the box.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1',
})

// Request interceptor: attach the Clerk JWT to every outgoing request.
// `window.__clerk_token` is installed by useTokenSync() (see lib/auth.ts) once
// ClerkProvider has mounted, so calls made before sign-in simply go without a token.
api.interceptors.request.use(async (config) => {
  const dt = devToken()
  if (dt) {
    config.headers.Authorization = `Bearer ${dt}`
    return config
  }
  const token = await window.__clerk_token?.()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Response interceptor: normalize every error to { status, error, code, details }
// so callers never have to dig through Axios's nested error shape. This matches
// the backend's error envelope: { error, code, details? }.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const data = err.response?.data
    return Promise.reject({
      status: err.response?.status,
      error: data?.error || 'Unknown error',
      code: data?.code || 'UNKNOWN',
      details: data?.details,
    })
  }
)
