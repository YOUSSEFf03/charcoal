import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumberString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductLineDto {
  @ApiProperty({ description: 'Charcoal type (e.g. coconut, hardwood)' })
  @IsString()
  @IsNotEmpty()
  charcoalType: string;

  @ApiProperty({ description: 'Grade (e.g. A, B, premium)' })
  @IsString()
  @IsNotEmpty()
  grade: string;

  @ApiProperty({ description: 'Supplier UUID for this product line' })
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @ApiProperty({ description: 'Number of paid bags', minimum: 0 })
  @IsInt()
  @Min(0)
  paidBags: number;

  @ApiPropertyOptional({ description: 'Number of gift bags', minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  giftBags?: number;

  @ApiProperty({ description: 'Kg per bag (decimal string, e.g. "25.000")' })
  @IsNotEmpty()
  @IsNumberString()
  kgPerBag: string;

  @ApiProperty({ description: 'Price per ton (decimal string, e.g. "850.00")' })
  @IsNotEmpty()
  @IsNumberString()
  pricePerTon: string;
}
