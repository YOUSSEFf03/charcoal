import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FillJobCharcoalInputDto {
  @ApiProperty({ description: 'Stock lot UUID to get cost per kg', example: '550e8400-e29b-41d4-a716-446655440000' })
  @Matches(UUID_PATTERN, { message: 'lotId must be a UUID' })
  lotId: string;

  @ApiProperty({ description: 'Kg consumed from this lot', example: 100 })
  @IsNumber()
  @Min(0.001)
  kg: number;
}

export class FillJobBagOutputDto {
  @ApiProperty({ description: 'Spec key: "{size}_{charcoal}" used to match bag specs', example: '2_BBQ Hardwood · A' })
  @IsString()
  @IsNotEmpty()
  specKey: string;

  @ApiProperty({ description: 'Bag size in kg', example: 2 })
  @IsNumber()
  @Min(0.001)
  size: number;

  @ApiProperty({ description: 'Charcoal type label', example: 'BBQ Hardwood · A' })
  @IsString()
  @IsNotEmpty()
  charcoal: string;

  @ApiProperty({ description: 'Number of bags filled', example: 50 })
  @IsInt()
  @Min(1)
  qty: number;
}

export class CreateFillJobDto {
  @ApiProperty({ description: 'Fill client UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @Matches(UUID_PATTERN, { message: 'clientId must be a UUID' })
  clientId: string;

  @ApiProperty({ description: 'Job date (ISO 8601)', example: '2026-05-30' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Worker (payroll entity) UUID', required: false })
  @IsOptional()
  @Matches(UUID_PATTERN, { message: 'workerEntityId must be a UUID' })
  workerEntityId?: string;

  @ApiProperty({ description: 'Charcoal stock lots consumed (at least one)', type: [FillJobCharcoalInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FillJobCharcoalInputDto)
  charcoalInputs: FillJobCharcoalInputDto[];

  @ApiProperty({ description: 'Bags filled per spec (at least one)', type: [FillJobBagOutputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FillJobBagOutputDto)
  bagOutputs: FillJobBagOutputDto[];

  @ApiProperty({ description: 'Optional notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
