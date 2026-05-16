import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { v4 as uuidv4 } from 'uuid'

import { PrismaService } from '../prisma/prisma.service'
import { MetaApiClient, MetaApiException } from './clients/meta-api.client'
import { N8nClient, N8nWebhookResponse } from './clients/n8n.client'
import { META_ERROR_CODES } from './types/meta-webhook.types'
import { SendWhatsappDto } from './dto/send-whatsapp.dto'
import { WhatsappResponseDto } from './dto/whatsapp-response.dto'

/**
 * High-level WhatsApp orchestration. Responsibility split (post-audit):
 *
 *   - `MetaApiClient` — raw HTTP to Meta WhatsApp Cloud API (keep-alive, timeouts)
 *   - `N8nClient`     — raw HTTP to N8N AI webhook (keep-alive, iterative retry)
 *   - `WhatsappService` (this file) — business logic:
 *       * persist message attempts to DB
 *       * orchestrate template fallback on re-engagement errors
 *       * coordinate bulk sends with per-recipient error tracking
 *
 * Public methods are kept stable so `WhatsappListener` doesn't need to change
 * beyond the constructor injection.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name)
  private readonly templateName: string
  private readonly templateLanguage: string
  private readonly templateFallbackRetries: number
  private readonly templateFallbackDelayMs: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaApiClient,
    private readonly n8n: N8nClient,
    config: ConfigService,
  ) {
    this.templateName = config.get<string>('WHATSAPP_TEMPLATE_NAME') ?? 'presentacion_de_ia'
    this.templateLanguage = config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en'
    this.templateFallbackRetries = Number(config.get<string>('WHATSAPP_TEMPLATE_RETRIES') ?? 2)
    this.templateFallbackDelayMs = Number(config.get<string>('WHATSAPP_TEMPLATE_RETRY_DELAY_MS') ?? 2000)
  }

  // ─────────────────────────────── Public API ───────────────────────────────

  /** Send the same message to multiple recipients with per-recipient error tracking. */
  async sendToRecipients(dto: SendWhatsappDto): Promise<WhatsappResponseDto> {
    const results = await Promise.allSettled(
      dto.recipients.map((recipient) =>
        this.sendToOneWithId(dto.messageId, recipient, dto.message, dto.mediaUrl),
      ),
    )

    const errors: Array<{ recipient: string; reason: string }> = []
    let sentCount = 0
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        sentCount++
      } else {
        errors.push({
          recipient: dto.recipients[idx],
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    })

    const failedCount = errors.length
    return {
      messageId: dto.messageId,
      status: this.resolveStatus(sentCount, failedCount),
      sentCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Send a message to a single recipient. Returns the Meta-assigned wamid on
   * success, empty string if the template fallback was used instead.
   *
   * Persists a `WaMessage` row to track lifecycle (PENDING → SENT|FAILED).
   * Auto-fallbacks to a pre-approved template on re-engagement (24h window
   * expired) errors.
   */
  async sendToOneWithId(
    messageId: string,
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ): Promise<string> {
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
    })

    try {
      const wamid = await this.meta.sendMessage(recipient, message, mediaUrl)
      await this.prisma.waMessage.update({
        where: { id: record.id },
        data: { status: 'SENT', waMessageId: wamid, sentAt: new Date() },
      })
      return wamid
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const isReEngagement =
        error instanceof MetaApiException && error.errorCode === META_ERROR_CODES.RE_ENGAGEMENT_REQUIRED

      this.logger.warn(
        `Send to ${recipient} failed${isReEngagement ? ' (re-engagement)' : ''}: ${reason}. Trying template fallback...`,
      )

      try {
        const wamid = await this.meta.sendTemplate(recipient, this.templateName, this.templateLanguage)
        await this.prisma.waMessage.update({
          where: { id: record.id },
          data: { status: 'SENT', waMessageId: wamid, sentAt: new Date(), templateUsed: true },
        })
        return '' // signal to caller: template was used
      } catch (templateError) {
        const templateReason =
          templateError instanceof Error ? templateError.message : String(templateError)
        await this.prisma.waMessage.update({
          where: { id: record.id },
          data: {
            status: 'FAILED',
            errorReason: `[Template fallback failed] ${templateReason} | [Original] ${reason}`,
            templateUsed: true,
          },
        })
        throw new Error(`${reason} + template fallback also failed: ${templateReason}`)
      }
    }
  }

  /**
   * Send a fallback template to a recipient after a re-engagement failure
   * detected from the status webhook. Has its own retry loop independent of
   * the main send flow.
   */
  async sendTemplateToFailedRecipient(recipient: string): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.templateFallbackRetries; attempt++) {
      try {
        const wamid = await this.meta.sendTemplate(recipient, this.templateName, this.templateLanguage)
        this.logger.log(
          `✅ Fallback template sent to ${recipient} [${attempt}/${this.templateFallbackRetries}] wamid=${wamid}`,
        )
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < this.templateFallbackRetries) {
          this.logger.warn(
            `Template fallback attempt ${attempt}/${this.templateFallbackRetries} failed for ${recipient}: ${lastError.message}. Retrying in ${this.templateFallbackDelayMs}ms`,
          )
          await sleep(this.templateFallbackDelayMs)
        }
      }
    }

    this.logger.error(
      `❌ Fallback template exhausted retries for ${recipient}: ${lastError?.message ?? 'unknown'}`,
    )
    throw lastError ?? new Error('Unknown error sending fallback template')
  }

  /** Delegated to N8nClient. Kept as public method so listener doesn't change. */
  async callN8NWebhook(
    userId: string,
    userName: string,
    userPhone: string,
    message: string,
    messageId: string,
  ): Promise<N8nWebhookResponse | null> {
    return this.n8n.invoke(userId, userName, userPhone, message, messageId)
  }

  // ─────────────────────────────── helpers ───────────────────────────────

  private resolveStatus(sent: number, failed: number): 'SENT' | 'FAILED' | 'PARTIAL' {
    if (failed === 0) return 'SENT'
    if (sent === 0) return 'FAILED'
    return 'PARTIAL'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
