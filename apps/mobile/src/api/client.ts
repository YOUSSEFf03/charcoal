import axios from 'axios';
import { config } from './config';
import type { ApiErrorShape } from './types';

/**
 * Single shared Axios instance, mirroring the web app's `src/lib/api.ts`
 * pattern. The only real difference is the auth mechanism: the web app
 * attaches a Clerk JWT per-request; this app has no per-user identity at
 * all, so it attaches the static shared secret baked in at build time
 * (see config.ts) as `X-Mobile-Api-Secret` — the exact header name and
 * verification scheme `MobileApiSecretGuard` expects on the backend.
 */
export const api = axios.create({
  baseURL: config.apiBaseUrl,
});

api.interceptors.request.use((req) => {
  if (config.mobileApiSecret) {
    req.headers.set('X-Mobile-Api-Secret', config.mobileApiSecret);
  }
  return req;
});

// Normalize every error to the backend's own envelope shape so callers never
// have to dig through Axios's nested error object. Mirrors the web client's
// response interceptor exactly.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const data = err.response?.data;
    const shape: ApiErrorShape = {
      status: err.response?.status,
      error: data?.error || (err.request ? 'Network error' : 'Unknown error'),
      code: data?.code || (err.request ? 'NETWORK_ERROR' : 'UNKNOWN'),
      details: data?.details,
    };
    return Promise.reject(shape);
  },
);
