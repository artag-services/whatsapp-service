import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosInstance } from 'axios'
import * as https from 'https'

export interface N8nWebhookPayload {
  userId: string
  userName: string
  userPhone: string
  channel: string
  message: string
  messageId: string
  timestamp: number
}

export interface N8nWebhookResponse {
  userId: string
  senderId: string
  messageId: string
  aiResponse: string
  confidence?: number
  model?: string
  processingTime?: number
  timestamp?: number
}

/**
 * Thin client for the N8N AI-response webhook.
 *
 * Improvements vs the inline implementation it replaces:
 *   - HTTP keep-alive (same TLS savings as MetaApiClient)
 *   - Iterative retry loop (was recursive — wasted stack frames)
 *   - Robust response parsing: handles array / object / string-JSON N8N
 *     can return in test vs live modes
 *   - Backoff delay grows linearly per retry (1s, 2s, 3s) instead of fixed 1s
 */
@Injectable()
export class N8nClient implements OnModuleInit {
  private readonly logger = new Logger(N8nClient.name)
  private http!: AxiosInstance
  private webhookUrl!: string
  private maxRetries!: number

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.webhookUrl = this.config.getOrThrow<string>('N8N_WEBHOOK_URL')
    const timeoutMs = Number(this.config.get<string>('N8N_WEBHOOK_TIMEOUT') ?? 5_000)
    this.maxRetries = Number(this.config.get<string>('N8N_WEBHOOK_RETRIES') ?? 1)

    const agent = new https.Agent({ keepAlive: true, maxSockets: 20 })

    this.http = axios.create({
      timeout: timeoutMs,
      httpsAgent: agent,
      headers: { 'Content-Type': 'application/json' },
    })

    this.logger.log(
      `N8nClient ready — url=${this.webhookUrl}, timeout=${timeoutMs}ms, retries=${this.maxRetries}`,
    )
  }

  /**
   * Call the AI webhook with automatic retries. Returns null if all
   * attempts fail (the listener treats null as "skip AI" rather than
   * propagating the error to the user).
   */
  async invoke(
    userId: string,
    userName: string,
    userPhone: string,
    message: string,
    messageId: string,
  ): Promise<N8nWebhookResponse | null> {
    const payload: N8nWebhookPayload = {
      userId,
      userName,
      userPhone,
      channel: 'whatsapp',
      message,
      messageId,
      timestamp: Date.now(),
    }

    const totalAttempts = this.maxRetries + 1
    let lastReason = 'unknown'

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const response = await this.http.post<unknown>(this.webhookUrl, payload)
        const aiData = this.parseResponse(response.data)
        if (!aiData.aiResponse) {
          throw new Error('N8N response missing aiResponse field')
        }
        if (attempt > 1) {
          this.logger.log(`N8N succeeded on attempt ${attempt}/${totalAttempts}`)
        }
        return aiData
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error)
        if (attempt < totalAttempts) {
          const delayMs = 1000 * attempt
          this.logger.warn(
            `N8N attempt ${attempt}/${totalAttempts} failed (${lastReason}). Retrying in ${delayMs}ms`,
          )
          await sleep(delayMs)
        }
      }
    }

    this.logger.error(`N8N failed after ${totalAttempts} attempts for userId=${userId}: ${lastReason}`)
    return null
  }

  private parseResponse(data: unknown): N8nWebhookResponse {
    // N8N can return:
    //   - array (test mode): [{...}]
    //   - object (live mode): {...}
    //   - string JSON (axios occasionally passes raw string)

    if (Array.isArray(data)) {
      if (data.length === 0) throw new Error('N8N returned empty array')
      return data[0] as N8nWebhookResponse
    }

    if (typeof data === 'string') {
      // Defensive cleanup of stray whitespace before parse
      const cleaned = data
        .replace(/[\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) throw new Error('N8N returned empty parsed array')
        return parsed[0] as N8nWebhookResponse
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as N8nWebhookResponse
      }
      throw new Error(`N8N returned invalid parsed type: ${typeof parsed}`)
    }

    if (typeof data === 'object' && data !== null) {
      return data as N8nWebhookResponse
    }

    throw new Error(`N8N returned invalid response type: ${typeof data}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
