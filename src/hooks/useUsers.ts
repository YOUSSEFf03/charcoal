import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { User, Role, PaginatedResponse } from '../types/api'

/** Query params accepted by GET /users (owner only). */
export interface UsersQuery {
  page?: number
  limit?: number
  role?: Role
}

const usersKey = (params?: UsersQuery) => ['users', params ?? {}] as const

/**
 * List all users (owner only, paginated).
 * @param params - pagination filters
 * @returns React Query result of PaginatedResponse<User>
 * GET /users
 */
/** A minimal user row — GET /users/receivers never returns email/phone. */
export interface CashReceiver {
  id: string
  name: string
  role: Role
}

/**
 * Every user who can be a cash payment receiver (owner/accountant/sales_rep/
 * worker/receiver), unbounded, id/name/role only. Unlike useUsers(), this is
 * NOT owner-only — every page that logs a payment (Payment, Invoices,
 * ClientDetail, WarehouseSales) has no role restriction of its own, and a
 * worker now has a real linked User (see the add_worker_user_link migration),
 * so this is the single source of truth for "received by" pickers — replaces
 * the old pattern of combining useWorkers() + useReceivers() + a hardcoded
 * fake "Owner" option, which only ever resolved a real id for the
 * role='receiver' subset.
 * GET /users/receivers
 */
export function useCashReceivers() {
  return useQuery({
    queryKey: ['users', 'receivers'],
    queryFn: async () => {
      const res = await api.get<CashReceiver[]>('/users/receivers')
      return res.data
    },
  })
}

export function useUsers(params?: UsersQuery) {
  return useQuery({
    queryKey: usersKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<User>>('/users', { params })
      return res.data
    },
  })
}

/**
 * Change a user's role (owner only).
 * PATCH /users/:id/role
 */
export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) => {
      const res = await api.patch<User>(`/users/${id}/role`, { role })
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['users', id] })
    },
  })
}

/**
 * Create a local (non-Clerk) user — receivers, internal accounts.
 * POST /users
 */
export function useCreateLocalUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; role: Role; phone?: string }) => {
      const res = await api.post<User>('/users', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * Update a user's display name and optional phone/label.
 * PATCH /users/:id/name
 */
export function useUpdateUserName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name, phone }: { id: string; name: string; phone?: string | null }) => {
      const res = await api.patch<User>(`/users/${id}/name`, { name, phone })
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['users', id] })
    },
  })
}

/**
 * Delete a local user (must have clerkId starting with 'local_').
 * DELETE /users/:id
 */
export function useDeleteLocalUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/users/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
