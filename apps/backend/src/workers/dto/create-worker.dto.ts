import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkerRateDto } from './worker-rate.dto';

export class CreateWorkerDto {
  @ApiProperty({ description: 'Worker full name', example: 'Ahmed Benali' })
  @IsString() @IsNotEmpty() name: string;

  @ApiProperty({ description: 'Worker phone number', required: false, example: '+213555987654' })
  @IsOptional() @IsString() phone?: string;

  @ApiProperty({ description: 'Per-bag-type packing rates for this worker', required: false, type: [WorkerRateDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkerRateDto)
  ratesPerBagType?: WorkerRateDto[];

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Experienced packer' })
  @IsOptional() @IsString() notes?: string;
}
