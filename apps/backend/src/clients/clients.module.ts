import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientBalanceService } from './client-balance.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientBalanceService],
  exports: [ClientsService, ClientBalanceService],
})
export class ClientsModule {}
