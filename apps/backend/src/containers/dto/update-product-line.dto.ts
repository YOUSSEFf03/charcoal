import { PartialType } from '@nestjs/swagger';
import { CreateProductLineDto } from './create-product-line.dto';

export class UpdateProductLineDto extends PartialType(CreateProductLineDto) {}
