import { IAIService } from '../ports/IAIService'
import { ICacheService } from '../ports/ICacheService'
import { IConversationRepository } from '../ports/IConversationRepository'
import { IRateLimitService } from '../ports/IRateLimitService'
import { IEventPublisher } from '../ports/IEventPublisher'

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

    // In the real flow, the user identity is looked up from DB directly.
    // The identity.resolve event is fire-and-forget; this use case reads
    // the current state from the conversation repository.
    const dbConversation = cached
      ? null
      : await this.conversationRepo.findActiveByChannelUser(input.senderId, input.channel)

    const conversation = cached ?? dbConversation

    if (conversation) {
      if (!conversation.aiEnabled || conversation.agentAssigned) return
    }

    // For AI, we need the resolved userId. Since identity resolution is async,
    // we check if the conversation has a userId. If not, we skip AI processing.
    if (!conversation?.userId) return

    const hasCapacity = await this.rateLimiter.checkAndIncrement(conversation.userId, input.channel)
    if (!hasCapacity) return

    const aiResponse = await this.aiService.invoke({
      userId: conversation.userId,
      userName: input.senderName,
      userPhone: input.senderId,
      message: input.messageText,
      messageId: input.messageId,
    })

    if (!aiResponse) {
      await this.rateLimiter.refund(conversation.userId, input.channel)
      return
    }

    this.eventBus.publish('channels.whatsapp.ai-response', {
      userId: conversation.userId,
      senderId: input.senderId,
      messageId: input.messageId,
      conversationId: conversation.id,
      aiResponse: aiResponse.aiResponse,
      confidence: aiResponse.confidence ?? 0,
      model: aiResponse.model ?? 'unknown',
      processingTime: aiResponse.processingTime ?? 0,
      timestamp: Date.now(),
    })
  }
}
