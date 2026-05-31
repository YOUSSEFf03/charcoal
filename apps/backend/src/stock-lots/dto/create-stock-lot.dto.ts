import {
  IsDateString,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStockLotDto {
  @ApiProperty({ description: 'Supplier UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  supplierId: string;

  @ApiProperty({ description: 'Charcoal type (e.g. coconut, hardwood)', example: 'coconut' })
  @IsString()
  @IsNotEmpty()
  charcoalType: string;

  @ApiProperty({ description: 'Grade (e.g. A, B, premium)', example: 'A' })
  @IsString()
  @IsNotEmpty()
  grade: string;

  @ApiProperty({ description: 'Kg remaining in the lot (decimal string)', example: '10000.000' })
  @IsNumberString()
  @IsNotEmpty()
  kgRemaining: string;

  @ApiProperty({ description: 'Cost per kg (decimal string)', example: '0.850' })
  @IsNumberString()
  @IsNotEmpty()
  costPerKg: string;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Direct purchase, no container' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Date received (ISO 8601)', required: false, example: '2024-01-10' })
  @IsOptional()
  @IsDateString()
  dateReceived?: string;
}
