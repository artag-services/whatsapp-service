export interface WaMessageData {
  id: string
  messageId: string
  recipient: string
  body: string
  mediaUrl: string | null
  status: 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'READ'
  waMessageId: string | null
  errorReason: string | null
  templateUsed: boolean
  sentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateWaMessageInput {
  id: string
  messageId: string
  recipient: string
  body: string
  mediaUrl?: string | null
  templateUsed?: boolean
}

export interface IMessageRepository {
  create(data: CreateWaMessageInput): Promise<WaMessageData>
  updateStatus(id: string, status: string, extra?: Partial<WaMessageData>): Promise<void>
  findById(id: string): Promise<WaMessageData | null>
}
