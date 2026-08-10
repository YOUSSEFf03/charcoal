import { Module } from '@nestjs/common';
import { CashHandoversController } from './cash-handovers.controller';
import { CashHandoversService } from './cash-handovers.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [CashHandoversController],
  providers: [CashHandoversService],
})
export class CashHandoversModule {}
