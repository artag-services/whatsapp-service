# WhatsApp Service

> Integración con Meta WhatsApp Cloud API — envía mensajes salientes y procesa los webhooks entrantes con respuestas de IA.

## Qué hace

Microservicio dedicado a la integración con la **Meta WhatsApp Cloud API**. Maneja dos flujos:

1. **Outbound** (envío): consume de `channels.whatsapp.send`, llama a la API de Meta y envía el mensaje
2. **Inbound** (recepción): el gateway recibe webhooks de Meta y los retransmite — este servicio los procesa, resuelve identidad, dispara opcionalmente un AI response, y maneja el envío de la respuesta en chunks (porque WhatsApp tiene límites de caracteres por mensaje)

## Stack

| Pieza | Valor |
|---|---|
| Framework | NestJS 10 |
| Lenguaje | TypeScript 5 |
| DB | PostgreSQL (`whatsapp_db`) — historial de mensajes, AIResponses, chunks, conversaciones |
| Mensajería | RabbitMQ — exchange `channels` |
| Provider externo | Meta WhatsApp Cloud API (v22.0) |
| Puerto | `3001` |

## Funcionalidades

- **Envío directo** de mensajes (texto + media URL)
- **Respuestas AI con chunking** — split de respuestas largas en mensajes que respetan los límites de WhatsApp
- **Retry logic** para chunks fallidos
- **Dead Letter Queue** (DLQ) para errores irrecuperables
- **Conversation rooms** — sistema de "salas" para agrupar mensajes con un mismo contacto (con AI on/off, agent assign, etc.)
- **Phone number update handling** — actualiza identidad cuando un usuario cambia de número en WhatsApp

## Routing keys

| Routing key | Dirección | Descripción |
|---|---|---|
| `channels.whatsapp.send` | inbound | Enviar mensaje (texto/media) |
| `channels.whatsapp.events.message` | inbound (event) | Mensaje recibido (bridge desde gateway webhook) |
| `channels.whatsapp.events.message_echo` | inbound (event) | Echo de mensaje enviado |
| `channels.whatsapp.events.calls` | inbound (event) | Notificación de llamada |
| `channels.whatsapp.events.flows` | inbound (event) | Evento de Flow completado |
| `channels.whatsapp.events.phone_number_update` | inbound (event) | Cambio de número |
| `channels.whatsapp.events.template_update` | inbound (event) | Status de template |
| `channels.whatsapp.events.alerts` | inbound (event) | Alertas de cuenta |
| `channels.whatsapp.ai-response` | inbound | AI respondió, hay que mandar al usuario |
| `channels.whatsapp.ai-response-chunk-failed` | inbound | Retry de chunk fallido |
| `channels.whatsapp.ai-response-dlq` | inbound | Fallo definitivo (logging) |

## Payload típico — enviar mensaje

```json
{
  "messageId": "uuid-from-gateway",
  "recipients": ["573205711428"],
  "message": "Hola, ¿cómo estás?",
  "mediaUrl": "https://example.com/imagen.jpg"
}
```

`recipients` son números de teléfono **con código de país, sin `+`, sin espacios** (formato WhatsApp).

## Endpoints HTTP (vía gateway)

Ver [../docs/api/channels/whatsapp.md](../docs/api/channels/whatsapp.md).

Genérico:
```bash
POST /api/v1/messages/send
{ "channel": "whatsapp", "recipients": ["..."], "message": "..." }
```

## Configuración (`.env`)

```env
WHATSAPP_PORT=3001
WHATSAPP_DATABASE_URL=postgresql://postgres:postgres123@postgres:5432/whatsapp_db
RABBITMQ_URL=...

WHATSAPP_API_TOKEN=EAA...                    # Token de Meta Cloud API
WHATSAPP_PHONE_NUMBER_ID=368124183059222     # ID del número que envía
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...            # Para handshake del webhook
WHATSAPP_API_VERSION=v22.0
WHATSAPP_TEMPLATE_NAME=presentacion_de_ia    # Para envíos fuera de ventana 24h
WHATSAPP_TEMPLATE_LANGUAGE=en
```

## Webhooks entrantes — cómo funciona

El gateway expone `POST /api/webhooks/whatsapp` (verificación handshake `GET` + recepción `POST`). Cuando Meta manda un evento, el gateway lo publica al routing key correspondiente (`channels.whatsapp.events.*`) y este servicio lo consume. **Ningún cliente externo llama a este servicio directamente.**

## Limitaciones del proveedor

- **Ventana de 24h**: solo podés mandar mensajes libres si el usuario te escribió en las últimas 24h. Fuera de esa ventana necesitás plantillas pre-aprobadas (`WHATSAPP_TEMPLATE_NAME`)
- **Rate limit**: ~80 mensajes/seg por número de Meta
- **Media size**: imágenes 5MB, video 16MB, documentos 100MB

## Cómo correrlo

```bash
docker-compose up -d whatsapp
```

Dev local:
```bash
cd whatsapp
pnpm install
pnpm prisma:generate
pnpm start:dev
```

## Ver también

- **[../docs/api/channels/whatsapp.md](../docs/api/channels/whatsapp.md)** — API reference para frontend
- **[../AGENTS.md](../AGENTS.md)** — flujos de mensajería + AI responses
