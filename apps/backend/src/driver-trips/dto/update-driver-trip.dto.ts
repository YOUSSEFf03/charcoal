import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDriverTripDto {
  @ApiProperty({ description: 'Optional notes about the trip', required: false, example: 'Updated delivery instructions' })
  @IsOptional()
  @IsString()
  notes?: string;
}
