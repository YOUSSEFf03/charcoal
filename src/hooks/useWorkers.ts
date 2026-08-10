import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Worker,
  CreateWorkerDto,
  UpdateWorkerRatesDto,
  CreateWorkerPaymentDto,
  WorkerPayment,
  WorkerEarning,
  CreateWorkerEarningDto,
  UpdateWorkerEarningDto,
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

/**
 * List payments for a worker (paginated).
 * @param workerId - worker UUID (skip query if undefined)
 * @returns React Query result of WorkerPayment[]
 * GET /workers/:id/payments
 */
export function useWorkerPayments(workerId: string | undefined) {
  return useQuery({
    queryKey: ['workers', workerId, 'payments'],
    queryFn: async () => {
      const res = await api.get<{ data: WorkerPayment[] }>(`/workers/${workerId}/payments`, {
        params: { limit: 20 },
      })
      return res.data.data
    },
    enabled: Boolean(workerId),
  })
}

/**
 * List earnings entries for a worker (paginated, newest first).
 * @param workerId - worker UUID (skip query if undefined)
 * @returns React Query result of WorkerEarning[]
 * GET /workers/:id/earnings
 */
export function useWorkerEarnings(workerId: string | undefined) {
  return useQuery({
    queryKey: ['workers', workerId, 'earnings'],
    queryFn: async () => {
      const res = await api.get<{ data: WorkerEarning[] }>(`/workers/${workerId}/earnings`, {
        params: { limit: 50 },
      })
      return res.data.data
    },
    enabled: Boolean(workerId),
  })
}

/**
 * Log an earnings entry for a worker (daily wage, bonus, deduction, etc.).
 * @returns mutation accepting { id, body: CreateWorkerEarningDto }
 * POST /workers/:id/earnings
 */
export function useCreateWorkerEarning() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CreateWorkerEarningDto
    }) => {
      const res = await api.post<WorkerEarning>(`/workers/${id}/earnings`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}

/**
 * Edit an earnings entry — the backend only accepts this within a short
 * window of creation (EDIT_WINDOW_EXPIRED past that); the UI should offer a
 * "log a correction entry" path instead once the window has passed.
 * @returns mutation accepting { id, earningId, body: UpdateWorkerEarningDto }
 * PATCH /workers/:id/earnings/:earningId
 */
export function useUpdateWorkerEarning() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      earningId,
      body,
    }: {
      id: string
      earningId: string
      body: UpdateWorkerEarningDto
    }) => {
      const res = await api.patch<WorkerEarning>(`/workers/${id}/earnings/${earningId}`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workers'] })
      qc.invalidateQueries({ queryKey: ['workers', id] })
    },
  })
}
