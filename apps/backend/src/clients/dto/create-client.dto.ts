import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsArray,
} from 'class-validator';
import { ClientType, Currency } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClientDto {
  @ApiProperty({ description: 'Client full name', example: 'Acme Trading Co.' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Client type', enum: ClientType, example: ClientType.wholesale })
  @IsEnum(ClientType)
  type: ClientType;

  @ApiProperty({ description: 'Billing currency', enum: Currency, example: Currency.USD })
  @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ description: 'Optional notes about the client (Arabic)', required: false, example: 'Prefers evening delivery' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Optional notes about the client (English)', required: false, example: 'Prefers evening delivery' })
  @IsOptional()
  @IsString()
  notesEn?: string;

  @ApiProperty({ description: 'Arabic display name', required: false })
  @IsOptional()
  @IsString()
  nameAr?: string;

  @ApiProperty({ description: 'Free-form address — informational only', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ description: 'Informational credit-limit figure, in the client\'s own currency (decimal string) — display only, not enforced anywhere', required: false, example: '5000.00' })
  @IsOptional()
  @IsNumberString()
  creditLimit?: string;

  @ApiProperty({ description: 'Payment terms (e.g. Net 30)', required: false, example: 'Net 30' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiProperty({ description: 'Initial phone numbers array', required: false })
  @IsOptional()
  @IsArray()
  phones?: any[];

  @ApiProperty({ description: 'Whether the client is active', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: 'Opt-in switch that reveals the Locations management UI for this client — a client stays single-location by default. Never affects the client\'s single financial account/balance.',
    required: false, default: false,
  })
  @IsOptional()
  @IsBoolean()
  multiLocationEnabled?: boolean;
}
