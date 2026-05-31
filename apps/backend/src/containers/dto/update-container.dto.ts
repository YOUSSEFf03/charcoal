import { PartialType } from '@nestjs/swagger';
import { CreateContainerDto } from './create-container.dto';

export class UpdateContainerDto extends PartialType(CreateContainerDto) {}
