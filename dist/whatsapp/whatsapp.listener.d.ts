import { OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { WhatsappService } from './whatsapp.service';
import { AIResponseService } from './services/ai-response.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationCacheService } from '../conversations/conversation-cache.service';
export declare class WhatsappListener implements OnModuleInit {
    private readonly rabbitmq;
    private readonly whatsapp;
    private readonly aiResponseService;
    private readonly prisma;
    private readonly conversationCache;
    private readonly logger;
    constructor(rabbitmq: RabbitMQService, whatsapp: WhatsappService, aiResponseService: AIResponseService, prisma: PrismaService, conversationCache: ConversationCacheService);
    onModuleInit(): Promise<void>;
    private handleSendMessage;
    private handleMessageReceived;
    private processAIResponse;
    private handleMessageEcho;
    private handleCalls;
    private handleFlows;
    private handlePhoneNumberUpdate;
    private handleTemplateUpdate;
    private handleAccountAlerts;
    private handleAIResponse;
    private handleFailedChunk;
    private handleAIResponseDLQ;
    private sendChunkToUser;
}
