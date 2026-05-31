import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkerRateDto } from './worker-rate.dto';

export class SetRatesDto {
  @ApiProperty({ description: 'Per-bag-type packing rates to set for the worker (at least one required)', type: [WorkerRateDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkerRateDto)
  ratesPerBagType: WorkerRateDto[];
}
