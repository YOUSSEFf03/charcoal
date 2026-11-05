import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * PATCH /stock-lots/:id — correct a local (direct) purchase. Every field is optional;
 * only the ones sent are changed. Container lots are edited through their container.
 */
export class UpdateStockLotDto {
  @ApiProperty({ required: false, description: 'Supplier UUID' })
  @IsOptional()
  @IsUUID('all')
  supplierId?: string;

  @ApiProperty({ required: false, description: 'Charcoal type — only while the lot is unused' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  charcoalType?: string;

  @ApiProperty({ required: false, description: 'Grade — only while the lot is unused' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  grade?: string;

  @ApiProperty({
    required: false,
    description: 'Corrected kg bought (decimal string). kgRemaining moves by the same difference and may not go below 0.',
    example: '500.000',
  })
  @IsOptional()
  @IsNumberString()
  kgReceived?: string;

  @ApiProperty({ required: false, description: 'Cost per kg, USD (decimal string, ≥ 0)', example: '0.80' })
  @IsOptional()
  @IsNumberString()
  costPerKg?: string;

  @ApiProperty({ required: false, description: 'Date received (ISO 8601)', example: '2026-11-05' })
  @IsOptional()
  @IsDateString()
  dateReceived?: string;

  @ApiProperty({ required: false, description: 'Notes; empty string clears them', nullable: true })
  @IsOptional()
  @IsString()
  notes?: string;
}
