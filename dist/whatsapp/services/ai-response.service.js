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
var AIResponseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIResponseService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const rabbitmq_service_1 = require("../../rabbitmq/rabbitmq.service");
const queues_1 = require("../../rabbitmq/constants/queues");
let AIResponseService = AIResponseService_1 = class AIResponseService {
    constructor(prisma, rabbitmq) {
        this.prisma = prisma;
        this.rabbitmq = rabbitmq;
        this.logger = new common_1.Logger(AIResponseService_1.name);
        this.MAX_CHUNK_SIZE = 4096;
        this.MAX_RETRIES = 3;
    }
    async createAIResponse(data) {
        const aiResponseText = data.aiResponse || 'No response received from AI service';
        return this.prisma.aIResponse.create({
            data: {
                userId: data.userId,
                senderId: data.senderId,
                messageId: data.messageId,
                originalMessage: data.originalMessage,
                aiResponse: aiResponseText,
                model: data.model,
                confidence: data.confidence,
                processingTime: data.processingTime,
                status: 'PENDING',
            },
        });
    }
    splitMessageIntoChunks(message) {
        if (!message || message.length === 0) {
            return [];
        }
        const chunks = [];
        let remainingText = message;
        while (remainingText.length > 0) {
            chunks.push(remainingText.substring(0, this.MAX_CHUNK_SIZE));
            remainingText = remainingText.substring(this.MAX_CHUNK_SIZE);
        }
        if (chunks.length === 1) {
            return chunks;
        }
        return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}] ${chunk}`);
    }
    async createChunks(aiResponseId, chunks) {
        return Promise.all(chunks.map((content, index) => this.prisma.aIResponseChunk.create({
            data: {
                aiResponseId,
                chunkNumber: index + 1,
                content,
                status: 'PENDING',
                retryCount: 0,
            },
        })));
    }
    async sendChunkWithRetry(chunk, senderId, sendToOneFunction) {
        let lastError = null;
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                this.logger.debug(`[sendChunkWithRetry] Attempt ${attempt}/${this.MAX_RETRIES} for chunk ${chunk.id}`);
                const externalMessageId = await sendToOneFunction(senderId, chunk.content, `chunk_${chunk.id}_attempt_${attempt}`);
                this.logger.log(`Chunk ${chunk.id} sent successfully | externalMessageId: ${externalMessageId}`);
                return {
                    success: true,
                    externalMessageId,
                    channel: 'whatsapp',
                };
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < this.MAX_RETRIES) {
                    this.logger.warn(`Chunk ${chunk.id} attempt ${attempt} failed: ${lastError.message}. Retrying...`);
                    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
                }
                else {
                    this.logger.error(`Chunk ${chunk.id} failed after ${this.MAX_RETRIES} attempts: ${lastError.message}`);
                }
            }
        }
        return {
            success: false,
            error: lastError?.message || 'Unknown error',
        };
    }
    async updateAIResponseStatus(aiResponseId) {
        const chunks = await this.prisma.aIResponseChunk.findMany({
            where: { aiResponseId },
        });
        const sentCount = chunks.filter((c) => c.status === 'SENT').length;
        const totalChunks = chunks.length;
        let status;
        if (sentCount === totalChunks) {
            status = 'SENT';
        }
        else if (sentCount > 0) {
            status = 'PARTIAL';
        }
        else {
            status = 'FAILED';
        }
        await this.prisma.aIResponse.update({
            where: { id: aiResponseId },
            data: {
                status,
                sentChunks: sentCount,
            },
        });
        return status;
    }
    async handleFailedChunk(chunkId) {
        const chunk = await this.prisma.aIResponseChunk.findUnique({
            where: { id: chunkId },
            include: { aiResponse: true },
        });
        if (!chunk) {
            this.logger.warn(`Chunk ${chunkId} not found`);
            return;
        }
        const newRetryCount = chunk.retryCount + 1;
        if (newRetryCount < this.MAX_RETRIES) {
            await this.prisma.aIResponseChunk.update({
                where: { id: chunkId },
                data: {
                    status: 'PENDING',
                    retryCount: newRetryCount,
                },
            });
            await this.rabbitmq.publish(queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE_CHUNK_FAILED, {
                chunkId,
                aiResponseId: chunk.aiResponseId,
                retryCount: newRetryCount,
            });
            this.logger.log(`Chunk ${chunkId} marked for retry (${newRetryCount}/${this.MAX_RETRIES})`);
        }
        else {
            await this.prisma.aIResponseChunk.update({
                where: { id: chunkId },
                data: {
                    status: 'FAILED',
                    retryCount: newRetryCount,
                },
            });
            await this.updateAIResponseStatus(chunk.aiResponseId);
            this.logger.error(`Chunk ${chunkId} failed permanently after ${this.MAX_RETRIES} retries`);
        }
    }
    async sendToDLQ(aiResponseId, reason) {
        const aiResponse = await this.prisma.aIResponse.findUnique({
            where: { id: aiResponseId },
        });
        if (!aiResponse) {
            this.logger.warn(`AIResponse ${aiResponseId} not found for DLQ`);
            return;
        }
        await this.prisma.aIResponse.update({
            where: { id: aiResponseId },
            data: {
                status: 'FAILED',
                failureReason: reason,
            },
        });
        await this.rabbitmq.publish(queues_1.ROUTING_KEYS.WHATSAPP_AI_RESPONSE_DLQ, {
            aiResponseId,
            userId: aiResponse.userId,
            senderId: aiResponse.senderId,
            reason,
            timestamp: Date.now(),
        });
        this.logger.error(`AIResponse ${aiResponseId} sent to DLQ: ${reason}`);
    }
    async checkDailyRateLimit(userId) {
        const now = new Date();
        const dateKey = new Date(now);
        dateKey.setUTCHours(0, 0, 0, 0);
        const dateString = dateKey.toISOString().split('T')[0];
        const service = 'n8n';
        let rateLimit = await this.prisma.n8NRateLimit.findUnique({
            where: {
                userId_service_date: {
                    userId,
                    service,
                    date: dateString,
                },
            },
        });
        if (!rateLimit) {
            rateLimit = await this.prisma.n8NRateLimit.create({
                data: {
                    userId,
                    service,
                    date: dateString,
                    callCount: 0,
                },
            });
        }
        const limit = 20;
        const hasCapacity = rateLimit.callCount < limit;
        if (hasCapacity) {
            await this.prisma.n8NRateLimit.update({
                where: {
                    userId_service_date: {
                        userId,
                        service,
                        date: dateString,
                    },
                },
                data: {
                    callCount: rateLimit.callCount + 1,
                },
            });
        }
        else {
            this.logger.warn(`User ${userId} exceeded daily N8N limit (${rateLimit.callCount}/${limit})`);
        }
        return hasCapacity;
    }
    async getRateLimitInfo(userId) {
        const dateKey = new Date();
        dateKey.setUTCHours(0, 0, 0, 0);
        const dateString = dateKey.toISOString().split('T')[0];
        const service = 'n8n';
        const rateLimit = await this.prisma.n8NRateLimit.findUnique({
            where: {
                userId_service_date: {
                    userId,
                    service,
                    date: dateString,
                },
            },
        });
        if (!rateLimit) {
            return {
                callsToday: 0,
                limit: 20,
                remaining: 20,
                resetAt: new Date(dateKey.getTime() + 24 * 60 * 60 * 1000),
            };
        }
        const tomorrow = new Date(dateKey.getTime() + 24 * 60 * 60 * 1000);
        return {
            callsToday: rateLimit.callCount,
            limit: 20,
            remaining: Math.max(0, 20 - rateLimit.callCount),
            resetAt: tomorrow,
        };
    }
};
exports.AIResponseService = AIResponseService;
exports.AIResponseService = AIResponseService = AIResponseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        rabbitmq_service_1.RabbitMQService])
], AIResponseService);
//# sourceMappingURL=ai-response.service.js.map