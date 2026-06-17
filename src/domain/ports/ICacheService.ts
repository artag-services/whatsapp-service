export interface CachedConversation {
  id: string
  channelUserId: string
  topic: string | null
  aiEnabled: boolean
  agentAssigned: string | null
  userId: string | null
  status: string
}

export interface ICacheService {
  get(channelUserId: string): CachedConversation | undefined
  set(channelUserId: string, data: CachedConversation): void
  update(channelUserId: string, updates: Partial<CachedConversation>): void
  has(channelUserId: string): boolean
  delete(channelUserId: string): void
  clear(): void
  size(): number
}
