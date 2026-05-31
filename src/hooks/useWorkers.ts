import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Worker,
  CreateWorkerDto,
  UpdateWorkerRatesDto,
  CreateWorkerPaymentDto,
  WorkerPayment,
} from '../types/api'

/**
 * List all workers (totalOwed computed).
 * @returns React Query result of Worker[]
 * GET /workers
 */
export function useWorkers() {
  return useQuery({
    queryKey: ['workers', {}],
    queryFn: async () => {
      const res = await api.get<{ data: Worker[] }>('/workers')
      return res.data.data
    },
  })
}

/**
 * Fetch one worker.
 * @param id - worker UUID
 * @returns React Query result of Worker
 * GET /workers/:id
 */
export function useWorker(id: string) {
  return useQuery({
    queryKey: ['workers', id],
    queryFn: async () => {
      const res = await api.get<Worker>(`/workers/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Create a worker.
 * @returns mutation accepting CreateWorkerDto
 * POST /workers
 */
export function useCreateWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateWorkerDto) => {
      const res = await api.post<Worker>('/workers', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

/**
 * Delete a worker permanently.
 * DELETE /workers/:id
 */
export function useDeleteWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/workers/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

/**
 * Update a worker's name, phone, or notes.
 * @returns mutation accepting { id, body: { name?, phone?, notes? } }
 * PATCH /workers/:id
 */
export function useUpdateWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { name?: string; phone?: string | null; notes?: string | null } }) => {
      const res = await api.patch<Worker>(`/workers/${id}`, body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

/**
 * Replace a worker's per-bag-type rate array.
 * @returns mutation accepting { id, body: UpdateWorkerRatesDto }
 * PATCH /workers/:id/rates
 */
export function useUpdateWorkerRates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: UpdateWorkerRatesDto
    }) => {
      const res = await api.patch<Worker>(`/workers/${id}/rates`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}

/**
 * Log a payment to a worker (increments worker.totalPaid).
 * @returns mutation accepting { id, body: CreateWorkerPaymentDto }
 * POST /workers/:id/payments
 */
export function useLogWorkerPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CreateWorkerPaymentDto
    }) => {
      const res = await api.post<WorkerPayment>(`/workers/${id}/payments`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}
