import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { Currency, PaymentMethod } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Client UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all') clientId: string;

  @ApiProperty({ description: 'Invoice UUID to apply payment to (optional)', required: false, example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsOptional() @IsUUID('all') invoiceId?: string;

  @ApiProperty({ description: 'Payment amount (decimal string)', example: '85000.00' })
  @IsNumberString() @IsNotEmpty() amount: string;

  @ApiProperty({ description: 'Payment currency', enum: Currency, example: Currency.USD })
  @IsEnum(Currency) currency: Currency;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod, example: PaymentMethod.cash })
  @IsEnum(PaymentMethod) method: PaymentMethod;

  @ApiProperty({ description: 'Payment date (ISO 8601)', required: false, example: '2024-01-15' })
  @IsOptional() @IsDateString() date?: string;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Partial payment' })
  @IsOptional() @IsString() notes?: string;

  @ApiProperty({ description: 'UUID of the receiver user (preferred over receiverName)', required: false })
  @IsOptional() @IsUUID('all') receiverId?: string;

  @ApiProperty({ description: 'Name of person who received the cash (legacy fallback, set automatically from receiverId)', required: false })
  @IsOptional() @IsString() receiverName?: string;
}
