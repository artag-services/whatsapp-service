/**
 * Contratos RabbitMQ del microservicio WhatsApp.
 * Importa los mismos valores que el gateway para mantener consistencia.
 * En el futuro puedes extraer esto a un paquete compartido (@shared/rabbitmq).
 */

export const RABBITMQ_EXCHANGE = 'channels';

export const ROUTING_KEYS = {
  WHATSAPP_SEND: 'channels.whatsapp.send',
  WHATSAPP_RESPONSE: 'channels.whatsapp.response',
  WHATSAPP_AI_RESPONSE: 'channels.whatsapp.ai-response',
  WHATSAPP_AI_RESPONSE_CHUNK_FAILED: 'channels.whatsapp.ai-response-chunk-failed',
  WHATSAPP_AI_RESPONSE_DLQ: 'channels.whatsapp.ai-response-dlq',

  // WhatsApp Events - Incoming events from webhooks
  WHATSAPP_MESSAGE_RECEIVED: 'channels.whatsapp.events.message',
  WHATSAPP_MESSAGE_ECHO_RECEIVED: 'channels.whatsapp.events.message_echo',
  WHATSAPP_CALLS_RECEIVED: 'channels.whatsapp.events.calls',
  WHATSAPP_FLOWS_RECEIVED: 'channels.whatsapp.events.flows',
  WHATSAPP_PHONE_NUMBER_UPDATE: 'channels.whatsapp.events.phone_number_update',
  WHATSAPP_TEMPLATE_UPDATE: 'channels.whatsapp.events.template_update',
  WHATSAPP_ALERTS_RECEIVED: 'channels.whatsapp.events.alerts',
} as const;

export const QUEUES = {
  WHATSAPP_SEND: 'whatsapp.send',

  // WhatsApp Events Queues
  WHATSAPP_EVENTS_MESSAGE: 'whatsapp.events.message',
  WHATSAPP_EVENTS_MESSAGE_ECHO: 'whatsapp.events.message_echo',
  WHATSAPP_EVENTS_CALLS: 'whatsapp.events.calls',
  WHATSAPP_EVENTS_FLOWS: 'whatsapp.events.flows',
  WHATSAPP_EVENTS_PHONE_NUMBER_UPDATE: 'whatsapp.events.phone_number_update',
  WHATSAPP_EVENTS_TEMPLATE_UPDATE: 'whatsapp.events.template_update',
  WHATSAPP_EVENTS_ALERTS: 'whatsapp.events.alerts',

  // AI Response Queues
  WHATSAPP_AI_RESPONSE: 'whatsapp.ai-response',
  WHATSAPP_AI_RESPONSE_CHUNK_FAILED: 'whatsapp.ai-response-chunk-failed',
  WHATSAPP_AI_RESPONSE_DLQ: 'whatsapp.ai-response-dlq',

  GATEWAY_RESPONSES: 'gateway.responses',
} as const;
