import { describe, it, expect } from '@jest/globals';
import { ParsePagePipe, ParseLimitPipe, MAX_PAGE_LIMIT } from './pagination.pipes';

describe('ParsePagePipe', () => {
  const pipe = new ParsePagePipe();

  it('defaults to 1 when the value is missing/empty', () => {
    expect(pipe.transform(undefined)).toBe(1);
    expect(pipe.transform(null)).toBe(1);
    expect(pipe.transform('')).toBe(1);
  });

  it('passes through a valid positive page number', () => {
    expect(pipe.transform('5')).toBe(5);
    expect(pipe.transform(42)).toBe(42);
  });

  it('clamps zero/negative page numbers up to 1 (never a negative OFFSET)', () => {
    expect(pipe.transform('0')).toBe(1);
    expect(pipe.transform('-3')).toBe(1);
  });

  it('falls back to 1 for non-numeric or non-integer input', () => {
    expect(pipe.transform('abc')).toBe(1);
    expect(pipe.transform('1.5')).toBe(1);
  });
});

describe('ParseLimitPipe', () => {
  it('defaults to the constructor-provided defaultValue when missing/empty', () => {
    const pipe = new ParseLimitPipe(20);
    expect(pipe.transform(undefined)).toBe(20);
    expect(pipe.transform(null)).toBe(20);
    expect(pipe.transform('')).toBe(20);
  });

  it('defaults to 20 when no defaultValue is passed to the constructor', () => {
    const pipe = new ParseLimitPipe();
    expect(pipe.transform(undefined)).toBe(20);
  });

  it('passes through a valid limit within [1, MAX_PAGE_LIMIT]', () => {
    const pipe = new ParseLimitPipe(20);
    expect(pipe.transform('50')).toBe(50);
    expect(pipe.transform(1)).toBe(1);
    expect(pipe.transform(String(MAX_PAGE_LIMIT))).toBe(MAX_PAGE_LIMIT);
  });

  // ── This is the scalability guarantee the Orders & Delivery audit relies on:
  // a client CANNOT force an unbounded/full-table-scan query by requesting an
  // arbitrarily large limit — every paginated endpoint using this pipe is capped.
  it('clamps any limit above MAX_PAGE_LIMIT down to MAX_PAGE_LIMIT — cannot force a full-table scan', () => {
    const pipe = new ParseLimitPipe(20);
    expect(pipe.transform(String(MAX_PAGE_LIMIT + 1))).toBe(MAX_PAGE_LIMIT);
    expect(pipe.transform('500')).toBe(MAX_PAGE_LIMIT);
    expect(pipe.transform('10000')).toBe(MAX_PAGE_LIMIT);
    expect(pipe.transform(Number.MAX_SAFE_INTEGER)).toBe(MAX_PAGE_LIMIT);
  });

  it('clamps zero/negative limits up to 1', () => {
    const pipe = new ParseLimitPipe(20);
    expect(pipe.transform('0')).toBe(1);
    expect(pipe.transform('-10')).toBe(1);
  });

  it('falls back to defaultValue for non-numeric or non-integer input', () => {
    const pipe = new ParseLimitPipe(20);
    expect(pipe.transform('abc')).toBe(20);
    expect(pipe.transform('12.5')).toBe(20);
  });
});
