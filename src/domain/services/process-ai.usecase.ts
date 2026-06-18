import { IAIService } from '../ports/IAIService'
import { ICacheService } from '../ports/ICacheService'
import { IConversationRepository } from '../ports/IConversationRepository'
import { IRateLimitService } from '../ports/IRateLimitService'
import { IEventPublisher } from '../ports/IEventPublisher'
import { IUserIdentityRepository } from '../ports/IUserIdentityRepository'

export interface AIProcessInput {
  senderId: string
  senderName: string
  messageText: string
  messageId: string
  channel: string
}

export class ProcessAIUseCase {
  private readonly aiRateLimitDaily: number

  constructor(
    private readonly cache: ICacheService,
    private readonly conversationRepo: IConversationRepository,
    private readonly identityRepo: IUserIdentityRepository,
    private readonly aiService: IAIService,
    private readonly rateLimiter: IRateLimitService,
    private readonly eventBus: IEventPublisher,
    aiRateLimitDaily?: number,
  ) {
    this.aiRateLimitDaily = aiRateLimitDaily ?? 20
  }

  async execute(input: AIProcessInput): Promise<void> {
    const cached = this.cache.get(input.senderId)
    if (cached && (!cached.aiEnabled || cached.agentAssigned)) {
      return
    }

    const dbConversation = cached
      ? null
      : await this.conversationRepo.findActiveByChannelUser(input.senderId, input.channel)

    const conversation = cached ?? dbConversation

    if (conversation) {
      if (!conversation.aiEnabled || conversation.agentAssigned) return
    }

    let userId = conversation?.userId ?? null

    if (!userId) {
      const identity = await this.identityRepo.findByChannelUser(input.senderId, input.channel)
      if (!identity || !identity.aiEnabled) return
      userId = identity.userId
    }

    const hasCapacity = await this.rateLimiter.checkAndIncrement(userId, input.channel)
    if (!hasCapacity) return

    const aiResponse = await this.aiService.invoke({
      userId,
      userName: input.senderName,
      userPhone: input.senderId,
      message: input.messageText,
      messageId: input.messageId,
    })

    if (!aiResponse) {
      await this.rateLimiter.refund(userId, input.channel)
      return
    }

    this.eventBus.publish('channels.whatsapp.ai-response', {
      userId,
      senderId: input.senderId,
      messageId: input.messageId,
      conversationId: conversation?.id ?? null,
      aiResponse: aiResponse.aiResponse,
      confidence: aiResponse.confidence ?? 0,
      model: aiResponse.model ?? 'unknown',
      processingTime: aiResponse.processingTime ?? 0,
      timestamp: Date.now(),
    })
  }
}
