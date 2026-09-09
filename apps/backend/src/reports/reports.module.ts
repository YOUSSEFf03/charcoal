import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SettingsModule } from '../settings/settings.module';
import { ClientsModule } from '../clients/clients.module';
import { StockExitsModule } from '../stock-exits/stock-exits.module';

@Module({
  // ClientsModule — reuses ClientBalanceService.computeBalance() for the Full
  // Day Report's client receivable roll-forward (2026-09), the SAME
  // authoritative balance formula every other balance figure in this app
  // uses, never a second one. StockExitsModule — reuses
  // StockExitsService.findAllGrouped()/getOnAccountCount() so the report's
  // sales section shares the exact one-sale-per-COALESCE(invoiceId,id) dedup
  // logic already proven for the Warehouse Sales log, rather than
  // re-implementing it.
  imports: [SettingsModule, ClientsModule, StockExitsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
