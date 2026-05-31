import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkerPaymentDto {
  @ApiProperty({ description: 'Payment amount (decimal string)', example: '3500.00' })
  @IsNumberString() @IsNotEmpty() amount: string;

  @ApiProperty({ description: 'Payment date (ISO 8601)', required: false, example: '2024-01-31' })
  @IsOptional() @IsDateString() date?: string;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'January salary advance' })
  @IsOptional() @IsString() notes?: string;
}
