import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { WhatsappService } from './whatsapp.service';
import { AIResponseService } from './services/ai-response.service';
import { ROUTING_KEYS, QUEUES } from '../rabbitmq/constants/queues';
import { SendWhatsappDto } from './dto/send-whatsapp.dto';
import { PrismaService } from '../prisma/prisma.service';

// Identity service routing keys
const IDENTITY_RESOLVE_ROUTING_KEY = 'channels.identity.resolve';

@Injectable()
export class WhatsappListener implements OnModuleInit {
  private readonly logger = new Logger(WhatsappListener.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly whatsapp: WhatsappService,
    private readonly aiResponseService: AIResponseService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Listen to outgoing messages
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_SEND,
      ROUTING_KEYS.WHATSAPP_SEND,
      (payload) => this.handleSendMessage(payload),
    );

    // Listen to incoming events
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_MESSAGE,
      ROUTING_KEYS.WHATSAPP_MESSAGE_RECEIVED,
      (payload) => this.handleMessageReceived(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_MESSAGE_ECHO,
      ROUTING_KEYS.WHATSAPP_MESSAGE_ECHO_RECEIVED,
      (payload) => this.handleMessageEcho(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_CALLS,
      ROUTING_KEYS.WHATSAPP_CALLS_RECEIVED,
      (payload) => this.handleCalls(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_FLOWS,
      ROUTING_KEYS.WHATSAPP_FLOWS_RECEIVED,
      (payload) => this.handleFlows(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_PHONE_NUMBER_UPDATE,
      ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE,
      (payload) => this.handlePhoneNumberUpdate(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_TEMPLATE_UPDATE,
      ROUTING_KEYS.WHATSAPP_TEMPLATE_UPDATE,
      (payload) => this.handleTemplateUpdate(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_EVENTS_ALERTS,
      ROUTING_KEYS.WHATSAPP_ALERTS_RECEIVED,
      (payload) => this.handleAccountAlerts(payload),
    );

    // AI Response listeners
    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_AI_RESPONSE,
      ROUTING_KEYS.WHATSAPP_AI_RESPONSE,
      (payload) => this.handleAIResponse(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_AI_RESPONSE_CHUNK_FAILED,
      ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED,
      (payload) => this.handleFailedChunk(payload),
    );

    await this.rabbitmq.subscribe(
      QUEUES.WHATSAPP_AI_RESPONSE_DLQ,
      ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ,
      (payload) => this.handleAIResponseDLQ(payload),
    );
  }

  // ─────────────────────────────────────────
  // Outgoing Message Handler
  // ─────────────────────────────────────────

  private async handleSendMessage(payload: Record<string, unknown>): Promise<void> {
    const dto = payload as unknown as SendWhatsappDto;

    this.logger.log(
      `Processing message ${dto.messageId} → recipients: [${dto.recipients.join(', ')}]`,
    );

    const response = await this.whatsapp.sendToRecipients(dto);

    // Publicar respuesta al gateway para que actualice el estado y notifique por WS
    this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_RESPONSE, {
      messageId: response.messageId,
      status: response.status,
      sentCount: response.sentCount,
      failedCount: response.failedCount,
      errors: response.errors ?? null,
      timestamp: response.timestamp,
    });

    if (response.errors && response.errors.length > 0) {
      for (const err of response.errors) {
        this.logger.error(
          `Message ${dto.messageId} | recipient ${err.recipient} FAILED → ${err.reason}`,
        );
      }
    }

    this.logger.log(
      `Message ${dto.messageId} done → status: ${response.status} | sent: ${response.sentCount} | failed: ${response.failedCount}`,
    );
  }

  // ─────────────────────────────────────────
  // Incoming Event Handlers (Placeholder)
  // ─────────────────────────────────────────

  private async handleMessageReceived(payload: Record<string, unknown>): Promise<void> {
    const value = payload.value as any;
    const entry = payload.entry as any;

    // Detectar si es evento de STATUS de mensaje (delivery status)
    if (value.statuses && Array.isArray(value.statuses)) {
      for (const status of value.statuses) {
        // Solo procesar fallos por Re-engagement (código 131047)
        if (status.status === 'failed' && status.errors?.length > 0) {
          const errorCode = status.errors[0].code;
          const recipient = status.recipient_id;

          if (errorCode === 131047) {
            this.logger.log(
              `⚠️ Re-engagement failure for ${recipient} | code: ${errorCode}`,
            );

            // Enviar plantilla como fallback (con reintentos)
            try {
              await this.whatsapp.sendTemplateToFailedRecipient(recipient);
            } catch (error) {
              this.logger.error(
                `Failed to send fallback template to ${recipient}`,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        }
      }
      return;
    }

    // Si es mensaje entrante normal (no status)
    // Extraer datos de usuario y resolver identidad
    if (value.messages && Array.isArray(value.messages)) {
      // Crear mapa de contactos para búsqueda rápida de nombres
      // WhatsApp envía el perfil en contacts[].profile.name, no en message.profile
      const contactsMap = new Map<string, string>();
      if (value.contacts && Array.isArray(value.contacts)) {
        for (const contact of value.contacts) {
          const contactName = contact.profile?.name;
          if (contactName && contact.wa_id) {
            contactsMap.set(contact.wa_id, contactName);
          }
        }
      }

      for (const message of value.messages) {
        const senderId = message.from;
        // Obtener nombre del contacto desde el mapa, si no existe usar el ID
        const senderName = contactsMap.get(senderId) || senderId;
        const messageText = message.text?.body || '';
        const messageId = message.id;
        const timestamp = message.timestamp;

        this.logger.log(`📨 Incoming message from ${senderId} (${senderName})`);

        // Publicar evento de resolución de identidad
        try {
          await this.rabbitmq.publish(IDENTITY_RESOLVE_ROUTING_KEY, {
            channel: 'whatsapp',
            channelUserId: senderId,
            phone: senderId, // WhatsApp ID es el teléfono
            displayName: senderName, // Nombre del contacto desde WhatsApp
            metadata: {
              messageId: messageId,
              timestamp: timestamp,
              messageText: messageText,
            },
          });

          this.logger.debug(
            `Identity resolution event published for user ${senderId} with displayName "${senderName}"`,
          );

          // Process AI response if enabled (fire-and-forget)
          this.processAIResponse(senderId, senderName, messageText, messageId).catch(
            (error) => {
              this.logger.error(
                `Failed to process AI response: ${error instanceof Error ? error.message : String(error)}`,
              );
            },
          );
        } catch (error) {
          this.logger.error(
            `Failed to publish identity resolution: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Process AI response for incoming message
   * Checks if user has AI enabled, rate limit, then calls N8N webhook
   */
  private async processAIResponse(
    senderId: string,
    senderName: string,
    messageText: string,
    messageId: string,
  ): Promise<void> {
    try {
      // Find user by their WhatsApp identity
      const userIdentity = await this.prisma.userIdentity.findUnique({
        where: {
          channelUserId_channel: {
            channelUserId: senderId,
            channel: 'whatsapp',
          },
        },
        include: {
          user: true,
        },
      });

      if (!userIdentity) {
        this.logger.debug(`User identity not found for ${senderId}, skipping AI response`);
        return;
      }

      const user = userIdentity.user;

      // Check if AI is enabled for this user
      if (!user.aiEnabled) {
        this.logger.debug(`AI disabled for user ${user.id}, skipping N8N webhook`);
        return;
      }

      // Check daily rate limit (20 calls/day per user)
      const hasCapacity = await this.aiResponseService.checkDailyRateLimit(user.id);
      if (!hasCapacity) {
        this.logger.warn(
          `User ${user.id} exceeded daily AI rate limit (20/day). Skipping N8N webhook.`,
        );
        // Opcionalmente, enviar mensaje al usuario informando del límite
        // await this.whatsapp.sendToOneWithId(messageId, senderId, "You've reached your daily AI limit. Please try again tomorrow.");
        return;
      }

      this.logger.debug(`AI enabled for user ${user.id}, rate limit OK. Calling N8N webhook`);

      // Call N8N webhook to generate AI response
      const n8nResponse = await this.whatsapp.callN8NWebhook(
        user.id,
        senderName,
        senderId,
        messageText,
        messageId,
      );

      if (!n8nResponse) {
        this.logger.warn(`N8N webhook returned null for user ${user.id}`);
        return;
      }

      // N8N returned a valid response with aiResponse text
      // Publish AI response event for further processing
      await this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE, {
        userId: user.id,
        senderId,
        messageId,
        aiResponse: n8nResponse.aiResponse || 'No AI response generated',
        confidence: n8nResponse.confidence || 0,
        model: n8nResponse.model || 'unknown',
        processingTime: n8nResponse.processingTime || 0,
        timestamp: Date.now(),
      });

      this.logger.log(
        `AI response published for user ${user.id} | confidence: ${n8nResponse.confidence} | model: ${n8nResponse.model}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing AI response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleMessageEcho(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`🔄 Message echo received event: ${JSON.stringify(payload)}`);
    // TODO: Implement message echo/delivery tracking logic
  }

  private async handleCalls(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`📞 Calls event: ${JSON.stringify(payload)}`);
    // TODO: Implement calls handling logic
  }

  private async handleFlows(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`🌊 Flows event: ${JSON.stringify(payload)}`);
    // TODO: Implement flows handling logic
  }

  private async handlePhoneNumberUpdate(payload: Record<string, unknown>): Promise<void> {
    const value = payload.value as any;

    this.logger.log(`📞 Phone number update event: ${JSON.stringify(value)}`);

    // Extraer información del cambio de teléfono
    // Esperado formato: { users: [{ old_phone: string, new_phone: string, user_id: string }] }
    if (value.users && Array.isArray(value.users)) {
      for (const user of value.users) {
        const { old_phone, new_phone, user_id } = user;

        this.logger.log(
          `📞 Phone number update: ${old_phone} → ${new_phone} (User: ${user_id})`,
        );

        // Publicar evento a identity service para actualizar
        try {
          await this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE, {
            oldPhoneNumber: old_phone,
            newPhoneNumber: new_phone,
            userId: user_id,
            channel: 'whatsapp',
            timestamp: Date.now(),
          });

          this.logger.debug(
            `Phone number update event published for user ${user_id}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to publish phone number update: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  private async handleTemplateUpdate(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`📋 Template update event: ${JSON.stringify(payload)}`);
    // TODO: Implement template update handling logic
  }

  private async handleAccountAlerts(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`⚠️ Account alerts event: ${JSON.stringify(payload)}`);
    // TODO: Implement account alerts handling logic
  }

  // ─────────────────────────────────────────
  // AI Response Handlers
  // ─────────────────────────────────────────

  /**
   * Manejar respuesta de IA: dividir en chunks, enviar al usuario
   */
  private async handleAIResponse(payload: Record<string, unknown>): Promise<void> {
    try {
      const { userId, senderId, messageId, aiResponse, confidence, model, processingTime } =
        payload as any;

      // Asegurar que aiResponse no esté vacío
      const validAiResponse = aiResponse || 'No AI response generated';

      this.logger.debug(
        `[handleAIResponse] Processing AI response for user ${userId} | senderId: ${senderId} | length: ${validAiResponse.length}`,
      );

      // 1. Crear registro de auditoría
      const aiResponseRecord = await this.aiResponseService.createAIResponse({
        userId,
        senderId,
        messageId,
        originalMessage: '', // No tenemos el original aquí, pero lo guardamos
        aiResponse: validAiResponse,
        model: model || 'unknown',
        confidence: confidence || 0,
        processingTime: processingTime || 0,
      });

      // 2. Dividir mensaje en chunks (con numeración)
      const chunks = this.aiResponseService.splitMessageIntoChunks(validAiResponse);

      if (chunks.length === 0) {
        this.logger.warn(`AI response is empty for user ${userId}`);
        await this.aiResponseService.sendToDLQ(
          aiResponseRecord.id,
          'AI response is empty',
        );
        return;
      }

      // 3. Crear registros de chunks
      const chunkRecords = await this.aiResponseService.createChunks(
        aiResponseRecord.id,
        chunks,
      );

      // 4. Enviar cada chunk (con reintentos internos)
      let sentCount = 0;
      let failureReason: string | null = null;

      for (const chunk of chunkRecords) {
        const result = await this.aiResponseService.sendChunkWithRetry(
          chunk,
          senderId,
          (recipient, message, chunkMessageId) =>
            this.sendChunkToUser(recipient, message, chunkMessageId),
        );

        if (result.success) {
          // Actualizar chunk a SENT
          await this.prisma.aIResponseChunk.update({
            where: { id: chunk.id },
            data: {
              status: 'SENT',
              externalMessageId: result.externalMessageId,
              channel: result.channel,
              sentAt: new Date(),
            },
          });
          sentCount++;
        } else {
          // Publicar evento de chunk fallido para retry
          await this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
            chunkId: chunk.id,
            aiResponseId: aiResponseRecord.id,
            senderId,
            error: result.error,
          });
          failureReason = result.error ?? null;
        }
      }

      // 5. Actualizar estado del AIResponse
      const finalStatus = await this.aiResponseService.updateAIResponseStatus(
        aiResponseRecord.id,
      );

      this.logger.log(
        `AI response processed: ${sentCount}/${chunkRecords.length} chunks sent | Status: ${finalStatus}`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling AI response: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Publicar a DLQ si falla todo
      if (payload.userId) {
        // Necesitaríamos el aiResponseId, pero no lo tenemos en este error handler
        // Por ahora solo loguear
      }
    }
  }

  /**
   * Manejar fallo de chunk individual (para retry)
   */
  private async handleFailedChunk(payload: Record<string, unknown>): Promise<void> {
    try {
      const { chunkId, aiResponseId, senderId, error } = payload as any;

      this.logger.debug(`[handleFailedChunk] Processing failed chunk ${chunkId}`);

      // Manejar retry del chunk fallido
      await this.aiResponseService.handleFailedChunk(chunkId);

      this.logger.log(`Failed chunk ${chunkId} marked for retry or permanent failure`);
    } catch (error) {
      this.logger.error(
        `Error handling failed chunk: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Manejar errores no recuperables (Dead Letter Queue)
   */
  private async handleAIResponseDLQ(payload: Record<string, unknown>): Promise<void> {
    try {
      const { aiResponseId, userId, senderId, reason } = payload as any;

      this.logger.error(
        `[DLQ] AI Response failed permanently | aiResponseId: ${aiResponseId} | userId: ${userId} | reason: ${reason}`,
      );

      // Aquí puedes agregar lógica adicional como:
      // - Notificar a admin
      // - Enviar mensaje de error al usuario
      // - Guardar en tabla de errores para análisis
      // - Alertas en Slack, etc.

      // Por ahora, solo loguear
      this.logger.warn(
        `DLQ recorded for ${aiResponseId}: user may need manual intervention`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling DLQ: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Enviar un chunk al usuario (wrapper)
   * Wrapper alrededor de sendToOneWithId() del WhatsappService
   * @param recipient - Número de teléfono destino
   * @param message - Mensaje/chunk a enviar
   * @param messageId - ID único del mensaje (para auditoría)
   * @returns waMessageId del mensaje enviado
   */
  private async sendChunkToUser(
    recipient: string,
    message: string,
    messageId: string,
  ): Promise<string> {
    const waMessageId = await this.whatsapp.sendToOneWithId(
      messageId,
      recipient,
      message,
      null, // Sin media URL para chunks de texto de IA
    );
    return waMessageId;
  }
}
