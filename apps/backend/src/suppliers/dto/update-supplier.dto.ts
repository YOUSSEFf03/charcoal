import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * All fields optional for PATCH. Defined explicitly to avoid pulling in
 * @nestjs/mapped-types (PartialType) as an extra dependency.
 */
export class UpdateSupplierDto {
  @ApiProperty({ description: 'Supplier company name', required: false, example: 'Indonesian Charcoal Co.' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Country of origin', required: false, example: 'Indonesia' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ description: 'List of contact person objects', required: false, isArray: true, type: Object, example: [{ name: 'Ali Hassan', email: 'ali@example.com' }] })
  @IsOptional()
  @IsArray()
  contactPersons?: unknown[];

  @ApiProperty({ description: 'List of charcoal types supplied', required: false, isArray: true, type: String, example: ['coconut', 'hardwood'] })
  @IsOptional()
  @IsArray()
  charcoalTypes?: unknown[];

  @ApiProperty({ description: 'Bank details (free-form JSON object)', required: false, example: { bank: 'BNI', iban: 'ID123456' } })
  @IsOptional()
  @IsObject()
  bankDetails?: Record<string, unknown>;

  @ApiProperty({ description: 'Payment terms (e.g. Net 60)', required: false, example: 'Net 60' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiProperty({ description: 'Typical lead time in days', required: false, example: 45, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Preferred supplier for coconut charcoal' })
  @IsOptional()
  @IsString()
  notes?: string;
}
