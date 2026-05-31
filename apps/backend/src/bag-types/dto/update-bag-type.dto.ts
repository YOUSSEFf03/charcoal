import { PartialType } from '@nestjs/swagger';
import { CreateBagTypeDto } from './create-bag-type.dto';

export class UpdateBagTypeDto extends PartialType(CreateBagTypeDto) {}
