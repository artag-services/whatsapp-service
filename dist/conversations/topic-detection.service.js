"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopicDetectionService = void 0;
const common_1 = require("@nestjs/common");
let TopicDetectionService = class TopicDetectionService {
    constructor() {
        this.keywordMap = {
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
    }
    detectTopic(text) {
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
    extractKeywords(text, topic) {
        if (!text || typeof text !== 'string') {
            return [];
        }
        const lowerText = text.toLowerCase();
        const topicLower = topic.toLowerCase();
        const keywords = this.keywordMap[topicLower] || [];
        return keywords.filter(kw => lowerText.includes(kw));
    }
    getAvailableTopics() {
        return Object.keys(this.keywordMap)
            .map(t => t.charAt(0).toUpperCase() + t.slice(1))
            .concat(['General']);
    }
};
exports.TopicDetectionService = TopicDetectionService;
exports.TopicDetectionService = TopicDetectionService = __decorate([
    (0, common_1.Injectable)()
], TopicDetectionService);
//# sourceMappingURL=topic-detection.service.js.map