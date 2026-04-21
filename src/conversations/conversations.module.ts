import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { ConversationListener } from './conversation.listener';
import { ConversationCacheService } from './conversation-cache.service';
import { TopicDetectionService } from './topic-detection.service';

@Module({
  imports: [PrismaModule, RabbitMQModule],
  providers: [
    ConversationListener,
    ConversationCacheService,
    TopicDetectionService,
  ],
  exports: [ConversationCacheService, TopicDetectionService],
})
export class ConversationsModule {}
