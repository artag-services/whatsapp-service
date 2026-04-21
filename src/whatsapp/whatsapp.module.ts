import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappListener } from './whatsapp.listener';
import { AIResponseService } from './services/ai-response.service';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ConversationsModule],
  providers: [WhatsappService, WhatsappListener, AIResponseService],
  exports: [WhatsappService, AIResponseService],
})
export class WhatsappModule {}
