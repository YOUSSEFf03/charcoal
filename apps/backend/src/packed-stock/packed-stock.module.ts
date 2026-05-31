import { Module } from '@nestjs/common';
import { PackedStockController } from './packed-stock.controller';
import { PackedStockService } from './packed-stock.service';

@Module({
  controllers: [PackedStockController],
  providers: [PackedStockService],
  exports: [PackedStockService],
})
export class PackedStockModule {}
