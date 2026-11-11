import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** One row of the Fill Clients "Edit bags & pricing" table. */
export class FillBagDto {
  @ApiProperty({ description: 'Row id (spec key or generated id)' })
  @IsString()
  @MaxLength(100)
  id: string;

  @ApiProperty({ description: 'Bag size in kg', example: 10 })
  @IsNumber()
  @Min(0)
  @Max(100000)
  size: number;

  @ApiProperty({ description: 'Charcoal spec', example: 'Grade A' })
  @IsString()
  @MaxLength(100)
  charcoal: string;

  @ApiProperty({ description: 'Price per bag (USD)' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ description: 'Worker pay per bag (USD)' })
  @IsNumber()
  @Min(0)
  worker: number;

  @ApiProperty({ description: 'true = we supply the bag' })
  @IsBoolean()
  ours: boolean;

  @ApiProperty({ description: 'Bag cost when we supply it (USD)' })
  @IsNumber()
  @Min(0)
  bagCost: number;
}

export class SetFillBagsDto {
  @ApiProperty({ type: [FillBagDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FillBagDto)
  bags: FillBagDto[];
}
