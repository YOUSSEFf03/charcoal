/* ── Sidebar + Topbar chrome ── */

const NAV = [
  { section: 'Overview', items: [
    { icon: 'ti-layout-dashboard', label: 'Dashboard' },
    { icon: 'ti-chart-bar', label: 'Reports' },
  ]},
  { section: 'Stock', items: [
    { icon: 'ti-package', label: 'Containers' },
    { icon: 'ti-building-warehouse', label: 'Warehouse' },
    { icon: 'ti-box', label: 'Packing' },
    { icon: 'ti-shopping-bag', label: 'Bag purchases' },
  ]},
  { section: 'Sales', items: [
    { icon: 'ti-users', label: 'Clients', active: true },
    { icon: 'ti-user-plus', label: 'Fill clients' },
    { icon: 'ti-file-invoice', label: 'Orders' },
    { icon: 'ti-cash', label: 'Warehouse sales' },
  ]},
  { section: 'Finance', items: [
    { icon: 'ti-scale', label: 'Balances' },
    { icon: 'ti-receipt-2', label: 'Invoices' },
    { icon: 'ti-cash-banknote', label: 'Cash handover' },
    { icon: 'ti-coin', label: 'Expenses' },
  ]},
  { section: 'Setup', items: [
    { icon: 'ti-user', label: 'Employees' },
    { icon: 'ti-truck', label: 'Suppliers' },
    { icon: 'ti-settings', label: 'Settings' },
  ]},
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark"><i className="ti ti-flame" /></div>
        <div>
          <div className="logo-text">Farah Charcoal</div>
          <div className="logo-sub">management system</div>
        </div>
      </div>
      {NAV.map(grp => (
        <div className="sidebar-section" key={grp.section}>
          <div className="sidebar-section-label">{grp.section}</div>
          {grp.items.map(it => (
            <div className={`nav-item ${it.active ? 'active' : ''}`} key={it.label}>
              <i className={`ti ${it.icon}`} /> {it.label}
            </div>
          ))}
        </div>
      ))}
      <div className="sidebar-bottom">
        <div className="user-row">
          <div className="avatar-sm">KA</div>
          <div>
            <div className="user-name">Khalil Abi Nader</div>
            <div className="user-role">owner</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ crumbs, children }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="crumb">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="sep">›</span>}
              {c.onClick
                ? <a href="#" onClick={e => { e.preventDefault(); c.onClick(); }}>
                    {c.icon && <i className={`ti ${c.icon}`} style={{ fontSize: 14 }} />}{c.label}
                  </a>
                : <span className="cur">{c.label}</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="topbar-right">{children}</div>
    </div>
  );
}

Object.assign(window, { Sidebar, Topbar });
