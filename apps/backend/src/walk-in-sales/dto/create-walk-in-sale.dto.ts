import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Currency, PaymentMethod } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One packed-bag line in a walk-in sale. The buyer's price is captured in its own
 * currency; the service converts to the client's currency for the invoice/payment.
 */
export class WalkInBagLineDto {
  @ApiProperty({ description: 'Packed stock record UUID to draw from' })
  @IsUUID('all') packedStockId: string;

  @ApiProperty({ description: 'Bag type UUID' })
  @IsUUID('all') bagTypeId: string;

  @ApiProperty({ description: 'Bag type display name (captured at sale time)', example: '25kg Standard' })
  @IsString() @IsNotEmpty() bagTypeName: string;

  @ApiProperty({ description: 'Number of bags', example: 10, type: Number })
  @IsInt() @Min(1) quantity: number;

  @ApiProperty({ description: 'Price per bag in the line currency (decimal string)', example: '12.50' })
  @IsNumberString() @IsNotEmpty() pricePerBag: string;

  @ApiProperty({ description: 'Currency the pricePerBag is quoted in', enum: Currency })
  @IsEnum(Currency) currency: Currency;
}

export class CreateWalkInSaleDto {
  @ApiProperty({ description: 'Registered client UUID. Anonymous walk-ins use POST /stock-exits instead.' })
  @IsUUID('all') clientId: string;

  @ApiProperty({ description: 'Sale date (ISO 8601)', example: '2026-06-03' })
  @IsDateString() @IsNotEmpty() date: string;

  @ApiProperty({ description: 'Packed-bag lines sold (at least one required)', type: [WalkInBagLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WalkInBagLineDto)
  bags: WalkInBagLineDto[];

  @ApiProperty({ description: 'Amount received in USD (decimal string)', required: false, example: '50.00' })
  @IsOptional() @IsNumberString() receivedUsd?: string;

  @ApiProperty({ description: 'Amount received in LBP (decimal string)', required: false, example: '4500000' })
  @IsOptional() @IsNumberString() receivedLbp?: string;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod, example: PaymentMethod.cash })
  @IsEnum(PaymentMethod) method: PaymentMethod;

  @ApiProperty({ description: 'UUID of the user who received the cash', required: false })
  @IsOptional() @IsUUID('all') receiverId?: string;

  @ApiProperty({ description: 'Recipient/buyer display name', required: false })
  @IsOptional() @IsString() recipient?: string;

  @ApiProperty({ description: 'Optional notes', required: false })
  @IsOptional() @IsString() notes?: string;
}
