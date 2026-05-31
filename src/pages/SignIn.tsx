import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSignIn, useAuth } from '@clerk/clerk-react'
import { DEV, setDevRole } from '../lib/devAuth'

const ROLE_HOME: Record<string, string> = {
  owner: '/dashboard',
  accountant: '/reports',
  sales_rep: '/orders',
  worker: '/packing',
  driver: '/driver-mobile',
}

const ROLE_EMAILS: Record<string, string> = {
  owner: 'owner@charcoal.com',
  accountant: 'accountant@charcoal.com',
  sales_rep: 'sales@charcoal.com',
  worker: 'worker@charcoal.com',
  driver: 'driver@charcoal.com',
}

export default function SignIn() {
  const navigate = useNavigate()
  const { isLoaded, signIn, setActive } = useSignIn()
  const { getToken } = useAuth()
  const [email, setEmail] = useState('owner@charcoal.com')
  const [pwd, setPwd] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'credentials' | 'second_factor'>('credentials')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function redirectByRole() {
    let role: string | undefined
    try {
      const token = await getToken()
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]))
        role = payload?.metadata?.role
      }
    } catch {
      role = undefined
    }
    navigate(ROLE_HOME[role ?? ''] ?? '/dashboard', { replace: true })
  }

  async function handleCredentials(e?: React.FormEvent) {
    e?.preventDefault()
    if (!isLoaded || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await signIn.create({ identifier: email, password: pwd })
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        await redirectByRole()
      } else if (result.status === 'needs_second_factor') {
        console.log('2FA factors:', JSON.stringify(result.supportedSecondFactors))
        setStep('second_factor')
      } else {
        setError(`Unexpected status: ${result.status}`)
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? 'Sign in failed. Check your credentials.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSecondFactor(e?: React.FormEvent) {
    e?.preventDefault()
    if (!isLoaded || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      // Try TOTP first, fall back to backup code
      let result: any
      try {
        result = await signIn!.attemptSecondFactor({ strategy: 'totp', code })
      } catch {
        result = await signIn!.attemptSecondFactor({ strategy: 'backup_code', code })
      }
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        await redirectByRole()
      } else {
        setError(`Unexpected status: ${result.status}`)
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? 'Invalid code. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const Branding = () => (
    <div className="signin-left">
      <div className="brand-block">
        <div className="logo-mark"><i className="ti ti-flame" /></div>
        <div>
          <div className="logo-text">Farah Charcoal</div>
          <div className="logo-sub">management system</div>
        </div>
      </div>
      <div className="marketing">
        <h2>Run the warehouse, the route, and the ledger from one place.</h2>
        <p>Container costing, packing reconciliation, client CRM and driver delivery — built for the way your business actually works.</p>
        <ul>
          <li><i className="ti ti-ship" /> container → lot → bag, traced end-to-end</li>
          <li><i className="ti ti-truck" /> mobile driver flow with on-site receipts</li>
          <li><i className="ti ti-language" /> Arabic-supported fields, USD &amp; LBP currencies</li>
        </ul>
      </div>
      <div className="signin-foot">© 2026 Farah Charcoal · v1.0 · Beirut, LB</div>
    </div>
  )

  if (!isLoaded) return (
    <div className="signin-wrap">
      <Branding />
      <div className="signin-right">
        <div className="signin-form" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ti ti-loader-2 spin" style={{ fontSize: 28, color: 'var(--text3)' }} />
        </div>
      </div>
    </div>
  )

  if (step === 'second_factor') return (
    <div className="signin-wrap">
      <Branding />
      <div className="signin-right">
        <form className="signin-form" onSubmit={handleSecondFactor}>
          <h1>Two-step verification</h1>
          <p className="lede">Enter the 6-digit code from your authenticator app, or a backup code from your Clerk account.</p>

          <div className="field">
            <label className="field-label" htmlFor="code">Verification code</label>
            <div className="input-wrap">
              <i className="ti ti-shield-check" />
              <input
                className="input"
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\s/g, ''))}
                autoFocus
              />
            </div>
          </div>

          {error && <div style={{ color: 'var(--danger, #C0392B)', fontSize: 12.5, marginTop: -4 }}>{error}</div>}

          <button className="signin-submit" type="submit" disabled={submitting}>
            {submitting ? 'Verifying…' : 'Verify'}
            <i className="ti ti-arrow-right" style={{ fontSize: 15 }} />
          </button>

          <div className="foot-note" style={{ marginTop: 16 }}>
            No authenticator app? Go to{' '}
            <a href="https://dashboard.clerk.com" target="_blank" rel="noreferrer">Clerk dashboard</a>
            {' '}→ Users → owner@charcoal.com → Multi-factor authentication → remove all methods, then{' '}
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              onClick={() => { setStep('credentials'); setError(null); setCode('') }}>
              go back
            </button>.
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <div className="signin-wrap">
      <Branding />
      <div className="signin-right">
        <form className="signin-form" onSubmit={handleCredentials}>
          <h1>Sign in</h1>
          <p className="lede">Welcome back. Use your work email and password.</p>

          <div className="field">
            <label className="field-label" htmlFor="email">Email</label>
            <div className="input-wrap">
              <i className="ti ti-send" />
              <input className="input" id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <div className="field-row">
              <label className="field-label" htmlFor="pwd">Password</label>
            </div>
            <div className="input-wrap">
              <i className="ti ti-lock" />
              <input className="input" id="pwd" type="password" autoComplete="current-password" value={pwd} onChange={e => setPwd(e.target.value)} />
            </div>
          </div>

          {error && <div style={{ color: 'var(--danger, #C0392B)', fontSize: 12.5, marginTop: -4 }}>{error}</div>}

          <button className="signin-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
            <i className="ti ti-arrow-right" style={{ fontSize: 15 }} />
          </button>

          <div className="signin-divider">or jump in as</div>

          <div className="role-picker">
            <button type="button" className="role-pill" onClick={() => setEmail(ROLE_EMAILS.owner)}>
              <i className="ti ti-id-badge" /><span className="role-name">Owner</span>
            </button>
            <button type="button" className="role-pill" onClick={() => setEmail(ROLE_EMAILS.accountant)}>
              <i className="ti ti-calculator" /><span className="role-name">Accountant</span>
            </button>
            <button type="button" className="role-pill" onClick={() => setEmail(ROLE_EMAILS.sales_rep)}>
              <i className="ti ti-receipt" /><span className="role-name">Sales rep</span>
            </button>
            <button type="button" className="role-pill" onClick={() => setEmail(ROLE_EMAILS.worker)}>
              <i className="ti ti-tools" /><span className="role-name">Worker</span>
            </button>
            <button type="button" className="role-pill" onClick={() => setEmail(ROLE_EMAILS.driver)} style={{ gridColumn: 'span 2' }}>
              <i className="ti ti-truck" /><span className="role-name">Driver</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', fontFamily: "'IBM Plex Mono',monospace" }}>mobile</span>
            </button>
          </div>

          <div className="foot-note">pick a role to pre-fill its email · then enter the password</div>

          {DEV && (
            <>
              <div className="signin-divider" style={{ marginTop: 24 }}>dev login (localhost only)</div>
              <div className="role-picker">
                {(['owner', 'accountant', 'sales_rep', 'worker', 'driver'] as const).map(role => (
                  <button
                    key={role}
                    type="button"
                    className="role-pill"
                    style={{ background: 'var(--surface2, #2a2a2a)', border: '1px dashed var(--border)' }}
                    onClick={() => { setDevRole(role); navigate(ROLE_HOME[role], { replace: true }) }}
                  >
                    <span className="role-name">{role.replace('_', ' ')}</span>
                  </button>
                ))}
              </div>
              <div className="foot-note">bypasses Clerk — only works in development</div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
