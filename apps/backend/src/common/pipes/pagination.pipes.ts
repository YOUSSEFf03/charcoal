import { Injectable, PipeTransform } from '@nestjs/common';

export const MAX_PAGE_LIMIT = 100;

/**
 * Replaces the DefaultValuePipe(1) + ParseIntPipe chain for the `page` query
 * param. Accepts a missing/empty value (returns 1) and clamps the result to
 * >= 1 so negative or zero page numbers are silently corrected server-side.
 */
@Injectable()
export class ParsePagePipe implements PipeTransform {
  transform(value: unknown): number {
    if (value === undefined || value === null || value === '') return 1;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 1;
    return Math.max(n, 1);
  }
}

/**
 * Replaces the DefaultValuePipe(X) + ParseIntPipe chain for the `limit` query
 * param. Accepts a missing/empty value (returns the defaultValue) and clamps
 * the result to [1, MAX_PAGE_LIMIT] so clients cannot force full-table scans.
 * The defaultValue keeps each endpoint's original page size.
 */
@Injectable()
export class ParseLimitPipe implements PipeTransform {
  constructor(private readonly defaultValue = 20) {}

  transform(value: unknown): number {
    if (value === undefined || value === null || value === '') return this.defaultValue;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return this.defaultValue;
    return Math.min(Math.max(n, 1), MAX_PAGE_LIMIT);
  }
}
