import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanyInfoDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) addressAr?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(50) taxNo?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) footer?: string;
}
