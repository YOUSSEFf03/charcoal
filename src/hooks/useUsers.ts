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
