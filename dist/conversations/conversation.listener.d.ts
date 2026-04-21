import { PrismaService } from '../prisma/prisma.service';
import { TopicDetectionService } from './topic-detection.service';
import { ConversationCacheService } from './conversation-cache.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
interface ConversationIncomingPayload {
    channel: string;
    channelUserId: string;
    messageText: string;
    messageId: string;
    timestamp: string;
}
export declare class ConversationListener {
    private prisma;
    private topicDetection;
    private cache;
    private rabbitmq;
    private readonly logger;
    constructor(prisma: PrismaService, topicDetection: TopicDetectionService, cache: ConversationCacheService, rabbitmq: RabbitMQService);
    handleConversationIncoming(payload: ConversationIncomingPayload): Promise<void>;
    handleAIToggle(payload: {
        conversationId: string;
        aiEnabled: boolean;
    }): Promise<void>;
    handleAgentAssign(payload: {
        conversationId: string;
        agentAssigned: string;
    }): Promise<void>;
}
export {};
