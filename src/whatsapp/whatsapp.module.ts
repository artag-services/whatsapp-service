import { Module } from '@nestjs/common'

import { WhatsappService } from './whatsapp.service'
import { WhatsappListener } from './whatsapp.listener'
import { AIResponseService } from './services/ai-response.service'
import { MetaApiClient } from './clients/meta-api.client'
import { N8nClient } from './clients/n8n.client'
import { ConversationsModule } from '../conversations/conversations.module'

@Module({
  imports: [ConversationsModule],
  providers: [
    MetaApiClient,
    N8nClient,
    WhatsappService,
    WhatsappListener,
    AIResponseService,
  ],
  exports: [WhatsappService, AIResponseService],
})
export class WhatsappModule {}
