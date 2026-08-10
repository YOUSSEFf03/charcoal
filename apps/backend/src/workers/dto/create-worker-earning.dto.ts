import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { WorkerCostCategory } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkerEarningDto {
  @ApiProperty({ description: 'Earning amount (decimal string)', example: '30.00' })
  @IsNumberString() @IsNotEmpty() amount: string;

  @ApiProperty({ description: 'Category', enum: WorkerCostCategory, example: WorkerCostCategory.daily_wage })
  @IsEnum(WorkerCostCategory) category: WorkerCostCategory;

  @ApiProperty({ description: 'Date the earning applies to (ISO 8601)', required: false, example: '2026-07-29' })
  @IsOptional() @IsDateString() date?: string;

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Half day, left early' })
  @IsOptional() @IsString() notes?: string;

  @ApiProperty({ description: 'Storage-agnostic reference to an attached receipt/photo, if any', required: false })
  @IsOptional() @IsString() fileId?: string;
}
