import { IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGeneralExpenseDto {
  @ApiProperty({ description: 'Expense description' })
  @IsString() @IsNotEmpty() description: string;

  @ApiProperty({ description: 'Amount (decimal string, e.g. "1500.00")' })
  @IsNotEmpty() @IsNumberString() amount: string;

  @ApiProperty({ description: 'Repeats every month', required: false })
  @IsOptional() @IsBoolean() isRecurring?: boolean;

  @ApiProperty({ description: 'Category (e.g. Rent, Utilities)', required: false })
  @IsOptional() @IsString() category?: string;

  @ApiProperty({ description: 'Expense date (YYYY-MM-DD)', required: false })
  @IsOptional() @IsDateString() date?: string;

  @ApiProperty({ description: 'Optional notes', required: false })
  @IsOptional() @IsString() notes?: string;
}
