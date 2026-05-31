import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceCalculatorService } from './invoice-calculator.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceCalculatorService],
  exports: [InvoicesService, InvoiceCalculatorService],
})
export class InvoicesModule {}
