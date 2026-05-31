import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDriverTripDto {
  @ApiProperty({ description: 'Driver user UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  driverId: string;

  @ApiProperty({ description: 'List of shipment UUIDs to assign to this trip', required: false, isArray: true, type: String, example: ['550e8400-e29b-41d4-a716-446655440001'] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  shipmentIds?: string[];

  @ApiProperty({ description: 'Optional notes about the trip', required: false, example: 'Deliver before noon' })
  @IsOptional()
  @IsString()
  notes?: string;
}
