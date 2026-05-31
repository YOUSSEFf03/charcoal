import { Module } from '@nestjs/common';
import { StockExitsController } from './stock-exits.controller';
import { StockExitsService } from './stock-exits.service';

@Module({
  controllers: [StockExitsController],
  providers: [StockExitsService],
  exports: [StockExitsService],
})
export class StockExitsModule {}
