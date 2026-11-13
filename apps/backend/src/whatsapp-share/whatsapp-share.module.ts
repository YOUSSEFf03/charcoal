import { Module } from '@nestjs/common';
import { WhatsAppShareController } from './whatsapp-share.controller';
import { WhatsAppShareService } from './whatsapp-share.service';

@Module({
  controllers: [WhatsAppShareController],
  providers: [WhatsAppShareService],
})
export class WhatsAppShareModule {}
