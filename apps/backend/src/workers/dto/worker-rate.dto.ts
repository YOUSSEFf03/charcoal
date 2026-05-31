import { IsNotEmpty, IsNumberString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WorkerRateDto {
  @ApiProperty({ description: 'Bag type UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all') bagTypeId: string;

  @ApiProperty({ description: 'Rate per bag packed (decimal string)', example: '1.20' })
  @IsNumberString() @IsNotEmpty() ratePerBag: string;
}
