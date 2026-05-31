import {
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ExpenseItemDto {
  @ApiProperty({ description: 'Expense label', example: 'Toll fees' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ description: 'Expense amount (decimal string)', example: '150.00' })
  @IsNumberString()
  amount: string;
}

export class CompleteDriverTripDto {
  @ApiProperty({ description: 'Fuel cost (decimal string)', required: false, example: '3500.00' })
  @IsOptional()
  @IsNumberString()
  fuelCost?: string;

  @ApiProperty({ description: 'Other expenses incurred during the trip', required: false, type: [ExpenseItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  otherExpenses?: ExpenseItemDto[];
}
