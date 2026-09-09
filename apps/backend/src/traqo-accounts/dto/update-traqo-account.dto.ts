import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateTraqoAccountDto {
  @ApiProperty({ description: 'Enable or disable this account for new allocations' })
  @IsBoolean()
  active: boolean;
}
