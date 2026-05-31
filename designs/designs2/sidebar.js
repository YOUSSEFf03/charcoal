// Renders the Ember sidebar into <aside id="sidebar" data-active="X">
// where X is one of: dashboard, reports, containers, warehouse, packing,
// clients, orders, delivery, warehouse-sales, invoices, payments,
// cash-handover, expenses, employees, suppliers, settings.
(function () {
  const SECTIONS = [
    { label: "Overview", items: [
      ["dashboard",       "Dashboard",       "layout-dashboard", "dashboard.html"],
      ["reports",         "Reports",         "chart-bar",        "reports.html"],
    ]},
    { label: "Stock", items: [
      ["containers",      "Containers",      "ship",                  "containers.html"],
      ["warehouse",       "Warehouse",       "building-warehouse",    "warehouse.html"],
      ["packing",         "Packing",         "tools",                 "packing.html"],
    ]},
    { label: "Sales", items: [
      ["clients",         "Clients",         "users",            "clients.html", { badge: "3", amber: true }],
      ["fill-clients",    "Fill clients",    "stack-2",          "fill-clients.html"],
      ["orders",          "Orders",          "file-invoice",     "orders.html"],
      ["warehouse-sales", "Warehouse sales", "cash-register",    "warehouse-sales.html"],
    ]},
    { label: "Finance", items: [
      ["balances",        "Balances",        "credit-card",      "balances.html", { badge: "$16k", amber: true }],
      ["invoices",        "Invoices",        "receipt",          "invoices.html"],
      ["cash-handover",   "Cash handover",   "wallet",           "cash-handover.html"],
      ["expenses",        "Expenses",        "receipt-tax",      "expenses.html"],
    ]},
    { label: "Setup", items: [
      ["employees",       "Employees",       "id-badge",         "employees.html"],
      ["suppliers",       "Suppliers",       "building-store",   "suppliers.html"],
      ["settings",        "Settings",        "settings",         "settings.html"],
    ]},
  ];

  function render(active) {
    let out = `
      <div class="sidebar-logo">
        <a href="index.html" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit">
          <div class="logo-mark"><i class="ti ti-flame"></i></div>
          <div>
            <div class="logo-text">Ember</div>
            <div class="logo-sub">charcoal system</div>
          </div>
        </a>
      </div>`;
    for (const sec of SECTIONS) {
      out += `<div class="sidebar-section"><div class="sidebar-section-label">${sec.label}</div>`;
      for (const [id, label, icon, href, extra] of sec.items) {
        const isActive = id === active ? " active" : "";
        const badge = extra && extra.badge
          ? `<span class="nav-badge${extra.amber ? " amber" : ""}">${extra.badge}</span>`
          : "";
        out += `<a class="nav-item${isActive}" href="${href}"><i class="ti ti-${icon}"></i> ${label}${badge}</a>`;
      }
      out += `</div>`;
    }
    out += `
      <div class="sidebar-bottom">
        <div class="user-row">
          <div class="avatar">KA</div>
          <div>
            <div class="user-name">Khalil Abi Nader</div>
            <div class="user-role">owner</div>
          </div>
        </div>
      </div>`;
    return out;
  }

  function init() {
    const el = document.getElementById("sidebar");
    if (!el) return;
    el.className = "sidebar";
    el.innerHTML = render(el.getAttribute("data-active") || "");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
