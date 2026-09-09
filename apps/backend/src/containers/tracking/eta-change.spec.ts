import { describe, it, expect } from '@jest/globals';
import { classifyEtaChange, isNotifiableEtaChange } from './eta-change';

const D1 = new Date('2026-09-15T00:00:00.000Z');
const D1_SAME_INSTANT_DIFFERENT_OBJECT = new Date('2026-09-15T00:00:00.000Z');
const D2 = new Date('2026-09-17T00:00:00.000Z');

describe('classifyEtaChange — Phase B ETA-change semantics (scenarios A–E from the task spec)', () => {
  it('A) no existing tracking row + new ETA → "initial", never a change', () => {
    expect(classifyEtaChange(false, null, D1)).toBe('initial');
  });

  it('A) no existing row + no new ETA either → still "initial"', () => {
    expect(classifyEtaChange(false, null, null)).toBe('initial');
  });

  it('B) existing row with null ETA + new ETA resolved → "became_known" (an ETA-change event)', () => {
    expect(classifyEtaChange(true, null, D1)).toBe('became_known');
  });

  it('C) existing ETA + a genuinely different new ETA → "changed"', () => {
    expect(classifyEtaChange(true, D1, D2)).toBe('changed');
  });

  it('C) compares real Date instants, not object identity or string formatting', () => {
    // Two distinct Date objects representing the exact same instant must
    // never be classified as a change.
    expect(D1).not.toBe(D1_SAME_INSTANT_DIFFERENT_OBJECT); // sanity: different objects
    expect(classifyEtaChange(true, D1, D1_SAME_INSTANT_DIFFERENT_OBJECT)).toBe('no_change');
  });

  it('D) existing ETA equals new ETA → "no_change"', () => {
    expect(classifyEtaChange(true, D1, D1)).toBe('no_change');
  });

  it('D) existing row with null ETA and new ETA still null → "no_change" (never resolved, still isn\'t)', () => {
    expect(classifyEtaChange(true, null, null)).toBe('no_change');
  });

  it('E) existing ETA + new ETA is null → "became_unavailable", a distinct category — never silently "changed" or "no_change"', () => {
    const result = classifyEtaChange(true, D1, null);
    expect(result).toBe('became_unavailable');
    expect(result).not.toBe('changed');
    expect(result).not.toBe('no_change');
  });

  it('idempotency: repeating the same (existing, new) pair always yields the same classification', () => {
    expect(classifyEtaChange(true, D1, D2)).toBe(classifyEtaChange(true, D1, D2));
    expect(classifyEtaChange(true, D2, D2)).toBe('no_change');
  });

  it('a revert (B → A after A → B) is classified as a fresh "changed", not suppressed', () => {
    // Refresh 3: A -> B
    expect(classifyEtaChange(true, D1, D2)).toBe('changed');
    // Refresh 4: B -> A (the revert) — must still be "changed", not treated
    // as "we already saw D1 once before" — there is no such memory here by
    // design; only the immediately-previous value matters.
    expect(classifyEtaChange(true, D2, D1)).toBe('changed');
  });
});

describe('isNotifiableEtaChange', () => {
  it('is true only for became_known and changed', () => {
    expect(isNotifiableEtaChange('became_known')).toBe(true);
    expect(isNotifiableEtaChange('changed')).toBe(true);
  });

  it('is false for initial, no_change, and became_unavailable', () => {
    expect(isNotifiableEtaChange('initial')).toBe(false);
    expect(isNotifiableEtaChange('no_change')).toBe(false);
    expect(isNotifiableEtaChange('became_unavailable')).toBe(false);
  });
});
