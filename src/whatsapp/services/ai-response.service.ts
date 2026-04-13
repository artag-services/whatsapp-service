import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { ROUTING_KEYS } from '../../rabbitmq/constants/queues';
import { AIResponseStatus, ChunkStatus } from '@prisma/client';

interface ChunkSendResult {
  success: boolean;
  externalMessageId?: string;
  channel?: string;
  error?: string;
}

@Injectable()
export class AIResponseService {
  private readonly logger = new Logger(AIResponseService.name);
  private readonly MAX_CHUNK_SIZE = 4096;
  private readonly MAX_RETRIES = 3;

  constructor(
    private prisma: PrismaService,
    private rabbitmq: RabbitMQService,
  ) {}

  /**
   * Crear registro de auditoría de AIResponse
   */
  async createAIResponse(data: {
    userId: string;
    senderId: string;
    messageId: string;
    originalMessage: string;
    aiResponse: string;
    model?: string;
    confidence?: number;
    processingTime?: number;
  }) {
    // Si aiResponse está vacío o undefined, usar un mensaje por defecto
    const aiResponseText = data.aiResponse || 'No response received from AI service';

    return this.prisma.aIResponse.create({
      data: {
        userId: data.userId,
        senderId: data.senderId,
        messageId: data.messageId,
        originalMessage: data.originalMessage,
        aiResponse: aiResponseText,
        model: data.model,
        confidence: data.confidence,
        processingTime: data.processingTime,
        status: 'PENDING',
      },
    });
  }

  /**
   * Dividir mensaje en chunks de máximo 4096 caracteres
   * Retorna array con numeración: "[1/3] contenido..."
   */
  splitMessageIntoChunks(message: string): string[] {
    if (!message || message.length === 0) {
      return [];
    }

    const chunks: string[] = [];
    let remainingText = message;

    while (remainingText.length > 0) {
      chunks.push(remainingText.substring(0, this.MAX_CHUNK_SIZE));
      remainingText = remainingText.substring(this.MAX_CHUNK_SIZE);
    }

    // Si es solo 1 chunk, no agregar numeración
    if (chunks.length === 1) {
      return chunks;
    }

    // Agregar numeración a cada chunk
    return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}] ${chunk}`);
  }

  /**
   * Crear registros de chunks en BD
   */
  async createChunks(
    aiResponseId: string,
    chunks: string[],
  ) {
    return Promise.all(
      chunks.map((content, index) =>
        this.prisma.aIResponseChunk.create({
          data: {
            aiResponseId,
            chunkNumber: index + 1,
            content,
            status: 'PENDING',
            retryCount: 0,
          },
        }),
      ),
    );
  }

  /**
    * Intentar enviar un chunk con reintentos (máx 3)
    * sendToOne debe ser un método que existe en WhatsappService
    */
  async sendChunkWithRetry(
    chunk: any,
    senderId: string,
    sendToOneFunction: (
      recipient: string,
      message: string,
      messageId: string,
    ) => Promise<string>, // Retorna externalMessageId
  ): Promise<ChunkSendResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(
          `[sendChunkWithRetry] Attempt ${attempt}/${this.MAX_RETRIES} for chunk ${chunk.id}`,
        );

        const externalMessageId = await sendToOneFunction(
          senderId,
          chunk.content,
          `chunk_${chunk.id}_attempt_${attempt}`,
        );

        this.logger.log(`Chunk ${chunk.id} sent successfully | externalMessageId: ${externalMessageId}`);

        return {
          success: true,
          externalMessageId,
          channel: 'whatsapp',
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.MAX_RETRIES) {
          this.logger.warn(
            `Chunk ${chunk.id} attempt ${attempt} failed: ${lastError.message}. Retrying...`,
          );
          // Wait before retrying (exponential backoff: 1s, 2s, 4s)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt - 1) * 1000),
          );
        } else {
          this.logger.error(
            `Chunk ${chunk.id} failed after ${this.MAX_RETRIES} attempts: ${lastError.message}`,
          );
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
    };
  }

  /**
   * Actualizar estado del AIResponse basado en chunks
   */
  async updateAIResponseStatus(aiResponseId: string): Promise<AIResponseStatus> {
    const chunks = await this.prisma.aIResponseChunk.findMany({
      where: { aiResponseId },
    });

    const sentCount = chunks.filter((c: any) => c.status === 'SENT').length;
    const totalChunks = chunks.length;

    let status: AIResponseStatus;
    if (sentCount === totalChunks) {
      status = 'SENT';
    } else if (sentCount > 0) {
      status = 'PARTIAL';
    } else {
      status = 'FAILED';
    }

    await this.prisma.aIResponse.update({
      where: { id: aiResponseId },
      data: {
        status,
        sentChunks: sentCount,
      },
    });

    return status;
  }

  /**
   * Manejar fallo de chunk individual
   * Se llama cuando un chunk falla después de reintentos
   */
  async handleFailedChunk(chunkId: string): Promise<void> {
    const chunk = await this.prisma.aIResponseChunk.findUnique({
      where: { id: chunkId },
      include: { aiResponse: true },
    });

    if (!chunk) {
      this.logger.warn(`Chunk ${chunkId} not found`);
      return;
    }

    // Incrementar retry count
    const newRetryCount = chunk.retryCount + 1;

    if (newRetryCount < this.MAX_RETRIES) {
      // Cambiar status a PENDING para reintentar
      await this.prisma.aIResponseChunk.update({
        where: { id: chunkId },
        data: {
          status: 'PENDING',
          retryCount: newRetryCount,
        },
      });

      // Publicar evento para reintentar
      await this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
        chunkId,
        aiResponseId: chunk.aiResponseId,
        retryCount: newRetryCount,
      });

      this.logger.log(
        `Chunk ${chunkId} marked for retry (${newRetryCount}/${this.MAX_RETRIES})`,
      );
    } else {
      // Marcar como FAILED permanentemente
      await this.prisma.aIResponseChunk.update({
        where: { id: chunkId },
        data: {
          status: 'FAILED',
          retryCount: newRetryCount,
        },
      });

      // Actualizar AIResponse status
      await this.updateAIResponseStatus(chunk.aiResponseId);

      this.logger.error(
        `Chunk ${chunkId} failed permanently after ${this.MAX_RETRIES} retries`,
      );
    }
  }

  /**
   * Enviar a Dead Letter Queue (DLQ) para errores no recuperables
   */
  async sendToDLQ(aiResponseId: string, reason: string): Promise<void> {
    const aiResponse = await this.prisma.aIResponse.findUnique({
      where: { id: aiResponseId },
    });

    if (!aiResponse) {
      this.logger.warn(`AIResponse ${aiResponseId} not found for DLQ`);
      return;
    }

    // Actualizar status a FAILED
    await this.prisma.aIResponse.update({
      where: { id: aiResponseId },
      data: {
        status: 'FAILED',
        failureReason: reason,
      },
    });

    // Publicar a DLQ
    await this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ, {
      aiResponseId,
      userId: aiResponse.userId,
      senderId: aiResponse.senderId,
      reason,
      timestamp: Date.now(),
    });

    this.logger.error(`AIResponse ${aiResponseId} sent to DLQ: ${reason}`);
  }

  /**
   * Verificar y actualizar rate limit diario
   */
  async checkDailyRateLimit(userId: string): Promise<boolean> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Obtener o crear registro de rate limit
    let rateLimit = await this.prisma.n8NRateLimit.findUnique({
      where: { userId },
    });

    if (!rateLimit) {
      rateLimit = await this.prisma.n8NRateLimit.create({
        data: {
          userId,
          callsToday: 0,
          resetAt: tomorrow,
        },
      });
    }

    // Si pasó la fecha de reset, resetear contador
    if (now > rateLimit.resetAt) {
      rateLimit = await this.prisma.n8NRateLimit.update({
        where: { userId },
        data: {
          callsToday: 0,
          resetAt: tomorrow,
        },
      });
    }

    // Verificar si llegó al límite (20/día)
    const limit = 20;
    const hasCapacity = rateLimit.callsToday < limit;

    if (hasCapacity) {
      // Incrementar contador
      await this.prisma.n8NRateLimit.update({
        where: { userId },
        data: {
          callsToday: rateLimit.callsToday + 1,
        },
      });
    } else {
      this.logger.warn(
        `User ${userId} exceeded daily N8N limit (${rateLimit.callsToday}/${limit})`,
      );
    }

    return hasCapacity;
  }

  /**
   * Obtener información de uso de rate limit (para API)
   */
  async getRateLimitInfo(userId: string) {
    const rateLimit = await this.prisma.n8NRateLimit.findUnique({
      where: { userId },
    });

    if (!rateLimit) {
      return {
        callsToday: 0,
        limit: 20,
        remaining: 20,
        resetAt: new Date(),
      };
    }

    return {
      callsToday: rateLimit.callsToday,
      limit: 20,
      remaining: Math.max(0, 20 - rateLimit.callsToday),
      resetAt: rateLimit.resetAt,
    };
  }
}
