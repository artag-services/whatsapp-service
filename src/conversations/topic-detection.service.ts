import { Injectable } from '@nestjs/common';

/**
 * Service for detecting conversation topics from message text
 * Uses keyword matching to classify messages into predefined topics
 */
@Injectable()
export class TopicDetectionService {
  private readonly keywordMap: Record<string, string[]> = {
    billing: [
      'factura', 'invoice', 'pago', 'payment', 'precio', 'price',
      'costo', 'cost', 'dinero', 'money', 'tarjeta', 'card',
      'transacción', 'transaction', 'cobro', 'charge', 'saldo', 'balance',
      'pagar', 'pay', 'adeudo', 'deuda', 'debit', 'crédito', 'credit'
    ],
    support: [
      'error', 'problema', 'problem', 'bug', 'no funciona', 'not working',
      'ayuda', 'help', 'soporte', 'support', 'falla', 'broken',
      'crash', 'issue', 'no me', 'cannot', 'no puedo', 'don\'t work',
      'emergency', 'urgente', 'urgent', 'help me', 'necesito ayuda',
      'roto', 'damaged', 'no', 'doesn\'t'
    ],
    product: [
      'producto', 'product', 'catálogo', 'catalog', 'item',
      'feature', 'característica', 'descripción', 'description',
      'disponible', 'available', 'modelo', 'model', 'especificaciones',
      'specifications', 'specs', 'características', 'detalles', 'details',
      'colores', 'colors', 'tallas', 'sizes', 'variants'
    ],
    order: [
      'pedido', 'order', 'compra', 'purchase', 'envío', 'shipping',
      'delivery', 'entrega', 'seguimiento', 'tracking', 'recibir', 'receive',
      'recibido', 'received', 'rastreo', 'track', 'dirección', 'address',
      'donde', 'where', 'llega', 'arrive', 'estado', 'status'
    ],
  };

  /**
   * Detect topic from message text
   * Returns the first matching topic or 'General' if no match
   */
  detectTopic(text: string): string {
    if (!text || typeof text !== 'string') {
      return 'General';
    }

    const lowerText = text.toLowerCase();

    for (const [topic, keywords] of Object.entries(this.keywordMap)) {
      if (keywords.some(kw => lowerText.includes(kw))) {
        return topic.charAt(0).toUpperCase() + topic.slice(1);
      }
    }

    return 'General';
  }

  /**
   * Extract keywords that matched the detected topic
   */
  extractKeywords(text: string, topic: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const lowerText = text.toLowerCase();
    const topicLower = topic.toLowerCase();
    const keywords = this.keywordMap[topicLower] || [];

    return keywords.filter(kw => lowerText.includes(kw));
  }

  /**
   * Get all available topics
   */
  getAvailableTopics(): string[] {
    return Object.keys(this.keywordMap)
      .map(t => t.charAt(0).toUpperCase() + t.slice(1))
      .concat(['General']);
  }
}
