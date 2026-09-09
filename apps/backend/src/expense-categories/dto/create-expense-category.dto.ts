import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Fuel' })
  @IsString() @IsNotEmpty() name: string;
}
