import { Module } from '@nestjs/common';
import { StockExitsController } from './stock-exits.controller';
import { StockExitsService } from './stock-exits.service';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [LedgerModule, UsersModule, SettingsModule],
  controllers: [StockExitsController],
  providers: [StockExitsService],
  exports: [StockExitsService],
})
export class StockExitsModule {}
