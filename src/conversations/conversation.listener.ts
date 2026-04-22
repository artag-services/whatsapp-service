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
  mediaUrl?: string;
  mediaType?: string;
}

/**
 * Listens for conversation.incoming events from the Gateway
 * Creates new Conversation records and publishes conversation.created events
 * Also saves the first incoming message to ConversationMessage
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
   * Creates or updates Conversation and saves the first message
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

      const { channel, channelUserId, messageText, messageId, timestamp, mediaUrl } = payload;

      // ✅ TAREA 2: Parse timestamp from Unix timestamp (string) to Date
      let messageTimestamp: Date;
      try {
        const unixTimestamp = parseInt(timestamp, 10);
        messageTimestamp = new Date(unixTimestamp * 1000);
      } catch (error) {
        this.logger.warn(`Invalid timestamp: ${timestamp}, using current time`);
        messageTimestamp = new Date();
      }

      // 1. Detect topic from message text
      const topic = this.topicDetection.detectTopic(messageText);
      const keywords = this.topicDetection.extractKeywords(messageText, topic);

      // ✅ TAREA 5: Use upsert to avoid duplicate conversations
      const conversation = await this.prisma.conversation.upsert({
        where: {
          channelUserId_channel_status: {
            channelUserId,
            channel,
            status: 'ACTIVE',
          },
        },
        update: {
          // If conversation exists, just update counters and timestamp
          messageCount: { increment: 1 },
          lastMessageAt: messageTimestamp,
          updatedAt: new Date(),
        },
        create: {
          // If conversation doesn't exist, create it
          userId: null, // Will be updated when Identity resolves
          channelUserId,
          channel,
          topic,
          detectionMethod: 'KEYWORDS',
          keywords,
          aiEnabled: true,
          status: 'ACTIVE',
          messageCount: 1, // Count the first message
          aiMessageCount: 0,
          lastMessageAt: messageTimestamp,
        },
      });

      this.logger.log(
        `✅ Conversation ${conversation.id ? 'created' : 'updated'}: ${conversation.id} | Topic: ${topic}`
      );

      // ✅ TAREA 1 & 3: Save the incoming message to ConversationMessage
      try {
        await this.prisma.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            sender: 'USER',
            content: messageText,
            mediaUrl: mediaUrl || null,
            externalId: messageId,
            metadata: {
              channelUserId,
              unixTimestamp: parseInt(timestamp, 10),
              mediaType: payload.mediaType || null,
            },
          },
        });

        this.logger.debug(
          `✅ ConversationMessage saved for conversation ${conversation.id} | mediaUrl: ${mediaUrl || 'none'}`
        );
      } catch (msgError) {
        this.logger.error(
          `Failed to save ConversationMessage: ${msgError instanceof Error ? msgError.message : msgError}`
        );
        // Don't throw - conversation was created, only message failed
      }

      // 2. Update in-memory cache
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

      // 3. Publish conversation.created event for other services
      await this.rabbitmq.publish(ROUTING_KEYS.CONVERSATION_CREATED, {
        conversationId: conversation.id,
        channel,
        channelUserId,
        topic,
        aiEnabled: true,
        messageId,
        timestamp: messageTimestamp.toISOString(),
        createdAt: conversation.createdAt.toISOString(),
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
