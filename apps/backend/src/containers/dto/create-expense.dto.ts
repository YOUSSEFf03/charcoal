import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateExpenseDto {
  @ApiProperty({ description: 'Expense description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Expense amount (decimal string, e.g. "1500.00")' })
  @IsNotEmpty()
  @IsNumberString()
  amount: string;
}
