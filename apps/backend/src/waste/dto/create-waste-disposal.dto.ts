import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /waste/disposals — waste thrown away rather than sold. */
export class CreateWasteDisposalDto {
  @ApiProperty({ description: 'Kg removed from the waste pool (decimal string, > 0)', example: '35.500' })
  @IsNumberString() @IsNotEmpty() kg: string;

  @ApiProperty({ description: 'Disposal date (ISO 8601)', example: '2026-11-05' })
  @IsDateString() @IsNotEmpty() date: string;

  @ApiProperty({ description: 'Why / how it was disposed', required: false, example: 'Wet dust — not sellable' })
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
