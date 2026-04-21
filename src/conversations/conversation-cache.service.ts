import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory cache for conversation data
 * Stores conversations by channelUserId for fast lookup
 * Cache is lost on service restart (acceptable for this use case)
 * 
 * NOTE: This implementation is NOT thread-safe. However, it's safe in Node.js
 * because JavaScript is single-threaded and Map operations are atomic enough
 * for the use case. If converting to a multi-threaded runtime, add locking.
 */
export interface CachedConversation {
  id: string;
  channelUserId: string;
  topic: string | null;
  aiEnabled: boolean;
  agentAssigned: string | null;
  userId: string | null;
  status: string;
}

@Injectable()
export class ConversationCacheService {
  private readonly logger = new Logger(ConversationCacheService.name);
  private cache = new Map<string, CachedConversation>();

  /**
   * Store conversation in cache
   * Key: channelUserId (e.g., WhatsApp phone number)
   */
  set(channelUserId: string, data: CachedConversation): void {
    this.cache.set(channelUserId, data);
    this.logger.debug(`Cached conversation for user ${channelUserId}`);
  }

  /**
   * Retrieve conversation from cache
   */
  get(channelUserId: string): CachedConversation | undefined {
    return this.cache.get(channelUserId);
  }

  /**
   * Check if conversation exists in cache
   */
  has(channelUserId: string): boolean {
    return this.cache.has(channelUserId);
  }

  /**
   * Update existing conversation in cache
   */
  update(channelUserId: string, updates: Partial<CachedConversation>): void {
    const existing = this.cache.get(channelUserId);
    if (existing) {
      this.cache.set(channelUserId, {...existing, ...updates});
      this.logger.debug(`Updated cached conversation for user ${channelUserId}`);
    }
  }

  /**
   * Remove conversation from cache
   */
  delete(channelUserId: string): void {
    this.cache.delete(channelUserId);
    this.logger.debug(`Deleted cached conversation for user ${channelUserId}`);
  }

  /**
   * Get all cached conversations (for debugging)
   */
  getAll(): CachedConversation[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.logger.log('Cleared all cached conversations');
  }
}
