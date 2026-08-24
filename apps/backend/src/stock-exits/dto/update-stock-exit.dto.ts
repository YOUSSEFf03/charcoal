import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * PATCH /stock-exits/:id — sale amount and/or recipient only. Was previously a
 * plain inline `@Body()` object type, which NestJS's global ValidationPipe
 * silently skips (it only validates decorated classes) — this class restores
 * the same whitelist/type-check protection every other write endpoint has.
 */
export class UpdateStockExitDto {
  @ApiProperty({ description: 'Sale amount (for client account balance)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({ description: 'Recipient name or reference', required: false })
  @IsOptional()
  @IsString()
  recipient?: string;
}
