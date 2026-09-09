import { describe, it, expect } from 'vitest'
import {
  computeYieldPct,
  uniformBagTypeLabel,
  mapSessionCharcoal,
  computeSessionCosts,
} from './Packing'

// ---------------------------------------------------------------------------
// Regression coverage for the Packing Session detail redesign (forensic
// audit, 2026-08-28): the screen must never imply that finished output came
// from a single charcoal lot/grade when the session actually consumed more
// than one, and the cost/yield figures it shows must match the same formulas
// already used elsewhere (COGS = Σ kgUsed × lot.costPerKg, worker cost =
// backend-snapshotted sessionEarnings — never recomputed from a live rate).
//
// The multi-lot fixture below (2000kg Grade B @ $1.00/kg + 3010kg Grade A @
// $0.50/kg → 1000 bags, $120 worker cost) is the REAL packing session found
// in the dev DB (id e194a1f4-236b-4931-8fc0-6d60bdff4e79, worker "brahim
// dakar", 2026-08-28) — verified against live Postgres, not invented.
// ---------------------------------------------------------------------------

describe('computeYieldPct', () => {
  it('computes finished-weight / material-consumed as a percentage', () => {
    // Real session: 5000 kg out of 5010 kg in.
    expect(computeYieldPct(5000, 5010)).toBeCloseTo(99.8004, 3)
  })

  it('returns 100% when nothing was lost', () => {
    expect(computeYieldPct(1000, 1000)).toBe(100)
  })

  it('returns 0 when no material was consumed (avoids divide-by-zero)', () => {
    expect(computeYieldPct(0, 0)).toBe(0)
  })

  it('can exceed 100% if output somehow exceeds input (surfaces the anomaly rather than hiding it)', () => {
    expect(computeYieldPct(110, 100)).toBeCloseTo(110, 5)
  })
})

describe('uniformBagTypeLabel', () => {
  const labels = new Map([
    ['bt-5kg', '5kg picking ayin'],
    ['bt-2kg', '2kg BBQ Hardwood'],
  ])

  it('one input lot → one output: returns the single bag type label', () => {
    const out = uniformBagTypeLabel([{ bagTypeId: 'bt-5kg' }], labels)
    expect(out).toBe('5kg picking ayin')
  })

  it('multiple input lots/grades → one output: still returns the single bag type label (multiple qty lines, same bagTypeId)', () => {
    const out = uniformBagTypeLabel(
      [{ bagTypeId: 'bt-5kg' }, { bagTypeId: 'bt-5kg' }],
      labels,
    )
    expect(out).toBe('5kg picking ayin')
  })

  it('multiple output bag types → returns null (must NOT silently name only the first)', () => {
    const out = uniformBagTypeLabel(
      [{ bagTypeId: 'bt-5kg' }, { bagTypeId: 'bt-2kg' }],
      labels,
    )
    expect(out).toBeNull()
  })

  it('empty bagsOutput → null', () => {
    expect(uniformBagTypeLabel([], labels)).toBeNull()
  })

  it('unknown bagTypeId → null (never falls back to a stale/guessed label)', () => {
    expect(uniformBagTypeLabel([{ bagTypeId: 'unknown' }], labels)).toBeNull()
  })
})

describe('mapSessionCharcoal', () => {
  it('one input lot: returns exactly one row with its own type/grade', () => {
    const rows = mapSessionCharcoal([
      { lotId: 'lot-b', kgUsed: '2000.000', lot: { charcoalType: 'PICKING AYIN', grade: 'B', costPerKg: '1.0000' } },
    ])
    expect(rows).toEqual([
      { lotId: 'lot-b', charcoalType: 'PICKING AYIN', grade: 'B', kg: 2000, costPerKg: 1 },
    ])
  })

  it('multiple input lots/grades: every lot is represented separately, never merged into one row', () => {
    const rows = mapSessionCharcoal([
      { lotId: 'lot-b', kgUsed: '2000.000', lot: { charcoalType: 'PICKING AYIN', grade: 'B', costPerKg: '1.0000' } },
      { lotId: 'lot-a', kgUsed: '3010.000', lot: { charcoalType: 'ayin pickings', grade: 'A', costPerKg: '0.5000' } },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ charcoalType: 'PICKING AYIN', grade: 'B', kg: 2000 })
    expect(rows[1]).toMatchObject({ charcoalType: 'ayin pickings', grade: 'A', kg: 3010 })
    // Correct total material input — 2000 + 3010, never blended into one figure.
    expect(rows.reduce((s, r) => s + r.kg, 0)).toBe(5010)
  })

  it('missing lot relation: falls back to a truncated id rather than crashing', () => {
    const rows = mapSessionCharcoal([{ lotId: 'abcdef1234567890', kgUsed: '10.000' }])
    expect(rows[0].charcoalType).toBe('abcdef12…')
    expect(rows[0].grade).toBe('')
  })

  it('empty sessionLots: returns an empty array', () => {
    expect(mapSessionCharcoal([])).toEqual([])
  })
})

describe('computeSessionCosts', () => {
  const bagTypeCostMap = new Map([
    ['bt-5kg', { costPerBag: 0.05, workerRate: 0.12 }],
  ])

  it('reproduces the real multi-lot session exactly: COGS $3505, bag cost $50, worker cost $120', () => {
    const sessionLots = [
      { kgUsed: '2000.000', lot: { costPerKg: '1.0000' } },
      { kgUsed: '3010.000', lot: { costPerKg: '0.5000' } },
    ]
    const bagsOutput = [{ bagTypeId: 'bt-5kg', qty: 1000 }]
    const result = computeSessionCosts(sessionLots, bagsOutput, bagTypeCostMap, '120.00')

    expect(result.charcoalCost).toBeCloseTo(3505, 5) // 2000×1.00 + 3010×0.50
    expect(result.bagCost).toBeCloseTo(50, 5)          // 1000×0.05
    expect(result.workerCost).toBe(120)
    expect(result.totalCost).toBeCloseTo(3675, 5)      // 3505 + 50 + 120
  })

  it('one input lot: charcoal cost is that single lot only', () => {
    const result = computeSessionCosts(
      [{ kgUsed: '500.000', lot: { costPerKg: '2.0000' } }],
      [{ bagTypeId: 'bt-5kg', qty: 100 }],
      bagTypeCostMap,
      '12.00',
    )
    expect(result.charcoalCost).toBe(1000)
  })

  it('worker cost never recomputes from a live bag-type rate — it always uses the backend-snapshotted sessionEarnings', () => {
    // bagTypeCostMap's workerRate (0.12) is deliberately different from the
    // amount sessionEarnings claims — proves the function reads the snapshot,
    // not qty × current rate (qty×0.12 would be 12.00, not 999.00).
    const result = computeSessionCosts(
      [],
      [{ bagTypeId: 'bt-5kg', qty: 100 }],
      bagTypeCostMap,
      '999.00',
    )
    expect(result.workerCost).toBe(999)
  })

  it('missing/null optional data (no lot cost, no sessionEarnings): degrades to zero, not NaN or a crash', () => {
    const result = computeSessionCosts(
      [{ kgUsed: '100.000' }],
      [],
      new Map(),
      null,
    )
    expect(result).toEqual({ charcoalCost: 0, bagCost: 0, workerCost: 0, totalCost: 0 })
  })
})
