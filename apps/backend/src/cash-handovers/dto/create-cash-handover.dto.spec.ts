import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCashHandoverDto } from './create-cash-handover.dto';

// =========================================================================
// CreateCashHandoverDto — class-validator DTO tests
//
// Regression coverage for the audit finding: POST /cash-handovers previously
// took `@Body() dto: { ... }` as a plain inline TS object type, which
// NestJS's global ValidationPipe silently skips (it only validates decorated
// classes) — so malformed/missing input reached the service completely
// unvalidated (e.g. a non-numeric expectedAmt/handedAmt produced a
// parseFloat NaN that only surfaced as a raw Postgres numeric-cast error).
// These tests prove the new class actually rejects bad input.
// =========================================================================

describe('CreateCashHandoverDto validation', () => {
  const valid = {
    date: '2024-01-15',
    receiverId: '550e8400-e29b-41d4-a716-446655440000',
    expectedAmt: '500.00',
    handedAmt: '480.00',
  };

  it('passes with a well-formed body', async () => {
    const dto = plainToInstance(CreateCashHandoverDto, valid);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails when receiverId is not a UUID', async () => {
    const dto = plainToInstance(CreateCashHandoverDto, { ...valid, receiverId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('receiverId');
  });

  it('fails when expectedAmt is a non-numeric string ("abc") — previously reached the service as NaN', async () => {
    const dto = plainToInstance(CreateCashHandoverDto, { ...valid, expectedAmt: 'abc' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('expectedAmt');
  });

  it('fails when handedAmt is missing', async () => {
    const { handedAmt: _drop, ...withoutHandedAmt } = valid;
    const dto = plainToInstance(CreateCashHandoverDto, withoutHandedAmt);
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('handedAmt');
  });

  it('fails when date is not a valid ISO date string', async () => {
    const dto = plainToInstance(CreateCashHandoverDto, { ...valid, date: 'not-a-date' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('date');
  });

  it('fails when an expenses[] item has a non-numeric amount', async () => {
    const dto = plainToInstance(CreateCashHandoverDto, {
      ...valid,
      expenses: [{ description: 'Fuel', amount: 'lots' }],
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('expenses');
  });

  it('passes with a well-formed expenses[] array', async () => {
    const dto = plainToInstance(CreateCashHandoverDto, {
      ...valid,
      expenses: [{ description: 'Fuel', amount: '10.00' }],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
