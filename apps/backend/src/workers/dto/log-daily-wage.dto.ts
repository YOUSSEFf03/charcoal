import { IsDateString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LogDailyWageDto {
  @ApiProperty({
    description:
      'Business date this daily wage applies to (ISO 8601, "YYYY-MM-DD"). ' +
      'Callers should send the SAME local-date convention every other manual ' +
      'entry in this app already uses (toDateOnlyString(new Date()) on the ' +
      'frontend) rather than relying on the server clock, which may run in a ' +
      'different timezone. Falls back to the server date if omitted.',
    required: false,
    example: '2026-09-05',
  })
  @IsOptional() @IsDateString() date?: string;
}
