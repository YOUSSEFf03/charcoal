import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateClientLocationDto {
  @ApiProperty({ description: 'Location/branch name — unique within this client (not globally)', example: 'Hamra Branch' })
  @IsString() @IsNotEmpty() name: string;

  @ApiProperty({ description: 'Address', required: false })
  @IsOptional() @IsString() address?: string;

  @ApiProperty({ description: 'Phone number', required: false })
  @IsOptional() @IsString() phone?: string;

  @ApiProperty({ description: 'Notes', required: false })
  @IsOptional() @IsString() notes?: string;
}
