import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Conversation } from '@prisma/client';
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
 * Routing keys for the CQRS read model (consumed by sync-service).
 * Rule: emit AFTER Postgres writes commit. Source of truth lives here.
 */
const DATA_EVENTS = {
  CONVERSATION_CREATED: 'data.whatsapp.conversation.created',
  MESSAGE_RECEIVED: 'data.whatsapp.message.received',
} as const;

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

      // ✅ TAREA 5: Use upsert to avoid duplicate conversations.
      //
      // We need to know whether this run actually created the row (vs found+updated
      // an existing one) so we only fire `data.whatsapp.conversation.created` once
      // per conversation. Prisma upsert returns the row but not that flag, so we
      // exploit: at creation time `createdAt === updatedAt`; any later upsert
      // bumps `updatedAt`. Safe because Prisma sets both in the same SQL
      // statement on INSERT.
      const conversation = await this.prisma.conversation.upsert({
        where: {
          channelUserId_channel_status: {
            channelUserId,
            channel,
            status: 'ACTIVE',
          },
        },
        update: {
          messageCount: { increment: 1 },
          lastMessageAt: messageTimestamp,
          updatedAt: new Date(),
        },
        create: {
          userId: null, // Will be backfilled when Identity resolves.
          channelUserId,
          channel,
          topic,
          detectionMethod: 'KEYWORDS',
          keywords,
          aiEnabled: true,
          status: 'ACTIVE',
          messageCount: 1,
          aiMessageCount: 0,
          lastMessageAt: messageTimestamp,
        },
      });
      const wasCreated = conversation.createdAt.getTime() === conversation.updatedAt.getTime();
      this.logger.log(
        `✅ Conversation ${wasCreated ? 'created' : 'updated'}: ${conversation.id} | Topic: ${topic}`,
      );

      // ✅ Save the incoming message to ConversationMessage
      let messageSaved = false;
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
        messageSaved = true;
        this.logger.debug(
          `✅ ConversationMessage saved for conversation ${conversation.id} | mediaUrl: ${mediaUrl || 'none'}`,
        );
      } catch (msgError) {
        this.logger.error(
          `Failed to save ConversationMessage: ${msgError instanceof Error ? msgError.message : msgError}`,
        );
        // Don't throw — the conversation row is fine; we still emit conversation.created
        // but skip message.received because no message row exists.
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

      // 3. Publish the legacy in-channel conversation.created event (other
      // services may still depend on this — kept for back-compat).
      if (wasCreated) {
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
        this.logger.log(`✅ Published channels.conversation.created: ${conversation.id}`);
      }

      // 4. Publish CQRS data.* events. Fires AFTER Postgres has committed.
      //    Sync-service projects these into the MongoDB read model.
      if (wasCreated) {
        await this.publishConversationSnapshot(conversation);
      }
      if (messageSaved) {
        await this.publishMessageReceived({
          messageId,
          channelUserId,
          conversationId: conversation.id,
          content: messageText,
          mediaUrl: mediaUrl ?? null,
          userId: conversation.userId,
          occurredAt: messageTimestamp,
        });
      }
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

      // Mirror the change into the read model.
      await this.publishConversationSnapshot(updated);
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

      // Mirror the change into the read model. sync-service will update the
      // UnifiedConversation document so the gateway's /v1/query/* sees it.
      await this.publishConversationSnapshot(updated);
    } catch (error) {
      this.logger.error('Error handling agent assign event:', error);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CQRS publishers — every method here runs AFTER Postgres has committed.
  // Payloads are intentionally complete (sync-service projects them as-is).
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Emit a conversation snapshot. Used for both first-time creation and
   * later state changes (AI toggle, agent assign). Sync's projector upserts,
   * so re-emitting the same conversationId is safe.
   *
   * Note: we keep the routing key as `data.whatsapp.conversation.created`
   * for back-compat — the projector treats it as "this is the current
   * state of this conversation."
   */
  private async publishConversationSnapshot(conversation: Conversation): Promise<void> {
    await this.rabbitmq.publish(DATA_EVENTS.CONVERSATION_CREATED, {
      conversationId: conversation.id,
      channel: 'whatsapp',
      channelUserId: conversation.channelUserId,
      topic: conversation.topic ?? null,
      userId: conversation.userId ?? null,
      status: conversation.status,
      aiEnabled: conversation.aiEnabled,
      agentAssigned: conversation.agentAssigned ?? null,
      createdAt: conversation.createdAt.toISOString(),
    } as unknown as Record<string, unknown>);
  }

  /** Emit a user-sent message. Always paired with a saved ConversationMessage. */
  private async publishMessageReceived(args: {
    messageId: string;
    channelUserId: string;
    conversationId: string;
    content: string;
    mediaUrl: string | null;
    userId: string | null;
    occurredAt: Date;
  }): Promise<void> {
    await this.rabbitmq.publish(DATA_EVENTS.MESSAGE_RECEIVED, {
      messageId: args.messageId,
      senderId: args.channelUserId,
      channelUserId: args.channelUserId,
      conversationId: args.conversationId,
      content: args.content,
      mediaUrl: args.mediaUrl,
      userId: args.userId,
      channel: 'whatsapp',
      timestamp: args.occurredAt.toISOString(),
    } as unknown as Record<string, unknown>);
  }
}
