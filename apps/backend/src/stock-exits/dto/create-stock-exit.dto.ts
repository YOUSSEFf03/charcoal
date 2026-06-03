import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Currency, ExitType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * CONSTRAINT 5: loggedById is NOT in this DTO — it is always taken from
 * @CurrentUser in the controller and set inside the service.
 * Supports two modes:
 *  - Packed bags: packedStockId + bagTypeId + quantity
 *  - Raw lot (by kg): lotId + kgQuantity
 */
export class CreateStockExitDto {
  @ApiProperty({ description: 'Packed stock record UUID (packed bags mode)', required: false })
  @IsOptional()
  @IsUUID('all')
  packedStockId?: string;

  @ApiProperty({ description: 'Bag type UUID (packed bags mode)', required: false })
  @IsOptional()
  @IsUUID('all')
  bagTypeId?: string;

  @ApiProperty({ description: 'Number of bags exiting stock (packed bags mode)', required: false, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ description: 'Raw stock lot UUID (by-kg mode)', required: false })
  @IsOptional()
  @IsUUID('all')
  lotId?: string;

  @ApiProperty({ description: 'Kg sold from the raw lot (by-kg mode)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  kgQuantity?: number;

  /**
   * CONSTRAINT 5: exitType is required.
   */
  @ApiProperty({ description: 'Exit type (CONSTRAINT 5 — required)', enum: ExitType, example: ExitType.order })
  @IsEnum(ExitType)
  exitType: ExitType;

  /**
   * CONSTRAINT 5: date is required.
   */
  @ApiProperty({ description: 'Exit date (ISO 8601, CONSTRAINT 5 — required)', example: '2024-01-15' })
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'Reason for the exit', required: false, example: 'Sample for client' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ description: 'Recipient name or reference', required: false, example: 'Acme Trading Co.' })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiProperty({ description: 'Order UUID this exit is linked to', required: false, example: '550e8400-e29b-41d4-a716-446655440002' })
  @IsOptional()
  @IsUUID('all')
  orderId?: string;

  @ApiProperty({ description: 'Client UUID (links walk-in sale to a client account)', required: false })
  @IsOptional()
  @IsUUID('all')
  clientId?: string;

  @ApiProperty({ description: 'Sale amount (for client account balance)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  /**
   * BUG-K (P5): currency of `amount`. Defaults USD when omitted (backward compatible).
   * P&L converts LBP amount-bearing exits to USD using the stored rate.
   */
  @ApiProperty({ description: 'Currency of `amount` (defaults USD)', enum: Currency, required: false })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ description: 'UUID of the user who collected the cash (preferred)', required: false })
  @IsOptional()
  @IsUUID('all')
  collectedById?: string;

  @ApiProperty({ description: 'Name of person who collected the cash (legacy fallback, set automatically from collectedById)', required: false })
  @IsOptional()
  @IsString()
  collectedBy?: string;
}
