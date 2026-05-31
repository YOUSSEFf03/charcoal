import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import UserMenu from '../auth/UserMenu'

interface TopbarProps {
  title: string
  back?: { label: string; to: string }
  children?: ReactNode
}

export default function Topbar({ title, back, children }: TopbarProps) {
  const navigate = useNavigate()
  return (
    <header className="topbar">
      <div className="topbar-left">
        {back && (
          <>
            <button className="back-link" onClick={() => navigate(back.to)}>
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
