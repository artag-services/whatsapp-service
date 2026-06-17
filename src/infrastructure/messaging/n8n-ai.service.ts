import { Injectable, Logger } from '@nestjs/common'
import { N8nClient } from '../../whatsapp/clients/n8n.client'
import {
  IAIService,
  AIInvokeInput,
  AIResponse,
} from '../../domain/ports/IAIService'

@Injectable()
export class N8nAIService implements IAIService {
  private readonly logger = new Logger(N8nAIService.name)

  constructor(private readonly n8n: N8nClient) {}

  async invoke(input: AIInvokeInput): Promise<AIResponse | null> {
    const result = await this.n8n.invoke(
      input.userId,
      input.userName,
      input.userPhone,
      input.message,
      input.messageId,
    )

    if (!result) return null

    return {
      aiResponse: result.aiResponse,
      confidence: result.confidence,
      model: result.model,
      processingTime: result.processingTime,
    }
  }
}
