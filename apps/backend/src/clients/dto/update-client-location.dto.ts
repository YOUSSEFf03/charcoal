import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateClientLocationDto } from './create-client-location.dto';

/**
 * PATCH /clients/:id/locations/:locationId — all fields optional, including
 * `isActive` (a location is deactivated by setting this false; there is no
 * DELETE endpoint — see ClientLocation's schema.prisma doc comment: never
 * hard-deleted once it may have orders against it).
 */
export class UpdateClientLocationDto extends PartialType(CreateClientLocationDto) {
  @ApiProperty({ description: 'Deactivate (false) or reactivate (true) — never deleted', required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
