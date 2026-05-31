import { IsNotEmpty, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertDiscountDto {
  @ApiProperty({ description: 'Discount amount (decimal string, e.g. "500.00")' })
  @IsNotEmpty()
  @IsNumberString()
  amount: string;
}
