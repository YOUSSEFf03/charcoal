import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import UserMenu from '../auth/UserMenu'

interface TopbarProps {
  title: string
  // `to` is a route path for real navigation, or a callback for in-page
  // "back" actions (e.g. a sub-view toggle) that don't change the URL —
  // this lets every back-navigation control in the app share one visual
  // treatment (see the frontend-wide navigation consolidation) even where
  // there's no route to navigate to.
  back?: { label: string; to: string | (() => void) }
  children?: ReactNode
}

export default function Topbar({ title, back, children }: TopbarProps) {
  const navigate = useNavigate()
  return (
    <header className="topbar">
      <div className="topbar-left">
        {back && (
          <>
            <button className="back-link" onClick={() => typeof back.to === 'function' ? back.to() : navigate(back.to)}>
              <i className="ti ti-chevron-left" /> {back.label}
            </button>
            <span style={{ color: 'var(--text3)', margin: '0 6px' }}>·</span>
          </>
        )}
        <span className="page-title">{title}</span>
      </div>
      <div className="topbar-right">
        {children}
        <UserMenu />
      </div>
    </header>
  )
}
