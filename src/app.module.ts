import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { RabbitMQModule } from './rabbitmq/rabbitmq.module'
import { AdminModule } from './admin/admin.module'

// Old clients (wrapped by new adapters — keep until old adapters are removed)
import { MetaApiClient } from './whatsapp/clients/meta-api.client'
import { N8nClient } from './whatsapp/clients/n8n.client'

// Infrastructure adapters
import { PrismaMessageRepository } from './infrastructure/persistence/prisma-message.repository'
import { PrismaConversationRepository } from './infrastructure/persistence/prisma-conversation.repository'
import { PrismaRateLimitRepository } from './infrastructure/persistence/prisma-rate-limit.repository'
import { MetaApiSender } from './infrastructure/messaging/meta-api.sender'
import { N8nAIService } from './infrastructure/messaging/n8n-ai.service'
import { InMemoryConversationCache } from './infrastructure/cache/in-memory-conversation-cache'
import { RabbitMQEventPublisher } from './infrastructure/event-bus/rabbitmq-event-publisher'

// Domain use cases (constructed via useFactory to keep them pure of NestJS)
import { SendMessageUseCase } from './domain/services/send-message.usecase'
import { ProcessAIUseCase } from './domain/services/process-ai.usecase'
import { ManageConversationUseCase } from './domain/services/manage-conversation.usecase'
import { HandleAIResponseUseCase } from './domain/services/handle-ai-response.usecase'

// Application consumers
import { WhatsappConsumer } from './application/consumers/whatsapp.consumer'
import { ConversationConsumer } from './application/consumers/conversation-consumer.listener'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RabbitMQModule,
    AdminModule,
  ],
  providers: [
    // Old clients (wrapped by new adapters)
    MetaApiClient,
    N8nClient,

    // Port tokens → Adapter implementations
    { provide: 'IMessageRepository', useClass: PrismaMessageRepository },
    { provide: 'IConversationRepository', useClass: PrismaConversationRepository },
    { provide: 'IRateLimitService', useClass: PrismaRateLimitRepository },
    { provide: 'IMessageSender', useClass: MetaApiSender },
    { provide: 'IAIService', useClass: N8nAIService },
    { provide: 'ICacheService', useClass: InMemoryConversationCache },
    { provide: 'IEventPublisher', useClass: RabbitMQEventPublisher },

    // Use cases — constructed via factory to keep them decorator-free
    {
      provide: SendMessageUseCase,
      useFactory: (repo, sender) => new SendMessageUseCase(repo, sender),
      inject: ['IMessageRepository', 'IMessageSender'],
    },
    {
      provide: ProcessAIUseCase,
      useFactory: (cache, convRepo, ai, rateLimiter, eventBus) =>
        new ProcessAIUseCase(cache, convRepo, ai, rateLimiter, eventBus),
      inject: ['ICacheService', 'IConversationRepository', 'IAIService', 'IRateLimitService', 'IEventPublisher'],
    },
    {
      provide: ManageConversationUseCase,
      useFactory: (cache, convRepo, eventBus) =>
        new ManageConversationUseCase(cache, convRepo, eventBus),
      inject: ['ICacheService', 'IConversationRepository', 'IEventPublisher'],
    },
    {
      provide: HandleAIResponseUseCase,
      useFactory: (eventBus) => new HandleAIResponseUseCase(eventBus),
      inject: ['IEventPublisher'],
    },

    // Application consumers
    WhatsappConsumer,
    ConversationConsumer,
  ],
})
export class AppModule {}
