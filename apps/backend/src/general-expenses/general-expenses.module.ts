import { Module } from '@nestjs/common';
import { GeneralExpensesController } from './general-expenses.controller';
import { GeneralExpensesService } from './general-expenses.service';

@Module({
  controllers: [GeneralExpensesController],
  providers: [GeneralExpensesService],
})
export class GeneralExpensesModule {}
