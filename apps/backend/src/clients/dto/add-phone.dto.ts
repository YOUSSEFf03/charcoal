import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddPhoneDto {
  @ApiProperty({ description: 'Phone number', example: '+213555123456' })
  @IsString()
  @IsNotEmpty()
  number: string;

  @ApiProperty({ description: 'Label for this phone number', example: 'mobile' })
  @IsString()
  @IsNotEmpty()
  label: string;
}
