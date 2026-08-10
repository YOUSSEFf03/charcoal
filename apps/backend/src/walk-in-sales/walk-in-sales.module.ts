import { Module } from '@nestjs/common';
import { WalkInSalesController } from './walk-in-sales.controller';
import { WalkInSalesService } from './walk-in-sales.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { SettingsModule } from '../settings/settings.module';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [InvoicesModule, SettingsModule, LedgerModule, UsersModule],
  controllers: [WalkInSalesController],
  providers: [WalkInSalesService],
})
export class WalkInSalesModule {}
