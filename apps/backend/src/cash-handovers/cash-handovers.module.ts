import { Module } from '@nestjs/common';
import { CashHandoversController } from './cash-handovers.controller';
import { CashHandoversService } from './cash-handovers.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CashHandoversController],
  providers: [CashHandoversService],
})
export class CashHandoversModule {}
