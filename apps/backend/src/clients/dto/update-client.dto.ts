import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateClientDto } from './create-client.dto';

// The opening balance is set at creation or via PUT /clients/:id/opening-balance, never via PATCH.
export class UpdateClientDto extends PartialType(OmitType(CreateClientDto, ['openingBalance'] as const)) {}
