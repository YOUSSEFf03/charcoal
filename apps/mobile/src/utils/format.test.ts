import { daysUntil, formatEtaCountdown, etaCountdownColor, formatDate } from './format';

describe('formatEtaCountdown', () => {
  const REAL_DATE = Date;
  beforeAll(() => {
    // Fix "now" so day-boundary math is deterministic.
    (global as any).Date = class extends REAL_DATE {
      constructor(...args: any[]) {
        if (args.length === 0) return super('2026-09-08T12:00:00.000Z') as any;
        // @ts-expect-error - spreading into Date constructor
        return super(...args);
      }
    };
  });
  afterAll(() => {
    global.Date = REAL_DATE;
  });

  it('returns "ETA unavailable" for null/invalid input', () => {
    expect(formatEtaCountdown(null)).toBe('ETA unavailable');
    expect(formatEtaCountdown('not-a-date')).toBe('ETA unavailable');
  });

  it('returns "Arrives today" for same-day ETA', () => {
    expect(formatEtaCountdown('2026-09-08T18:00:00.000Z')).toBe('Arrives today');
  });

  it('pluralizes future days correctly', () => {
    expect(formatEtaCountdown('2026-09-09T00:00:00.000Z')).toBe('1 day to arrival');
    expect(formatEtaCountdown('2026-09-12T00:00:00.000Z')).toBe('4 days to arrival');
  });

  it('never shows a negative number for overdue ETAs', () => {
    expect(formatEtaCountdown('2026-09-05T00:00:00.000Z')).toBe('3 days overdue');
    expect(formatEtaCountdown('2026-09-05T00:00:00.000Z')).not.toMatch(/-/);
  });

  it('classifies countdown color by threshold', () => {
    expect(etaCountdownColor(null)).toBe('unknown');
    expect(etaCountdownColor('2026-09-05T00:00:00.000Z')).toBe('overdue');
    expect(etaCountdownColor('2026-09-10T00:00:00.000Z')).toBe('soon');
    expect(etaCountdownColor('2026-09-20T00:00:00.000Z')).toBe('normal');
  });
});

describe('daysUntil', () => {
  it('returns null for missing or invalid input', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil('garbage')).toBeNull();
  });
});

describe('formatDate', () => {
  it('falls back to em dash for missing input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('formats a valid ISO date', () => {
    expect(formatDate('2026-01-15T00:00:00.000Z')).toBe('15 Jan 2026');
  });
});
