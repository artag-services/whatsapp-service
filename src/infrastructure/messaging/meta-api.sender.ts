import { Injectable, Logger } from '@nestjs/common'
import { MetaApiClient, MetaApiException } from '../../whatsapp/clients/meta-api.client'
import {
  IMessageSender,
  SendMessageInput,
  SendTemplateInput,
  SendResult,
} from '../../domain/ports/IMessageSender'

@Injectable()
export class MetaApiSender implements IMessageSender {
  private readonly logger = new Logger(MetaApiSender.name)

  constructor(private readonly meta: MetaApiClient) {}

  async send(input: SendMessageInput): Promise<SendResult> {
    const wamid = await this.meta.sendMessage(input.recipient, input.message, input.mediaUrl)
    return { wamid }
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const wamid = await this.meta.sendTemplate(input.recipient, input.templateName, input.language)
    return { wamid }
  }
}
