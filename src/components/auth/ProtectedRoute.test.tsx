// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Regression coverage for the Bag Purchases frontend role-gating audit:
// BagPurchasesController is @Roles('owner', 'accountant') on every endpoint
// (findAll/findOne/create), but the /bag-purchases route previously had no
// matching allowedRoles — any signed-in role could land on the page and only
// then discover every API call 403s. This exercises ProtectedRoute itself
// (the actual enforcement mechanism App.tsx's Guard delegates to) with the
// exact allowedRoles now set on /bag-purchases, via the dev-role bypass path
// (the same path local development and this test suite both use — see
// lib/devAuth.ts's DEV / getDevRole()).
// ---------------------------------------------------------------------------

const mockUseAuth = vi.fn()
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => mockUseAuth(),
}))

let devRole: string | null = null
vi.mock('../../lib/devAuth', () => ({
  DEV: true,
  getDevRole: () => devRole,
}))

import { ProtectedRoute } from './ProtectedRoute'

function renderGuarded(allowedRoles?: string[]) {
  return render(
    <MemoryRouter initialEntries={['/bag-purchases']}>
      <Routes>
        <Route path="/bag-purchases" element={<ProtectedRoute allowedRoles={allowedRoles}>Bag Purchases Page</ProtectedRoute>} />
        <Route path="/sign-in" element={<div>Sign In Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  devRole = null
  // Not exercised on the DEV-bypass path, but useAuth() is still called
  // unconditionally (it's a hook) — give it a harmless signed-out shape.
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false, sessionClaims: undefined })
})

describe('ProtectedRoute — /bag-purchases allowedRoles=[owner, accountant]', () => {
  const BAG_PURCHASES_ROLES = ['owner', 'accountant']

  it('owner can access', () => {
    devRole = 'owner'
    renderGuarded(BAG_PURCHASES_ROLES)
    expect(screen.getByText('Bag Purchases Page')).toBeInTheDocument()
  })

  it('accountant can access', () => {
    devRole = 'accountant'
    renderGuarded(BAG_PURCHASES_ROLES)
    expect(screen.getByText('Bag Purchases Page')).toBeInTheDocument()
  })

  it.each(['sales_rep', 'worker', 'driver'])('%s cannot access — redirected to /sign-in', (role) => {
    devRole = role
    renderGuarded(BAG_PURCHASES_ROLES)
    expect(screen.queryByText('Bag Purchases Page')).not.toBeInTheDocument()
    expect(screen.getByText('Sign In Page')).toBeInTheDocument()
  })

  it('no role at all (not signed in / dev role unset) is redirected to /sign-in', () => {
    devRole = null
    renderGuarded(BAG_PURCHASES_ROLES)
    expect(screen.queryByText('Bag Purchases Page')).not.toBeInTheDocument()
    expect(screen.getByText('Sign In Page')).toBeInTheDocument()
  })
})

describe('ProtectedRoute — general behavior, unaffected by the bag-purchases gate', () => {
  it('a route with no allowedRoles still allows any signed-in role through', () => {
    devRole = 'worker'
    renderGuarded(undefined)
    expect(screen.getByText('Bag Purchases Page')).toBeInTheDocument()
  })
})
