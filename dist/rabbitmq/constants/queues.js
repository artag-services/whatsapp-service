"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEUES = exports.ROUTING_KEYS = exports.RABBITMQ_EXCHANGE = void 0;
exports.RABBITMQ_EXCHANGE = 'channels';
exports.ROUTING_KEYS = {
    WHATSAPP_SEND: 'channels.whatsapp.send',
    WHATSAPP_RESPONSE: 'channels.whatsapp.response',
    WHATSAPP_AI_RESPONSE: 'channels.whatsapp.ai-response',
    WHATSAPP_AI_RESPONSE_CHUNK_FAILED: 'channels.whatsapp.ai-response-chunk-failed',
    WHATSAPP_AI_RESPONSE_DLQ: 'channels.whatsapp.ai-response-dlq',
    WHATSAPP_MESSAGE_RECEIVED: 'channels.whatsapp.events.message',
    WHATSAPP_MESSAGE_ECHO_RECEIVED: 'channels.whatsapp.events.message_echo',
    WHATSAPP_CALLS_RECEIVED: 'channels.whatsapp.events.calls',
    WHATSAPP_FLOWS_RECEIVED: 'channels.whatsapp.events.flows',
    WHATSAPP_PHONE_NUMBER_UPDATE: 'channels.whatsapp.events.phone_number_update',
    WHATSAPP_TEMPLATE_UPDATE: 'channels.whatsapp.events.template_update',
    WHATSAPP_ALERTS_RECEIVED: 'channels.whatsapp.events.alerts',
    CONVERSATION_INCOMING: 'channels.conversation.incoming',
    CONVERSATION_CREATED: 'channels.conversation.created',
    CONVERSATION_AI_TOGGLE: 'channels.conversation.ai-toggle',
    CONVERSATION_AGENT_ASSIGN: 'channels.conversation.agent-assign',
};
exports.QUEUES = {
    WHATSAPP_SEND: 'whatsapp.send',
    WHATSAPP_EVENTS_MESSAGE: 'whatsapp.events.message',
    WHATSAPP_EVENTS_MESSAGE_ECHO: 'whatsapp.events.message_echo',
    WHATSAPP_EVENTS_CALLS: 'whatsapp.events.calls',
    WHATSAPP_EVENTS_FLOWS: 'whatsapp.events.flows',
    WHATSAPP_EVENTS_PHONE_NUMBER_UPDATE: 'whatsapp.events.phone_number_update',
    WHATSAPP_EVENTS_TEMPLATE_UPDATE: 'whatsapp.events.template_update',
    WHATSAPP_EVENTS_ALERTS: 'whatsapp.events.alerts',
    WHATSAPP_AI_RESPONSE: 'whatsapp.ai-response',
    WHATSAPP_AI_RESPONSE_CHUNK_FAILED: 'whatsapp.ai-response-chunk-failed',
    WHATSAPP_AI_RESPONSE_DLQ: 'whatsapp.ai-response-dlq',
    CONVERSATION_INCOMING: 'whatsapp.conversation.incoming',
    CONVERSATION_CREATED: 'whatsapp.conversation.created',
    CONVERSATION_AI_TOGGLE: 'whatsapp.conversation.ai-toggle',
    CONVERSATION_AGENT_ASSIGN: 'whatsapp.conversation.agent-assign',
    GATEWAY_RESPONSES: 'gateway.responses',
};
//# sourceMappingURL=queues.js.map