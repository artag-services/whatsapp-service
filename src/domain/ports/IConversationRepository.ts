export interface ConversationData {
  id: string
  userId: string | null
  channelUserId: string
  channel: string
  topic: string | null
  detectionMethod: string
  keywords: string[]
  aiEnabled: boolean
  agentAssigned: string | null
  status: string
  messageCount: number
  aiMessageCount: number
  createdAt: Date
  updatedAt: Date
  lastMessageAt: Date | null
  archivedAt: Date | null
}

export interface UpsertConversationInput {
  channelUserId: string
  channel: string
  messageText: string
  timestamp: Date
  topic: string
  keywords: string[]
}

export interface CreateMessageInput {
  conversationId: string
  sender: string
  content: string
  mediaUrl?: string | null
  externalId: string
  metadata?: Record<string, unknown>
}

export interface IConversationRepository {
  upsert(input: UpsertConversationInput): Promise<{ conversation: ConversationData; wasCreated: boolean }>
  findActiveByChannelUser(channelUserId: string, channel: string): Promise<ConversationData | null>
  update(id: string, data: Partial<ConversationData>): Promise<ConversationData>
  createMessage(data: CreateMessageInput): Promise<void>
}
