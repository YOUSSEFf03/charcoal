import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ShipmentBagInputDto {
  @ApiProperty({ description: 'Bag type UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  bagTypeId: string;

  @ApiProperty({ description: 'Number of bags to ship', example: 200, type: Number })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateShipmentDto {
  @ApiProperty({ description: 'Order UUID this shipment fulfils', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  orderId: string;

  @ApiProperty({ description: 'Delivery address', example: '12 Rue des Oliviers, Alger' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ description: 'Nominal weight in kg (decimal string)', example: '5000.000' })
  @IsNumberString()
  nominalKg: string;

  @ApiProperty({ description: 'Driver trip UUID to assign this shipment to', required: false, example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsOptional()
  @IsUUID('all')
  tripId?: string;

  @ApiProperty({ description: 'Bags to include in the shipment (at least one required)', type: [ShipmentBagInputDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ShipmentBagInputDto)
  bags: ShipmentBagInputDto[];

  @ApiProperty({ description: 'Optional notes', required: false, example: 'Handle with care' })
  @IsOptional()
  @IsString()
  notes?: string;
}
