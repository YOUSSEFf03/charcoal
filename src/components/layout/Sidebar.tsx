import { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

interface NavItemProps {
  to: string
  icon: string
  label: string
  badge?: string
  badgeVariant?: 'red' | 'amber' | 'green'
  prefix?: boolean
}

function NavItem({ to, icon, label, badge, badgeVariant = 'red', prefix = false }: NavItemProps) {
  const location = useLocation()
  const isActive = prefix
    ? location.pathname.startsWith(to)
    : location.pathname === to || location.pathname.startsWith(to + '/')

  return (
    <NavLink
      to={to}
      className={`nav-item ${isActive ? 'active' : ''}`}
    >
      <i className={`ti ${icon}`} />
      {label}
      {badge && (
        <span className={`nav-badge ${badgeVariant !== 'red' ? badgeVariant : ''}`}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-mark">
          <i className="ti ti-flame" />
        </div>
        <div>
          <div className="logo-text">Farah Charcoal</div>
          <div className="logo-sub">management system</div>
        </div>
      </div>

      {/* Overview */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Overview</div>
        <NavItem to="/dashboard" icon="ti-layout-dashboard" label="Dashboard" />
        <NavItem to="/reports" icon="ti-chart-bar" label="Reports" />
      </div>

      {/* Stock */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Stock</div>
        <NavItem to="/containers" icon="ti-ship" label="Containers" prefix />
        <NavItem to="/warehouse" icon="ti-building-warehouse" label="Warehouse" />
        <NavItem to="/packing" icon="ti-tools" label="Packing" />
        <NavItem to="/bag-purchases" icon="ti-shopping-cart" label="Bag purchases" />
      </div>

      {/* Sales */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Sales</div>
        <NavItem to="/clients" icon="ti-users" label="Clients" prefix />
        <NavItem to="/fill-clients" icon="ti-stack-2" label="Fill clients" prefix />
        <NavItem to="/orders" icon="ti-file-invoice" label="Orders" prefix />
        <NavItem to="/warehouse-sales" icon="ti-cash-register" label="Warehouse sales" />
      </div>

      {/* Finance */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Finance</div>
        <NavItem to="/balances" icon="ti-credit-card" label="Balances" />
        <NavItem to="/invoices" icon="ti-receipt" label="Invoices" />
        <NavItem to="/cash-handover" icon="ti-wallet" label="Cash handover" />
        <NavItem to="/expenses" icon="ti-receipt-tax" label="Expenses" />
      </div>

      {/* Setup */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Setup</div>
        <NavItem to="/employees" icon="ti-id-badge" label="Employees" />
        <NavItem to="/suppliers" icon="ti-building-store" label="Suppliers" prefix />
        <NavItem to="/settings" icon="ti-settings" label="Settings" />
      </div>

      {/* User */}
      <div className="sidebar-bottom">
        <div ref={menuRef} style={{ position: 'relative' }}>
          {menuOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', overflow: 'hidden', zIndex: 20 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Khalil Abi Nader</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>owner · khalil</div>
              </div>
              <div
                onClick={() => { setMenuOpen(false); navigate('/settings') }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <i className="ti ti-settings" style={{ fontSize: 14, color: 'var(--text3)' }} /> Account settings
              </div>
              <div
                onClick={() => { setMenuOpen(false); navigate('/sign-in') }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', fontSize: 13, color: 'var(--red)', cursor: 'pointer', borderTop: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <i className="ti ti-logout" style={{ fontSize: 14 }} /> Sign out
              </div>
            </div>
          )}
          <div className="user-row" style={{ cursor: 'pointer' }} onClick={() => setMenuOpen(o => !o)}>
            <div className="avatar">KA</div>
            <div>
              <div className="user-name">Khalil Abi Nader</div>
              <div className="user-role">owner</div>
            </div>
            <i className="ti ti-chevron-up" style={{ fontSize: 13, color: 'var(--text3)', marginLeft: 'auto', transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </div>
        </div>
      </div>
    </aside>
  )
}
