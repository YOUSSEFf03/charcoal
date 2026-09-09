import { PartialType } from '@nestjs/swagger';
import { CreateGeneralExpenseDto } from './create-general-expense.dto';

export class UpdateGeneralExpenseDto extends PartialType(CreateGeneralExpenseDto) {}
