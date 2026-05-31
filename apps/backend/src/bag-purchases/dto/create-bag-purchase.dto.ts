import {
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBagPurchaseDto {
  @ApiProperty({ description: 'Bag type UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  bagTypeId: string;

  @ApiProperty({ description: 'Number of bags purchased', example: 500, type: Number })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Cost per bag (decimal string)', example: '8.50' })
  @IsNumberString()
  unitCost: string;

  @ApiProperty({ description: 'Total cost (decimal string)', example: '4250.00' })
  @IsNumberString()
  totalCost: string;

  @ApiProperty({ description: 'Purchase date (ISO 8601)', example: '2024-01-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Bulk order discount applied' })
  @IsOptional()
  @IsString()
  notes?: string;
}
