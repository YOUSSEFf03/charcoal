import { PartialType } from '@nestjs/swagger';
import { CreateWorkerEarningDto } from './create-worker-earning.dto';

// Edits are only accepted within a short window of creation — enforced in
// WorkersService.updateEarning(), not here. Past that window, corrections
// must be a new entry with category `correction` rather than a rewrite of
// history (see WorkerCost model comment in schema.prisma).
export class UpdateWorkerEarningDto extends PartialType(CreateWorkerEarningDto) {}
