import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Currency } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { InvoiceLineDto } from './invoice-line.dto';

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Client UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all') clientId: string;

  @ApiProperty({ description: 'Order UUID (optional link)', required: false, example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsOptional() @IsUUID('all') orderId?: string;

  @ApiProperty({ description: 'Invoice line items (at least one required)', type: [InvoiceLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines: InvoiceLineDto[];

  @ApiProperty({ description: 'Invoice currency', enum: Currency, example: Currency.USD })
  @IsEnum(Currency) currency: Currency;

  @ApiProperty({ description: 'Due date (ISO 8601)', required: false, example: '2024-02-15' })
  @IsOptional() @IsDateString() dueDate?: string;
}
