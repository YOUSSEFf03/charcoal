import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Invoice line DTO — supports two sale units via a discriminated union.
 *
 * BAG line  (saleUnit = 'BAG' or omitted for backward compat):
 *   bagTypeId, bagTypeName, qty, pricePerBag   → lineTotal = qty × pricePerBag
 *
 * KG line   (saleUnit = 'KG'):
 *   kgQuantity, description, pricePerKg        → lineTotal = kgQuantity × pricePerKg
 *
 * Backward compatibility: callers that omit saleUnit and supply BAG fields continue
 * to pass validation unchanged — ValidateIf treats absent saleUnit as 'BAG'.
 */
export class InvoiceLineDto {
  @ApiProperty({
    description: "Sale unit discriminator. Omit or pass 'BAG' for bag lines; pass 'KG' for kg lines.",
    enum: ['BAG', 'KG'],
    required: false,
    example: 'BAG',
  })
  @IsOptional()
  @IsIn(['BAG', 'KG'])
  saleUnit?: 'BAG' | 'KG';

  // ── BAG-line fields — required when saleUnit is 'BAG' or absent ───────────

  @ApiProperty({ description: 'Bag type UUID (BAG lines only)', required: false, example: '550e8400-e29b-41d4-a716-446655440000' })
  @ValidateIf(o => !o.saleUnit || o.saleUnit === 'BAG')
  @IsUUID('all')
  bagTypeId?: string;

  @ApiProperty({ description: 'Bag type display name captured at invoice time (BAG lines only)', required: false, example: '25kg Standard' })
  @ValidateIf(o => !o.saleUnit || o.saleUnit === 'BAG')
  @IsString() @IsNotEmpty()
  bagTypeName?: string;

  @ApiProperty({ description: 'Number of bags (BAG lines only)', required: false, example: 100, type: Number })
  @ValidateIf(o => !o.saleUnit || o.saleUnit === 'BAG')
  @IsInt() @Min(1)
  qty?: number;

  @ApiProperty({ description: 'Price per bag in client currency — free price, CONSTRAINT 10 (BAG lines only)', required: false, example: '12.50' })
  @ValidateIf(o => !o.saleUnit || o.saleUnit === 'BAG')
  @IsNumberString() @IsNotEmpty()
  pricePerBag?: string;

  // ── KG-line fields — required when saleUnit is 'KG' ──────────────────────

  @ApiProperty({ description: 'Quantity sold in kilograms (KG lines only)', required: false, example: '500.000' })
  @ValidateIf(o => o.saleUnit === 'KG')
  @IsNumberString() @IsNotEmpty()
  kgQuantity?: string;

  @ApiProperty({ description: 'Product description snapshot, e.g. charcoal type and grade (KG lines only)', required: false, example: 'BBQ Hardwood Grade A' })
  @ValidateIf(o => o.saleUnit === 'KG')
  @IsString() @IsNotEmpty()
  description?: string;

  @ApiProperty({ description: 'Price per kg in client currency (KG lines only)', required: false, example: '2.50' })
  @ValidateIf(o => o.saleUnit === 'KG')
  @IsNumberString() @IsNotEmpty()
  pricePerKg?: string;
}
