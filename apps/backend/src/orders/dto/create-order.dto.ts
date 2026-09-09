import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Currency } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ description: 'Client UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'Charcoal type (e.g. coconut, hardwood)', example: 'coconut' })
  @IsString()
  @IsNotEmpty()
  charcoalType: string;

  @ApiProperty({ description: 'Grade (e.g. A, B, premium)', example: 'A' })
  @IsString()
  @IsNotEmpty()
  grade: string;

  @ApiProperty({ description: 'Total kg requested (decimal string)', example: '5000.000' })
  @IsNumberString()
  totalKgRequested: string;

  @ApiProperty({ description: 'Bag type UUID (optional)', required: false, example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsOptional()
  @IsString()
  bagTypeId?: string;

  /**
   * CONSTRAINT 10: pricePerBag is entered at sale time — no price-list lookup.
   */
  @ApiProperty({ description: 'Price per bag (decimal string — free price, CONSTRAINT 10)', example: '850.00' })
  @IsNumberString()
  @IsNotEmpty()
  pricePerBag: string;

  @ApiProperty({ description: 'Order currency', enum: Currency, example: Currency.USD })
  @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Urgent delivery' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Driver user UUID (optional)', required: false })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiProperty({ description: 'Charcoal supplier name (informational)', required: false })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiProperty({
    description: 'Client location/branch UUID this order/delivery is for (optional — must belong to the client and be active). Warehouse/walk-in sales never use this field.',
    required: false,
  })
  @IsOptional()
  @IsUUID('all')
  locationId?: string;
}
