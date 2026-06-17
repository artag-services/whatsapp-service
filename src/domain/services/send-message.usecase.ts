import { v4 as uuidv4 } from 'uuid'
import { IMessageRepository, CreateWaMessageInput } from '../ports/IMessageRepository'
import { IMessageSender } from '../ports/IMessageSender'
import { Message } from '../entities/message.entity'

export interface SendMessageInput {
  messageId: string
  recipients: string[]
  message: string
  mediaUrl?: string | null
}

export interface SendMessageOutput {
  messageId: string
  status: 'SENT' | 'FAILED' | 'PARTIAL'
  sentCount: number
  failedCount: number
  errors?: Array<{ recipient: string; reason: string }>
  timestamp: string
}

export class SendMessageUseCase {
  private readonly templateName: string
  private readonly templateLanguage: string
  private readonly templateFallbackRetries: number
  private readonly templateFallbackDelayMs: number

  constructor(
    private readonly messageRepo: IMessageRepository,
    private readonly sender: IMessageSender,
    config?: { templateName?: string; templateLanguage?: string; retries?: number; retryDelayMs?: number },
  ) {
    this.templateName = config?.templateName ?? 'presentacion_de_ia'
    this.templateLanguage = config?.templateLanguage ?? 'en'
    this.templateFallbackRetries = config?.retries ?? 2
    this.templateFallbackDelayMs = config?.retryDelayMs ?? 2000
  }

  async sendToRecipients(dto: SendMessageInput): Promise<SendMessageOutput> {
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

  async sendToOneWithId(
    messageId: string,
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ): Promise<string> {
    const record = await this.messageRepo.create({
      id: uuidv4(),
      messageId,
      recipient,
      body: message,
      mediaUrl: mediaUrl ?? null,
      templateUsed: false,
    })

    try {
      const result = await this.sender.send({ recipient, message, mediaUrl })
      await this.messageRepo.updateStatus(record.id, 'SENT', {
        waMessageId: result.wamid,
        sentAt: new Date(),
      })
      return result.wamid
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const isReEngagement = reason.includes('131047') || reason.includes('RE_ENGAGEMENT_REQUIRED')

      try {
        const templateResult = await this.sender.sendTemplate({
          recipient,
          templateName: this.templateName,
          language: this.templateLanguage,
        })
        await this.messageRepo.updateStatus(record.id, 'SENT', {
          waMessageId: templateResult.wamid,
          sentAt: new Date(),
          templateUsed: true,
        })
        return ''
      } catch (templateError) {
        const templateReason =
          templateError instanceof Error ? templateError.message : String(templateError)
        await this.messageRepo.updateStatus(record.id, 'FAILED', {
          errorReason: `[Template fallback failed] ${templateReason} | [Original] ${reason}`,
          templateUsed: true,
        })
        throw new Error(`${reason} + template fallback also failed: ${templateReason}`)
      }
    }
  }

  async sendTemplateToFailedRecipient(recipient: string): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.templateFallbackRetries; attempt++) {
      try {
        const result = await this.sender.sendTemplate({
          recipient,
          templateName: this.templateName,
          language: this.templateLanguage,
        })
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < this.templateFallbackRetries) {
          await this.sleep(this.templateFallbackDelayMs)
        }
      }
    }

    throw lastError ?? new Error('Unknown error sending fallback template')
  }

  private resolveStatus(sent: number, failed: number): 'SENT' | 'FAILED' | 'PARTIAL' {
    if (failed === 0) return 'SENT'
    if (sent === 0) return 'FAILED'
    return 'PARTIAL'
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
