import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SendWhatsappDto } from './dto/send-whatsapp.dto';
import { WhatsappResponseDto } from './dto/whatsapp-response.dto';
import { v4 as uuidv4 } from 'uuid';

interface MetaApiResponse {
  messages: Array<{ id: string }>;
}

interface MetaApiError {
  error: {
    message: string;
    type?: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface N8NWebhookPayload {
  userId: string;
  userName: string;
  userPhone: string;
  channel: string;
  message: string;
  messageId: string;
  timestamp: number;
}

interface N8NWebhookResponse {
  userId: string;
  senderId: string;
  messageId: string;
  aiResponse: string;
  confidence?: number;
  model?: string;
  processingTime?: number;
  timestamp?: number;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly templateName: string;
  private readonly templateLanguage: string;
  private readonly n8nWebhookUrl: string;
  private readonly n8nWebhookTimeout: number;
  private readonly n8nWebhookRetries: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.apiVersion = config.get<string>('WHATSAPP_API_VERSION') ?? 'v19.0';
    this.phoneNumberId = config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    this.apiToken = config.getOrThrow<string>('WHATSAPP_API_TOKEN');
    this.apiUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    this.templateName = config.get<string>('WHATSAPP_TEMPLATE_NAME') ?? 'presentacion_de_ia';
    this.templateLanguage = config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en';
    this.n8nWebhookUrl = config.getOrThrow<string>('N8N_WEBHOOK_URL');
    this.n8nWebhookTimeout = config.get<number>('N8N_WEBHOOK_TIMEOUT') ?? 5000;
    this.n8nWebhookRetries = config.get<number>('N8N_WEBHOOK_RETRIES') ?? 1;
  }

  // ─────────────────────────────────────────
  // Enviar a múltiples destinatarios
  // ─────────────────────────────────────────

  async sendToRecipients(dto: SendWhatsappDto): Promise<WhatsappResponseDto> {
    const results = await Promise.allSettled(
      dto.recipients.map((recipient) =>
        this.sendToOne(dto.messageId, recipient, dto.message, dto.mediaUrl),
      ),
    );

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r, i) => ({
        recipient: dto.recipients[i],
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      }));

    const sentCount = results.filter((r) => r.status === 'fulfilled').length;
    const failedCount = errors.length;

    const overallStatus = this.resolveStatus(sentCount, failedCount);

    return {
      messageId: dto.messageId,
      status: overallStatus,
      sentCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────
  // Enviar a un destinatario individual
  // ─────────────────────────────────────────

  /**
   * Enviar mensaje a un destinatario y retornar waMessageId
   * Versión pública para uso desde AIResponseService
   */
  async sendToOneWithId(
    messageId: string,
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ): Promise<string> {
    // Persistir el intento en la BD
    const record = await this.prisma.waMessage.create({
      data: {
        id: uuidv4(),
        messageId,
        recipient,
        body: message,
        mediaUrl: mediaUrl ?? null,
        status: 'PENDING',
        templateUsed: false,
      },
    });

    try {
      const payload = this.buildMetaPayload(recipient, message, mediaUrl);

      this.logger.debug(
        `[sendToOneWithId] Calling Meta API → URL: ${this.apiUrl} | recipient: ${recipient}`,
      );

      const response = await axios.post<MetaApiResponse>(this.apiUrl, payload, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      const waMessageId = response.data.messages[0]?.id;

      await this.prisma.waMessage.update({
        where: { id: record.id },
        data: { status: 'SENT', waMessageId, sentAt: new Date() },
      });

      this.logger.log(`Sent to ${recipient} | waMessageId: ${waMessageId}`);
      return waMessageId;
    } catch (error) {
      const { reason } = this.extractErrorDetail(error);

      this.logger.warn(
        `Failed to send message to ${recipient}: ${reason}. Attempting template fallback...`,
      );

      try {
        // Intentar enviar con la plantilla como fallback
        await this.sendTemplate(recipient, record.id, messageId);
        return ''; // Retornamos vacío porque fue con template
      } catch (templateError) {
        const { reason: templateReason } = this.extractErrorDetail(templateError);

        await this.prisma.waMessage.update({
          where: { id: record.id },
          data: {
            status: 'FAILED',
            errorReason: `[Template fallback failed] ${templateReason} | [Original error] ${reason}`,
            templateUsed: true,
          },
        });

        this.logger.error(`Both sendToOne and template fallback failed for ${recipient}`);
        throw new Error(`${reason} + template fallback also failed: ${templateReason}`);
      }
    }
  }

  private async sendToOne(
    messageId: string,
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ): Promise<void> {
    await this.sendToOneWithId(messageId, recipient, message, mediaUrl);
  }

  // ─────────────────────────────────────────
  // Enviar plantilla como fallback
  // ─────────────────────────────────────────

  private async sendTemplate(recipient: string, recordId: string, messageId: string): Promise<void> {
    const templatePayload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: this.templateName,
        language: {
          code: this.templateLanguage,
        },
      },
    };

    this.logger.debug(
      `[sendTemplate] Calling Meta API with template → URL: ${this.apiUrl} | recipient: ${recipient} | template: ${this.templateName}`,
    );

    const response = await axios.post<MetaApiResponse>(this.apiUrl, templatePayload, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const waMessageId = response.data.messages[0]?.id;

    await this.prisma.waMessage.update({
      where: { id: recordId },
      data: {
        status: 'SENT',
        waMessageId,
        sentAt: new Date(),
        templateUsed: true,
      },
    });

    this.logger.log(
      `Sent template to ${recipient} | waMessageId: ${waMessageId} | template: ${this.templateName}`,
    );
  }

  // ─────────────────────────────────────────
  // Enviar plantilla por fallo de Re-engagement
  // ─────────────────────────────────────────

  /**
   * Enviar plantilla a un número que tuvo fallo por Re-engagement (24h sin respuesta)
   * Incluye reintentos automáticos
   * @param recipient - Número de teléfono que falló
   */
  async sendTemplateToFailedRecipient(recipient: string): Promise<void> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `Sending fallback template to ${recipient} [Attempt ${attempt}/${maxRetries}] | template: ${this.templateName}`,
        );

        const templatePayload = {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'template',
          template: {
            name: this.templateName, // 'presentacion_de_ia'
            language: {
              code: this.templateLanguage, // 'en'
            },
          },
        };

        const response = await axios.post<MetaApiResponse>(
          this.apiUrl,
          templatePayload,
          {
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          },
        );

        const waMessageId = response.data.messages[0]?.id;

        this.logger.log(
          `✅ Fallback template sent to ${recipient} [Attempt ${attempt}/${maxRetries}] | wamid: ${waMessageId}`,
        );

        return; // Éxito, salir
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const { reason } = this.extractErrorDetail(error);

        if (attempt < maxRetries) {
          this.logger.warn(
            `Attempt ${attempt}/${maxRetries} failed for ${recipient}: ${reason}. Retrying in 2 seconds...`,
          );
          // Esperar 2 segundos antes de reintentar
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          this.logger.error(
            `❌ Fallback template failed after ${maxRetries} attempts for ${recipient}: ${reason}`,
          );
        }
      }
    }

    // Si llegamos aquí, todos los intentos fallaron
    throw lastError || new Error('Unknown error sending fallback template');
  }

  // ─────────────────────────────────────────
  // Helpers privados
  // ─────────────────────────────────────────

  private buildMetaPayload(
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ) {
    if (mediaUrl) {
      return {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'image',
        image: { link: mediaUrl, caption: message },
      };
    }

    return {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: message },
    };
  }

  private resolveStatus(
    sent: number,
    failed: number,
  ): 'SENT' | 'FAILED' | 'PARTIAL' {
    if (failed === 0) return 'SENT';
    if (sent === 0) return 'FAILED';
    return 'PARTIAL';
  }

  private extractErrorDetail(error: unknown): { reason: string; detail: string; errorCode?: number } {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<MetaApiError>;
      const httpStatus = axiosError.response?.status ?? 'no-response';
      const metaError = axiosError.response?.data?.error;

      const reason = metaError?.message ?? axiosError.message;
      const errorCode = metaError?.code;
      const detail =
        `httpStatus: ${httpStatus}\n` +
        `  metaCode : ${metaError?.code ?? 'n/a'}\n` +
        `  metaType : ${metaError?.type ?? 'n/a'}\n` +
        `  subcode  : ${metaError?.error_subcode ?? 'n/a'}\n` +
        `  traceId  : ${metaError?.fbtrace_id ?? 'n/a'}\n` +
        `  apiUrl   : ${this.apiUrl}\n` +
        `  rawBody  : ${JSON.stringify(axiosError.response?.data ?? null)}`;

      return { reason, detail, errorCode };
    }

    const reason = error instanceof Error ? error.message : String(error);
    return { reason, detail: `(non-axios error) ${reason}` };
  }

  // ─────────────────────────────────────────
  // N8N Webhook Integration
  // ─────────────────────────────────────────

  /**
   * Call N8N webhook to generate AI response for a message
   * @param userId - User ID
   * @param userName - User's display name
   * @param userPhone - User's phone number
   * @param message - The incoming message text
   * @param messageId - Unique message identifier
   * @returns N8N webhook response or null if error/rate limited
   */
  async callN8NWebhook(
    userId: string,
    userName: string,
    userPhone: string,
    message: string,
    messageId: string,
  ): Promise<N8NWebhookResponse | null> {
    return this.callN8NWebhookWithRetry(
      userId,
      userName,
      userPhone,
      message,
      messageId,
      0,
    );
  }

  /**
   * Call N8N webhook with automatic retries on failure
   * @param userId - User ID
   * @param userName - User's display name
   * @param userPhone - User's phone number
   * @param message - The incoming message text
   * @param messageId - Unique message identifier
   * @param attemptNumber - Current attempt number (for recursion)
   * @returns N8N webhook response or null if failed after all retries
   */
  private async callN8NWebhookWithRetry(
    userId: string,
    userName: string,
    userPhone: string,
    message: string,
    messageId: string,
    attemptNumber: number,
  ): Promise<N8NWebhookResponse | null> {
    const maxRetries = this.n8nWebhookRetries;
    const currentAttempt = attemptNumber + 1;

    try {
      const payload: N8NWebhookPayload = {
        userId,
        userName,
        userPhone,
        channel: 'whatsapp',
        message,
        messageId,
        timestamp: Date.now(),
      };

      this.logger.debug(
        `[callN8NWebhook] Attempt ${currentAttempt}/${maxRetries + 1} → URL: ${this.n8nWebhookUrl} | userId: ${userId} | messageId: ${messageId}`,
      );

      const response = await axios.post<N8NWebhookResponse[] | N8NWebhookResponse>(
        this.n8nWebhookUrl,
        payload,
        {
          timeout: this.n8nWebhookTimeout,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      // Log detailed response info for debugging
      this.logger.debug(
        `[callN8NWebhook] Raw response received:
        - response exists: ${!!response}
        - response.data exists: ${!!response.data}
        - response.data type: ${typeof response.data}
        - response.data is array: ${Array.isArray(response.data)}
        - response.data: ${JSON.stringify(response.data).substring(0, 500)}...`,
      );

       // N8N can return in different formats:
       // 1. Array: [{...}] (test mode)
       // 2. Object: {...} (live mode)
       // 3. String JSON: "{...}" (axios returns response.data as string sometimes)
       let aiResponseData: N8NWebhookResponse;

       if (Array.isArray(response.data)) {
         // Test mode: array format
         if (response.data.length === 0) {
           throw new Error('N8N webhook returned empty array');
         }
         aiResponseData = response.data[0];
         this.logger.debug(`[callN8NWebhook] Extracted from array format (length: ${response.data.length})`);
       } else if (typeof response.data === 'string') {
         // String JSON format: parse it first
         try {
           // Clean up the string: remove literal newlines and extra whitespace
           // that might cause JSON parsing errors
           const dataStr = response.data as string;
           const cleanedString = dataStr
             .replace(/\r\n/g, ' ')  // Replace Windows line endings
             .replace(/\n/g, ' ')    // Replace Unix line endings
             .replace(/\r/g, ' ')    // Replace Mac line endings
             .replace(/\t/g, ' ')    // Replace tabs
             .replace(/\s+/g, ' ')   // Collapse multiple spaces
             .trim();
           
           const parsed = JSON.parse(cleanedString);
           if (Array.isArray(parsed)) {
             if (parsed.length === 0) {
               throw new Error('N8N webhook returned empty array (after parsing)');
             }
             aiResponseData = parsed[0];
             this.logger.debug(`[callN8NWebhook] Extracted from parsed array format (length: ${parsed.length})`);
           } else if (typeof parsed === 'object' && parsed !== null) {
             aiResponseData = parsed as N8NWebhookResponse;
             this.logger.debug(`[callN8NWebhook] Received parsed object format`);
           } else {
             throw new Error(`N8N webhook returned invalid format after parsing: ${typeof parsed}`);
           }
         } catch (parseError) {
           throw new Error(`Failed to parse N8N response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
         }
       } else if (typeof response.data === 'object' && response.data !== null) {
         // Live mode: object format
         aiResponseData = response.data as N8NWebhookResponse;
         this.logger.debug(`[callN8NWebhook] Received object format (direct response)`);
       } else {
         throw new Error(`N8N webhook returned invalid format: ${typeof response.data}`);
       }

      // Validate required fields
      if (!aiResponseData.aiResponse) {
        throw new Error('N8N response missing aiResponse field');
      }

      this.logger.log(
        `[callN8NWebhook] Success → userId: ${aiResponseData.userId} | aiResponse length: ${aiResponseData.aiResponse?.length || 0} | confidence: ${aiResponseData.confidence} | model: ${aiResponseData.model}`,
      );

      return aiResponseData;
    } catch (error) {
      const { reason, detail, errorCode } = this.extractErrorDetail(error);

      this.logger.debug(
        `[callN8NWebhook] Error details: ${detail}`,
      );

      if (currentAttempt <= maxRetries) {
        this.logger.warn(
          `[callN8NWebhook] Attempt ${currentAttempt}/${maxRetries + 1} failed (code: ${errorCode}): ${reason}. Retrying...`,
        );
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.callN8NWebhookWithRetry(
          userId,
          userName,
          userPhone,
          message,
          messageId,
          attemptNumber + 1,
        );
      } else {
        this.logger.error(
          `[callN8NWebhook] Failed after ${maxRetries + 1} attempts → userId: ${userId} | errorCode: ${errorCode} | reason: ${reason}`,
        );
        this.logger.error(`[callN8NWebhook] Full error details:\n${detail}`);
        return null;
      }
    }
  }
}
