# Plan de Refactorización: WhatsApp Service → Hexagonal Architecture

## Estado Actual

```
whatsapp/src/
├── app.module.ts                    ← NestJS root
├── main.ts                          ← Bootstrap
├── admin/
│   ├── admin.guard.ts
│   ├── admin.module.ts
│   └── backfill.controller.ts
├── common/filters/
│   └── http-exception.filter.ts
├── conversations/
│   ├── conversations.module.ts
│   ├── conversation.listener.ts     ← LÓGICA + INFRA mezcladas
│   ├── conversation-cache.service.ts
│   └── topic-detection.service.ts   ← Casi dominio puro
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── rabbitmq/
│   ├── rabbitmq.module.ts
│   ├── rabbitmq.service.ts
│   └── constants/queues.ts
└── whatsapp/
    ├── whatsapp.module.ts
    ├── whatsapp.service.ts          ← LÓGICA + DB + API mezcladas
    ├── whatsapp.listener.ts         ← LÓGICA + QUEUE mezcladas (500+ líneas)
    ├── clients/
    │   ├── meta-api.client.ts       ← Adaptador HTTP (bien aislado)
    │   └── n8n.client.ts            ← Adaptador HTTP (bien aislado)
    ├── dto/
    │   ├── send-whatsapp.dto.ts
    │   └── whatsapp-response.dto.ts
    ├── services/
    │   └── ai-response.service.ts   ← LÓGICA + DB + QUEUE mezcladas
    └── types/
        └── meta-webhook.types.ts
```

## Target: Hexagonal Architecture

```
whatsapp/src/
│
├── domain/                          ← 💎 NÚCLEO — Zero dependencias externas
│   ├── entities/
│   │   ├── message.entity.ts
│   │   ├── conversation.entity.ts
│   │   └── user-identity.entity.ts
│   ├── ports/                       ← 🚪 PUERTOS (interfaces)
│   │   ├── IMessageRepository.ts
│   │   ├── IConversationRepository.ts
│   │   ├── IMessageSender.ts
│   │   ├── IAIService.ts
│   │   ├── ICacheService.ts
│   │   ├── IRateLimitService.ts
│   │   └── IEventPublisher.ts
│   ├── services/                    ← Casos de uso puros (lógica de negocio)
│   │   ├── process-incoming-message.usecase.ts
│   │   ├── send-message.usecase.ts
│   │   ├── manage-conversation.usecase.ts
│   │   └── handle-ai-response.usecase.ts
│   └── value-objects/
│       ├── topic.ts
│       └── message-sender.ts
│
├── infrastructure/                  ← 🏭 ADAPTADORES (implementan puertos)
│   ├── persistence/
│   │   ├── prisma-message.repository.ts      ← implements IMessageRepository
│   │   ├── prisma-conversation.repository.ts ← implements IConversationRepository
│   │   └── prisma-rate-limit.repository.ts   ← implements IRateLimitService
│   ├── messaging/
│   │   ├── meta-api.sender.ts                ← implements IMessageSender
│   │   └── n8n-ai.service.ts                 ← implements IAIService
│   ├── cache/
│   │   └── in-memory-conversation-cache.ts   ← implements ICacheService
│   ├── event-bus/
│   │   └── rabbitmq-event-publisher.ts       ← implements IEventPublisher
│   └── config/
│       └── env-config.service.ts             ← Env vars tipadas
│
├── application/                    ← 🎬 ORQUESTACIÓN NESTJS
│   ├── consumers/
│   │   ├── whatsapp.consumer.ts     ← Solo parsea payload y llama use case
│   │   └── conversation-consumer.listener.ts
│   ├── controllers/
│   │   ├── backfill.controller.ts
│   │   └── admin.guard.ts
│   └── filters/
│       └── http-exception.filter.ts
│
├── app.module.ts                    ← DI wiring (inyecta adapters en puertos)
├── main.ts
└── shared/                          ← Opcional: DTOs comunes
    └── dto/
```

## Plan de Migración (4 Fases)

---

### FASE 1: Puertos (Interfaces) — Sin cambios funcionales

**Objetivo:** Definir todos los contratos sin tocar implementaciones existentes.

**Archivos a crear:** `domain/ports/*.ts` (7 interfaces)

#### 1.1 `domain/ports/IMessageRepository.ts`
```typescript
export interface WaMessageData {
  id: string;
  messageId: string;
  recipient: string;
  body: string;
  mediaUrl?: string | null;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'READ';
  waMessageId?: string | null;
  errorReason?: string | null;
  templateUsed: boolean;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWaMessageInput {
  id: string;
  messageId: string;
  recipient: string;
  body: string;
  mediaUrl?: string | null;
}

export interface IMessageRepository {
  create(data: CreateWaMessageInput): Promise<WaMessageData>;
  updateStatus(id: string, status: string, extra?: Partial<WaMessageData>): Promise<void>;
  findById(id: string): Promise<WaMessageData | null>;
}
```

#### 1.2 `domain/ports/IConversationRepository.ts`
```typescript
export interface ConversationData {
  id: string;
  userId: string | null;
  channelUserId: string;
  channel: string;
  topic: string | null;
  detectionMethod: string;
  keywords: string[];
  aiEnabled: boolean;
  agentAssigned: string | null;
  status: string;
  messageCount: number;
  aiMessageCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
}

export interface UpsertConversationInput {
  channelUserId: string;
  channel: string;
  messageText: string;
  timestamp: Date;
  topic: string;
  keywords: string[];
}

export interface IConversationRepository {
  upsert(input: UpsertConversationInput): Promise<{ conversation: ConversationData; wasCreated: boolean }>;
  findActiveByChannelUser(channelUserId: string, channel: string): Promise<ConversationData | null>;
  update(id: string, data: Partial<ConversationData>): Promise<ConversationData>;
  createMessage(data: {
    conversationId: string;
    sender: string;
    content: string;
    mediaUrl?: string | null;
    externalId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
```

#### 1.3 `domain/ports/IMessageSender.ts`
```typescript
export interface SendMessageInput {
  recipient: string;
  message: string;
  mediaUrl?: string | null;
}

export interface SendTemplateInput {
  recipient: string;
  templateName: string;
  language: string;
}

export interface IMessageSender {
  send(input: SendMessageInput): Promise<string>;                   // returns wamid
  sendTemplate(input: SendTemplateInput): Promise<string>;          // returns wamid
}
```

#### 1.4 `domain/ports/IAIService.ts`
```typescript
export interface AIResponse {
  aiResponse: string;
  confidence?: number;
  model?: string;
  processingTime?: number;
}

export interface AIInvokeInput {
  userId: string;
  userName: string;
  userPhone: string;
  message: string;
  messageId: string;
}

export interface IAIService {
  invoke(input: AIInvokeInput): Promise<AIResponse | null>;
}
```

#### 1.5 `domain/ports/ICacheService.ts`
```typescript
export interface CachedConversation {
  id: string;
  channelUserId: string;
  topic: string | null;
  aiEnabled: boolean;
  agentAssigned: string | null;
  userId: string | null;
  status: string;
}

export interface ICacheService {
  get(channelUserId: string): CachedConversation | undefined;
  set(channelUserId: string, data: CachedConversation): void;
  update(channelUserId: string, updates: Partial<CachedConversation>): void;
  has(channelUserId: string): boolean;
  delete(channelUserId: string): void;
  clear(): void;
  size(): number;
}
```

#### 1.6 `domain/ports/IRateLimitService.ts`
```typescript
export interface IRateLimitService {
  checkAndIncrement(userId: string, service: string): Promise<boolean>;  // false = exceeded
  getUsage(userId: string, service: string): Promise<{ callsToday: number; limit: number; remaining: number; resetAt: Date }>;
}
```

#### 1.7 `domain/ports/IEventPublisher.ts`
```typescript
export interface IEventPublisher {
  publish(routingKey: string, payload: Record<string, unknown>): Promise<void>;
}
```

---

### FASE 2: Entidades de Dominio + Value Objects — Sin cambios funcionales

**Objetivo:** Modelar datos puros del dominio sin decoradores ni infra.

**Archivos a crear:** `domain/entities/*.ts`, `domain/value-objects/*.ts`

#### `domain/entities/message.entity.ts`
```typescript
export class Message {
  constructor(
    public readonly id: string,
    public readonly messageId: string,
    public readonly recipient: string,
    public readonly body: string,
    public readonly mediaUrl: string | null,
    public status: 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'READ',
    public readonly createdAt: Date,
  ) {}

  markSent(waMessageId: string): void { this.status = 'SENT'; }
  markFailed(reason: string): void { this.status = 'FAILED'; }
}
```

#### `domain/entities/conversation.entity.ts`
```typescript
export class Conversation {
  constructor(
    public readonly id: string,
    public readonly channelUserId: string,
    public readonly channel: string,
    public topic: string | null,
    public aiEnabled: boolean,
    public status: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public readonly wasCreated: boolean,
  ) {}

  isAIActive(): boolean { return this.aiEnabled && this.status === 'ACTIVE'; }
  assignAgent(agentId: string): void { /* ... */ }
  toggleAI(enabled: boolean): void { /* ... */ }
}
```

#### `domain/value-objects/topic.ts`
```typescript
const KEYWORD_MAP: Record<string, string[]> = {
  billing: ['factura', 'pago', ...],
  support: ['error', 'problema', ...],
  // ...
};

export class Topic {
  private constructor(public readonly value: string) {}
  static detect(text: string): Topic { /* pure logic from TopicDetectionService */ }
  extractKeywords(text: string): string[] { /* ... */ }
}
```

---

### FASE 3: Casos de Uso (Servicios de Dominio) — Extraer lógica pura

**Objetivo:** Mover toda la lógica de negocio de los listeners/services actuales a use cases puros que solo dependan de puertos (no de implementaciones concretas).

#### 3.1 `domain/services/process-incoming-message.usecase.ts`

Extraer de `WhatsappListener.processAIResponse()` (líneas 193-284) + `ConversationListener.handleConversationIncoming()`.

```typescript
import { ICacheService } from '../ports/ICacheService';
import { IConversationRepository } from '../ports/IConversationRepository';
import { IRateLimitService } from '../ports/IRateLimitService';
import { IAIService } from '../ports/IAIService';
import { IEventPublisher } from '../ports/IEventPublisher';
import { Topic } from '../value-objects/topic';

export interface IncomingMessageInput {
  channel: 'whatsapp';
  channelUserId: string;
  messageText: string;
  messageId: string;
  timestamp: string;
  displayName: string;
  mediaUrl?: string;
  mediaType?: string;
}

export class ProcessIncomingMessageUseCase {
  constructor(
    private readonly cache: ICacheService,
    private readonly conversationRepo: IConversationRepository,
    private readonly rateLimiter: IRateLimitService,
    private readonly aiService: IAIService,
    private readonly eventBus: IEventPublisher,
  ) {}

  async execute(input: IncomingMessageInput): Promise<void> {
    // 1. Detectar topic (lógica pura)
    const topic = Topic.detect(input.messageText);
    const keywords = topic.extractKeywords(input.messageText);

    // 2. Resolver timestamp
    const timestamp = new Date(parseInt(input.timestamp, 10) * 1000);

    // 3. Upsert conversación vía puerto
    const { conversation, wasCreated } = await this.conversationRepo.upsert({
      channelUserId: input.channelUserId,
      channel: input.channel,
      messageText: input.messageText,
      timestamp,
      topic: topic.value,
      keywords,
    });

    // 4. Actualizar cache
    this.cache.set(input.channelUserId, { /* ... */ });

    // 5. Guardar mensaje
    try {
      await this.conversationRepo.createMessage({ /* ... */ });
    } catch { /* log but don't fail */ }

    // 6. Publicar eventos CQRS
    if (wasCreated) {
      await this.eventBus.publish('data.whatsapp.conversation.created', { /* ... */ });
    }
    await this.eventBus.publish('data.whatsapp.message.received', { /* ... */ });
    await this.eventBus.publish(IDENTITY_RESOLVE_ROUTING_KEY, { /* ... */ });

    // 7. Rate limit + AI
    const hasCapacity = await this.rateLimiter.checkAndIncrement(/* userId */, 'whatsapp');
    if (!hasCapacity) return;

    const aiResponse = await this.aiService.invoke({ /* ... */ });
    if (!aiResponse) return;

    await this.eventBus.publish(ROUTING_KEYS.WHATSAPP_AI_RESPONSE, { /* ... */ });
  }
}
```

#### 3.2 `domain/services/send-message.usecase.ts`

Extraer de `WhatsappService.sendToOneWithId()` y `sendToRecipients()`.

```typescript
export class SendMessageUseCase {
  constructor(
    private readonly messageRepo: IMessageRepository,
    private readonly sender: IMessageSender,
  ) {}

  async execute(dto: SendWhatsappDto): Promise<WhatsappResponseDto> {
    // Lógica de bulk send con per-recipient error tracking
    // Sin imports de NestJS ni Prisma
  }

  async sendToRecipient(
    messageId: string,
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ): Promise<string> {
    const record = await this.messageRepo.create({ /* ... */ });
    try {
      const wamid = await this.sender.send({ recipient, message, mediaUrl });
      await this.messageRepo.updateStatus(record.id, 'SENT', { waMessageId: wamid });
      return wamid;
    } catch (error) {
      // Template fallback logic (sin cambios)
    }
  }
}
```

#### 3.3 `domain/services/manage-conversation.usecase.ts`

Extraer lógica de AI toggle + Agent assign de `ConversationListener`.

```typescript
export class ManageConversationUseCase {
  constructor(
    private readonly conversationRepo: IConversationRepository,
    private readonly cache: ICacheService,
    private readonly eventBus: IEventPublisher,
  ) {}

  async toggleAI(conversationId: string, aiEnabled: boolean): Promise<void> { /* ... */ }
  async assignAgent(conversationId: string, agentAssigned: string | null): Promise<void> { /* ... */ }
}
```

#### 3.4 `domain/services/handle-ai-response.usecase.ts`

Extraer de `WhatsappListener.handleAIResponse()` + `AIResponseService`.

```typescript
export class HandleAIResponseUseCase {
  constructor(
    private readonly sender: IMessageSender,
    private readonly eventBus: IEventPublisher,
    private readonly messageRepo: IMessageRepository,
    // Ya no depende de Prisma directamente
  ) {}

  async execute(payload: AIResponsePayload): Promise<void> {
    const chunks = this.splitIntoChunks(payload.aiResponse);
    for (const chunk of chunks) {
      // Retry logic (pura)
      // Publicar fallos vía eventBus
    }
  }

  private splitIntoChunks(text: string, maxSize = 4096): string[] {
    // Lógica pura de split
  }
}
```

---

### FASE 4: Adaptadores (Infrastructure) — Implementar puertos

**Objetivo:** Cada adapter implementa su interfaz correspondiente. Los adaptadores envuelven el código existente.

#### 4.1 `infrastructure/persistence/prisma-message.repository.ts`
Envuelve `PrismaService` e implementa `IMessageRepository`.

#### 4.2 `infrastructure/persistence/prisma-conversation.repository.ts`
Envuelve `PrismaService` e implementa `IConversationRepository`.

#### 4.3 `infrastructure/persistence/prisma-rate-limit.repository.ts`
Envuelve `PrismaService` e implementa `IRateLimitService`.

#### 4.4 `infrastructure/messaging/meta-api.sender.ts`
Envuelve `MetaApiClient` e implementa `IMessageSender`.

#### 4.5 `infrastructure/messaging/n8n-ai.service.ts`
Envuelve `N8nClient` e implementa `IAIService`.

#### 4.6 `infrastructure/cache/in-memory-conversation-cache.ts`
Mueve `ConversationCacheService` aquí, implementa `ICacheService`.

#### 4.7 `infrastructure/event-bus/rabbitmq-event-publisher.ts`
Envuelve `RabbitMQService` e implementa `IEventPublisher`.

---

### FASE 5: Application Layer — Consumidores delgados

**Objetivo:** Los listeners/consumidores actuales se convierten en thin adapters que solo parsean el payload y delegan al use case.

#### `application/consumers/whatsapp.consumer.ts` (reemplaza `whatsapp.listener.ts`)
```typescript
@Injectable()
export class WhatsappConsumer implements OnModuleInit {
  constructor(
    private readonly processIncoming: ProcessIncomingMessageUseCase,
    private readonly sendMessage: SendMessageUseCase,
    private readonly handleAIResponse: HandleAIResponseUseCase,
    private readonly rabbitmq: RabbitMQService,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_SEND, ROUTING_KEYS.WHATSAPP_SEND, (p) =>
      this.handleSendMessage(p),
    );
    await this.rabbitmq.subscribe(QUEUES.WHATSAPP_EVENTS_MESSAGE, ..., (p) =>
      this.handleInboundMessages(p),
    );
    // ... todos los subscribers
  }

  private async handleInboundMessages(payload: Record<string, unknown>) {
    // Solo parsea y delega al use case
    const value = (payload as MetaWebhookPayload).value;
    if (!value?.messages) return;
    for (const msg of value.messages) {
      await this.processIncoming.execute({
        channel: 'whatsapp',
        channelUserId: msg.from,
        messageText: msg.text?.body ?? '',
        messageId: msg.id,
        timestamp: msg.timestamp,
        displayName: value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name ?? msg.from,
      });
    }
  }

  private async handleSendMessage(payload: Record<string, unknown>) {
    const dto = payload as SendWhatsappDto;
    const response = await this.sendMessage.execute(dto);
    // publicar respuesta (infra, no dominio)
    await this.rabbitmq.publish(ROUTING_KEYS.WHATSAPP_RESPONSE, { ... });
  }

  // ... stubs igual que antes
}
```

#### `application/consumers/conversation-consumer.listener.ts` (reemplaza `conversation.listener.ts`)
```typescript
@RabbitSubscribe({ ... })
async handleConversationIncoming(payload: ConversationIncomingPayload) {
  await this.processIncoming.execute({ ... });
}

@RabbitSubscribe({ ... })
async handleAIToggle(payload: {conversationId: string; aiEnabled: boolean}) {
  await this.manageConversation.toggleAI(payload.conversationId, payload.aiEnabled);
}

@RabbitSubscribe({ ... })
async handleAgentAssign(payload: {conversationId: string; agentAssigned: string}) {
  await this.manageConversation.assignAgent(payload.conversationId, payload.agentAssigned);
}
```

---

### FASE 6: Wiring (app.module.ts) — Inyección por interfaz

```typescript
@Module({
  imports: [ConfigModule, PrismaModule, RabbitMQModule],
  providers: [
    // Puertos → Adaptadores (NestJS injecta por token personalizado)
    { provide: 'IMessageRepository', useClass: PrismaMessageRepository },
    { provide: 'IConversationRepository', useClass: PrismaConversationRepository },
    { provide: 'IRateLimitService', useClass: PrismaRateLimitRepository },
    { provide: 'IMessageSender', useClass: MetaApiSender },
    { provide: 'IAIService', useClass: N8nAIService },
    { provide: 'ICacheService', useClass: InMemoryConversationCache },
    { provide: 'IEventPublisher', useClass: RabbitMQEventPublisher },

    // Casos de uso (inyectan puertos, no concretos)
    ProcessIncomingMessageUseCase,
    SendMessageUseCase,
    ManageConversationUseCase,
    HandleAIResponseUseCase,

    // Consumidores delgados
    WhatsappConsumer,
    ConversationConsumer,
  ],
})
export class AppModule {}
```

---

## Resumen de Archivos

### Archivos NUEVOS a crear (21)

| Archivo | Propósito |
|---------|-----------|
| `domain/entities/message.entity.ts` | Entidad Message pura |
| `domain/entities/conversation.entity.ts` | Entidad Conversation pura |
| `domain/entities/user-identity.entity.ts` | Entidad UserIdentity pura |
| `domain/value-objects/topic.ts` | Topic detection puro (de TopicDetectionService) |
| `domain/value-objects/message-sender.ts` | Enum puro |
| `domain/ports/IMessageRepository.ts` | Puerto de persistencia de mensajes |
| `domain/ports/IConversationRepository.ts` | Puerto de persistencia de conversaciones |
| `domain/ports/IMessageSender.ts` | Puerto de envío (Meta) |
| `domain/ports/IAIService.ts` | Puerto de AI (N8N) |
| `domain/ports/ICacheService.ts` | Puerto de caché |
| `domain/ports/IRateLimitService.ts` | Puerto de rate limiting |
| `domain/ports/IEventPublisher.ts` | Puerto de event bus (RabbitMQ) |
| `domain/services/process-incoming-message.usecase.ts` | Use case: incoming message |
| `domain/services/send-message.usecase.ts` | Use case: send message |
| `domain/services/manage-conversation.usecase.ts` | Use case: manage conversation |
| `domain/services/handle-ai-response.usecase.ts` | Use case: AI response |
| `infrastructure/persistence/prisma-message.repository.ts` | Adapter: MessageRepo → Prisma |
| `infrastructure/persistence/prisma-conversation.repository.ts` | Adapter: ConversationRepo → Prisma |
| `infrastructure/persistence/prisma-rate-limit.repository.ts` | Adapter: RateLimit → Prisma |
| `infrastructure/messaging/meta-api.sender.ts` | Adapter: Sender → MetaApiClient |
| `infrastructure/messaging/n8n-ai.service.ts` | Adapter: AI → N8nClient |
| `infrastructure/cache/in-memory-conversation-cache.ts` | Adapter: Cache → ConversationCacheService |
| `infrastructure/event-bus/rabbitmq-event-publisher.ts` | Adapter: EventBus → RabbitMQService |
| `application/consumers/whatsapp.consumer.ts` | Thin consumer (replaces whatsapp.listener.ts) |
| `application/consumers/conversation-consumer.listener.ts` | Thin consumer (replaces conversation.listener.ts) |

### Archivos a MODIFICAR (4)

| Archivo | Cambio |
|---------|--------|
| `app.module.ts` | Wiring por interfaz en vez de clases concretas |
| `whatsapp/whatsapp.module.ts` | Eliminar providers que migraron |
| `conversations/conversations.module.ts` | Eliminar providers que migraron |
| `main.ts` | Sin cambios (ya está limpio) |

### Archivos a ELIMINAR (6)

| Archivo | Motivo |
|---------|--------|
| `whatsapp/whatsapp.listener.ts` | Reemplazado por `WhatsappConsumer` |
| `whatsapp/whatsapp.service.ts` | Lógica movida a use cases |
| `conversations/conversation.listener.ts` | Reemplazado por `ConversationConsumer` |
| `conversations/conversation-cache.service.ts` | Reemplazado por `InMemoryConversationCache` |
| `conversations/topic-detection.service.ts` | Reemplazado por `Topic` value object |
| `whatsapp/services/ai-response.service.ts` | Lógica movida a `HandleAIResponseUseCase` |

### Archivos que se CONSERVAN (sin cambios)

| Archivo | Motivo |
|---------|--------|
| `whatsapp/clients/meta-api.client.ts` | Sigue siendo el adapter HTTP de Meta (se inyecta en MetaApiSender) |
| `whatsapp/clients/n8n.client.ts` | Sigue siendo el adapter HTTP de N8N (se inyecta en N8nAIService) |
| `whatsapp/types/meta-webhook.types.ts` | Tipos, se mantienen |
| `whatsapp/dto/send-whatsapp.dto.ts` | DTOs, se mantienen |
| `whatsapp/dto/whatsapp-response.dto.ts` | DTOs, se mantienen |
| `rabbitmq/*` | Infraestructura, se mantiene |
| `prisma/*` | Infraestructura, se mantiene |
| `admin/*` | Administrativo, se mantiene |
| `common/filters/*` | Filtros HTTP, se mantienen |

---

## Garantías de la migración

| Aspecto | Garantía |
|---------|----------|
| **Routing keys RabbitMQ** | Sin cambios |
| **Contrato de eventos `data.*`** | Idéntico |
| **Payloads de eventos** | Mismos campos, mismo formato |
| **Nombres de colas** | Sin cambios |
| **Rutas HTTP admin** | Sin cambios |
| **Lógica de template fallback** | Idéntica |
| **Lógica de rate limiting** | Idéntica |
| **Lógica de chunks** | Idéntica |
| **Prisma schema** | Sin cambios |

---

## Orden de implementación recomendado

```
Semana 1: Fase 1 (Puertos) + Fase 2 (Entidades)
  → Solo crear archivos nuevos, nada se rompe

Semana 2: Fase 3 (Casos de uso)
  → Extraer lógica de whatsapp.service.ts y whatsapp.listener.ts
  → Los archivos originales aún funcionan (no se tocan hasta el final)

Semana 3: Fase 4 (Adaptadores)
  → Crear implementaciones que envuelven código existente

Semana 4: Fase 5 + 6 (Consumidores delgados + Wiring)
  → Reemplazar listeners originales, conectar todo
  → Nada cambia externamente, pero internamente es hexagonal
```

Cada fase es **independiente y reversible** — puedes hacer commit después de cada una sin romper nada.
