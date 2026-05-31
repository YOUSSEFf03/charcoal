import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeactivatePhoneDto {
  @ApiProperty({ description: 'Phone number to deactivate', example: '+213555123456' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}
