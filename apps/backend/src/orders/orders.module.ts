import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [InvoicesModule, ShipmentsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
