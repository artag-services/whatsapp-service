export declare class WhatsappResponseDto {
    messageId: string;
    status: 'SENT' | 'FAILED' | 'PARTIAL';
    sentCount: number;
    failedCount: number;
    errors?: Array<{
        recipient: string;
        reason: string;
    }>;
    timestamp: string;
}
