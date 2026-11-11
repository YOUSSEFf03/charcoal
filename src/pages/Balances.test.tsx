// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Client } from '../types/api'

vi.mock('../components/layout/Topbar', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const mockUseClientBalances = vi.fn()
vi.mock('../hooks/useBalances', () => ({
  useClientBalances: (...args: unknown[]) => mockUseClientBalances(...args),
  useClientAging: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}))

import Balances from './Balances'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function client(id: string, name: string, o: Partial<Client>): Client {
  return {
    id, name, nameAr: null, type: 'restaurant', currency: 'USD', phones: [],
    balance: '0.00', isOverdue: false, lastOrderDate: daysAgo(1),
    ...o,
  } as unknown as Client
}

const ROWS = [
  client('a', 'Alpha Grill', { balance: '300.00', type: 'restaurant', lastOrderDate: daysAgo(5) }),
  client('b', 'Beta Shop', { balance: '50.00', type: 'shop', lastOrderDate: daysAgo(40), isOverdue: true }),
  client('c', 'Cedar Wholesale', { balance: '1000.00', type: 'wholesale', lastOrderDate: daysAgo(10) }),
]

/** Client names in table order (rows link to /clients/:id via .bal-name). */
function tableNames() {
  return Array.from(document.querySelectorAll('.bal-row:not(.head) .bal-name')).map(e => e.textContent)
}

beforeEach(() => {
  mockUseClientBalances.mockReturnValue({ data: { data: ROWS, total: 3 }, isLoading: false, isError: false, refetch: vi.fn() })
})

const renderPage = () => render(<MemoryRouter><Balances /></MemoryRouter>)

describe('Balances page — filters', () => {
  it('fetches every client that owes us, not a search-limited page', () => {
    renderPage()
    expect(mockUseClientBalances).toHaveBeenCalledWith({ hasBalance: true, limit: 100 })
  })

  it('aging buckets filter the table', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    expect(tableNames()).toHaveLength(3)

    await user.click(screen.getByText('Overdue', { selector: '.bucket' }))
    expect(tableNames()).toEqual(['Beta Shop'])

    await user.click(screen.getByText('On account', { selector: '.bucket' }))
    expect(tableNames().sort()).toEqual(['Alpha Grill', 'Cedar Wholesale'])
  })

  it('type pills filter the table and the footer total follows', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    const seg = document.querySelector('.seg') as HTMLElement
    await user.click(within(seg).getByText('Shop'))
    expect(tableNames()).toEqual(['Beta Shop'])
    expect(document.querySelector('.bal-foot .total')?.textContent).toBe('$50')
    // headline stays the real total of everyone
    expect(document.querySelector('.headline-val')?.textContent).toBe('$1,350')

    await user.click(screen.getByRole('button', { name: /Clear filters/ }))
    expect(tableNames()).toHaveLength(3)
  })

  it('search narrows the table without changing the headline total', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await user.type(screen.getByPlaceholderText('Search clients…'), 'cedar')
    expect(tableNames()).toEqual(['Cedar Wholesale'])
    expect(document.querySelector('.headline-val')?.textContent).toBe('$1,350')
  })
})

describe('Balances page — sort', () => {
  it('defaults to oldest first, then sorts by a clicked column and flips on second click', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    expect(tableNames()).toEqual(['Beta Shop', 'Cedar Wholesale', 'Alpha Grill'])

    await user.click(screen.getByRole('button', { name: /^Balance/ }))
    expect(tableNames()).toEqual(['Cedar Wholesale', 'Alpha Grill', 'Beta Shop'])
    await user.click(screen.getByRole('button', { name: /^Balance/ }))
    expect(tableNames()).toEqual(['Beta Shop', 'Alpha Grill', 'Cedar Wholesale'])

    await user.click(screen.getByRole('button', { name: /^Client/ }))
    expect(tableNames()).toEqual(['Alpha Grill', 'Beta Shop', 'Cedar Wholesale'])
  })
})
