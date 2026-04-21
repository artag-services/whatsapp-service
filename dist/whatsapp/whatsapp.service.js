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
var WhatsappService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const prisma_service_1 = require("../prisma/prisma.service");
const uuid_1 = require("uuid");
let WhatsappService = WhatsappService_1 = class WhatsappService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.logger = new common_1.Logger(WhatsappService_1.name);
        this.apiVersion = config.get('WHATSAPP_API_VERSION') ?? 'v19.0';
        this.phoneNumberId = config.getOrThrow('WHATSAPP_PHONE_NUMBER_ID');
        this.apiToken = config.getOrThrow('WHATSAPP_API_TOKEN');
        this.apiUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
        this.templateName = config.get('WHATSAPP_TEMPLATE_NAME') ?? 'presentacion_de_ia';
        this.templateLanguage = config.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en';
        this.n8nWebhookUrl = config.getOrThrow('N8N_WEBHOOK_URL');
        this.n8nWebhookTimeout = config.get('N8N_WEBHOOK_TIMEOUT') ?? 5000;
        this.n8nWebhookRetries = config.get('N8N_WEBHOOK_RETRIES') ?? 1;
    }
    async sendToRecipients(dto) {
        const results = await Promise.allSettled(dto.recipients.map((recipient) => this.sendToOne(dto.messageId, recipient, dto.message, dto.mediaUrl)));
        const errors = results
            .filter((r) => r.status === 'rejected')
            .map((r, i) => ({
            recipient: dto.recipients[i],
            reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        }));
        const sentCount = results.filter((r) => r.status === 'fulfilled').length;
        const failedCount = errors.length;
        const overallStatus = this.resolveStatus(sentCount, failedCount);
        return {
            messageId: dto.messageId,
            status: overallStatus,
            sentCount,
            failedCount,
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString(),
        };
    }
    async sendToOneWithId(messageId, recipient, message, mediaUrl) {
        const record = await this.prisma.waMessage.create({
            data: {
                id: (0, uuid_1.v4)(),
                messageId,
                recipient,
                body: message,
                mediaUrl: mediaUrl ?? null,
                status: 'PENDING',
                templateUsed: false,
            },
        });
        try {
            const payload = this.buildMetaPayload(recipient, message, mediaUrl);
            this.logger.debug(`[sendToOneWithId] Calling Meta API → URL: ${this.apiUrl} | recipient: ${recipient}`);
            const response = await axios_1.default.post(this.apiUrl, payload, {
                headers: {
                    Authorization: `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json',
                },
            });
            const waMessageId = response.data.messages[0]?.id;
            await this.prisma.waMessage.update({
                where: { id: record.id },
                data: { status: 'SENT', waMessageId, sentAt: new Date() },
            });
            this.logger.log(`Sent to ${recipient} | waMessageId: ${waMessageId}`);
            return waMessageId;
        }
        catch (error) {
            const { reason } = this.extractErrorDetail(error);
            this.logger.warn(`Failed to send message to ${recipient}: ${reason}. Attempting template fallback...`);
            try {
                await this.sendTemplate(recipient, record.id, messageId);
                return '';
            }
            catch (templateError) {
                const { reason: templateReason } = this.extractErrorDetail(templateError);
                await this.prisma.waMessage.update({
                    where: { id: record.id },
                    data: {
                        status: 'FAILED',
                        errorReason: `[Template fallback failed] ${templateReason} | [Original error] ${reason}`,
                        templateUsed: true,
                    },
                });
                this.logger.error(`Both sendToOne and template fallback failed for ${recipient}`);
                throw new Error(`${reason} + template fallback also failed: ${templateReason}`);
            }
        }
    }
    async sendToOne(messageId, recipient, message, mediaUrl) {
        await this.sendToOneWithId(messageId, recipient, message, mediaUrl);
    }
    async sendTemplate(recipient, recordId, messageId) {
        const templatePayload = {
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'template',
            template: {
                name: this.templateName,
                language: {
                    code: this.templateLanguage,
                },
            },
        };
        this.logger.debug(`[sendTemplate] Calling Meta API with template → URL: ${this.apiUrl} | recipient: ${recipient} | template: ${this.templateName}`);
        const response = await axios_1.default.post(this.apiUrl, templatePayload, {
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
        });
        const waMessageId = response.data.messages[0]?.id;
        await this.prisma.waMessage.update({
            where: { id: recordId },
            data: {
                status: 'SENT',
                waMessageId,
                sentAt: new Date(),
                templateUsed: true,
            },
        });
        this.logger.log(`Sent template to ${recipient} | waMessageId: ${waMessageId} | template: ${this.templateName}`);
    }
    async sendTemplateToFailedRecipient(recipient) {
        const maxRetries = 2;
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.log(`Sending fallback template to ${recipient} [Attempt ${attempt}/${maxRetries}] | template: ${this.templateName}`);
                const templatePayload = {
                    messaging_product: 'whatsapp',
                    to: recipient,
                    type: 'template',
                    template: {
                        name: this.templateName,
                        language: {
                            code: this.templateLanguage,
                        },
                    },
                };
                const response = await axios_1.default.post(this.apiUrl, templatePayload, {
                    headers: {
                        Authorization: `Bearer ${this.apiToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                const waMessageId = response.data.messages[0]?.id;
                this.logger.log(`✅ Fallback template sent to ${recipient} [Attempt ${attempt}/${maxRetries}] | wamid: ${waMessageId}`);
                return;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const { reason } = this.extractErrorDetail(error);
                if (attempt < maxRetries) {
                    this.logger.warn(`Attempt ${attempt}/${maxRetries} failed for ${recipient}: ${reason}. Retrying in 2 seconds...`);
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
                else {
                    this.logger.error(`❌ Fallback template failed after ${maxRetries} attempts for ${recipient}: ${reason}`);
                }
            }
        }
        throw lastError || new Error('Unknown error sending fallback template');
    }
    buildMetaPayload(recipient, message, mediaUrl) {
        if (mediaUrl) {
            return {
                messaging_product: 'whatsapp',
                to: recipient,
                type: 'image',
                image: { link: mediaUrl, caption: message },
            };
        }
        return {
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'text',
            text: { body: message },
        };
    }
    resolveStatus(sent, failed) {
        if (failed === 0)
            return 'SENT';
        if (sent === 0)
            return 'FAILED';
        return 'PARTIAL';
    }
    extractErrorDetail(error) {
        if (axios_1.default.isAxiosError(error)) {
            const axiosError = error;
            const httpStatus = axiosError.response?.status ?? 'no-response';
            const metaError = axiosError.response?.data?.error;
            const reason = metaError?.message ?? axiosError.message;
            const errorCode = metaError?.code;
            const detail = `httpStatus: ${httpStatus}\n` +
                `  metaCode : ${metaError?.code ?? 'n/a'}\n` +
                `  metaType : ${metaError?.type ?? 'n/a'}\n` +
                `  subcode  : ${metaError?.error_subcode ?? 'n/a'}\n` +
                `  traceId  : ${metaError?.fbtrace_id ?? 'n/a'}\n` +
                `  apiUrl   : ${this.apiUrl}\n` +
                `  rawBody  : ${JSON.stringify(axiosError.response?.data ?? null)}`;
            return { reason, detail, errorCode };
        }
        const reason = error instanceof Error ? error.message : String(error);
        return { reason, detail: `(non-axios error) ${reason}` };
    }
    async callN8NWebhook(userId, userName, userPhone, message, messageId) {
        return this.callN8NWebhookWithRetry(userId, userName, userPhone, message, messageId, 0);
    }
    async callN8NWebhookWithRetry(userId, userName, userPhone, message, messageId, attemptNumber) {
        const maxRetries = this.n8nWebhookRetries;
        const currentAttempt = attemptNumber + 1;
        try {
            const payload = {
                userId,
                userName,
                userPhone,
                channel: 'whatsapp',
                message,
                messageId,
                timestamp: Date.now(),
            };
            this.logger.debug(`[callN8NWebhook] Attempt ${currentAttempt}/${maxRetries + 1} → URL: ${this.n8nWebhookUrl} | userId: ${userId} | messageId: ${messageId}`);
            const response = await axios_1.default.post(this.n8nWebhookUrl, payload, {
                timeout: this.n8nWebhookTimeout,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            this.logger.debug(`[callN8NWebhook] Raw response received:
        - response exists: ${!!response}
        - response.data exists: ${!!response.data}
        - response.data type: ${typeof response.data}
        - response.data is array: ${Array.isArray(response.data)}
        - response.data: ${JSON.stringify(response.data).substring(0, 500)}...`);
            let aiResponseData;
            if (Array.isArray(response.data)) {
                if (response.data.length === 0) {
                    throw new Error('N8N webhook returned empty array');
                }
                aiResponseData = response.data[0];
                this.logger.debug(`[callN8NWebhook] Extracted from array format (length: ${response.data.length})`);
            }
            else if (typeof response.data === 'string') {
                try {
                    const dataStr = response.data;
                    const cleanedString = dataStr
                        .replace(/\r\n/g, ' ')
                        .replace(/\n/g, ' ')
                        .replace(/\r/g, ' ')
                        .replace(/\t/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const parsed = JSON.parse(cleanedString);
                    if (Array.isArray(parsed)) {
                        if (parsed.length === 0) {
                            throw new Error('N8N webhook returned empty array (after parsing)');
                        }
                        aiResponseData = parsed[0];
                        this.logger.debug(`[callN8NWebhook] Extracted from parsed array format (length: ${parsed.length})`);
                    }
                    else if (typeof parsed === 'object' && parsed !== null) {
                        aiResponseData = parsed;
                        this.logger.debug(`[callN8NWebhook] Received parsed object format`);
                    }
                    else {
                        throw new Error(`N8N webhook returned invalid format after parsing: ${typeof parsed}`);
                    }
                }
                catch (parseError) {
                    throw new Error(`Failed to parse N8N response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                }
            }
            else if (typeof response.data === 'object' && response.data !== null) {
                aiResponseData = response.data;
                this.logger.debug(`[callN8NWebhook] Received object format (direct response)`);
            }
            else {
                throw new Error(`N8N webhook returned invalid format: ${typeof response.data}`);
            }
            if (!aiResponseData.aiResponse) {
                throw new Error('N8N response missing aiResponse field');
            }
            this.logger.log(`[callN8NWebhook] Success → userId: ${aiResponseData.userId} | aiResponse length: ${aiResponseData.aiResponse?.length || 0} | confidence: ${aiResponseData.confidence} | model: ${aiResponseData.model}`);
            return aiResponseData;
        }
        catch (error) {
            const { reason, detail, errorCode } = this.extractErrorDetail(error);
            this.logger.debug(`[callN8NWebhook] Error details: ${detail}`);
            if (currentAttempt <= maxRetries) {
                this.logger.warn(`[callN8NWebhook] Attempt ${currentAttempt}/${maxRetries + 1} failed (code: ${errorCode}): ${reason}. Retrying...`);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return this.callN8NWebhookWithRetry(userId, userName, userPhone, message, messageId, attemptNumber + 1);
            }
            else {
                this.logger.error(`[callN8NWebhook] Failed after ${maxRetries + 1} attempts → userId: ${userId} | errorCode: ${errorCode} | reason: ${reason}`);
                this.logger.error(`[callN8NWebhook] Full error details:\n${detail}`);
                return null;
            }
        }
    }
};
exports.WhatsappService = WhatsappService;
exports.WhatsappService = WhatsappService = WhatsappService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], WhatsappService);
//# sourceMappingURL=whatsapp.service.js.map