/* ── Charcoal · Client detail prototype ── */
const { useState, useMemo, useRef } = React;

/* ── helpers ── */
const MONTH_IDX = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseDate(s) {
  const m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m) return new Date(+m[3], MONTH_IDX[m[2]], +m[1]).getTime();
  const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
}
function fmt(n) {
  const neg = n < 0; const a = Math.abs(n);
  return (neg ? '-$' : '$') + a.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function statusBadge(s) {
  const map = { delivered: 'badge-green', draft: 'badge-gray', issued: 'badge-blue', paid: 'badge-green', unpaid: 'badge-red', partial: 'badge-amber' };
  return <span className={`badge ${map[s] ?? 'badge-gray'}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>;
}

/* ── Build a debit/credit ledger from sales (charges) + invoices + payments ── */
function buildLedger(warehouse, invoices, payments) {
  const entries = [];
  warehouse.forEach(w => entries.push({
    date: w.date, kind: 'sale',
    desc: `Warehouse sale · ${w.charcoal} · ${w.kg}`, ref: w.code,
    debit: w.amount, credit: 0,
  }));
  invoices.forEach(inv => entries.push({
    date: inv.date, kind: 'invoice',
    desc: `Invoice · ${inv.note || 'sales charge'}`, ref: inv.id,
    debit: inv.amount, credit: 0,
  }));
  payments.forEach(p => entries.push({
    date: p.date, kind: 'payment',
    desc: `Payment received · ${p.method}`, ref: p.code || p.ref,
    debit: 0, credit: p.amount,
  }));
  // date asc; within a day charges (debit) come before credits
  entries.sort((a, b) => {
    const d = parseDate(a.date) - parseDate(b.date);
    if (d !== 0) return d;
    return (a.credit > 0 ? 1 : 0) - (b.credit > 0 ? 1 : 0);
  });
  let bal = 0;
  entries.forEach(e => { bal += e.debit - e.credit; e.balance = bal; });
  return entries;
}

/* ════════════ APP ════════════ */
function App() {
  const D = window.DATA;
  const [view, setView] = useState('detail'); // detail | orders | invoices | warehouse | statement | payments
  const [payments, setPayments] = useState(D.payments);
  const [invoices, setInvoices] = useState(D.invoices);
  const [toast, setToast] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const toastTimer = useRef();

  const ledger = useMemo(() => buildLedger(D.warehouse, invoices, payments), [invoices, payments]);
  const totalDebit = ledger.reduce((s, e) => s + e.debit, 0);
  const totalCredit = ledger.reduce((s, e) => s + e.credit, 0);
  const outstanding = totalDebit - totalCredit;

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }

  function addPayment(p) { setPayments(prev => [...prev, p]); }
  function addInvoice(inv) { setInvoices(prev => [...prev, inv]); }

  return (
    <>
      <Sidebar />
      <div className="main">
        <Topbar crumbs={[
          { label: 'All clients', icon: 'ti-chevron-left', onClick: () => setView('detail') },
          { label: D.client.name },
        ]}>
          {view === 'detail' ? (
            <>
              <button className="btn"><i className="ti ti-edit" style={{ fontSize: 15 }} /> Edit</button>
              <button className="btn" onClick={() => setInvOpen(true)}><i className="ti ti-file-invoice" style={{ fontSize: 15 }} /> New order</button>
              <button className="btn" onClick={() => setPayOpen(true)}><i className="ti ti-receipt" style={{ fontSize: 15 }} /> Log payment</button>
            </>
          ) : (
            <button className="btn" onClick={() => setView('detail')}><i className="ti ti-arrow-left" style={{ fontSize: 15 }} /> Back to client</button>
          )}
        </Topbar>

        <div className="content">
          {view === 'detail' && (
            <ClientDetail
              D={D} outstanding={outstanding} payments={payments} invoices={invoices} ledger={ledger}
              onMakeInvoice={() => setInvOpen(true)}
              onMakePayment={() => setPayOpen(true)}
              onOrders={() => setView('orders')}
              onInvoices={() => setView('invoices')}
              onWarehouse={() => setView('warehouse')}
              onStatement={() => setView('statement')}
              onAllPayments={() => setView('payments')}
            />
          )}
          {view === 'orders' && (
            <OrdersView D={D} onNewOrder={() => setInvOpen(true)}
              onExport={() => showToast('Orders exported to Excel')} />
          )}
          {view === 'invoices' && (
            <InvoicesView D={D} invoices={invoices} onMake={() => setInvOpen(true)}
              onExport={() => showToast('Invoices exported to Excel')} />
          )}
          {view === 'warehouse' && (
            <WarehouseView D={D} onExport={() => showToast('Warehouse sales exported to Excel')} />
          )}
          {view === 'statement' && (
            <StatementView D={D} ledger={ledger}
              onExport={() => showToast('Statement exported to Excel')} />
          )}
          {view === 'payments' && (
            <PaymentsView D={D} payments={payments} onExport={() => showToast('Payments exported to Excel')}
              onLog={() => setPayOpen(true)} />
          )}
        </div>
      </div>

      {payOpen && <PaymentModal D={D} outstanding={outstanding}
        onClose={() => setPayOpen(false)}
        onSave={(p) => { addPayment(p); setPayOpen(false); showToast(`Payment ${fmt(p.amount)} logged`); }} />}
      {invOpen && <InvoiceModal D={D}
        onClose={() => setInvOpen(false)}
        onSave={(inv) => { addInvoice(inv); setInvOpen(false); showToast(`Invoice issued · ${fmt(inv.amount)}`); }} />}

      <div className={`toast ${toast ? 'show' : ''}`}><i className="ti ti-circle-check" /><span>{toast}</span></div>
    </>
  );
}

/* ════════════ ACCOUNT ACTIVITY CHART ════════════ */
function shortDate(s) { return String(s).split(' ').slice(0, 2).join(' '); }

function AccountChart({ ledger, totalCharged, totalPaid, outstanding }) {
  const COL = { amber: '#B45309', green: '#1D6B4A', grid: '#E4E1D9', surface: '#FFFFFF' };
  // cumulative charged + paid at the close of each distinct date
  const map = new Map();
  let cumC = 0, cumP = 0;
  ledger.forEach(e => { cumC += e.debit; cumP += e.credit; map.set(e.date, { date: e.date, charged: cumC, paid: cumP }); });
  const pts = Array.from(map.values());

  if (pts.length === 0) {
    return <div className="empty" style={{ padding: '48px 18px' }}>No account activity yet</div>;
  }

  const W = 760, H = 300, padL = 58, padR = 22, padT = 18, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(totalCharged, totalPaid, 1);
  const niceMax = Math.max(Math.ceil(maxV / 300) * 300, 300);
  const n = pts.length;
  const denom = Math.max(n - 1, 1);
  const X = i => padL + (n === 1 ? plotW / 2 : (i / denom) * plotW);
  const Y = v => padT + (1 - v / niceMax) * plotH;
  const chargedPts = pts.map((p, i) => [X(i), Y(p.charged)]);
  const paidPts = pts.map((p, i) => [X(i), Y(p.paid)]);
  const line = arr => arr.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = arr => `${line(arr)} L${X(n - 1).toFixed(1)} ${Y(0).toFixed(1)} L${X(0).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const ticks = [0, niceMax / 3, (niceMax * 2) / 3, niceMax];

  return (
    <>
      <div className="chart-legend">
        <div className="chart-leg"><span className="sw" style={{ background: COL.amber }} /><div><div className="lg-l">Charged</div><div className="lg-v" style={{ color: COL.amber }}>{fmt(totalCharged)}</div></div></div>
        <div className="chart-leg"><span className="sw" style={{ background: COL.green }} /><div><div className="lg-l">Paid</div><div className="lg-v" style={{ color: COL.green }}>{fmt(totalPaid)}</div></div></div>
        <div className="chart-leg out"><span className="sw" style={{ background: 'var(--text)' }} /><div><div className="lg-l">Outstanding</div><div className="lg-v">{fmt(outstanding)}</div></div></div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="acct-chart" preserveAspectRatio="xMidYMid meet">
          {ticks.map((t, i) => (
            <g key={'g' + i}>
              <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke={COL.grid} strokeWidth="1" />
              <text x={padL - 12} y={Y(t) + 4} textAnchor="end" className="ax">${t.toLocaleString()}</text>
            </g>
          ))}
          <path d={area(chargedPts)} fill={COL.amber} opacity="0.09" />
          <path d={area(paidPts)} fill={COL.green} opacity="0.14" />
          <path d={line(chargedPts)} fill="none" stroke={COL.amber} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <path d={line(paidPts)} fill="none" stroke={COL.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {chargedPts.map((p, i) => <circle key={'c' + i} cx={p[0]} cy={p[1]} r="3.6" fill={COL.surface} stroke={COL.amber} strokeWidth="2" />)}
          {paidPts.map((p, i) => <circle key={'p' + i} cx={p[0]} cy={p[1]} r="3.6" fill={COL.surface} stroke={COL.green} strokeWidth="2" />)}
          {pts.map((p, i) => <text key={'x' + i} x={X(i)} y={H - padB + 22} textAnchor="middle" className="ax">{shortDate(p.date)}</text>)}
        </svg>
      </div>
    </>
  );
}

/* ════════════ CLIENT DETAIL ════════════ */
function ClientDetail({ D, outstanding, payments, invoices, ledger, onMakeInvoice, onMakePayment, onOrders, onInvoices, onWarehouse, onStatement, onAllPayments }) {
  const c = D.client;
  const overdue = c.daysSinceOrder > c.avgDays;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const totalCharged = ledger.reduce((s, e) => s + e.debit, 0);

  return (
    <div className="fade-up">
      {/* HERO */}
      <div className="page-header">
        <div className="client-hero">
          <div className="client-mono">{c.initials}</div>
          <div>
            <h1>{c.name}</h1>
            <div className="page-header-meta">
              <span className="badge badge-green">{c.type}</span>
              <span className="badge badge-gray">{c.currency}</span>
              <span className="meta-row"><i className="ti ti-calendar" /> client since {c.since}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="kpi-tile amber" style={{ minWidth: 160 }}>
            <div className="kpi-tile-label">Outstanding balance</div>
            <div className="kpi-tile-value">{fmt(outstanding)}</div>
            <div className="kpi-tile-sub">{c.openInvoices} open invoices</div>
          </div>
          <div className={`kpi-tile ${overdue ? 'red' : ''}`} style={{ minWidth: 160 }}>
            <div className="kpi-tile-label">Days since last order</div>
            <div className="kpi-tile-value">{c.daysSinceOrder}</div>
            <div className="kpi-tile-sub">{overdue ? `+${c.daysSinceOrder - c.avgDays} vs avg · OVERDUE` : 'on track'}</div>
          </div>
        </div>
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div className="sec-label">Quick actions</div>
      <div className="action-bar">
        <button className="action-card" onClick={onMakeInvoice}>
          <div className="action-ic green"><i className="ti ti-file-invoice" /></div>
          <div className="action-tx"><span className="t">Make invoice</span><span className="s">issue a new charge</span></div>
        </button>
        <button className="action-card" onClick={onMakePayment}>
          <div className="action-ic dark"><i className="ti ti-receipt" /></div>
          <div className="action-tx"><span className="t">Make payment</span><span className="s">log money received</span></div>
        </button>
      </div>

      {/* ── RECORDS (the old tables, now buttons) ── */}
      <div className="sec-label">Records</div>
      <div className="action-bar">
        <button className="action-card" onClick={onStatement}>
          <div className="action-ic amber"><i className="ti ti-table" /></div>
          <div className="action-tx"><span className="t">Statement of account</span><span className="s">debit · credit · balance</span></div>
          <i className="ti ti-chevron-right chev" />
        </button>
        <button className="action-card" onClick={onOrders}>
          <div className="action-ic amber"><i className="ti ti-file-invoice" /></div>
          <div className="action-tx"><span className="t">Order history</span><span className="s">{D.orders.length} orders</span></div>
          <i className="ti ti-chevron-right chev" />
        </button>
        <button className="action-card" onClick={onInvoices}>
          <div className="action-ic green"><i className="ti ti-receipt-2" /></div>
          <div className="action-tx"><span className="t">Invoices</span><span className="s">{invoices.length} issued</span></div>
          <i className="ti ti-chevron-right chev" />
        </button>
        <button className="action-card" onClick={onWarehouse}>
          <div className="action-ic dark"><i className="ti ti-building-warehouse" /></div>
          <div className="action-tx"><span className="t">Warehouse sales</span><span className="s">{D.warehouse.length} purchases</span></div>
          <i className="ti ti-chevron-right chev" />
        </button>
        <button className="action-card" onClick={onAllPayments}>
          <div className="action-ic blue"><i className="ti ti-cash" /></div>
          <div className="action-tx"><span className="t">All payments</span><span className="s">{payments.length} on record</span></div>
          <i className="ti ti-chevron-right chev" />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        {/* LEFT */}
        <div className="stack">
          {/* Account activity chart */}
          <div className="card">
            <div className="card-head"><div className="card-title"><i className="ti ti-chart-bar" /> Account activity</div>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>{c.currency} · cumulative</span>
            </div>
            <AccountChart ledger={ledger} totalCharged={totalCharged} totalPaid={totalPaid} outstanding={outstanding} />
          </div>
        </div>

        {/* RIGHT */}
        <div className="stack">
          <div className="card">
            <div className="card-head"><div className="card-title"><i className="ti ti-phone" /> Phone numbers
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6, fontFamily: "'IBM Plex Mono',monospace" }}>{D.phones.length} numbers</span>
            </div><button className="card-action"><i className="ti ti-pencil" style={{ fontSize: 13 }} /> Manage</button></div>
            {D.phones.map((p, i) => (
              <div className="phone-row" key={i}>
                <div className="phone-dot" />
                <div style={{ minWidth: 0 }}><div className="phone-number">{p.number}</div><div className="phone-label">{p.label}</div></div>
                <div className="phone-meta">active</div>
                <div className="row-actions">
                  <span className="icon-btn"><i className="ti ti-phone" /></span>
                  <span className="icon-btn"><i className="ti ti-brand-whatsapp" /></span>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title"><i className="ti ti-star" /> Preferred charcoal</div></div>
            {D.preferred.length ? (
              <div className="pref-chips">{D.preferred.map(p => { const [t, g] = p.split(' · '); return <span className="pref-chip" key={p}>{t}<span className="grade">{g}</span></span>; })}</div>
            ) : <div className="pref-empty">No preferences recorded</div>}
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title"><i className="ti ti-clipboard-text" /> Terms &amp; notes</div><button className="card-action">Edit</button></div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Payment terms</div>
                <div>{c.terms}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 3 }}>Notes</div>
                <div style={{ color: 'var(--text2)', fontSize: 12.5 }}>{c.notesEn}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════ ORDER HISTORY (full view) ════════════ */
function OrdersView({ D, onNewOrder, onExport }) {
  const c = D.client;
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const filtered = D.orders.filter(o => {
    if (status !== 'all' && o.status !== status) return false;
    if (q && !(o.id + ' ' + o.char + ' ' + (o.sub || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const delivered = D.orders.filter(o => o.status === 'delivered').length;
  const draft = D.orders.filter(o => o.status === 'draft').length;

  return (
    <div className="fade-up">
      <div className="view-head">
        <div>
          <div className="view-title">Order history</div>
          <div className="view-sub">
            <span className="meta-row"><i className="ti ti-user" /> {c.name}</span>
            <span className="meta-row"><i className="ti ti-file-invoice" /> {D.orders.length} orders</span>
          </div>
        </div>
        <div className="stmt-actions">
          <button className="btn" onClick={onNewOrder}><i className="ti ti-plus" style={{ fontSize: 15 }} /> New order</button>
          <button className="btn-export" onClick={onExport}><i className="ti ti-table-export" /> Export Excel</button>
        </div>
      </div>

      <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stmt-cell"><div className="l">Total orders</div><div className="v">{D.orders.length}</div><div className="s">all time</div></div>
        <div className="stmt-cell"><div className="l">Delivered</div><div className="v green">{delivered}</div><div className="s">completed</div></div>
        <div className="stmt-cell"><div className="l">Draft</div><div className="v amber">{draft}</div><div className="s">not yet delivered</div></div>
      </div>

      <div className="filter-row">
        <div className="filter-search">
          <i className="ti ti-search" />
          <input placeholder="Search order or charcoal…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="seg">
          {[['all', 'All'], ['delivered', 'Delivered'], ['draft', 'Draft']].map(([k, lbl]) => (
            <div key={k} className={`seg-opt ${status === k ? 'sel' : ''}`} onClick={() => setStatus(k)}>{lbl}</div>
          ))}
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th style={{ width: 120 }}>Date</th><th>Order</th><th style={{ width: 60 }}>Type</th>
            <th>Weight</th><th style={{ width: 90 }}>Status</th><th className="right" style={{ width: 90 }}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={6} className="empty">No orders match this filter</td></tr>}
            {filtered.map(o => (
              <tr key={o.id}>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{o.date}</td>
                <td>
                  <div style={{ fontWeight: 500, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{o.id}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.char}{o.sub ? ` · ${o.sub}` : ''}</div>
                </td>
                <td><span className={`badge ${o.isBag ? 'badge-blue' : 'badge-amber'}`}>{o.isBag ? 'Bag' : 'KG'}</span></td>
                <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{o.weight}</td>
                <td>{statusBadge(o.status)}</td>
                <td><div className="row-actions">
                  <span className="icon-btn"><i className="ti ti-arrow-up-right" /></span>
                  <span className="icon-btn"><i className="ti ti-printer" /></span>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════ INVOICES (full view) ════════════ */
function InvoicesView({ D, invoices, onMake, onExport }) {
  const c = D.client;
  const totalAmt = invoices.reduce((s, inv) => s + inv.amount, 0);

  return (
    <div className="fade-up">
      <div className="view-head">
        <div>
          <div className="view-title">Invoices</div>
          <div className="view-sub">
            <span className="meta-row"><i className="ti ti-user" /> {c.name}</span>
            <span className="meta-row"><i className="ti ti-receipt-2" /> {invoices.length} issued</span>
          </div>
        </div>
        <div className="stmt-actions">
          <button className="btn" onClick={onMake}><i className="ti ti-plus" style={{ fontSize: 15 }} /> Make invoice</button>
          <button className="btn-export" onClick={onExport}><i className="ti ti-table-export" /> Export Excel</button>
        </div>
      </div>

      <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stmt-cell"><div className="l">Issued</div><div className="v">{invoices.length}</div><div className="s">invoices</div></div>
        <div className="stmt-cell"><div className="l">Total billed</div><div className="v amber">{fmt(totalAmt)}</div><div className="s">incl. VAT</div></div>
        <div className="stmt-cell"><div className="l">Open</div><div className="v">{invoices.length}</div><div className="s">awaiting settlement</div></div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th style={{ width: 120 }}>Issued</th><th>Invoice</th>
            <th className="right" style={{ width: 100 }}>Amount</th><th className="right" style={{ width: 100 }}>Paid</th>
            <th className="right" style={{ width: 100 }}>Due</th><th style={{ width: 80 }}>Status</th>
          </tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={6} className="empty">No invoices issued yet — use “Make invoice” to create one</td></tr>}
            {invoices.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{inv.date}</td>
                <td>
                  <div style={{ fontWeight: 500, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{inv.id}</div>
                  {inv.note ? <div style={{ fontSize: 11, color: 'var(--text3)' }}>{inv.note}</div> : null}
                </td>
                <td className="num">{fmt(inv.amount)}</td>
                <td className="num green">{fmt(0)}</td>
                <td className="num amber" style={{ fontWeight: 600 }}>{fmt(inv.amount)}</td>
                <td>{statusBadge('unpaid')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════ WAREHOUSE SALES (full view) ════════════ */
function WarehouseView({ D, onExport }) {
  const c = D.client;
  const total = D.warehouse.reduce((s, w) => s + w.amount, 0);
  const totalKg = D.warehouse.reduce((s, w) => s + (parseFloat(String(w.kg).replace(/[^\d.]/g, '')) || 0), 0);

  return (
    <div className="fade-up">
      <div className="view-head">
        <div>
          <div className="view-title">Warehouse sales</div>
          <div className="view-sub">
            <span className="meta-row"><i className="ti ti-user" /> {c.name}</span>
            <span className="meta-row"><i className="ti ti-building-warehouse" /> {D.warehouse.length} purchases</span>
          </div>
        </div>
        <div className="stmt-actions">
          <button className="btn-export" onClick={onExport}><i className="ti ti-table-export" /> Export Excel</button>
        </div>
      </div>

      <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stmt-cell"><div className="l">Purchases</div><div className="v">{D.warehouse.length}</div><div className="s">transactions</div></div>
        <div className="stmt-cell"><div className="l">Total kg sold</div><div className="v">{totalKg.toLocaleString()} kg</div><div className="s">across all grades</div></div>
        <div className="stmt-cell"><div className="l">Total amount</div><div className="v amber">{fmt(total)}</div><div className="s">charged</div></div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th>Date</th><th>Ref</th><th>Bag type</th><th>Charcoal</th>
            <th className="right">Qty</th><th className="right">Kg sold</th><th className="right">Amount</th><th>Logged by</th>
          </tr></thead>
          <tbody>
            {D.warehouse.map((w, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{w.date}</td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text3)' }}>{w.code}</td>
                <td>{w.bagType === 'By kg'
                  ? <span className="badge badge-amber">By kg</span>
                  : <><div style={{ fontWeight: 500 }}>{w.bagType}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{w.bagSub}</div></>}</td>
                <td style={{ fontSize: 12, color: 'var(--text2)' }}>{w.charcoal}</td>
                <td className="num" style={{ fontWeight: 600 }}>{w.qty}</td>
                <td className="num" style={{ color: 'var(--text2)' }}>{w.kg}</td>
                <td className="num" style={{ fontWeight: 600, color: 'var(--accent2)' }}>{fmt(w.amount)}</td>
                <td style={{ fontSize: 12, color: 'var(--text3)' }}>{w.by}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={6} style={{ textAlign: 'right', background: 'var(--surface2)', fontWeight: 700 }}>Total</td>
            <td className="num amber" style={{ background: 'var(--surface2)', fontWeight: 700, borderTop: '2px solid var(--border2)' }}>{fmt(total)}</td>
            <td style={{ background: 'var(--surface2)', borderTop: '2px solid var(--border2)' }}></td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

/* ════════════ STATEMENT OF ACCOUNT (full view) ════════════ */
function isoToMs(iso) { return iso ? new Date(iso + 'T00:00:00').getTime() : null; }

function StatementView({ D, ledger, onExport }) {
  const c = D.client;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all'); // all | debit | credit
  const [q, setQ] = useState('');

  const fromMs = isoToMs(from), toMs = isoToMs(to);
  const filtered = ledger.filter(e => {
    const ms = parseDate(e.date);
    if (fromMs && ms < fromMs) return false;
    if (toMs && ms > toMs) return false;
    if (type === 'debit' && !e.debit) return false;
    if (type === 'credit' && !e.credit) return false;
    if (q && !(e.desc + ' ' + e.ref).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const fDebit = filtered.reduce((s, e) => s + e.debit, 0);
  const fCredit = filtered.reduce((s, e) => s + e.credit, 0);
  // opening = running balance just before the first shown row; closing = balance of last shown row
  const firstIdx = filtered.length ? ledger.indexOf(filtered[0]) : -1;
  const opening = firstIdx > 0 ? ledger[firstIdx - 1].balance : 0;
  const closing = filtered.length ? filtered[filtered.length - 1].balance : opening;
  const openingDate = filtered.length ? filtered[0].date : (ledger[0]?.date ?? todayLabel());
  const period = filtered.length ? `${filtered[0].date} — ${filtered[filtered.length - 1].date}` : '—';
  const filterActive = from || to || type !== 'all' || q;

  function reset() { setFrom(''); setTo(''); setType('all'); setQ(''); }

  return (
    <div className="fade-up stmt-view">
      <div className="view-head">
        <div>
          <div className="view-title">Statement of account</div>
          <div className="view-sub">
            <span className="meta-row"><i className="ti ti-user" /> {c.name}</span>
            <span className="meta-row"><i className="ti ti-calendar" /> {period}</span>
            <span className="meta-row"><i className="ti ti-currency-dollar" /> {c.currency}</span>
          </div>
        </div>
        <div className="stmt-actions">
          <button className="btn" onClick={() => window.print()}><i className="ti ti-printer" style={{ fontSize: 15 }} /> Print</button>
          <button className="btn-export" onClick={onExport}><i className="ti ti-table-export" /> Export Excel</button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="filter-row">
        <div className="filter-search">
          <i className="ti ti-search" />
          <input placeholder="Search description or ref…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="seg">
          {[['all', 'All'], ['debit', 'Charges'], ['credit', 'Payments']].map(([k, lbl]) => (
            <div key={k} className={`seg-opt ${type === k ? 'sel' : ''}`} onClick={() => setType(k)}>{lbl}</div>
          ))}
        </div>
        <div className="filter-dates">
          <span className="lbl">From</span>
          <input className="date-mini" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <span className="lbl">To</span>
          <input className="date-mini" type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        {filterActive ? <button className="btn" onClick={reset}><i className="ti ti-x" style={{ fontSize: 14 }} /> Reset</button> : null}
      </div>

      <div className="stmt-summary">
        <div className="stmt-cell"><div className="l">Opening balance</div><div className="v">{fmt(opening)}</div><div className="s">{openingDate}</div></div>
        <div className="stmt-cell"><div className="l">Total debit</div><div className="v amber">{fmt(fDebit)}</div><div className="s">charges &amp; invoices</div></div>
        <div className="stmt-cell"><div className="l">Total credit</div><div className="v green">{fmt(fCredit)}</div><div className="s">payments received</div></div>
        <div className="stmt-cell"><div className="l">Closing balance</div><div className={`v ${closing > 0 ? 'amber' : closing < 0 ? 'red' : 'green'}`}>{fmt(closing)}</div><div className="s">{closing > 0 ? 'owed by client' : closing < 0 ? 'in credit' : 'settled'}</div></div>
      </div>

      <div className="card">
        <table className="data-table stmt-table">
          <thead><tr>
            <th style={{ width: 120 }}>Date</th>
            <th style={{ width: 90 }}>Ref</th>
            <th>Description</th>
            <th className="right" style={{ width: 120 }}>Debit</th>
            <th className="right" style={{ width: 120 }}>Credit</th>
            <th className="right" style={{ width: 130 }}>Balance</th>
          </tr></thead>
          <tbody>
            <tr className="opening">
              <td className="mono">{openingDate}</td>
              <td></td>
              <td className="desc">Opening balance</td>
              <td className="num"></td><td className="num"></td>
              <td className="num">{fmt(opening)}</td>
            </tr>
            {filtered.map((e, i) => (
              <tr key={i}>
                <td className="mono">{e.date}</td>
                <td className="mono ref-cell">{e.ref}</td>
                <td className="desc">{e.desc}</td>
                <td className="num dr">{e.debit ? fmt(e.debit) : ''}</td>
                <td className="num cr">{e.credit ? fmt(e.credit) : ''}</td>
                <td className={`num ${e.balance < 0 ? 'bal-neg' : 'bal-pos'}`} style={{ fontWeight: 600 }}>{fmt(e.balance)}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="empty">No entries match this filter</td></tr>}
          </tbody>
          <tfoot><tr>
            <td colSpan={3} style={{ textAlign: 'right' }}>Totals</td>
            <td className="num dr">{fmt(fDebit)}</td>
            <td className="num cr">{fmt(fCredit)}</td>
            <td className="num">{fmt(closing)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

/* ════════════ ALL PAYMENTS (full view) ════════════ */
function PaymentsView({ D, payments, onExport, onLog }) {
  const c = D.client;
  const sorted = [...payments].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  let run = 0;
  const rows = sorted.map(p => { run += p.amount; return { ...p, run }; });
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const methodBadge = { cash: 'badge-green', whish: 'badge-blue', omt: 'badge-amber' };

  return (
    <div className="fade-up">
      <div className="view-head">
        <div>
          <div className="view-title">All payments</div>
          <div className="view-sub">
            <span className="meta-row"><i className="ti ti-user" /> {c.name}</span>
            <span className="meta-row"><i className="ti ti-cash" /> {payments.length} payments on record</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onLog}><i className="ti ti-plus" style={{ fontSize: 15 }} /> Log payment</button>
          <button className="btn-export" onClick={onExport}><i className="ti ti-table-export" /> Export Excel</button>
        </div>
      </div>

      <div className="stmt-summary" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stmt-cell"><div className="l">Total received</div><div className="v green">{fmt(total)}</div><div className="s">all time</div></div>
        <div className="stmt-cell"><div className="l">Payments</div><div className="v">{payments.length}</div><div className="s">transactions</div></div>
        <div className="stmt-cell"><div className="l">Last payment</div><div className="v">{last ? fmt(last.amount) : '—'}</div><div className="s">{last ? last.date : '—'}</div></div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th style={{ width: 130 }}>Date</th><th style={{ width: 90 }}>Method</th>
            <th>Reference</th><th>Received by</th>
            <th className="right" style={{ width: 120 }}>Amount</th><th className="right" style={{ width: 140 }}>Running total</th>
          </tr></thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5 }}>{p.date}</td>
                <td><span className={`badge ${methodBadge[p.method] ?? 'badge-gray'}`}>{p.method}</span></td>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: 'var(--text2)' }}>{p.code || p.ref}</td>
                <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{p.by}</td>
                <td className="num green" style={{ fontWeight: 600 }}>+{fmt(p.amount)}</td>
                <td className="num" style={{ color: 'var(--text2)' }}>{fmt(p.run)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={4} style={{ textAlign: 'right', background: 'var(--surface2)', fontWeight: 700 }}>Total received</td>
            <td className="num green" style={{ background: 'var(--surface2)', fontWeight: 700, borderTop: '2px solid var(--border2)' }}>{fmt(total)}</td>
            <td style={{ background: 'var(--surface2)', borderTop: '2px solid var(--border2)' }}></td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

/* ════════════ PAYMENT MODAL ════════════ */
function PaymentModal({ D, outstanding, onClose, onSave }) {
  const [date, setDate] = useState(todayLabel());
  const [method, setMethod] = useState('cash');
  const [amt, setAmt] = useState('');
  const [by, setBy] = useState('Dev owner');
  const [note, setNote] = useState('');
  const n = parseFloat(amt) || 0;

  function genRef() {
    return 'RV-' + (8094 + Math.floor(Math.random() * 900));
  }
  function save() {
    if (n <= 0) return;
    const code = genRef();
    onSave({ date, method, code, ref: code, by: by || 'Dev owner', amount: n });
  }
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-head">
          <div className="modal-title"><i className="ti ti-receipt" style={{ marginRight: 8 }} />Log payment</div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><span className="field-label">Date</span><input className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="field"><span className="field-label">Amount (USD)</span><input className="input num" type="number" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00" /></div>
            <div className="field full">
              <span className="field-label">Method</span>
              <div className="method-pills">
                {['cash', 'whish', 'omt'].map(m => (
                  <div key={m} className={`method-pill ${method === m ? 'sel' : ''}`} onClick={() => setMethod(m)}>{m.charAt(0).toUpperCase() + m.slice(1)}</div>
                ))}
              </div>
            </div>
            <div className="field"><span className="field-label">Received by</span>
              <select className="select" value={by} onChange={e => setBy(e.target.value)}>
                {['Dev owner', 'Khalil Abi Nader', 'Rita Salameh', 'Owner'].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="field"><span className="field-label">Reference / note</span><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. cheque #4521" /></div>
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>deducts from outstanding {fmt(outstanding)}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn green" onClick={save} disabled={n <= 0}><i className="ti ti-check" style={{ fontSize: 15 }} /> Log payment</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════ INVOICE MODAL ════════════ */
function InvoiceModal({ D, onClose, onSave }) {
  const [date, setDate] = useState(todayLabel());
  const [order, setOrder] = useState(D.orders[0] ? D.orders[0].id : '');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const n = parseFloat(amt) || 0;
  const vat = +(n * 0.11).toFixed(2);

  function genId() {
    const num = String(Math.floor(Math.random() * 900) + 100);
    return `SE-4${num}`;
  }
  function save() {
    if (n <= 0) return;
    const orderObj = D.orders.find(o => o.id === order);
    onSave({ id: genId(), date, amount: +(n + vat).toFixed(2), note: orderObj ? orderObj.char : 'sales charge', orderId: order });
  }
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 540 }}>
        <div className="modal-head">
          <div className="modal-title"><i className="ti ti-file-invoice" style={{ marginRight: 8 }} />Make invoice</div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><span className="field-label">Invoice date</span><input className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="field"><span className="field-label">Amount (USD, pre-VAT)</span><input className="input num" type="number" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00" /></div>
            <div className="field full"><span className="field-label">From order</span>
              <select className="select" value={order} onChange={e => setOrder(e.target.value)}>
                {D.orders.map(o => <option key={o.id} value={o.id}>{o.char}{o.sub ? ` · ${o.sub}` : ''} — {o.weight} ({o.id})</option>)}
              </select>
            </div>
            <div className="field full"><span className="field-label">Note (optional)</span><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. June wholesale delivery" /></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', marginTop: 16, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: 'var(--text2)' }}>
            <div>Subtotal · {fmt(n)}</div>
            <div>VAT (11%) · {fmt(vat)}</div>
            <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)', width: 240, textAlign: 'right' }}>
              Total <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent)', letterSpacing: -0.5, marginLeft: 6 }}>{fmt(n + vat)}</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn green" onClick={save} disabled={n <= 0}><i className="ti ti-check" style={{ fontSize: 15 }} /> Issue invoice</button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
