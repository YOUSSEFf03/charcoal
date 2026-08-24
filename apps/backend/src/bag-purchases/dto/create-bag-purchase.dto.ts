import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Currency } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBagPurchaseDto {
  @ApiProperty({ description: 'Bag type UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  bagTypeId: string;

  @ApiProperty({ description: 'Number of bags purchased', example: 500, type: Number })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Cost per bag (decimal string)', example: '8.50' })
  @IsNumberString()
  unitCost: string;

  /**
   * BUG-L (P5): currency of unitCost/totalCost. Defaults USD when omitted.
   * P&L converts LBP bag cost to USD using the stored rate.
   */
  @ApiProperty({ description: 'Currency of the cost (defaults USD)', enum: Currency, required: false })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ description: 'Purchase date (ISO 8601)', example: '2024-01-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Bulk order discount applied' })
  @IsOptional()
  @IsString()
  notes?: string;
}
