import { IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkerAttendanceDto {
  @ApiProperty({ description: 'Date attended (YYYY-MM-DD)', example: '2026-05-14' })
  @IsNotEmpty() @IsDateString() date: string;
}
