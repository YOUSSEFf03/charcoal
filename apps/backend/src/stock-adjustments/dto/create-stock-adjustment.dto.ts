import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AdjustmentType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStockAdjustmentDto {
  @ApiProperty({ description: 'Type of stock adjustment', enum: AdjustmentType, example: AdjustmentType.packed_stock })
  @IsEnum(AdjustmentType)
  adjustmentType: AdjustmentType;

  @ApiProperty({ description: 'Stock lot UUID (required for raw stock adjustments)', required: false, example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID('all')
  lotId?: string;

  @ApiProperty({ description: 'Packed stock UUID (required for packed stock adjustments)', required: false, example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsOptional()
  @IsUUID('all')
  packedStockId?: string;

  @ApiProperty({ description: 'Quantity before adjustment (decimal string)', example: '200.000' })
  @IsNumberString()
  @IsNotEmpty()
  qtyBefore: string;

  @ApiProperty({ description: 'Quantity after adjustment (decimal string)', example: '195.000' })
  @IsNumberString()
  @IsNotEmpty()
  qtyAfter: string;

  // CONSTRAINT 6: reason is required and must be non-empty
  @ApiProperty({ description: 'Reason for the adjustment (CONSTRAINT 6 — required)', example: 'Physical count discrepancy' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({ description: 'Adjustment date (ISO 8601)', example: '2024-01-15' })
  @IsDateString()
  date: string;
}
