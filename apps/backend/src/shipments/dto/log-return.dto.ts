import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LogReturnDto {
  @ApiProperty({ description: 'Reason or notes for the return', required: false, example: 'Client refused delivery' })
  @IsOptional()
  @IsString()
  notes?: string;
}
