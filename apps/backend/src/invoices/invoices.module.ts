import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceCalculatorService],
  exports: [InvoicesService, InvoiceCalculatorService],
})
export class InvoicesModule {}
