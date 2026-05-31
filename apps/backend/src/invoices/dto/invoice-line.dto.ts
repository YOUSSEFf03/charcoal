import { IsInt, IsNotEmpty, IsNumberString, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InvoiceLineDto {
  @ApiProperty({ description: 'Bag type UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all') bagTypeId: string;

  @ApiProperty({ description: 'Bag type display name (captured at invoice time)', example: '25kg Standard' })
  @IsString() @IsNotEmpty() bagTypeName: string;

  @ApiProperty({ description: 'Quantity of bags', example: 100, type: Number })
  @IsInt() @Min(1) qty: number;

  @ApiProperty({ description: 'Price per bag (decimal string — free price, CONSTRAINT 10)', example: '850.00' })
  @IsNumberString() @IsNotEmpty() pricePerBag: string;
}
