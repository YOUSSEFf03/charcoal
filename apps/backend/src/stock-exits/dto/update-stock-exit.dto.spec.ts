import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStockExitDto } from './update-stock-exit.dto';

// =========================================================================
// UpdateStockExitDto — class-validator DTO tests
//
// Regression coverage for the audit finding: PATCH /stock-exits/:id
// previously took `@Body() dto: { amount?: number; recipient?: string }` as a
// plain inline TS object type, which NestJS's global ValidationPipe silently
// skips (it only validates decorated classes) — malformed input (e.g. a
// non-numeric or negative amount) reached the service unvalidated.
// =========================================================================

describe('UpdateStockExitDto validation', () => {
  it('passes with both fields well-formed', async () => {
    const dto = plainToInstance(UpdateStockExitDto, { amount: 50, recipient: 'Acme Trading Co.' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with an empty body — both fields optional', async () => {
    const dto = plainToInstance(UpdateStockExitDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails when amount is negative', async () => {
    const dto = plainToInstance(UpdateStockExitDto, { amount: -10 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('amount');
  });

  it('fails when amount is a non-numeric value', async () => {
    const dto = plainToInstance(UpdateStockExitDto, { amount: 'free' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('amount');
  });

  it('fails when recipient is not a string', async () => {
    const dto = plainToInstance(UpdateStockExitDto, { recipient: 12345 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('recipient');
  });
});
