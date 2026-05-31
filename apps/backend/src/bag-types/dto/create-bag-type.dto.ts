import { IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBagTypeDto {
  @ApiProperty({ description: 'Bag type name', example: '25kg Standard' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Nominal weight in kg (decimal string)', example: '25.000' })
  @IsNumberString()
  nominalKg: string;

  @ApiProperty({ description: 'Cost per bag (decimal string)', example: '8.50' })
  @IsNumberString()
  costPerBag: string;

  @ApiProperty({ description: 'Worker packing rate per bag (decimal string)', example: '1.20' })
  @IsNumberString()
  workerRate: string;

  @ApiProperty({ description: 'Optional note about this bag type', required: false, example: 'Used for retail orders' })
  @IsOptional()
  @IsString()
  note?: string;
}
