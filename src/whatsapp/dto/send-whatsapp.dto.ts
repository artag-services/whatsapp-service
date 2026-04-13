export class SendWhatsappDto {
  messageId: string;       // ID del gateway para correlacionar la respuesta
  recipients: string[];    // números de teléfono
  message: string;
  mediaUrl?: string | null;
  metadata?: Record<string, unknown>;
}
