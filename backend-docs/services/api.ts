// ─────────────────────────────────────────────────────────────────────────────
// Base API Client
// Axios instance with Clerk JWT injection, error normalization, and retries.
// All service files import from here.
// ─────────────────────────────────────────────────────────────────────────────

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import type { ApiError } from "../types/api";

// Clerk's useAuth hook gives us getToken(). We can't import hooks here since
// this file runs outside React — callers must inject the token getter.
let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>) {
  _getToken = fn;
}

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${baseURL}/api/v1`,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 15_000,
});

// ── Request interceptor — inject Clerk JWT ────────────────────────────────────
apiClient.interceptors.request.use(async (config) => {
  if (_getToken) {
    const token = await _getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// ── Response interceptor — normalize errors ───────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response) {
      const apiError: ApiError = error.response.data ?? {
        error: "An unexpected error occurred",
        code: "UNKNOWN_ERROR",
      };
      return Promise.reject(apiError);
    }
    if (error.request) {
      return Promise.reject({
        error: "Network error — check your connection",
        code: "NETWORK_ERROR",
      } satisfies ApiError);
    }
    return Promise.reject({
      error: error.message,
      code: "REQUEST_ERROR",
    } satisfies ApiError);
  }
);

// ── Generic typed helpers ──────────────────────────────────────────────────────

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.get<T>(url, config);
  return res.data;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.post<T>(url, data, config);
  return res.data;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.put<T>(url, data, config);
  return res.data;
}

export async function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.patch<T>(url, data, config);
  return res.data;
}

export async function del<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.delete<T>(url, config);
  return res.data;
}

// ── Query string builder ──────────────────────────────────────────────────────
export function buildQuery(params: Record<string, unknown>): string {
  const filtered = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (!filtered.length) return "";
  return "?" + new URLSearchParams(filtered.map(([k, v]) => [k, String(v)])).toString();
}
