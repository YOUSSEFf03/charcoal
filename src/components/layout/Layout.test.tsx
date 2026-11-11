// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './Layout'

vi.mock('./Sidebar', () => ({ default: () => null }))

let nav: ReturnType<typeof useNavigate>
function Page() { nav = useNavigate(); return <div>page</div> }

describe('Layout scroll to top', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('scrolls to the top on every navigation except back/forward', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Routes><Route element={<Layout />}><Route path="*" element={<Page />} /></Route></Routes>
      </MemoryRouter>,
    )
    scroll.mockClear()
    act(() => nav('/orders'))
    expect(scroll).toHaveBeenCalledTimes(1)
    act(() => nav('/orders')) // pressing the same sidebar item again
    expect(scroll).toHaveBeenCalledTimes(2)
    act(() => nav(-1)) // back button
    expect(scroll).toHaveBeenCalledTimes(2)
  })
})
