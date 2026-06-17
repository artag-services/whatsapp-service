export interface SendMessageInput {
  recipient: string
  message: string
  mediaUrl?: string | null
}

export interface SendTemplateInput {
  recipient: string
  templateName: string
  language: string
}

export interface SendResult {
  wamid: string
}

export interface IMessageSender {
  send(input: SendMessageInput): Promise<SendResult>
  sendTemplate(input: SendTemplateInput): Promise<SendResult>
}
