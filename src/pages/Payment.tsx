import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/layout/Topbar'
import { useToast } from '../context/ToastContext'
import { useClients } from '../hooks/useClients'
import { useInvoices } from '../hooks/useInvoices'
import { useCreatePayment } from '../hooks/usePayments'
import { useArSummary } from '../hooks/useReports'
import type { CreatePaymentDto, PaymentMethod } from '../types/api'

const METHODS: { id: PaymentMethod; label: string; sub: string; icon: string }[] = [
  { id: 'cash',  label: 'Cash',  sub: 'most common', icon: 'ti-cash' },
  { id: 'whish', label: 'Whish', sub: 'mobile transfer', icon: 'ti-device-mobile' },
  { id: 'omt',   label: 'OMT',   sub: 'money transfer', icon: 'ti-send' },
]

export default function Payment() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [amount, setAmount] = useState(500)
  const [curr, setCurr] = useState<'USD' | 'LBP'>('USD')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')

  const { data: clientsRes } = useClients()
  const clients = clientsRes?.data ?? []
  const selectedClient = clients.find(c => c.id === selectedClientId)

  // Invoices are fetched reactively once a client is selected (hook is gated by clientId).
  const { data: invoicesRes } = useInvoices(selectedClientId ? { clientId: selectedClientId } : undefined)
  const invoices = selectedClientId ? (invoicesRes?.data ?? []) : []

  const createPayment = useCreatePayment()
  const arQ = useArSummary()
  const totalOutstanding = parseFloat(arQ.data?.totalOutstanding ?? '0')
  const totalCollected = parseFloat(arQ.data?.totalCollected ?? '0')

  const BALANCE = selectedClient ? Number(selectedClient.balance) : 0
  const applied_total = Math.min(amount, BALANCE)
  const remaining = Math.max(0, BALANCE - applied_total)
  const pct = BALANCE > 0 ? Math.min(100, Math.round((applied_total / BALANCE) * 100)) : 0

  function handleSave() {
    if (!selectedClientId) {
      showToast('Select a client first')
      return
    }
    if (amount <= 0) {
      showToast('Enter an amount greater than zero')
      return
    }
    if (BALANCE > 0 && amount > BALANCE) {
      showToast(`Amount exceeds balance — max $${BALANCE.toFixed(2)}`)
      return
    }
    const body: CreatePaymentDto = {
      clientId: selectedClientId,
      invoiceId: selectedInvoiceId || null,
      amount: amount.toFixed(2),
      currency: curr,
      method,
      date: payDate,
      notes: notes || null,
    }
    createPayment.mutate(body, {
      onSuccess: () => {
        showToast('Payment logged')
        setAmount(0)
        setRef('')
        setNotes('')
        setSelectedInvoiceId('')
        setPayDate(new Date().toISOString().slice(0, 10))
      },
      onError: (err) => {
        const message =
          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ??
          (err as Error)?.message ??
          'Failed to log payment'
        showToast(message)
      },
    })
  }

  const presets = [
    ...(BALANCE > 0 ? [{ label: `$${BALANCE.toFixed(2)} · full balance`, val: BALANCE }] : []),
    { label: '$500', val: 500 },
    { label: '$200', val: 200 },
    { label: '$100', val: 100 },
  ].filter(p => p.val > 0)

  return (
    <>
      <Topbar title="Log payment">
        <button className="btn" style={{ marginLeft: 'auto' }}><i className="ti ti-history" style={{ fontSize: 15 }} /> Recent payments</button>
        <button className="btn" onClick={() => navigate('/balances')}>Cancel</button>
      </Topbar>
      <div className="content">

        {/* Hero */}
        <div className="pay-hero">
          <div className="mono"><i className="ti ti-cash" /></div>
          <h1>
            New payment
            <small>logged {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · by Khalil (owner)</small>
          </h1>
          <div className="hero-stat">
            <div className="v amber">{arQ.isLoading ? '…' : `$${totalOutstanding.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</div>
            <div className="k">total outstanding</div>
          </div>
          <div className="hero-stat">
            <div className="v green">{arQ.isLoading ? '…' : `$${totalCollected.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</div>
            <div className="k">collected (all time)</div>
          </div>
        </div>

        {/* Client switcher */}
        <div className="client-switch">
          <div className="switch-av">{selectedClient ? selectedClient.name.slice(0, 2).toUpperCase() : '—'}</div>
          <div className="switch-info">
            <div className="switch-name">{selectedClient ? selectedClient.name : 'Select a client'}</div>
            <div className="switch-meta">
              <select
                className="input"
                value={selectedClientId}
                onChange={e => { setSelectedClientId(e.target.value); setSelectedInvoiceId('') }}
              >
                <option value="">Select a client…</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="switch-balance">
            ${BALANCE.toFixed(2)}
            <span className="small">outstanding</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 14, alignItems: 'start' }}>
          <div className="stack">

            {/* Amount */}
            <div className="amount-card">
              <div className="amount-label">amount received</div>
              <div className="amount-row">
                <span className="amount-sym">$</span>
                <input
                  className="amount-input"
                  type="number"
                  value={amount || ''}
                  step={0.01}
                  onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
                <div className="amount-curr">
                  <div className={`opt ${curr === 'USD' ? 'sel' : ''}`} onClick={() => setCurr('USD')}>USD</div>
                  <div className={`opt ${curr === 'LBP' ? 'sel' : ''}`} onClick={() => setCurr('LBP')}>LBP</div>
                </div>
              </div>
              <div className="preset-row">
                {presets.map(p => (
                  <span className="preset" key={p.val} onClick={() => setAmount(p.val)}>{p.label}</span>
                ))}
              </div>
              <div className="amount-foot">
                <span><span className="lbl">applying to</span> <span className="val green">${Math.min(amount, BALANCE).toFixed(2)}</span></span>
                {amount > BALANCE && BALANCE > 0 && (
                  <span><span className="lbl" style={{ color: 'var(--red)' }}>exceeds balance by</span> <span className="val" style={{ color: 'var(--red)' }}>${(amount - BALANCE).toFixed(2)}</span></span>
                )}
                <span style={{ marginLeft: 'auto' }}><span className="lbl">after this</span> <span className="val amber">${remaining.toFixed(2)} remaining</span></span>
              </div>
            </div>

            {/* Method */}
            <div className="field-card">
              <div className="field-card-head">payment method</div>
              <div className="method-grid">
                {METHODS.map(m => (
                  <div key={m.id} className={`method ${method === m.id ? 'sel' : ''}`} onClick={() => setMethod(m.id)}>
                    <i className={`ti ${m.icon}`} />
                    <span className="nm">{m.label}</span>
                    <span className="sub">{m.sub}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Apply to invoices */}
            <div className="field-card" style={{ padding: 0 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Apply to invoices</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>payment is split oldest-first by default · adjust amounts if needed</div>
                </div>
              </div>
              <div className="apply-row head">
                <span />
                <span>Invoice</span>
                <span>Order / item</span>
                <span className="right">Outstanding</span>
                <span className="right">Age</span>
                <span className="right">Apply</span>
              </div>
              {invoices.map(inv => {
                const on = selectedInvoiceId === inv.id
                const outstanding = Number(inv.total) - Number(inv.paidAmount)
                return (
                  <div key={inv.id} className={`apply-row ${on ? 'sel' : ''}`}>
                    <div className={`check ${on ? 'on' : ''}`} onClick={() => setSelectedInvoiceId(on ? '' : inv.id)} />
                    <div>
                      <div className="inv-id" title={inv.id}>{inv.displayId ?? inv.id}</div>
                      <div className="inv-due">{inv.dueDate ? `due ${new Date(inv.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : inv.status}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{inv.lines.map(l => l.saleUnit === 'KG' ? `${l.kgQuantity}kg ${l.description}` : `${l.qty}× ${l.bagTypeName}`).join(' + ')}</div>
                    <div className="num">${outstanding.toFixed(2)}</div>
                    <div style={{ textAlign: 'right' }}><span className="age-pill ok">{inv.status}</span></div>
                    <input
                      className="apply-input"
                      type="number"
                      value={on ? outstanding.toFixed(2) : 0}
                      disabled
                      step={0.01}
                      readOnly
                    />
                  </div>
                )
              })}
              {selectedClientId && invoices.length === 0 && (
                <div className="apply-row" style={{ color: 'var(--text3)', fontSize: 12.5 }}>
                  <span /><span>No open invoices for this client</span>
                </div>
              )}
              <div className="apply-foot">
                <span>{invoices.length} open invoices · ${BALANCE.toFixed(2)} outstanding</span>
                <span className="total">Applied ${applied_total.toFixed(2)}</span>
              </div>
            </div>

            {/* Date & notes */}
            <div className="field-card">
              <div className="field-card-head">date &amp; reference</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label className="field-label">Payment date</label>
                  <input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Reference (OMT / Whish #)</label>
                  <input className="input" type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="optional · OMT-883920" />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>Notes (Arabic supported)</label>
                <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. paid to driver Joseph on delivery" />
              </div>
            </div>

          </div>

          {/* Receipt */}
          <div className="receipt">
            <div className="receipt-head">
              <span>Payment summary</span>
              <span className="id">PAY-0341</span>
            </div>
            <div className="receipt-body">
              <div className="r-row"><span className="lbl">Client</span><span className="val">{selectedClient ? selectedClient.name : '—'}</span></div>
              <div className="r-row"><span className="lbl">Date</span><span className="val">{new Date(payDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              <div className="r-row"><span className="lbl">Method</span><span className="val">{METHODS.find(m => m.id === method)?.label}</span></div>
              <div className="r-row"><span className="lbl">Logged by</span><span className="val">Khalil (owner)</span></div>
              <hr className="r-divider" />
              <div className="r-row"><span className="lbl">Balance before</span><span className="val">${BALANCE.toFixed(2)}</span></div>
              <div className="r-row green"><span className="lbl">− Payment received</span><span className="val">${amount.toFixed(2)}</span></div>
              <hr className="r-divider" />
              <div className="r-row big amber"><span className="lbl">Balance after</span><span className="val">${remaining.toFixed(2)}</span></div>
            </div>
            <div className="pay-balance-bar">
              <div className="fill" style={{ width: `${pct}%` }} />
              <div className="bar-lbl">{pct}% of balance paid</div>
            </div>
            <div style={{ padding: '12px 18px', fontSize: 11.5, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text)', fontFamily: "'IBM Plex Sans',sans-serif", fontWeight: 600 }}>Applied to</strong>
              {selectedInvoiceId
                ? <div style={{ marginTop: 4 }}>{selectedInvoiceId} · ${applied_total.toFixed(2)}</div>
                : <div style={{ marginTop: 4 }}>unapplied · ${amount.toFixed(2)}</div>}
            </div>
            <div className="save-row">
              <button className="btn"><i className="ti ti-printer" style={{ fontSize: 14 }} /> Print receipt</button>
              <button
                className="btn green big"
                disabled={createPayment.isPending}
                onClick={handleSave}
              >
                <i className="ti ti-check" style={{ fontSize: 15 }} /> {createPayment.isPending ? 'Saving…' : 'Save payment'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
