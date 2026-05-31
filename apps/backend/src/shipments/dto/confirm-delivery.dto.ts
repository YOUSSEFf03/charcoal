import {
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmDeliveryDto {
  @ApiProperty({ description: 'Optional notes about the delivery', required: false, example: 'Delivered on time' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Cash-on-delivery payment amount (decimal string)', required: false, example: '42500.00' })
  @IsOptional()
  @IsNumberString()
  paymentAmount?: string;

  @ApiProperty({ description: 'Cash-on-delivery payment method', required: false, enum: PaymentMethod, example: PaymentMethod.cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiProperty({ description: 'Cash-on-delivery payment date (ISO 8601)', required: false, example: '2024-01-15' })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;
}
