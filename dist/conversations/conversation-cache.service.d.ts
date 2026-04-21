export interface CachedConversation {
    id: string;
    channelUserId: string;
    topic: string | null;
    aiEnabled: boolean;
    agentAssigned: string | null;
    userId: string | null;
    status: string;
}
export declare class ConversationCacheService {
    private readonly logger;
    private cache;
    set(channelUserId: string, data: CachedConversation): void;
    get(channelUserId: string): CachedConversation | undefined;
    has(channelUserId: string): boolean;
    update(channelUserId: string, updates: Partial<CachedConversation>): void;
    delete(channelUserId: string): void;
    getAll(): CachedConversation[];
    size(): number;
    clear(): void;
}
