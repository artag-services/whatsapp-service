import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ICacheService,
  CachedConversation,
} from '../../domain/ports/ICacheService'

interface CacheEntry {
  data: CachedConversation
  expiresAt: number
}

@Injectable()
export class InMemoryConversationCache implements ICacheService {
  private readonly logger = new Logger(InMemoryConversationCache.name)
  private readonly cache = new Map<string, CacheEntry>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(config: ConfigService) {
    this.maxSize = Number(config.get<string>('CONVERSATION_CACHE_MAX_SIZE') ?? 5_000)
    this.ttlMs = Number(config.get<string>('CONVERSATION_CACHE_TTL_MS') ?? 60 * 60 * 1_000)
    this.logger.log(
      `InMemoryConversationCache ready — maxSize=${this.maxSize}, ttlMs=${this.ttlMs}`,
    )
  }

  set(channelUserId: string, data: CachedConversation): void {
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

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return { size: this.cache.size, maxSize: this.maxSize, ttlMs: this.ttlMs }
  }
}
