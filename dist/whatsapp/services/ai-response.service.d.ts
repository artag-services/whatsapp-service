import { PrismaService } from '../../prisma/prisma.service';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { AIResponseStatus } from '@prisma/client';
interface ChunkSendResult {
    success: boolean;
    externalMessageId?: string;
    channel?: string;
    error?: string;
}
export declare class AIResponseService {
    private prisma;
    private rabbitmq;
    private readonly logger;
    private readonly MAX_CHUNK_SIZE;
    private readonly MAX_RETRIES;
    constructor(prisma: PrismaService, rabbitmq: RabbitMQService);
    createAIResponse(data: {
        userId: string;
        senderId: string;
        messageId: string;
        originalMessage: string;
        aiResponse: string;
        model?: string;
        confidence?: number;
        processingTime?: number;
    }): Promise<{
        messageId: string;
        status: import("@prisma/client").$Enums.AIResponseStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        senderId: string;
        aiResponse: string;
        confidence: number | null;
        model: string | null;
        processingTime: number | null;
        originalMessage: string;
        sentChunks: number;
        failureReason: string | null;
    }>;
    splitMessageIntoChunks(message: string): string[];
    createChunks(aiResponseId: string, chunks: string[]): Promise<{
        status: import("@prisma/client").$Enums.ChunkStatus;
        id: string;
        sentAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        channel: string | null;
        chunkNumber: number;
        content: string;
        externalMessageId: string | null;
        retryCount: number;
        aiResponseId: string;
    }[]>;
    sendChunkWithRetry(chunk: any, senderId: string, sendToOneFunction: (recipient: string, message: string, messageId: string) => Promise<string>): Promise<ChunkSendResult>;
    updateAIResponseStatus(aiResponseId: string): Promise<AIResponseStatus>;
    handleFailedChunk(chunkId: string): Promise<void>;
    sendToDLQ(aiResponseId: string, reason: string): Promise<void>;
    checkDailyRateLimit(userId: string): Promise<boolean>;
    getRateLimitInfo(userId: string): Promise<{
        callsToday: number;
        limit: number;
        remaining: number;
        resetAt: Date;
    }>;
}
export {};
