import { ICacheService, CachedConversation } from '../ports/ICacheService'
import { IConversationRepository } from '../ports/IConversationRepository'
import { IEventPublisher } from '../ports/IEventPublisher'
import { Topic } from '../value-objects/topic'

export interface ConversationIncomingInput {
  channel: string
  channelUserId: string
  messageText: string
  messageId: string
  timestamp: string
  mediaUrl?: string
  mediaType?: string
}

const DATA_EVENTS = {
  CONVERSATION_CREATED: 'data.whatsapp.conversation.created',
  MESSAGE_RECEIVED: 'data.whatsapp.message.received',
  MESSAGE_SENT: 'data.whatsapp.message.sent',
} as const

export class ManageConversationUseCase {
  constructor(
    private readonly cache: ICacheService,
    private readonly conversationRepo: IConversationRepository,
    private readonly eventBus: IEventPublisher,
  ) {}

  async handleIncoming(input: ConversationIncomingInput): Promise<void> {
    if (input.channel !== 'whatsapp') return

    const topic = Topic.detect(input.messageText)
    const keywords = topic.extractKeywords(input.messageText)

    let messageTimestamp: Date
    try {
      const unixTimestamp = parseInt(input.timestamp, 10)
      messageTimestamp = new Date(unixTimestamp * 1000)
    } catch {
      messageTimestamp = new Date()
    }

    const { conversation, wasCreated } = await this.conversationRepo.upsert({
      channelUserId: input.channelUserId,
      channel: input.channel,
      messageText: input.messageText,
      timestamp: messageTimestamp,
      topic: topic.value,
      keywords,
    })

    let messageSaved = false
    try {
      await this.conversationRepo.createMessage({
        conversationId: conversation.id,
        sender: 'USER',
        content: input.messageText,
        mediaUrl: input.mediaUrl ?? null,
        externalId: input.messageId,
        metadata: {
          channelUserId: input.channelUserId,
          unixTimestamp: parseInt(input.timestamp, 10),
          mediaType: input.mediaType ?? null,
        },
      })
      messageSaved = true
    } catch {
      /* log but don't fail — conversation row is fine */
    }

    const cachedConv: CachedConversation = {
      id: conversation.id,
      channelUserId: input.channelUserId,
      topic: topic.value,
      aiEnabled: true,
      userId: null,
      status: 'ACTIVE',
      agentAssigned: null,
    }
    this.cache.set(input.channelUserId, cachedConv)

    if (wasCreated) {
      this.eventBus.publish('channels.conversation.created', {
        conversationId: conversation.id,
        channel: input.channel,
        channelUserId: input.channelUserId,
        topic: topic.value,
        aiEnabled: true,
        messageId: input.messageId,
        timestamp: messageTimestamp.toISOString(),
        createdAt: conversation.createdAt.toISOString(),
      })
    }

    if (wasCreated) {
      this.publishConversationSnapshot(conversation)
    }
    if (messageSaved) {
      this.publishMessageReceived({
        messageId: input.messageId,
        channelUserId: input.channelUserId,
        conversationId: conversation.id,
        content: input.messageText,
        mediaUrl: input.mediaUrl ?? null,
        userId: conversation.userId,
        occurredAt: messageTimestamp,
      })
    }
  }

  async toggleAI(conversationId: string, aiEnabled: boolean): Promise<void> {
    const updated = await this.conversationRepo.update(conversationId, { aiEnabled })
    if (updated.channelUserId) {
      this.cache.update(updated.channelUserId, { aiEnabled })
    }
    this.publishConversationSnapshot(updated)
  }

  async assignAgent(conversationId: string, agentAssigned: string | null): Promise<void> {
    const updated = await this.conversationRepo.update(conversationId, {
      agentAssigned: agentAssigned || null,
      aiEnabled: agentAssigned ? false : true,
      status: agentAssigned ? 'WITH_AGENT' : 'ACTIVE',
    })
    if (updated.channelUserId) {
      this.cache.update(updated.channelUserId, {
        aiEnabled: agentAssigned ? false : true,
        status: agentAssigned ? 'WITH_AGENT' : 'ACTIVE',
      })
    }
    this.publishConversationSnapshot(updated)
  }

  async handleBotResponse(conversationId: string, content: string, channelUserId: string, messageId?: string): Promise<void> {
    await this.conversationRepo.createMessage({
      conversationId,
      sender: 'BOT',
      content,
      externalId: messageId ?? '',
    })

    await this.conversationRepo.incrementAiMessageCount(conversationId)

    this.eventBus.publish(DATA_EVENTS.MESSAGE_SENT, {
      messageId: messageId ?? null,
      conversationId,
      channel: 'whatsapp',
      channelUserId,
      recipient: channelUserId,
      content,
      timestamp: new Date().toISOString(),
    })
  }

  private publishConversationSnapshot(conversation: {
    id: string
    channel: string
    channelUserId: string
    topic: string | null
    userId: string | null
    status: string
    aiEnabled: boolean
    agentAssigned: string | null
    createdAt: Date
  }): void {
    this.eventBus.publish(DATA_EVENTS.CONVERSATION_CREATED, {
      conversationId: conversation.id,
      channel: 'whatsapp',
      channelUserId: conversation.channelUserId,
      topic: conversation.topic ?? null,
      userId: conversation.userId ?? null,
      status: conversation.status,
      aiEnabled: conversation.aiEnabled,
      agentAssigned: conversation.agentAssigned ?? null,
      createdAt: conversation.createdAt.toISOString(),
    })
  }

  private publishMessageReceived(args: {
    messageId: string
    channelUserId: string
    conversationId: string
    content: string
    mediaUrl: string | null
    userId: string | null
    occurredAt: Date
  }): void {
    this.eventBus.publish(DATA_EVENTS.MESSAGE_RECEIVED, {
      messageId: args.messageId,
      senderId: args.channelUserId,
      channelUserId: args.channelUserId,
      conversationId: args.conversationId,
      content: args.content,
      mediaUrl: args.mediaUrl,
      userId: args.userId,
      channel: 'whatsapp',
      timestamp: args.occurredAt.toISOString(),
    })
  }
}
