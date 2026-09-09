// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Topbar.back is the shared primitive every page's back-navigation control is
// being consolidated onto (frontend-wide navigation audit). It supports two
// modes: `to` as a route string (real navigation, via useNavigate) or `to` as
// a callback (an in-page view toggle that never changes the URL — e.g. a
// detail page's Statement sub-view returning to its own detail hub). Both
// must keep working, and neither must accidentally trigger the other.
// ---------------------------------------------------------------------------

vi.mock('../auth/UserMenu', () => ({ default: () => <div>UserMenu</div> }))

import Topbar from './Topbar'

describe('Topbar', () => {
  it('renders the title and, with no `back` prop, no back-link', () => {
    render(
      <MemoryRouter>
        <Topbar title="Orders" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('back.to as a string navigates to that route (does not call it as a function)', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/o1" element={<Topbar title="Order" back={{ label: 'Orders', to: '/orders' }} />} />
          <Route path="/orders" element={<div>Orders list page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByText('Orders'))
    expect(screen.getByText('Orders list page')).toBeInTheDocument()
  })

  it('back.to as a callback invokes it directly and never touches the URL/route', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <MemoryRouter initialEntries={['/suppliers/s1']}>
        <Routes>
          <Route path="/suppliers/s1" element={<Topbar title="Supplier" back={{ label: 'Back to supplier', to: onBack }} />} />
          {/* No /suppliers route registered — if the callback were mistakenly
              treated as a route path, this render would go blank instead of
              staying on the Supplier topbar. */}
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByText('Back to supplier'))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Supplier')).toBeInTheDocument()
  })

  it('renders children (page actions) alongside a back link', () => {
    render(
      <MemoryRouter>
        <Topbar title="Client" back={{ label: 'All clients', to: '/clients' }}>
          <button>Edit</button>
        </Topbar>
      </MemoryRouter>,
    )
    expect(screen.getByText('All clients')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })
})
