import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { LedgerWriteService } from './ledger-write.service';
import { BalanceQueryService } from './balance-query.service';

@Module({
  imports: [PrismaModule, UsersModule],
  providers: [LedgerWriteService, BalanceQueryService],
  exports: [LedgerWriteService, BalanceQueryService],
})
export class LedgerModule {}
