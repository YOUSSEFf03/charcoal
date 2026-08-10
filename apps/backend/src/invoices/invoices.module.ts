import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceCalculatorService, PaymentAllocationService],
  exports: [InvoicesService, InvoiceCalculatorService, PaymentAllocationService],
})
export class InvoicesModule {}
