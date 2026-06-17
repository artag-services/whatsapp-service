import { IEventPublisher } from '../ports/IEventPublisher'

export interface AIResponsePayload {
  userId: string
  senderId: string
  messageId: string
  conversationId?: string
  aiResponse: string
  confidence?: number
  model?: string
  processingTime?: number
}

export interface ChunkSendFunction {
  (recipient: string, message: string, messageId: string): Promise<string>
}

export interface ChunkResult {
  success: boolean
  externalMessageId?: string
  channel?: string
  error?: string
}

const ROUTING_KEYS = {
  WHATSAPP_AI_RESPONSE_CHUNK_FAILED: 'channels.whatsapp.ai-response-chunk-failed',
  WHATSAPP_AI_RESPONSE_DLQ: 'channels.whatsapp.ai-response-dlq',
}

export class HandleAIResponseUseCase {
  private readonly MAX_CHUNK_SIZE = 4096
  private readonly MAX_RETRIES = 3

  constructor(
    private readonly eventBus: IEventPublisher,
  ) {}

  async execute(
    payload: AIResponsePayload,
    sendFn: ChunkSendFunction,
  ): Promise<void> {
    const validAiResponse = payload.aiResponse || 'No AI response generated'

    const chunks = this.splitMessageIntoChunks(validAiResponse)
    if (chunks.length === 0) {
      this.eventBus.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ, {
        aiResponseId: payload.messageId,
        userId: payload.userId,
        reason: 'AI response is empty',
        timestamp: Date.now(),
      })
      return
    }

    const chunkRecords = chunks.map((content, index) => ({
      id: `${payload.messageId}_chunk_${index}`,
      content,
      chunkNumber: index + 1,
    }))

    let sentCount = 0
    for (const chunk of chunkRecords) {
      const result = await this.sendChunkWithRetry(
        chunk,
        payload.senderId,
        sendFn,
      )

      if (result.success) {
        sentCount++
      } else {
        this.eventBus.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
          chunkId: chunk.id,
          aiResponseId: payload.messageId,
          senderId: payload.senderId,
          error: result.error,
        })
      }
    }

    const sentChunks = sentCount
    const totalChunks = chunkRecords.length
    const status = sentChunks === totalChunks ? 'SENT' : sentChunks > 0 ? 'PARTIAL' : 'FAILED'
  }

  async handleFailedChunk(
    chunkId: string,
    aiResponseId: string,
    senderId: string,
    sendFn: ChunkSendFunction,
    retryCount: number,
  ): Promise<void> {
    const newRetryCount = retryCount + 1

    if (newRetryCount < this.MAX_RETRIES) {
      // Re-publish to retry queue
      this.eventBus.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
        chunkId,
        aiResponseId,
        senderId,
        retryCount: newRetryCount,
      })
    } else {
      this.eventBus.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ, {
        aiResponseId,
        senderId,
        reason: `Chunk ${chunkId} failed after ${this.MAX_RETRIES} retries`,
        timestamp: Date.now(),
      })
    }
  }

  async sendToDLQ(
    aiResponseId: string,
    userId: string,
    senderId: string,
    reason: string,
  ): Promise<void> {
    this.eventBus.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ, {
      aiResponseId,
      userId,
      senderId,
      reason,
      timestamp: Date.now(),
    })
  }

  splitMessageIntoChunks(message: string): string[] {
    if (!message || message.length === 0) {
      return []
    }

    const chunks: string[] = []
    let remainingText = message

    while (remainingText.length > 0) {
      chunks.push(remainingText.substring(0, this.MAX_CHUNK_SIZE))
      remainingText = remainingText.substring(this.MAX_CHUNK_SIZE)
    }

    if (chunks.length === 1) {
      return chunks
    }

    return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}] ${chunk}`)
  }

  private async sendChunkWithRetry(
    chunk: { id: string; content: string },
    senderId: string,
    sendFn: ChunkSendFunction,
  ): Promise<ChunkResult> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const externalMessageId = await sendFn(
          senderId,
          chunk.content,
          `chunk_${chunk.id}_attempt_${attempt}`,
        )

        return {
          success: true,
          externalMessageId,
          channel: 'whatsapp',
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < this.MAX_RETRIES) {
          await this.sleep(Math.pow(2, attempt - 1) * 1000)
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
