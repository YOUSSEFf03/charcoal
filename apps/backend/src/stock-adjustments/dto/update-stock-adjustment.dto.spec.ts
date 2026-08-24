import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStockAdjustmentDto } from './update-stock-adjustment.dto';

// =========================================================================
// UpdateStockAdjustmentDto — class-validator DTO tests
//
// Regression coverage for the audit finding: PATCH /stock-adjustments/:id
// previously took `@Body() dto: { qtyAfter?: string; reason?: string }` as a
// plain inline TS object type, which NestJS's global ValidationPipe silently
// skips (it only validates decorated classes) — malformed input (e.g. a
// non-numeric qtyAfter) reached the service unvalidated.
// =========================================================================

describe('UpdateStockAdjustmentDto validation', () => {
  it('passes with both fields well-formed', async () => {
    const dto = plainToInstance(UpdateStockAdjustmentDto, { qtyAfter: '195.000', reason: 'Recount' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes with an empty body — both fields optional', async () => {
    const dto = plainToInstance(UpdateStockAdjustmentDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails when qtyAfter is a non-numeric string', async () => {
    const dto = plainToInstance(UpdateStockAdjustmentDto, { qtyAfter: 'a lot' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('qtyAfter');
  });

  it('fails when reason is not a string', async () => {
    const dto = plainToInstance(UpdateStockAdjustmentDto, { reason: 12345 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('reason');
  });
});
