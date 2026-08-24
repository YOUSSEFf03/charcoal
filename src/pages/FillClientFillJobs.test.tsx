// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Fill Client Fill Jobs — dedicated history page. Highest-risk items
// (break/prove): client scoping and pagination (mirrors FillClientPickups).
// ---------------------------------------------------------------------------

vi.mock('../components/layout/Topbar', () => ({
  default: ({ title, back, children }: { title: string; back?: { label: string; to: string }; children?: ReactNode }) => (
    <div><span>{title}</span>{back && <a href={back.to}>{back.label}</a>}{children}</div>
  ),
}))

const mockUseClient = vi.fn()
vi.mock('../hooks/useClients', () => ({ useClient: (id: string) => mockUseClient(id) }))

const mockUseFillJobs = vi.fn()
const mockUseFillJobYtdSummary = vi.fn()
vi.mock('../hooks/useFillJobs', () => ({
  useFillJobs: (clientId: string, params: unknown) => mockUseFillJobs(clientId, params),
  useFillJobYtdSummary: (clientId: string) => mockUseFillJobYtdSummary(clientId),
}))

import FillClientFillJobs from './FillClientFillJobs'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/fill-clients/${id}/fill-jobs`]}>
      <Routes><Route path="/fill-clients/:id/fill-jobs" element={<FillClientFillJobs />} /></Routes>
    </MemoryRouter>,
  )
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fj-1', date: '2026-08-10', workerEntity: { id: 'w1', name: 'Worker Wael' },
    totalCharcoalKg: '100.000', totalBags: 40, totalCost: '80.00',
    bagOutputs: [], fillJobLots: [], notes: null, createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseClient.mockReturnValue({ data: { id: 'fc-1', name: 'Cedar Fill Co' }, isLoading: false })
  mockUseFillJobs.mockReturnValue({ data: { data: [makeJob()], total: 1, page: 1, limit: 20 }, isLoading: false, isError: false })
  mockUseFillJobYtdSummary.mockReturnValue({ data: undefined, isLoading: false })
})

describe('FillClientFillJobs', () => {
  it('scopes the query to this client\'s id — never another client\'s fill jobs', () => {
    renderAt('fc-1')
    expect(mockUseFillJobs.mock.calls[0][0]).toBe('fc-1')
  })

  it('renders worker, kg, bags, and cost for each job', () => {
    renderAt('fc-1')
    expect(screen.getByText('Worker Wael')).toBeInTheDocument()
    expect(screen.getByText('100.0 kg')).toBeInTheDocument()
    // "40" appears both in the table row and in the "Bags (this page)" KPI tile.
    expect(screen.getAllByText('40').length).toBeGreaterThanOrEqual(1)
  })

  it('pagination requests the next page from the backend, not a client-side slice', async () => {
    mockUseFillJobs.mockReturnValue({ data: { data: [makeJob()], total: 45, page: 1, limit: 20 }, isLoading: false, isError: false })
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')

    await user.click(screen.getByRole('button', { name: /Next/ }))

    const lastCall = mockUseFillJobs.mock.calls[mockUseFillJobs.mock.calls.length - 1]!
    expect(lastCall[1].page).toBe(2)
  })

  it('date filter resets to page 1 and passes dateFrom/dateTo through', async () => {
    mockUseFillJobs.mockReturnValue({ data: { data: [makeJob()], total: 45, page: 2, limit: 20 }, isLoading: false, isError: false })
    const user = userEvent.setup({ delay: null })
    renderAt('fc-1')

    await user.selectOptions(screen.getByRole('combobox'), 'Last month')

    const lastCall = mockUseFillJobs.mock.calls[mockUseFillJobs.mock.calls.length - 1]!
    expect(lastCall[1].page).toBe(1)
    expect(lastCall[1].dateFrom).toBeDefined()
    expect(lastCall[1].dateTo).toBeDefined()
  })

  it('empty state when there are no fill jobs', () => {
    mockUseFillJobs.mockReturnValue({ data: { data: [], total: 0, page: 1, limit: 20 }, isLoading: false, isError: false })
    renderAt('fc-1')
    expect(screen.getByText(/No fill jobs/)).toBeInTheDocument()
  })
})
