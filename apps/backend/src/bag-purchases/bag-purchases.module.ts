import { Module } from '@nestjs/common';
import { BagPurchasesController } from './bag-purchases.controller';
import { BagPurchasesService } from './bag-purchases.service';

@Module({
  controllers: [BagPurchasesController],
  providers: [BagPurchasesService],
})
export class BagPurchasesModule {}
