import { IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * PATCH /stock-adjustments/:id — qtyAfter and/or reason only. Was previously a
 * plain inline `@Body()` object type, which NestJS's global ValidationPipe
 * silently skips (it only validates decorated classes) — this class restores
 * the same whitelist/type-check protection every other write endpoint has.
 */
export class UpdateStockAdjustmentDto {
  @ApiProperty({ description: 'New quantity after adjustment (decimal string)', required: false, example: '195.000' })
  @IsOptional()
  @IsNumberString()
  qtyAfter?: string;

  @ApiProperty({ description: 'Updated reason', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
