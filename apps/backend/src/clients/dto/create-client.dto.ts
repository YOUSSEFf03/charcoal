import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
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

  @ApiProperty({ description: 'Optional notes about the client', required: false, example: 'Prefers evening delivery' })
  @IsOptional()
  @IsString()
  notes?: string;

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
}
