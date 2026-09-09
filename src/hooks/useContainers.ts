import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Container,
  ContainerDetail,
  CreateContainerDto,
  UpdateContainerDto,
  CreateContainerExpenseDto,
  UpdateContainerExpenseDto,
  ContainerExpense,
  SetContainerDiscountDto,
  ContainerDiscount,
  CreateContainerProductLineDto,
  UpdateContainerProductLineDto,
  ContainerProductLine,
  ContainerTracking,
  CarrierOption,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /containers. */
export interface ContainersQuery {
  status?: string
  supplierId?: string
  search?: string
  page?: number
  limit?: number
  // Opt-in only (see ContainersService.findAll()'s doc comment on the
  // backend): omitted = unfiltered. `false` excludes finalized containers
  // (the main Containers page). `true` returns ONLY finalized containers
  // (the History page), sorted finalizedAt desc, and enables the two
  // date-range params below.
  finalized?: boolean
  finalizedFrom?: string // "YYYY-MM-DD"
  finalizedTo?: string // "YYYY-MM-DD"
}

const containersKey = (params?: ContainersQuery) =>
  ['containers', params ?? {}] as const

/**
 * List containers (paginated).
 * @param params - status / supplier / search filters
 * @returns React Query result of PaginatedResponse<Container>
 * GET /containers
 */
export function useContainers(params?: ContainersQuery) {
  return useQuery({
    queryKey: containersKey(params),
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Container>>('/containers', { params })
      return res.data
    },
  })
}

/**
 * Fetch one container with product lines, expenses, discount and totals.
 * @param id - container UUID
 * @returns React Query result of ContainerDetail
 * GET /containers/:id
 */
export function useContainer(id: string) {
  return useQuery({
    queryKey: ['containers', id],
    queryFn: async () => {
      const res = await api.get<ContainerDetail>(`/containers/${id}`)
      return res.data
    },
    enabled: Boolean(id),
  })
}

/**
 * Delete a container (blocked if status=arrived).
 * @returns mutation accepting container id string
 * DELETE /containers/:id
 */
export function useDeleteContainer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/containers/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}

/**
 * Finalize an arrived container — locks its financial/identity record
 * permanently (owner only; backend-enforced). Does not touch stock lots,
 * product lines, or cost — see backend ContainersService.finalize() doc.
 * @returns mutation accepting the container id
 * POST /containers/:id/finalize
 */
export function useFinalizeContainer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<Container>(`/containers/${id}/finalize`)
      return res.data
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['containers'] })
      qc.invalidateQueries({ queryKey: ['containers', id] })
    },
  })
}

/**
 * Create a container.
 * @returns mutation accepting CreateContainerDto
 * POST /containers
 */
export function useCreateContainer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateContainerDto) => {
      const res = await api.post<Container>('/containers', body)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}

/**
 * Update a container (setting status to "arrived" auto-creates stock lots).
 * @returns mutation accepting { id, body: UpdateContainerDto }
 * PATCH /containers/:id
 */
export function useUpdateContainer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: UpdateContainerDto
    }) => {
      const res = await api.patch<Container>(`/containers/${id}`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['containers'] })
      qc.invalidateQueries({ queryKey: ['containers', id] })
      // Arrival creates stock lots.
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
    },
  })
}

/**
 * Add an expense to a container (recalculates costPerKg on linked lots).
 * @returns mutation accepting { id, body: CreateContainerExpenseDto }
 * POST /containers/:id/expenses
 */
export function useAddExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CreateContainerExpenseDto
    }) => {
      const res = await api.post<ContainerExpense>(`/containers/${id}/expenses`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['containers', id] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
    },
  })
}

/**
 * Update an expense's description/amount (recalculates costPerKg on linked lots).
 * @returns mutation accepting { containerId, expenseId, body: UpdateContainerExpenseDto }
 * PATCH /containers/:containerId/expenses/:expenseId
 */
export function useUpdateExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      containerId,
      expenseId,
      body,
    }: {
      containerId: string
      expenseId: string
      body: UpdateContainerExpenseDto
    }) => {
      const res = await api.patch<ContainerExpense>(
        `/containers/${containerId}/expenses/${expenseId}`,
        body,
      )
      return res.data
    },
    onSuccess: (_data, { containerId }) => {
      qc.invalidateQueries({ queryKey: ['containers', containerId] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
    },
  })
}

/**
 * Delete an expense (recalculates costPerKg on linked lots).
 * @returns mutation accepting { containerId, expenseId }
 * DELETE /containers/:containerId/expenses/:expenseId
 */
export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ containerId, expenseId }: { containerId: string; expenseId: string }) => {
      await api.delete(`/containers/${containerId}/expenses/${expenseId}`)
    },
    onSuccess: (_data, { containerId }) => {
      qc.invalidateQueries({ queryKey: ['containers', containerId] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
    },
  })
}

/**
 * Create or update a container's discount (recalculates linked lot costs).
 * @returns mutation accepting { id, body: SetContainerDiscountDto }
 * PUT /containers/:id/discount
 */
export function useUpsertDiscount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: SetContainerDiscountDto
    }) => {
      const res = await api.put<ContainerDiscount>(`/containers/${id}/discount`, body)
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['containers', id] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
    },
  })
}

/**
 * Add a product line to a container.
 * @returns mutation accepting { id, body: CreateContainerProductLineDto }
 * POST /containers/:id/product-lines
 */
export function useAddProductLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string
      body: CreateContainerProductLineDto
    }) => {
      const res = await api.post<ContainerProductLine>(
        `/containers/${id}/product-lines`,
        body,
      )
      return res.data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['containers', id] })
    },
  })
}

/**
 * Update a product line's fields (recalculates costPerKg).
 * @returns mutation accepting { containerId, lineId, body: UpdateContainerProductLineDto }
 * PATCH /containers/:containerId/product-lines/:lineId
 */
export function useUpdateProductLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      containerId,
      lineId,
      body,
    }: {
      containerId: string
      lineId: string
      body: UpdateContainerProductLineDto
    }) => {
      const res = await api.patch<ContainerProductLine>(
        `/containers/${containerId}/product-lines/${lineId}`,
        body,
      )
      return res.data
    },
    onSuccess: (_data, { containerId }) => {
      qc.invalidateQueries({ queryKey: ['containers', containerId] })
      qc.invalidateQueries({ queryKey: ['stock-lots'] })
    },
  })
}

/**
 * Delete a product line — blocked by the API if the container has already arrived.
 * @returns mutation accepting { containerId, lineId }
 * DELETE /containers/:containerId/product-lines/:lineId
 */
export function useDeleteProductLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ containerId, lineId }: { containerId: string; lineId: string }) => {
      await api.delete(`/containers/${containerId}/product-lines/${lineId}`)
    },
    onSuccess: (_data, { containerId }) => {
      qc.invalidateQueries({ queryKey: ['containers', containerId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Shipment tracking (Traqo Ocean) — informational only, independent of
// container status/cost. GET never calls the provider; only the refresh
// mutation does, and the backend throttles that server-side.
// ---------------------------------------------------------------------------

/**
 * Last stored tracking snapshot for a container (null until first refresh).
 * Never triggers a live provider call — purely reads what's in our DB.
 * GET /containers/:id/tracking
 */
export function useContainerTracking(containerId: string) {
  return useQuery({
    queryKey: ['containers', containerId, 'tracking'],
    queryFn: async () => {
      const res = await api.get<ContainerTracking | null>(`/containers/${containerId}/tracking`)
      return res.data
    },
    enabled: Boolean(containerId),
  })
}

/**
 * Manual "Refresh tracking" — the only action that calls the live provider.
 * Backend enforces a minimum interval between refreshes regardless of what
 * the frontend does; a 429 here means "too soon", not a client bug.
 * POST /containers/:id/tracking/refresh
 */
export function useRefreshTracking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (containerId: string) => {
      const res = await api.post<ContainerTracking>(`/containers/${containerId}/tracking/refresh`)
      return res.data
    },
    onSuccess: (_data, containerId) => {
      qc.invalidateQueries({ queryKey: ['containers', containerId, 'tracking'] })
    },
  })
}

/**
 * Search supported ocean carriers, for the carrier picker in the edit-container modal.
 * GET /containers/tracking/carriers?search=
 */
export function useCarriers(search: string, enabled = true) {
  return useQuery({
    queryKey: ['containers', 'tracking', 'carriers', search],
    queryFn: async () => {
      const res = await api.get<CarrierOption[]>('/containers/tracking/carriers', {
        params: search ? { search } : undefined,
      })
      return res.data
    },
    enabled,
  })
}
