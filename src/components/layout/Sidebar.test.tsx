// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Regression coverage for the Bag Purchases frontend role-gating audit: the
// sidebar's "Bag purchases" link must only render for roles that can
// actually use the page — the same ['owner', 'accountant'] matrix as
// BagPurchasesController's @Roles and the /bag-purchases route's
// allowedRoles (App.tsx) — never a page the user would click into only to
// be redirected back out. Mirrors the existing canSeeExpenses/canSeeEmployees/
// canSeeSettings pattern already in this file.
// ---------------------------------------------------------------------------

const mockUseMe = vi.fn()
vi.mock('../../hooks/useMe', () => ({
  useMe: () => mockUseMe(),
}))

import Sidebar from './Sidebar'

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar />
    </MemoryRouter>,
  )
}

function makeMe(role: string) {
  return { id: 'u1', clerkId: 'c1', email: 'x@x.com', name: 'Test User', role, phone: null, createdAt: '', updatedAt: '' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Sidebar — "Bag purchases" visibility matches BagPurchasesController @Roles(owner, accountant)', () => {
  it('shows it for owner', () => {
    mockUseMe.mockReturnValue({ data: makeMe('owner'), isLoading: false })
    renderSidebar()
    expect(screen.getByText('Bag purchases')).toBeInTheDocument()
  })

  it('shows it for accountant', () => {
    mockUseMe.mockReturnValue({ data: makeMe('accountant'), isLoading: false })
    renderSidebar()
    expect(screen.getByText('Bag purchases')).toBeInTheDocument()
  })

  it.each(['sales_rep', 'worker', 'driver'])('hides it for %s', (role) => {
    mockUseMe.mockReturnValue({ data: makeMe(role), isLoading: false })
    renderSidebar()
    expect(screen.queryByText('Bag purchases')).not.toBeInTheDocument()
  })

  it('shows it while /auth/me is still loading — avoids a flash-then-hide, matches the existing canSeeExpenses/canSeeEmployees/canSeeSettings fallback', () => {
    mockUseMe.mockReturnValue({ data: undefined, isLoading: true })
    renderSidebar()
    expect(screen.getByText('Bag purchases')).toBeInTheDocument()
  })
})
