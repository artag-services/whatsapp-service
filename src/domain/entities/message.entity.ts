export type MessageStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'READ'

export class Message {
  constructor(
    public readonly id: string,
    public readonly messageId: string,
    public readonly recipient: string,
    public readonly body: string,
    public readonly mediaUrl: string | null,
    public status: MessageStatus,
    public readonly createdAt: Date,
  ) {}

  markSent(waMessageId: string): void {
    this.status = 'SENT'
  }

  markFailed(reason: string): void {
    this.status = 'FAILED'
  }
}
