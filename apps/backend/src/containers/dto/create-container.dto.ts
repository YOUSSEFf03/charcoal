import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProductLineDto } from './create-product-line.dto';

export class CreateContainerDto {
  @ApiProperty({ description: 'Container number/reference', maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  number: string;

  @ApiProperty({ description: 'Supplier UUID' })
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @ApiPropertyOptional({
    enum: ['port', 'transit', 'arrived'],
    description: 'Container status',
  })
  @IsOptional()
  @IsEnum(['port', 'transit', 'arrived'])
  status?: string;

  @ApiPropertyOptional({ description: 'Optional notes', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Product lines to create with the container', type: [CreateProductLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductLineDto)
  productLines?: CreateProductLineDto[];
}
