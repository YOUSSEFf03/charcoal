/* ── Mock data for client "abou 3azam" — modelled on the live screenshot ──
   Warehouse sales are charges (debit); payments are credits.
   845.00 charged − 823.00 paid = 22.00 outstanding (matches the hero KPI). */
window.DATA = {
  client: {
    id: 'CL-1001',
    name: 'abou 3azam',
    initials: 'A3',
    type: 'wholesale',
    currency: 'USD',
    since: '30 May 2026',
    outstanding: 22.00,
    openInvoices: 0,
    daysSinceOrder: 2,
    avgDays: 0,
    terms: 'Net 14 days from invoice',
    notesAr: '',
    notesEn: 'Pays on collection — calls before each pickup.',
  },

  phones: [
    { number: '81233129', label: 'mobile', active: true },
  ],

  preferred: [],

  orders: [
    { date: '02 Jun 2026', id: 'SE-4003', char: 'BBQ Hardwood · A', sub: '1.8 Kg Bag', isBag: true, weight: '9 kg', status: 'draft' },
    { date: '02 Jun 2026', id: 'SE-4002', char: 'BBQ Hardwood · A', sub: '1.8 Kg Bag', isBag: true, weight: '1,800 kg', status: 'delivered' },
    { date: '02 Jun 2026', id: 'SE-4001', char: 'shisha · A', sub: '', isBag: false, weight: '2,000 kg', status: 'delivered' },
  ],

  invoices: [],

  warehouse: [
    { date: '03 Jun 2026', code: 'O-3004', bagType: 'By kg', charcoal: 'shisha cubes · Grade A', qty: '—', kg: '100.0 kg', amount: 102.00, by: 'Dev owner' },
    { date: '01 Jun 2026', code: 'O-3003', bagType: '1.8 Kg Bag', bagSub: '1.8 kg/bag', charcoal: 'ayin pickings · Grade B', qty: 10, kg: '18.0 kg', amount: 18.00, by: 'Dev owner' },
    { date: '30 May 2026', code: 'O-3001', bagType: 'By kg', charcoal: 'BBQ Hardwood · Grade A', qty: '—', kg: '500.0 kg', amount: 365.00, by: 'Dev owner' },
    { date: '30 May 2026', code: 'O-3002', bagType: 'By kg', charcoal: 'ayin pickings · Grade B', qty: '—', kg: '500.0 kg', amount: 360.00, by: 'Dev owner' },
  ],

  payments: [
    { date: '30 May 2026', code: 'RV-8090', method: 'cash',  ref: 'RV-8090', by: 'Dev owner', amount: 365.00 },
    { date: '01 Jun 2026', code: 'RV-8091', method: 'whish', ref: 'RV-8091', by: 'Dev owner', amount: 18.00 },
    { date: '02 Jun 2026', code: 'RV-8092', method: 'omt',   ref: 'RV-8092', by: 'Dev owner', amount: 360.00 },
    { date: '03 Jun 2026', code: 'RV-8093', method: 'cash',  ref: 'RV-8093', by: 'Dev owner', amount: 80.00 },
  ],
};
