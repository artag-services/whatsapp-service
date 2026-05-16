import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { RabbitMQService } from '../rabbitmq/rabbitmq.service'
import { WhatsappService } from './whatsapp.service'
import { AIResponseService } from './services/ai-response.service'
import { ROUTING_KEYS, QUEUES } from '../rabbitmq/constants/queues'
import { SendWhatsappDto } from './dto/send-whatsapp.dto'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationCacheService } from '../conversations/conversation-cache.service'
import {
  META_ERROR_CODES,
  MetaWebhookPayload,
  MetaWebhookValue,
} from './types/meta-webhook.types'

const IDENTITY_RESOLVE_ROUTING_KEY = 'channels.identity.resolve'

@Injectable()
export class WhatsappListener implements OnModuleInit {
  private readonly logger = new Logger(WhatsappListener.name)
  private readonly aiRateLimitDaily: number

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly whatsapp: WhatsappService,
    private readonly aiResponseService: AIResponseService,
    private readonly prisma: PrismaService,
    private readonly conversationCache: ConversationCacheService,
    config: ConfigService,
  ) {
    this.aiRateLimitDaily = Number(config.get<string>('WHATSAPP_AI_DAILY_LIMIT') ?? 20)
  }

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_SEND, ROUTING_KEYS.WHATSAPP_SEND, (p) =>
      this.handleSendMessage(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_MESSAGE,
      ROUTING_KEYS.WHATSAPP_MESSAGE_RECEIVED,
      (p) => this.handleMessageReceived(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_MESSAGE_ECHO,
      ROUTING_KEYS.WHATSAPP_MESSAGE_ECHO_RECEIVED,
      (p) => this.handleMessageEcho(p),
    )
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_EVENTS_CALLS, ROUTING_KEYS.WHATSAPP_CALLS_RECEIVED, (p) =>
      this.handleCalls(p),
    )
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_EVENTS_FLOWS, ROUTING_KEYS.WHATSAPP_FLOWS_RECEIVED, (p) =>
      this.handleFlows(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_PHONE_NUMBER_UPDATE,
      ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE,
      (p) => this.handlePhoneNumberUpdate(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_TEMPLATE_UPDATE,
      ROUTING_KEYS.WHATSAPP_TEMPLATE_UPDATE,
      (p) => this.handleTemplateUpdate(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_ALERTS,
      ROUTING_KEYS.WHATSAPP_ALERTS_RECEIVED,
      (p) => this.handleAccountAlerts(p),
    )
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_AI_RESPONSE, ROUTING_KEYS.WHATSAPP_AI_RESPONSE, (p) =>
      this.handleAIResponse(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_AI_RESPONSE_CHUNK_FAILED,
      ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED,
      (p) => this.handleFailedChunk(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_AI_RESPONSE_DLQ,
      ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ,
      (p) => this.handleAIResponseDLQ(p),
    )
  }

  // ───────────────────────────── Outgoing ─────────────────────────────

  private async handleSendMessage(payload: Record<string, unknown>): Promise<void> {
    const dto = payload as unknown as SendWhatsappDto
    this.logger.log(`Processing message ${dto.messageId} → ${dto.recipients.length} recipient(s)`)
    const response = await this.whatsapp.sendToRecipients(dto)

    this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_RESPONSE, {
      messageId: response.messageId,
      status: response.status,
      sentCount: response.sentCount,
      failedCount: response.failedCount,
      errors: response.errors ?? null,
      timestamp: response.timestamp,
    })

    if (response.errors?.length) {
      for (const err of response.errors) {
        this.logger.error(`Msg ${dto.messageId} → ${err.recipient} FAILED: ${err.reason}`)
      }
    }

    this.logger.log(
      `Msg ${dto.messageId} done | ${response.status} | sent=${response.sentCount} failed=${response.failedCount}`,
    )
  }

  // ───────────────────────────── Incoming ─────────────────────────────

  private async handleMessageReceived(payload: Record<string, unknown>): Promise<void> {
    const value = (payload as MetaWebhookPayload).value
    if (!value) {
      this.logger.warn('Received webhook without `value`')
      return
    }
    if (value.statuses?.length) {
      await this.handleStatusEvents(value)
      return
    }
    if (value.messages?.length) {
      await this.handleInboundMessages(value)
    }
  }

  private async handleStatusEvents(value: MetaWebhookValue): Promise<void> {
    if (!value.statuses) return
    for (const status of value.statuses) {
      if (status.status !== 'failed' || !status.errors?.length) continue
      const errorCode = status.errors[0].code
      const recipient = status.recipient_id

      if (errorCode === META_ERROR_CODES.RE_ENGAGEMENT_REQUIRED) {
        this.logger.log(`⚠️ Re-engagement failure for ${recipient} (code 131047)`)
        try {
          await this.whatsapp.sendTemplateToFailedRecipient(recipient)
        } catch (error) {
          this.logger.error(
            `Fallback template failed for ${recipient}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }

  private async handleInboundMessages(value: MetaWebhookValue): Promise<void> {
    if (!value.messages) return

    const contactsMap = new Map<string, string>()
    if (value.contacts) {
      for (const contact of value.contacts) {
        if (contact.profile?.name && contact.wa_id) {
          contactsMap.set(contact.wa_id, contact.profile.name)
        }
      }
    }

    for (const message of value.messages) {
      const senderId = message.from
      const senderName = contactsMap.get(senderId) ?? senderId
      const messageText = message.text?.body ?? ''
      const messageId = message.id
      const timestamp = message.timestamp

      this.logger.log(`📨 Incoming from ${senderId} (${senderName})`)

      this.rabbitmq.publish(IDENTITY_RESOLVE_ROUTING_KEY, {
        channel: 'whatsapp',
        channelUserId: senderId,
        phone: senderId,
        displayName: senderName,
        metadata: { messageId, timestamp, messageText },
      })

      this.processAIResponse(senderId, senderName, messageText, messageId).catch((error) => {
        this.logger.error(
          `AI processing failed for ${senderId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }
  }

  /**
   * Optimizations vs original:
   *   - Parallel DB queries (identity + conversation when cache miss)
   *   - Atomic `upsert` for rate limit (no race condition)
   *   - Fast-path skip via cache before any DB hit
   *   - Refund rate-limit slot if N8N returns null
   */
  private async processAIResponse(
    senderId: string,
    senderName: string,
    messageText: string,
    messageId: string,
  ): Promise<void> {
    const cached = this.conversationCache.get(senderId)
    if (cached && (!cached.aiEnabled || cached.agentAssigned)) {
      return
    }

    const [userIdentity, dbConversation] = await Promise.all([
      this.prisma.userIdentity.findUnique({
        where: { channelUserId_channel: { channelUserId: senderId, channel: 'whatsapp' } },
        include: { user: true },
      }),
      cached
        ? Promise.resolve(null)
        : this.prisma.conversation.findFirst({
            where: { channelUserId: senderId, channel: 'whatsapp', status: 'ACTIVE' },
          }),
    ])

    if (!userIdentity) return
    const user = userIdentity.user

    const conversation =
      cached ??
      (dbConversation
        ? {
            id: dbConversation.id,
            channelUserId: dbConversation.channelUserId,
            topic: dbConversation.topic,
            aiEnabled: dbConversation.aiEnabled,
            userId: dbConversation.userId,
            status: dbConversation.status,
            agentAssigned: dbConversation.agentAssigned,
          }
        : null)

    if (conversation) {
      if (!conversation.aiEnabled || conversation.agentAssigned) return
    } else if (!user.aiEnabled) {
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const rateLimit = await this.prisma.n8NRateLimit.upsert({
      where: { userId_service_date: { userId: user.id, service: 'whatsapp', date: today } },
      create: { userId: user.id, service: 'whatsapp', date: today, callCount: 1 },
      update: { callCount: { increment: 1 } },
    })

    if (rateLimit.callCount > this.aiRateLimitDaily) {
      await this.prisma.n8NRateLimit.update({
        where: { id: rateLimit.id },
        data: { callCount: { decrement: 1 } },
      })
      this.logger.warn(`User ${user.id} exceeded daily AI limit (${this.aiRateLimitDaily})`)
      return
    }

    const n8nResponse = await this.whatsapp.callN8NWebhook(
      user.id,
      senderName,
      senderId,
      messageText,
      messageId,
    )

    if (!n8nResponse) {
      await this.prisma.n8NRateLimit.update({
        where: { id: rateLimit.id },
        data: { callCount: { decrement: 1 } },
      })
      return
    }

    this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE, {
      userId: user.id,
      senderId,
      messageId,
      conversationId: conversation?.id,
      aiResponse: n8nResponse.aiResponse,
      confidence: n8nResponse.confidence ?? 0,
      model: n8nResponse.model ?? 'unknown',
      processingTime: n8nResponse.processingTime ?? 0,
      timestamp: Date.now(),
    })
  }

  // ───────────────────────────── Stubs ─────────────────────────────

  private async handleMessageEcho(payload: Record<string, unknown>): Promise<void> {
    this.lazyDebug(() => `🔄 Message echo: ${JSON.stringify(payload).substring(0, 200)}`)
  }

  private async handleCalls(payload: Record<string, unknown>): Promise<void> {
    this.lazyDebug(() => `📞 Call event: ${JSON.stringify(payload).substring(0, 200)}`)
  }

  private async handleFlows(payload: Record<string, unknown>): Promise<void> {
    this.lazyDebug(() => `🌊 Flow event: ${JSON.stringify(payload).substring(0, 200)}`)
  }

  private async handlePhoneNumberUpdate(payload: Record<string, unknown>): Promise<void> {
    const value = (payload as MetaWebhookPayload).value
    if (!value?.users?.length) return

    for (const user of value.users) {
      this.logger.log(`📞 Phone update: ${user.old_phone} → ${user.new_phone} (user ${user.user_id})`)
      this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE, {
        oldPhoneNumber: user.old_phone,
        newPhoneNumber: user.new_phone,
        userId: user.user_id,
        channel: 'whatsapp',
        timestamp: Date.now(),
      })
    }
  }

  private async handleTemplateUpdate(payload: Record<string, unknown>): Promise<void> {
    this.lazyDebug(() => `📋 Template update: ${JSON.stringify(payload).substring(0, 200)}`)
  }

  private async handleAccountAlerts(payload: Record<string, unknown>): Promise<void> {
    this.logger.warn(`⚠️ Account alert: ${JSON.stringify(payload).substring(0, 400)}`)
  }

  // ───────────────────────────── AI Response ─────────────────────────────

  private async handleAIResponse(payload: Record<string, unknown>): Promise<void> {
    try {
      const { userId, senderId, messageId, aiResponse, confidence, model, processingTime } =
        payload as {
          userId: string
          senderId: string
          messageId: string
          aiResponse: string
          confidence?: number
          model?: string
          processingTime?: number
        }

      const validAiResponse = aiResponse || 'No AI response generated'

      const aiResponseRecord = await this.aiResponseService.createAIResponse({
        userId,
        senderId,
        messageId,
        originalMessage: '',
        aiResponse: validAiResponse,
        model: model ?? 'unknown',
        confidence: confidence ?? 0,
        processingTime: processingTime ?? 0,
      })

      const chunks = this.aiResponseService.splitMessageIntoChunks(validAiResponse)
      if (chunks.length === 0) {
        await this.aiResponseService.sendToDLQ(aiResponseRecord.id, 'AI response is empty')
        return
      }

      const chunkRecords = await this.aiResponseService.createChunks(aiResponseRecord.id, chunks)

      let sentCount = 0
      for (const chunk of chunkRecords) {
        const result = await this.aiResponseService.sendChunkWithRetry(
          chunk,
          senderId,
          (recipient, message, chunkMessageId) =>
            this.whatsapp.sendToOneWithId(chunkMessageId, recipient, message, null),
        )

        if (result.success) {
          await this.prisma.aIResponseChunk.update({
            where: { id: chunk.id },
            data: {
              status: 'SENT',
              externalMessageId: result.externalMessageId,
              channel: result.channel,
              sentAt: new Date(),
            },
          })
          sentCount++
        } else {
          this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
            chunkId: chunk.id,
            aiResponseId: aiResponseRecord.id,
            senderId,
            error: result.error,
          })
        }
      }

      const finalStatus = await this.aiResponseService.updateAIResponseStatus(aiResponseRecord.id)
      this.logger.log(`AI response: ${sentCount}/${chunkRecords.length} chunks sent | ${finalStatus}`)
    } catch (error) {
      this.logger.error(
        `Error handling AI response: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async handleFailedChunk(payload: Record<string, unknown>): Promise<void> {
    try {
      const { chunkId } = payload as { chunkId: string }
      await this.aiResponseService.handleFailedChunk(chunkId)
    } catch (error) {
      this.logger.error(
        `Error handling failed chunk: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async handleAIResponseDLQ(payload: Record<string, unknown>): Promise<void> {
    const { aiResponseId, userId, reason } = payload as {
      aiResponseId: string
      userId: string
      reason: string
    }
    this.logger.error(
      `[DLQ] AI Response permanently failed | aiResponseId=${aiResponseId} userId=${userId} reason=${reason}`,
    )
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private lazyDebug(messageBuilder: () => string): void {
    if (Logger.isLevelEnabled('debug')) {
      this.logger.debug(messageBuilder())
    }
  }
}
