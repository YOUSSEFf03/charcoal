import type { SetOpeningBalanceDto } from '../../types/api'
import { toDateOnlyString } from '../../lib/date'

/**
 * Optional "opening balance" block for the New client / New supplier forms —
 * the go-live carry-forward from the old books, entered once when the
 * account is created. Owner only (the backend rejects it for other roles),
 * so callers render it only when the current user is the owner.
 *
 * The amount is typed as a positive number and the direction picks the sign,
 * so nobody has to remember which way "negative" means.
 */
export interface OpeningBalanceValue {
  amount: string
  /** true = the default direction (client owes us / we owe the supplier). */
  positive: boolean
  date: string
}

export function emptyOpeningBalance(): OpeningBalanceValue {
  return { amount: '', positive: true, date: toDateOnlyString(new Date()) }
}

/** Form value → API body; undefined when nothing (or zero) was entered. */
export function toOpeningBalanceDto(v: OpeningBalanceValue): SetOpeningBalanceDto | undefined {
  const n = parseFloat(v.amount)
  if (!Number.isFinite(n) || n === 0) return undefined
  const abs = Math.abs(n).toFixed(2)
  return { amount: v.positive ? abs : `-${abs}`, date: v.date }
}

/** Typed-but-invalid amount (blank is fine — the balance is optional). */
export function isOpeningBalanceInvalid(v: OpeningBalanceValue): boolean {
  if (v.amount.trim() === '') return false
  const n = parseFloat(v.amount)
  return !Number.isFinite(n) || n < 0 || !v.date
}

export default function OpeningBalanceFields({
  value, onChange, currency, positiveLabel, negativeLabel,
}: {
  value: OpeningBalanceValue
  onChange: (next: OpeningBalanceValue) => void
  currency: string
  positiveLabel: string
  negativeLabel: string
}) {
  const invalid = isOpeningBalanceInvalid(value)
  return (
    <div className="form-group">
      <label className="form-label">Opening balance (optional)</label>
      <div className="flex gap-2">
        <input
          className="form-input flex-1"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder={`0.00 ${currency}`}
          aria-label={`Opening balance amount in ${currency}`}
          value={value.amount}
          onChange={e => onChange({ ...value, amount: e.target.value })}
        />
        <input
          className="form-input w-40"
          type="date"
          aria-label="Opening balance date"
          value={value.date}
          onChange={e => onChange({ ...value, date: e.target.value })}
        />
      </div>
      <div className="method-pills mt-2" role="radiogroup" aria-label="Who owes whom">
        {[true, false].map(pos => (
          <div
            key={String(pos)}
            role="radio"
            aria-checked={value.positive === pos}
            tabIndex={0}
            className={`method-pill ${value.positive === pos ? 'sel' : ''}`}
            onClick={() => onChange({ ...value, positive: pos })}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange({ ...value, positive: pos }) } }}
          >
            {pos ? positiveLabel : negativeLabel}
          </div>
        ))}
      </div>
      {invalid && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>Enter a positive amount and a date</div>}
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
        Balance from the old books as of the go-live date. Leave empty if nothing is owed.
      </div>
    </div>
  )
}
