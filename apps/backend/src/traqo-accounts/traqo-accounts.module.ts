import { Module } from '@nestjs/common';
import { TraqoAccountsController } from './traqo-accounts.controller';
import { TraqoAccountsService } from './traqo-accounts.service';
import { TraqoKeyResolver } from '../containers/tracking/traqo-key-resolver.service';

@Module({
  controllers: [TraqoAccountsController],
  providers: [TraqoAccountsService, TraqoKeyResolver],
})
export class TraqoAccountsModule {}
