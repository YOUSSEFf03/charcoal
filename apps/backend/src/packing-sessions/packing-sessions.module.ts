import { Module } from '@nestjs/common';
import { PackingSessionsController } from './packing-sessions.controller';
import { PackingSessionsService } from './packing-sessions.service';

@Module({
  controllers: [PackingSessionsController],
  providers: [PackingSessionsService],
  exports: [PackingSessionsService],
})
export class PackingSessionsModule {}
