import { IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PhysicalCountItemDto {
  @ApiProperty({ description: 'Packed stock record UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  packedStockId: string;

  @ApiProperty({ description: 'Physically counted quantity', example: 195, type: Number })
  @IsInt()
  @Min(0)
  actualQuantity: number;
}

export class SubmitPhysicalCountDto {
  @ApiProperty({ description: 'Physical count items for each packed stock record', type: [PhysicalCountItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhysicalCountItemDto)
  items: PhysicalCountItemDto[];
}
