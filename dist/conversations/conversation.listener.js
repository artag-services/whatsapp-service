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
var ConversationListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationListener = void 0;
const common_1 = require("@nestjs/common");
const nestjs_rabbitmq_1 = require("@golevelup/nestjs-rabbitmq");
const prisma_service_1 = require("../prisma/prisma.service");
const topic_detection_service_1 = require("./topic-detection.service");
const conversation_cache_service_1 = require("./conversation-cache.service");
const rabbitmq_service_1 = require("../rabbitmq/rabbitmq.service");
const queues_1 = require("../rabbitmq/constants/queues");
let ConversationListener = ConversationListener_1 = class ConversationListener {
    constructor(prisma, topicDetection, cache, rabbitmq) {
        this.prisma = prisma;
        this.topicDetection = topicDetection;
        this.cache = cache;
        this.rabbitmq = rabbitmq;
        this.logger = new common_1.Logger(ConversationListener_1.name);
    }
    async handleConversationIncoming(payload) {
        try {
            if (payload.channel !== 'whatsapp') {
                this.logger.debug(`Ignoring conversation.incoming for channel: ${payload.channel}`);
                return;
            }
            this.logger.log(`Processing conversation incoming from user: ${payload.channelUserId}`);
            const { channel, channelUserId, messageText, messageId } = payload;
            const topic = this.topicDetection.detectTopic(messageText);
            const keywords = this.topicDetection.extractKeywords(messageText, topic);
            const conversation = await this.prisma.conversation.create({
                data: {
                    userId: null,
                    channelUserId,
                    channel,
                    topic,
                    detectionMethod: 'KEYWORDS',
                    keywords,
                    aiEnabled: true,
                    status: 'ACTIVE',
                    messageCount: 0,
                    aiMessageCount: 0,
                },
            });
            this.logger.log(`✅ Conversation created: ${conversation.id} | Topic: ${topic}`);
            const cachedConv = {
                id: conversation.id,
                channelUserId,
                topic,
                aiEnabled: true,
                userId: null,
                status: 'ACTIVE',
                agentAssigned: null,
            };
            this.cache.set(channelUserId, cachedConv);
            await this.rabbitmq.publish(queues_1.ROUTING_KEYS.CONVERSATION_CREATED, {
                conversationId: conversation.id,
                channel,
                channelUserId,
                topic,
                aiEnabled: true,
                messageId,
                createdAt: new Date().toISOString(),
            });
            this.logger.log(`✅ Published conversation.created event: ${conversation.id}`);
        }
        catch (error) {
            this.logger.error('Error handling conversation incoming event:', error instanceof Error ? error.message : error);
        }
    }
    async handleAIToggle(payload) {
        try {
            const { conversationId, aiEnabled } = payload;
            const updated = await this.prisma.conversation.update({
                where: { id: conversationId },
                data: { aiEnabled, updatedAt: new Date() },
            });
            this.logger.log(`✅ Conversation AI toggled: ${conversationId} → ${aiEnabled}`);
            if (updated.channelUserId) {
                this.cache.update(updated.channelUserId, { aiEnabled });
            }
        }
        catch (error) {
            this.logger.error('Error handling AI toggle event:', error);
        }
    }
    async handleAgentAssign(payload) {
        try {
            const { conversationId, agentAssigned } = payload;
            const updated = await this.prisma.conversation.update({
                where: { id: conversationId },
                data: {
                    agentAssigned: agentAssigned || null,
                    aiEnabled: agentAssigned ? false : true,
                    status: agentAssigned ? 'WITH_AGENT' : 'ACTIVE',
                    updatedAt: new Date(),
                },
            });
            this.logger.log(`✅ Agent assigned to conversation: ${conversationId} → ${agentAssigned || 'UNASSIGNED'}`);
            if (updated.channelUserId) {
                this.cache.update(updated.channelUserId, {
                    aiEnabled: agentAssigned ? false : true,
                    status: agentAssigned ? 'WITH_AGENT' : 'ACTIVE',
                });
            }
        }
        catch (error) {
            this.logger.error('Error handling agent assign event:', error);
        }
    }
};
exports.ConversationListener = ConversationListener;
__decorate([
    (0, nestjs_rabbitmq_1.RabbitSubscribe)({
        exchange: 'channels',
        routingKey: 'channels.conversation.incoming',
        queue: 'whatsapp.conversation.incoming',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ConversationListener.prototype, "handleConversationIncoming", null);
__decorate([
    (0, nestjs_rabbitmq_1.RabbitSubscribe)({
        exchange: 'channels',
        routingKey: 'channels.conversation.ai-toggle',
        queue: 'whatsapp.conversation.ai-toggle',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ConversationListener.prototype, "handleAIToggle", null);
__decorate([
    (0, nestjs_rabbitmq_1.RabbitSubscribe)({
        exchange: 'channels',
        routingKey: 'channels.conversation.agent-assign',
        queue: 'whatsapp.conversation.agent-assign',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ConversationListener.prototype, "handleAgentAssign", null);
exports.ConversationListener = ConversationListener = ConversationListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        topic_detection_service_1.TopicDetectionService,
        conversation_cache_service_1.ConversationCacheService,
        rabbitmq_service_1.RabbitMQService])
], ConversationListener);
//# sourceMappingURL=conversation.listener.js.map