import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface CachedConversation {
  id: string
  channelUserId: string
  topic: string | null
  aiEnabled: boolean
  agentAssigned: string | null
  userId: string | null
  status: string
}

interface CacheEntry {
  data: CachedConversation
  expiresAt: number
}

/**
 * In-memory LRU cache for conversation data with TTL.
 *
 * Why this replaces the old unbounded Map:
 *   - Previous impl never evicted entries → memory leak with many users.
 *   - LRU + TTL ensures memory stays bounded under any load.
 *
 * Config (env, with defaults):
 *   - `CONVERSATION_CACHE_MAX_SIZE` (default 5000)
 *   - `CONVERSATION_CACHE_TTL_MS`   (default 3_600_000 = 1 hour)
 */
@Injectable()
export class ConversationCacheService {
  private readonly logger = new Logger(ConversationCacheService.name)
  private readonly cache = new Map<string, CacheEntry>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(config: ConfigService) {
    this.maxSize = Number(config.get<string>('CONVERSATION_CACHE_MAX_SIZE') ?? 5_000)
    this.ttlMs = Number(config.get<string>('CONVERSATION_CACHE_TTL_MS') ?? 60 * 60 * 1_000)
    this.logger.log(
      `ConversationCacheService ready — maxSize=${this.maxSize}, ttlMs=${this.ttlMs}`,
    )
  }

  set(channelUserId: string, data: CachedConversation): void {
    // Bump-to-front (Map preserves insertion order so re-inserting moves to MRU)
    if (this.cache.has(channelUserId)) {
      this.cache.delete(channelUserId)
    } else if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(channelUserId, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  get(channelUserId: string): CachedConversation | undefined {
    const entry = this.cache.get(channelUserId)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(channelUserId)
      return undefined
    }
    // Touch — move to MRU
    this.cache.delete(channelUserId)
    this.cache.set(channelUserId, entry)
    return entry.data
  }

  has(channelUserId: string): boolean {
    return this.get(channelUserId) !== undefined
  }

  update(channelUserId: string, updates: Partial<CachedConversation>): void {
    const existing = this.get(channelUserId)
    if (existing) {
      this.set(channelUserId, { ...existing, ...updates })
    }
  }

  delete(channelUserId: string): void {
    this.cache.delete(channelUserId)
  }

  getAll(): CachedConversation[] {
    const now = Date.now()
    return Array.from(this.cache.values())
      .filter((e) => now <= e.expiresAt)
      .map((e) => e.data)
  }

  size(): number {
    return this.cache.size
  }

  clear(): void {
    this.cache.clear()
    this.logger.log('Cleared all cached conversations')
  }

  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return { size: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs }
  }
}
