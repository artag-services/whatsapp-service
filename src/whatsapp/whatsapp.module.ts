import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappListener } from './whatsapp.listener';
import { AIResponseService } from './services/ai-response.service';

@Module({
  providers: [WhatsappService, WhatsappListener, AIResponseService],
})
export class WhatsappModule {}
