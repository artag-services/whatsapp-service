"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WhatsappListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappListener = void 0;
const common_1 = require("@nestjs/common");
const rabbitmq_service_1 = require("../rabbitmq/rabbitmq.service");
const whatsapp_service_1 = require("./whatsapp.service");
const ai_response_service_1 = require("./services/ai-response.service");
const queues_1 = require("../rabbitmq/constants/queues");
const prisma_service_1 = require("../prisma/prisma.service");
const conversation_cache_service_1 = require("../conversations/conversation-cache.service");
const IDENTITY_RESOLVE_ROUTING_KEY = 'channels.identity.resolve';
let WhatsappListener = WhatsappListener_1 = class WhatsappListener {
    constructor(rabbitmq, whatsapp, aiResponseService, prisma, conversationCache) {
        this.rabbitmq = rabbitmq;
        this.whatsapp = whatsapp;
        this.aiResponseService = aiResponseService;
        this.prisma = prisma;
        this.conversationCache = conversationCache;
        this.logger = new common_1.Logger(WhatsappListener_1.name);
    }
    async onModuleInit() {
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_SEND, queues_1.ROUTING_KEYS.WHATSAPP_SEND, (payload) => this.handleSendMessage(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_MESSAGE, queues_1.ROUTING_KEYS.WHATSAPP_MESSAGE_RECEIVED, (payload) => this.handleMessageReceived(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_MESSAGE_ECHO, queues_1.ROUTING_KEYS.WHATSAPP_MESSAGE_ECHO_RECEIVED, (payload) => this.handleMessageEcho(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_CALLS, queues_1.ROUTING_KEYS.WHATSAPP_CALLS_RECEIVED, (payload) => this.handleCalls(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_FLOWS, queues_1.ROUTING_KEYS.WHATSAPP_FLOWS_RECEIVED, (payload) => this.handleFlows(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_PHONE_NUMBER_UPDATE, queues_1.ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE, (payload) => this.handlePhoneNumberUpdate(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_TEMPLATE_UPDATE, queues_1.ROUTING_KEYS.WHATSAPP_TEMPLATE_UPDATE, (payload) => this.handleTemplateUpdate(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_EVENTS_ALERTS, queues_1.ROUTING_KEYS.WHATSAPP_ALERTS_RECEIVED, (payload) => this.handleAccountAlerts(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_AI_RESPONSE, queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE, (payload) => this.handleAIResponse(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, (payload) => this.handleFailedChunk(payload));
        await this.rabbitmq.subscribe(queues_1.QUEUES.WHATSAPP_AI_RESPONSE_DLQ, queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ, (payload) => this.handleAIResponseDLQ(payload));
    }
    async handleSendMessage(payload) {
        const dto = payload;
        this.logger.log(`Processing message ${dto.messageId} → recipients: [${dto.recipients.join(', ')}]`);
        const response = await this.whatsapp.sendToRecipients(dto);
        this.rabbitmq.publish(queues_1.ROUTING_KEYS.WHATSAPP_RESPONSE, {
            messageId: response.messageId,
            status: response.status,
            sentCount: response.sentCount,
            failedCount: response.failedCount,
            errors: response.errors ?? null,
            timestamp: response.timestamp,
        });
        if (response.errors && response.errors.length > 0) {
            for (const err of response.errors) {
                this.logger.error(`Message ${dto.messageId} | recipient ${err.recipient} FAILED → ${err.reason}`);
            }
        }
        this.logger.log(`Message ${dto.messageId} done → status: ${response.status} | sent: ${response.sentCount} | failed: ${response.failedCount}`);
    }
    async handleMessageReceived(payload) {
        const value = payload.value;
        const entry = payload.entry;
        if (value.statuses && Array.isArray(value.statuses)) {
            for (const status of value.statuses) {
                if (status.status === 'failed' && status.errors?.length > 0) {
                    const errorCode = status.errors[0].code;
                    const recipient = status.recipient_id;
                    if (errorCode === 131047) {
                        this.logger.log(`⚠️ Re-engagement failure for ${recipient} | code: ${errorCode}`);
                        try {
                            await this.whatsapp.sendTemplateToFailedRecipient(recipient);
                        }
                        catch (error) {
                            this.logger.error(`Failed to send fallback template to ${recipient}`, error instanceof Error ? error.message : String(error));
                        }
                    }
                }
            }
            return;
        }
        if (value.messages && Array.isArray(value.messages)) {
            const contactsMap = new Map();
            if (value.contacts && Array.isArray(value.contacts)) {
                for (const contact of value.contacts) {
                    const contactName = contact.profile?.name;
                    if (contactName && contact.wa_id) {
                        contactsMap.set(contact.wa_id, contactName);
                    }
                }
            }
            for (const message of value.messages) {
                const senderId = message.from;
                const senderName = contactsMap.get(senderId) || senderId;
                const messageText = message.text?.body || '';
                const messageId = message.id;
                const timestamp = message.timestamp;
                this.logger.log(`📨 Incoming message from ${senderId} (${senderName})`);
                try {
                    await this.rabbitmq.publish(IDENTITY_RESOLVE_ROUTING_KEY, {
                        channel: 'whatsapp',
                        channelUserId: senderId,
                        phone: senderId,
                        displayName: senderName,
                        metadata: {
                            messageId: messageId,
                            timestamp: timestamp,
                            messageText: messageText,
                        },
                    });
                    this.logger.debug(`Identity resolution event published for user ${senderId} with displayName "${senderName}"`);
                    this.processAIResponse(senderId, senderName, messageText, messageId).catch((error) => {
                        this.logger.error(`Failed to process AI response: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }
                catch (error) {
                    this.logger.error(`Failed to publish identity resolution: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
    }
    async processAIResponse(senderId, senderName, messageText, messageId) {
        try {
            const userIdentity = await this.prisma.userIdentity.findUnique({
                where: {
                    channelUserId_channel: {
                        channelUserId: senderId,
                        channel: 'whatsapp',
                    },
                },
                include: {
                    user: true,
                },
            });
            if (!userIdentity) {
                this.logger.debug(`User identity not found for ${senderId}, skipping AI response`);
                return;
            }
            const user = userIdentity.user;
            let conversation = this.conversationCache.get(senderId);
            if (!conversation) {
                const dbConversation = await this.prisma.conversation.findFirst({
                    where: {
                        channelUserId: senderId,
                        channel: 'whatsapp',
                        status: 'ACTIVE',
                    },
                });
                if (dbConversation) {
                    conversation = {
                        id: dbConversation.id,
                        channelUserId: dbConversation.channelUserId,
                        topic: dbConversation.topic,
                        aiEnabled: dbConversation.aiEnabled,
                        userId: dbConversation.userId,
                        status: dbConversation.status,
                        agentAssigned: dbConversation.agentAssigned,
                    };
                }
            }
            if (!conversation) {
                if (!user.aiEnabled) {
                    this.logger.debug(`AI disabled globally for user ${user.id}, skipping N8N webhook`);
                    return;
                }
            }
            else {
                if (!conversation.aiEnabled) {
                    this.logger.debug(`AI disabled for conversation ${conversation.id} (agent assigned or manually disabled)`);
                    return;
                }
                if (conversation.agentAssigned) {
                    this.logger.debug(`Agent ${conversation.agentAssigned} assigned to conversation ${conversation.id}, skipping AI`);
                    return;
                }
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const rateLimit = await this.prisma.n8NRateLimit.findUnique({
                where: {
                    userId_service_date: {
                        userId: user.id,
                        service: 'whatsapp',
                        date: today,
                    },
                },
            });
            const callsToday = rateLimit?.callCount || 0;
            if (callsToday >= 20) {
                this.logger.warn(`User ${user.id} exceeded daily AI rate limit (WhatsApp): ${callsToday}/20`);
                return;
            }
            this.logger.debug(`AI enabled for conversation, rate limit OK (${callsToday}/20). Calling N8N webhook`);
            const n8nResponse = await this.whatsapp.callN8NWebhook(user.id, senderName, senderId, messageText, messageId);
            if (!n8nResponse) {
                this.logger.warn(`N8N webhook returned null for user ${user.id}`);
                return;
            }
            if (rateLimit) {
                await this.prisma.n8NRateLimit.update({
                    where: { id: rateLimit.id },
                    data: { callCount: rateLimit.callCount + 1 },
                });
            }
            else {
                await this.prisma.n8NRateLimit.create({
                    data: {
                        userId: user.id,
                        service: 'whatsapp',
                        date: today,
                        callCount: 1,
                    },
                });
            }
            await this.rabbitmq.publish(queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE, {
                userId: user.id,
                senderId,
                messageId,
                conversationId: conversation?.id,
                aiResponse: n8nResponse.aiResponse || 'No AI response generated',
                confidence: n8nResponse.confidence || 0,
                model: n8nResponse.model || 'unknown',
                processingTime: n8nResponse.processingTime || 0,
                timestamp: Date.now(),
            });
            this.logger.log(`AI response published for user ${user.id} | confidence: ${n8nResponse.confidence} | model: ${n8nResponse.model}`);
        }
        catch (error) {
            this.logger.error(`Error processing AI response: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleMessageEcho(payload) {
        this.logger.log(`🔄 Message echo received event: ${JSON.stringify(payload)}`);
    }
    async handleCalls(payload) {
        this.logger.log(`📞 Calls event: ${JSON.stringify(payload)}`);
    }
    async handleFlows(payload) {
        this.logger.log(`🌊 Flows event: ${JSON.stringify(payload)}`);
    }
    async handlePhoneNumberUpdate(payload) {
        const value = payload.value;
        this.logger.log(`📞 Phone number update event: ${JSON.stringify(value)}`);
        if (value.users && Array.isArray(value.users)) {
            for (const user of value.users) {
                const { old_phone, new_phone, user_id } = user;
                this.logger.log(`📞 Phone number update: ${old_phone} → ${new_phone} (User: ${user_id})`);
                try {
                    await this.rabbitmq.publish(queues_1.ROUTING_KEYS.WHATSAPP_PHONE_NUMBER_UPDATE, {
                        oldPhoneNumber: old_phone,
                        newPhoneNumber: new_phone,
                        userId: user_id,
                        channel: 'whatsapp',
                        timestamp: Date.now(),
                    });
                    this.logger.debug(`Phone number update event published for user ${user_id}`);
                }
                catch (error) {
                    this.logger.error(`Failed to publish phone number update: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
    }
    async handleTemplateUpdate(payload) {
        this.logger.log(`📋 Template update event: ${JSON.stringify(payload)}`);
    }
    async handleAccountAlerts(payload) {
        this.logger.log(`⚠️ Account alerts event: ${JSON.stringify(payload)}`);
    }
    async handleAIResponse(payload) {
        try {
            const { userId, senderId, messageId, aiResponse, confidence, model, processingTime } = payload;
            const validAiResponse = aiResponse || 'No AI response generated';
            this.logger.debug(`[handleAIResponse] Processing AI response for user ${userId} | senderId: ${senderId} | length: ${validAiResponse.length}`);
            const aiResponseRecord = await this.aiResponseService.createAIResponse({
                userId,
                senderId,
                messageId,
                originalMessage: '',
                aiResponse: validAiResponse,
                model: model || 'unknown',
                confidence: confidence || 0,
                processingTime: processingTime || 0,
            });
            const chunks = this.aiResponseService.splitMessageIntoChunks(validAiResponse);
            if (chunks.length === 0) {
                this.logger.warn(`AI response is empty for user ${userId}`);
                await this.aiResponseService.sendToDLQ(aiResponseRecord.id, 'AI response is empty');
                return;
            }
            const chunkRecords = await this.aiResponseService.createChunks(aiResponseRecord.id, chunks);
            let sentCount = 0;
            let failureReason = null;
            for (const chunk of chunkRecords) {
                const result = await this.aiResponseService.sendChunkWithRetry(chunk, senderId, (recipient, message, chunkMessageId) => this.sendChunkToUser(recipient, message, chunkMessageId));
                if (result.success) {
                    await this.prisma.aIResponseChunk.update({
                        where: { id: chunk.id },
                        data: {
                            status: 'SENT',
                            externalMessageId: result.externalMessageId,
                            channel: result.channel,
                            sentAt: new Date(),
                        },
                    });
                    sentCount++;
                }
                else {
                    await this.rabbitmq.publish(queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
                        chunkId: chunk.id,
                        aiResponseId: aiResponseRecord.id,
                        senderId,
                        error: result.error,
                    });
                    failureReason = result.error ?? null;
                }
            }
            const finalStatus = await this.aiResponseService.updateAIResponseStatus(aiResponseRecord.id);
            this.logger.log(`AI response processed: ${sentCount}/${chunkRecords.length} chunks sent | Status: ${finalStatus}`);
        }
        catch (error) {
            this.logger.error(`Error handling AI response: ${error instanceof Error ? error.message : String(error)}`);
            if (payload.userId) {
            }
        }
    }
    async handleFailedChunk(payload) {
        try {
            const { chunkId, aiResponseId, senderId, error } = payload;
            this.logger.debug(`[handleFailedChunk] Processing failed chunk ${chunkId}`);
            await this.aiResponseService.handleFailedChunk(chunkId);
            this.logger.log(`Failed chunk ${chunkId} marked for retry or permanent failure`);
        }
        catch (error) {
            this.logger.error(`Error handling failed chunk: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async handleAIResponseDLQ(payload) {
        try {
            const { aiResponseId, userId, senderId, reason } = payload;
            this.logger.error(`[DLQ] AI Response failed permanently | aiResponseId: ${aiResponseId} | userId: ${userId} | reason: ${reason}`);
            this.logger.warn(`DLQ recorded for ${aiResponseId}: user may need manual intervention`);
        }
        catch (error) {
            this.logger.error(`Error handling DLQ: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async sendChunkToUser(recipient, message, messageId) {
        const waMessageId = await this.whatsapp.sendToOneWithId(messageId, recipient, message, null);
        return waMessageId;
    }
};
exports.WhatsappListener = WhatsappListener;
exports.WhatsappListener = WhatsappListener = WhatsappListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rabbitmq_service_1.RabbitMQService,
        whatsapp_service_1.WhatsappService,
        ai_response_service_1.AIResponseService,
        prisma_service_1.PrismaService,
        conversation_cache_service_1.ConversationCacheService])
], WhatsappListener);
//# sourceMappingURL=whatsapp.listener.js.map