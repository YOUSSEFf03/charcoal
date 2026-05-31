import { IsNotEmpty, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateActualWeightDto {
  @ApiProperty({ description: 'Actual weighed kg (decimal string)', example: '4987.500' })
  @IsNumberString()
  @IsNotEmpty()
  actualKg: string;
}
