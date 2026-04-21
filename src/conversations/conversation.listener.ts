import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { PrismaService } from '../prisma/prisma.service';
import { TopicDetectionService } from './topic-detection.service';
import { ConversationCacheService, CachedConversation } from './conversation-cache.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { ROUTING_KEYS } from '../rabbitmq/constants/queues';

interface ConversationIncomingPayload {
  channel: string;
  channelUserId: string;
  messageText: string;
  messageId: string;
  timestamp: string;
}

/**
 * Listens for conversation.incoming events from the Gateway
 * Creates new Conversation records and publishes conversation.created events
 */
@Injectable()
export class ConversationListener {
  private readonly logger = new Logger(ConversationListener.name);

  constructor(
    private prisma: PrismaService,
    private topicDetection: TopicDetectionService,
    private cache: ConversationCacheService,
    private rabbitmq: RabbitMQService,
  ) {}

  /**
   * Handle incoming conversation event
   * Only processes WhatsApp messages (other channels will implement similar listeners)
   */
  @RabbitSubscribe({
    exchange: 'channels',
    routingKey: 'channels.conversation.incoming',
    queue: 'whatsapp.conversation.incoming',
  })
  async handleConversationIncoming(payload: ConversationIncomingPayload) {
    try {
      // Only process WhatsApp messages
      if (payload.channel !== 'whatsapp') {
        this.logger.debug(`Ignoring conversation.incoming for channel: ${payload.channel}`);
        return;
      }

      this.logger.log(
        `Processing conversation incoming from user: ${payload.channelUserId}`
      );

      const {channel, channelUserId, messageText, messageId} = payload;

      // 1. Detect topic from message text
      const topic = this.topicDetection.detectTopic(messageText);
      const keywords = this.topicDetection.extractKeywords(messageText, topic);

      // 2. Create conversation in database
      const conversation = await this.prisma.conversation.create({
        data: {
          userId: null, // Will be updated when Identity resolves
          channelUserId,
          channel,
          topic,
          detectionMethod: 'KEYWORDS',
          keywords,
          aiEnabled: true,
          status: 'ACTIVE',
          messageCount: 0,
          aiMessageCount: 0,
        },
      });

      this.logger.log(`✅ Conversation created: ${conversation.id} | Topic: ${topic}`);

      // 3. Update in-memory cache
      const cachedConv: CachedConversation = {
        id: conversation.id,
        channelUserId,
        topic,
        aiEnabled: true,
        userId: null,
        status: 'ACTIVE',
        agentAssigned: null,
      };
      this.cache.set(channelUserId, cachedConv);

      // 4. Publish conversation.created event for other services
      await this.rabbitmq.publish(ROUTING_KEYS.CONVERSATION_CREATED, {
        conversationId: conversation.id,
        channel,
        channelUserId,
        topic,
        aiEnabled: true,
        messageId,
        createdAt: new Date().toISOString(),
      } as unknown as Record<string, unknown>);

      this.logger.log(
        `✅ Published conversation.created event: ${conversation.id}`
      );
    } catch (error) {
      this.logger.error(
        'Error handling conversation incoming event:',
        error instanceof Error ? error.message : error
      );
      // Don't throw - let message processing continue independently
    }
  }

  /**
   * Listen for AI toggle events (when conversation.aiEnabled is changed)
   */
  @RabbitSubscribe({
    exchange: 'channels',
    routingKey: 'channels.conversation.ai-toggle',
    queue: 'whatsapp.conversation.ai-toggle',
  })
  async handleAIToggle(payload: {conversationId: string; aiEnabled: boolean}) {
    try {
      const {conversationId, aiEnabled} = payload;

      // Update database
      const updated = await this.prisma.conversation.update({
        where: {id: conversationId},
        data: {aiEnabled, updatedAt: new Date()},
      });

      this.logger.log(
        `✅ Conversation AI toggled: ${conversationId} → ${aiEnabled}`
      );

      // Update cache (cache stores by channelUserId, not conversationId)
      if (updated.channelUserId) {
        this.cache.update(updated.channelUserId, {aiEnabled});
      }
    } catch (error) {
      this.logger.error('Error handling AI toggle event:', error);
    }
  }

  /**
   * Listen for agent assignment events
   */
  @RabbitSubscribe({
    exchange: 'channels',
    routingKey: 'channels.conversation.agent-assign',
    queue: 'whatsapp.conversation.agent-assign',
  })
  async handleAgentAssign(payload: {
    conversationId: string;
    agentAssigned: string;
  }) {
    try {
      const {conversationId, agentAssigned} = payload;

      // Update database: set agent and disable AI
      const updated = await this.prisma.conversation.update({
        where: {id: conversationId},
        data: {
          agentAssigned: agentAssigned || null,
          aiEnabled: agentAssigned ? false : true, // Disable AI when agent assigned
          status: agentAssigned ? 'WITH_AGENT' : 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      this.logger.log(
        `✅ Agent assigned to conversation: ${conversationId} → ${
          agentAssigned || 'UNASSIGNED'
        }`
      );

      // Update cache (cache stores by channelUserId, not conversationId)
      if (updated.channelUserId) {
        this.cache.update(updated.channelUserId, {
          aiEnabled: agentAssigned ? false : true,
          status: agentAssigned ? 'WITH_AGENT' : 'ACTIVE',
        });
      }
    } catch (error) {
      this.logger.error('Error handling agent assign event:', error);
    }
  }
}
