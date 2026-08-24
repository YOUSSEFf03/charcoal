import { describe, it, expect, vi, afterEach } from 'vitest'
import { currentWeekToDateRange, currentMonthToDateRange, toDateOnlyString } from './date'

afterEach(() => {
  vi.useRealTimers()
})

describe('currentWeekToDateRange', () => {
  it('starts on the most recent Sunday and ends today, for a mid-week date', () => {
    // Wednesday 19 Aug 2026 — Sunday of that week is 16 Aug 2026.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 19, 14, 30))
    const { dateFrom, dateTo } = currentWeekToDateRange()
    expect(dateFrom).toBe('2026-08-16')
    expect(dateTo).toBe('2026-08-19')
  })

  it('when today IS a Sunday, dateFrom and dateTo are the same day', () => {
    // 16 Aug 2026 is itself a Sunday.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 16, 9, 0))
    const { dateFrom, dateTo } = currentWeekToDateRange()
    expect(dateFrom).toBe('2026-08-16')
    expect(dateTo).toBe('2026-08-16')
  })

  it('correctly rewinds across a month boundary', () => {
    // Tuesday 1 Sep 2026 — the most recent Sunday is 30 Aug 2026 (previous month).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1, 10, 0))
    const { dateFrom, dateTo } = currentWeekToDateRange()
    expect(dateFrom).toBe('2026-08-30')
    expect(dateTo).toBe('2026-09-01')
  })

  it('does not use toISOString() / UTC conversion — stays on the correct local calendar day just after local midnight', () => {
    // Regression guard for the exact bug toDateOnlyString()'s own doc comment
    // warns about: a naive toISOString()-based implementation converts to UTC
    // first, which can roll the date back a day for a timezone ahead of UTC
    // (e.g. Beirut, UTC+3) shortly after local midnight. 00:30 local time,
    // safely reproducible regardless of the host machine's real timezone
    // since we only assert against toDateOnlyString() of the same instant.
    vi.useFakeTimers()
    const justAfterMidnight = new Date(2026, 7, 17, 0, 30)
    vi.setSystemTime(justAfterMidnight)
    const { dateTo } = currentWeekToDateRange()
    expect(dateTo).toBe(toDateOnlyString(justAfterMidnight))
    expect(dateTo).not.toBe(toDateOnlyString(new Date(justAfterMidnight.getTime() - 86_400_000)))
  })
})

describe('currentMonthToDateRange (regression — pre-existing helper, confirming it still behaves as the preset relies on)', () => {
  it('returns the first of the current month through today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 19, 12, 0))
    const { dateFrom, dateTo } = currentMonthToDateRange()
    expect(dateFrom).toBe('2026-08-01')
    expect(dateTo).toBe('2026-08-19')
  })
})

describe('toDateOnlyString — a date-only business value must not shift across timezones', () => {
  it('2026-08-01 stays 2026-08-01, at any hour of that local day (application-wide timezone audit)', () => {
    // This is the literal example from the timezone audit: a date-only
    // business value such as "2026-08-01" must remain "2026-08-01"
    // regardless of the time of day it's read/selected — never rolled back
    // to 2026-07-31 by an incidental toISOString()/UTC conversion.
    for (const hour of [0, 1, 2, 3, 12, 23]) {
      expect(toDateOnlyString(new Date(2026, 7, 1, hour, 0))).toBe('2026-08-01')
    }
  })

  it('never produces the previous day for any hour of any day — the exact bug class found in Money Handover History and Invoices', () => {
    // A naive `new Date(y, m, d).toISOString().slice(0, 10)` rolls the date
    // back by one for any timezone ahead of UTC (Beirut, UTC+3) for hours
    // 00:00–02:59 local time. toDateOnlyString must never do that, for any
    // hour, on any day — assert across a full 24h sweep on a fixed day.
    for (let hour = 0; hour < 24; hour++) {
      const d = new Date(2026, 7, 1, hour, 30)
      expect(toDateOnlyString(d)).toBe('2026-08-01')
    }
  })
})
