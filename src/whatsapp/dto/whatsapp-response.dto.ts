export class WhatsappResponseDto {
  messageId: string;         // ID del gateway
  status: 'SENT' | 'FAILED' | 'PARTIAL';
  sentCount: number;
  failedCount: number;
  errors?: Array<{ recipient: string; reason: string }>;
  timestamp: string;
}
