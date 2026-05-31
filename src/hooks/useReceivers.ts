import { useCallback } from 'react'
import { useUsers, useCreateLocalUser, useUpdateUserName, useDeleteLocalUser } from './useUsers'

export interface Receiver {
  id: string
  name: string
  role: string // always 'receiver'
}

/**
 * Receivers are Users with role='receiver' stored in the database.
 * Replaces the old localStorage-based implementation.
 *
 * The hook exposes the same { receivers, add, remove, update } API as before
 * so all existing callers (CashHandover, ClientDetail, FillClientDetail,
 * WarehouseSales, Settings) work without changes.
 */
export function useReceivers() {
  const usersQ = useUsers({ role: 'receiver', limit: 100 })
  const createMutation  = useCreateLocalUser()
  const updateMutation  = useUpdateUserName()
  const deleteMutation  = useDeleteLocalUser()

  const receivers: Receiver[] = (usersQ.data?.data ?? []).map(u => ({
    id: u.id,
    name: u.name,
    role: 'receiver',
  }))

  const add = useCallback((name: string, _roleLabel?: string) => {
    createMutation.mutate({ name, role: 'receiver' })
  }, [createMutation])

  const remove = useCallback((id: string) => {
    deleteMutation.mutate(id)
  }, [deleteMutation])

  const update = useCallback((id: string, name: string, _roleLabel?: string) => {
    updateMutation.mutate({ id, name })
  }, [updateMutation])

  return {
    receivers,
    add,
    remove,
    update,
    isLoading: usersQ.isLoading,
  }
}
