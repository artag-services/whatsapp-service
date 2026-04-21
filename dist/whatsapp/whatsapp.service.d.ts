import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SendWhatsappDto } from './dto/send-whatsapp.dto';
import { WhatsappResponseDto } from './dto/whatsapp-response.dto';
interface N8NWebhookResponse {
    userId: string;
    senderId: string;
    messageId: string;
    aiResponse: string;
    confidence?: number;
    model?: string;
    processingTime?: number;
    timestamp?: number;
}
export declare class WhatsappService {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    private readonly apiUrl;
    private readonly apiToken;
    private readonly phoneNumberId;
    private readonly apiVersion;
    private readonly templateName;
    private readonly templateLanguage;
    private readonly n8nWebhookUrl;
    private readonly n8nWebhookTimeout;
    private readonly n8nWebhookRetries;
    constructor(prisma: PrismaService, config: ConfigService);
    sendToRecipients(dto: SendWhatsappDto): Promise<WhatsappResponseDto>;
    sendToOneWithId(messageId: string, recipient: string, message: string, mediaUrl?: string | null): Promise<string>;
    private sendToOne;
    private sendTemplate;
    sendTemplateToFailedRecipient(recipient: string): Promise<void>;
    private buildMetaPayload;
    private resolveStatus;
    private extractErrorDetail;
    callN8NWebhook(userId: string, userName: string, userPhone: string, message: string, messageId: string): Promise<N8NWebhookResponse | null>;
    private callN8NWebhookWithRetry;
}
export {};
