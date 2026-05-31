import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { LotInputDto, BagOutputLineDto } from './create-packing-session.dto';

export class UpdatePackingSessionDto {
  @ApiProperty({ required: false, type: [LotInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lotInputs?: LotInputDto[];

  @ApiProperty({ required: false, type: [BagOutputLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BagOutputLineDto)
  bagsOutput?: BagOutputLineDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  varianceNote?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  /** Empty string = clear worker entity; UUID = assign; omit = keep existing. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  workerEntityId?: string;
}
