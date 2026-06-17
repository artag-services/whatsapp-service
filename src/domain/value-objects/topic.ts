const KEYWORD_MAP: Record<string, string[]> = {
  billing: [
    'factura', 'invoice', 'pago', 'payment', 'precio', 'price',
    'costo', 'cost', 'dinero', 'money', 'tarjeta', 'card',
    'transacción', 'transaction', 'cobro', 'charge', 'saldo', 'balance',
    'pagar', 'pay', 'adeudo', 'deuda', 'debit', 'crédito', 'credit',
  ],
  support: [
    'error', 'problema', 'problem', 'bug', 'no funciona', 'not working',
    'ayuda', 'help', 'soporte', 'support', 'falla', 'broken',
    'crash', 'issue', 'no me', 'cannot', 'no puedo', "don't work",
    'emergency', 'urgente', 'urgent', 'help me', 'necesito ayuda',
    'roto', 'damaged', 'no', "doesn't",
  ],
  product: [
    'producto', 'product', 'catálogo', 'catalog', 'item',
    'feature', 'característica', 'descripción', 'description',
    'disponible', 'available', 'modelo', 'model', 'especificaciones',
    'specifications', 'specs', 'características', 'detalles', 'details',
    'colores', 'colors', 'tallas', 'sizes', 'variants',
  ],
  order: [
    'pedido', 'order', 'compra', 'purchase', 'envío', 'shipping',
    'delivery', 'entrega', 'seguimiento', 'tracking', 'recibir', 'receive',
    'recibido', 'received', 'rastreo', 'track', 'dirección', 'address',
    'donde', 'where', 'llega', 'arrive', 'estado', 'status',
  ],
}

export class Topic {
  private constructor(public readonly value: string) {}

  static detect(text: string): Topic {
    if (!text || typeof text !== 'string') {
      return new Topic('General')
    }

    const lowerText = text.toLowerCase()

    for (const [topic, keywords] of Object.entries(KEYWORD_MAP)) {
      if (keywords.some((kw) => lowerText.includes(kw))) {
        return new Topic(topic.charAt(0).toUpperCase() + topic.slice(1))
      }
    }

    return new Topic('General')
  }

  extractKeywords(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return []
    }

    const lowerText = text.toLowerCase()
    const topicLower = this.value.toLowerCase()
    const keywords = KEYWORD_MAP[topicLower] || []

    return keywords.filter((kw) => lowerText.includes(kw))
  }

  static getAvailableTopics(): string[] {
    return Object.keys(KEYWORD_MAP)
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      .concat(['General'])
  }
}
