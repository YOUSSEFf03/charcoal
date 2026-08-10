import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LotInputDto {
  @ApiProperty({ description: 'Stock lot UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @Matches(UUID_PATTERN, { message: 'lotId must be a UUID' })
  lotId: string;

  @ApiProperty({ description: 'Kg consumed from this lot', example: '180.000' })
  @IsNumberString()
  @IsNotEmpty()
  kg: string;
}

export class BagOutputLineDto {
  @ApiProperty({ description: 'Bag type UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @Matches(UUID_PATTERN, { message: 'bagTypeId must be a UUID' })
  bagTypeId: string;

  @ApiProperty({ description: 'Number of bags packed', example: 200, type: Number })
  @IsInt()
  @Min(1)
  qty: number;
}

export class CreatePackingSessionDto {
  @ApiProperty({
    description: 'Charcoal lots consumed — one entry per lot with the actual kg used from that lot. At least one lot required.',
    type: [LotInputDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lotInputs: LotInputDto[];

  @ApiProperty({ description: 'Bags packed — one line per bag type. At least one line required.', type: [BagOutputLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BagOutputLineDto)
  bagsOutput: BagOutputLineDto[];

  @ApiProperty({ description: 'Note explaining any variance between expected and actual kg', required: false })
  @IsOptional()
  @IsString()
  varianceNote?: string;

  @ApiProperty({ description: 'Session date (ISO 8601)', required: false, example: '2024-01-15' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ description: 'Optional notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: 'Worker (payroll entity) UUID who performed the packing — REQUIRED. Every ' +
      'new packing session must be attributable to a payroll Worker; without it, the labor cost ' +
      'it produces enters P&L but can never be reconciled against any worker-facing total.',
    required: true,
  })
  @IsNotEmpty({ message: 'workerEntityId is required — select the worker who performed the packing' })
  @Matches(UUID_PATTERN, { message: 'workerEntityId must be a UUID' })
  workerEntityId: string;
}
