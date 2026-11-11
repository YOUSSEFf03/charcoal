import { useEffect } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import Sidebar from './Sidebar'

/**
 * Every page opens at the top: any navigation (sidebar, links, buttons, or
 * pressing the current page's sidebar item again) scrolls the window up.
 * Back/forward (POP) is left alone so the browser can return you to where
 * you were in the list. 2026-11-11.
 */
function useScrollToTopOnNavigate() {
  const location = useLocation()
  const navType = useNavigationType()
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo({ top: 0, left: 0 })
  }, [location.key, navType])
}

export default function Layout() {
  useScrollToTopOnNavigate()
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}
