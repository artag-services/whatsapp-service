import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common'

import { RabbitMQService } from '../../rabbitmq/rabbitmq.service'
import { ROUTING_KEYS, QUEUES } from '../../rabbitmq/constants/queues'
import {
  SendMessageUseCase,
  SendMessageInput,
} from '../../domain/services/send-message.usecase'
import { ProcessAIUseCase, AIProcessInput } from '../../domain/services/process-ai.usecase'
import { HandleAIResponseUseCase } from '../../domain/services/handle-ai-response.usecase'
import { IEventPublisher } from '../../domain/ports/IEventPublisher'
import {
  MetaWebhookPayload,
  MetaWebhookValue,
  META_ERROR_CODES,
} from '../../whatsapp/types/meta-webhook.types'
import { SendWhatsappDto } from '../../whatsapp/dto/send-whatsapp.dto'

const IDENTITY_RESOLVE_ROUTING_KEY = 'channels.identity.resolve'

@Injectable()
export class WhatsappConsumer implements OnModuleInit {
  private readonly logger = new Logger(WhatsappConsumer.name)

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly sendMessageUseCase: SendMessageUseCase,
    private readonly processAIUseCase: ProcessAIUseCase,
    private readonly handleAIResponseUseCase: HandleAIResponseUseCase,
    @Inject('IEventPublisher') private readonly eventBus: IEventPublisher,
  ) {}

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
      async () => { /* stub — debug only */ },
    )
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_EVENTS_CALLS, ROUTING_KEYS.WHATSAPP_CALLS_RECEIVED, async () => {
      /* stub */
    })
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_EVENTS_FLOWS, ROUTING_KEYS.WHATSAPP_FLOWS_RECEIVED, async () => {
      /* stub */
    })
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_PHONE_NUMBER_UPDATE,
      ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE,
      (p) => this.handlePhoneNumberUpdate(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_TEMPLATE_UPDATE,
      ROUTING_KEYS.WHATSAPP_TEMPLATE_UPDATE,
      async () => { /* stub */ },
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

  private async handleSendMessage(payload: Record<string, unknown>): Promise<void> {
    const dto = payload as unknown as SendWhatsappDto
    this.logger.log(`Processing message ${dto.messageId} → ${dto.recipients.length} recipient(s)`)

    const response = await this.sendMessageUseCase.sendToRecipients({
      messageId: dto.messageId,
      recipients: dto.recipients,
      message: dto.message,
      mediaUrl: dto.mediaUrl,
    })

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
        this.logger.log(`Re-engagement failure for ${recipient} (code 131047)`)
        try {
          await this.sendMessageUseCase.sendTemplateToFailedRecipient(recipient)
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

      this.logger.log(`Incoming from ${senderId} (${senderName})`)

      this.eventBus.publish(IDENTITY_RESOLVE_ROUTING_KEY, {
        channel: 'whatsapp',
        channelUserId: senderId,
        phone: senderId,
        displayName: senderName,
        metadata: { messageId, timestamp, messageText },
      })

      this.processAIUseCase.execute({
        senderId,
        senderName,
        messageText,
        messageId,
        channel: 'whatsapp',
      }).catch((error) => {
        this.logger.error(
          `AI processing failed for ${senderId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }
  }

  private async handlePhoneNumberUpdate(payload: Record<string, unknown>): Promise<void> {
    const value = (payload as MetaWebhookPayload).value
    if (!value?.users?.length) return

    for (const user of value.users) {
      this.logger.log(`Phone update: ${user.old_phone} → ${user.new_phone} (user ${user.user_id})`)
      this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE, {
        oldPhoneNumber: user.old_phone,
        newPhoneNumber: user.new_phone,
        userId: user.user_id,
        channel: 'whatsapp',
        timestamp: Date.now(),
      })
    }
  }

  private async handleAccountAlerts(payload: Record<string, unknown>): Promise<void> {
    this.logger.warn(`Account alert: ${JSON.stringify(payload).substring(0, 400)}`)
  }

  private async handleAIResponse(payload: Record<string, unknown>): Promise<void> {
    try {
      const { userId, senderId, messageId, aiResponse, confidence, model, processingTime } = payload as {
        userId: string
        senderId: string
        messageId: string
        aiResponse: string
        confidence?: number
        model?: string
        processingTime?: number
      }

      const sendFn = (recipient: string, message: string, chunkMessageId: string) =>
        this.sendMessageUseCase.sendToOneWithId(chunkMessageId, recipient, message, null)

      await this.handleAIResponseUseCase.execute(
        { userId, senderId, messageId, aiResponse, confidence, model, processingTime },
        sendFn,
      )
    } catch (error) {
      this.logger.error(
        `Error handling AI response: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async handleFailedChunk(payload: Record<string, unknown>): Promise<void> {
    try {
      const { chunkId, aiResponseId, senderId, retryCount } = payload as {
        chunkId: string
        aiResponseId: string
        senderId: string
        retryCount?: number
      }

      const sendFn = (recipient: string, message: string, chunkMessageId: string) =>
        this.sendMessageUseCase.sendToOneWithId(chunkMessageId, recipient, message, null)

      await this.handleAIResponseUseCase.handleFailedChunk(
        chunkId, aiResponseId, senderId, sendFn, retryCount ?? 0,
      )
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
}
