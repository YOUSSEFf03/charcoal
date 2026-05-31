import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  Container,
  ContainerDetail,
  CreateContainerDto,
  UpdateContainerDto,
  CreateContainerExpenseDto,
  ContainerExpense,
  SetContainerDiscountDto,
  ContainerDiscount,
  CreateContainerProductLineDto,
  ContainerProductLine,
  PaginatedResponse,
} from '../types/api'

/** Query params accepted by GET /containers. */
export interface ContainersQuery {
  status?: string
  supplierId?: string
  search?: string
  page?: number
  limit?: number
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
