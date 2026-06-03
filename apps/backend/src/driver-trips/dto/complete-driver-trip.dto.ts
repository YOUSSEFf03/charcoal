import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Currency } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class ExpenseItemDto {
  @ApiProperty({ description: 'Expense label', example: 'Toll fees' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ description: 'Expense amount (decimal string)', example: '150.00' })
  @IsNumberString()
  amount: string;

  /**
   * BUG-M (P5): currency of this expense amount. Defaults USD when omitted.
   * P&L converts each LBP item to USD using the stored rate.
   */
  @ApiProperty({ description: 'Currency of `amount` (defaults USD)', enum: Currency, required: false })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class CompleteDriverTripDto {
  @ApiProperty({ description: 'Fuel cost (decimal string)', required: false, example: '3500.00' })
  @IsOptional()
  @IsNumberString()
  fuelCost?: string;

  /**
   * BUG-M (P5): currency of fuelCost. Defaults USD when omitted.
   */
  @ApiProperty({ description: 'Currency of fuelCost (defaults USD)', enum: Currency, required: false })
  @IsOptional()
  @IsEnum(Currency)
  fuelCurrency?: Currency;

  @ApiProperty({ description: 'Other expenses incurred during the trip', required: false, type: [ExpenseItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  otherExpenses?: ExpenseItemDto[];
}
