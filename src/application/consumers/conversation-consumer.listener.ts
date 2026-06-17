import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service'
import { ROUTING_KEYS, QUEUES } from '../../rabbitmq/constants/queues'
import { ManageConversationUseCase, ConversationIncomingInput } from '../../domain/services/manage-conversation.usecase'

@Injectable()
export class ConversationConsumer implements OnModuleInit {
  private readonly logger = new Logger(ConversationConsumer.name)

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly manageConversation: ManageConversationUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.subscribe(
      QUEUES.CONVERSATION_INCOMING,
      ROUTING_KEYS.CONVERSATION_INCOMING,
      (p) => this.handleConversationIncoming(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.CONVERSATION_AI_TOGGLE,
      ROUTING_KEYS.CONVERSATION_AI_TOGGLE,
      (p) => this.handleAIToggle(p),
    )
    await this.rabbitmq.subscribe(
      QUEUES.CONVERSATION_AGENT_ASSIGN,
      ROUTING_KEYS.CONVERSATION_AGENT_ASSIGN,
      (p) => this.handleAgentAssign(p),
    )
  }

  private async handleConversationIncoming(payload: Record<string, unknown>): Promise<void> {
    try {
      const input = payload as unknown as ConversationIncomingInput
      await this.manageConversation.handleIncoming(input)
    } catch (error) {
      this.logger.error(
        'Error handling conversation incoming event:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  private async handleAIToggle(payload: Record<string, unknown>): Promise<void> {
    try {
      const { conversationId, aiEnabled } = payload as { conversationId: string; aiEnabled: boolean }
      await this.manageConversation.toggleAI(conversationId, aiEnabled)
    } catch (error) {
      this.logger.error('Error handling AI toggle event:', error)
    }
  }

  private async handleAgentAssign(payload: Record<string, unknown>): Promise<void> {
    try {
      const { conversationId, agentAssigned } = payload as { conversationId: string; agentAssigned: string }
      await this.manageConversation.assignAgent(conversationId, agentAssigned)
    } catch (error) {
      this.logger.error('Error handling agent assign event:', error)
    }
  }
}
