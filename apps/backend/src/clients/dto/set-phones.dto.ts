import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PhoneInputDto {
  @ApiProperty({ description: 'Phone number', example: '+961 70 123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  number: string;

  @ApiProperty({ description: 'Label for this phone number', example: 'mobile' })
  @IsString()
  @MaxLength(40)
  label: string;

  @ApiProperty({ description: 'Whether the number is in use' })
  @IsBoolean()
  isActive: boolean;
}

/**
 * The full phone list as edited in the client Edit modal, in display order
 * (the first active entry is the primary number).
 */
export class SetPhonesDto {
  @ApiProperty({ type: [PhoneInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PhoneInputDto)
  phones: PhoneInputDto[];
}
