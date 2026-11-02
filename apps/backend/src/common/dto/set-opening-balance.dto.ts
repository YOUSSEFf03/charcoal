import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for PUT /clients/:id/opening-balance and PUT /suppliers/:id/opening-balance.
 * Shared by both because the go-live carry-forward has the same shape for either
 * party — only the currency differs (client's own currency vs. always USD for
 * suppliers), and that's implied by the party, never sent.
 */
export class SetOpeningBalanceDto {
  @ApiProperty({
    description: 'Signed amount carried forward. Positive = they owe us (client) / we owe them (supplier); negative = credit the other way.',
    example: '1250.00',
  })
  @IsNumberString() @IsNotEmpty()
  amount: string;

  @ApiProperty({ description: 'Date the balance is carried forward as of (usually the go-live date)', example: '2026-11-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Optional note (e.g. "From old notebook")', required: false })
  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}
