import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { AdminGuard } from './admin.guard';

const PAGE = 500;
const SLEEP_MS_EVERY_N = 100;

/**
 * One-shot CQRS backfill for whatsapp. Re-emits:
 *   - `data.whatsapp.conversation.created` for every Conversation
 *   - `data.whatsapp.message.received` for every USER-sender ConversationMessage
 *
 * BOT/AGENT-sender rows are skipped — those don't have a `data.whatsapp.message.sent`
 * routing key yet (out of scope for whatsapp's CQRS contract). If we ever start
 * emitting outbound message events, add another pass here.
 *
 * Safe to run multiple times — sync's projectors are idempotent.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class BackfillController {
  private readonly logger = new Logger(BackfillController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
  ) {}

  @Post('backfill-events')
  @HttpCode(HttpStatus.OK)
  async backfill() {
    const started = Date.now();
    let scannedConversations = 0;
    let scannedMessages = 0;
    let published = 0;

    // Pass 1 — every conversation
    for (let skip = 0; ; skip += PAGE) {
      const convs = await this.prisma.conversation.findMany({
        skip,
        take: PAGE,
        orderBy: { createdAt: 'asc' },
      });
      if (convs.length === 0) break;
      scannedConversations += convs.length;

      for (const conv of convs) {
        await this.rabbitmq.publish('data.whatsapp.conversation.created', {
          conversationId: conv.id,
          channel: 'whatsapp',
          channelUserId: conv.channelUserId,
          topic: conv.topic ?? null,
          userId: conv.userId ?? null,
          status: conv.status,
          aiEnabled: conv.aiEnabled,
          agentAssigned: conv.agentAssigned ?? null,
          createdAt: conv.createdAt.toISOString(),
        });
        published++;
        if (published % SLEEP_MS_EVERY_N === 0) await this.sleep(10);
      }
    }

    // Pass 2 — every USER-sender message
    for (let skip = 0; ; skip += PAGE) {
      const msgs = await this.prisma.conversationMessage.findMany({
        skip,
        take: PAGE,
        where: { sender: 'USER' },
        orderBy: { createdAt: 'asc' },
      });
      if (msgs.length === 0) break;
      scannedMessages += msgs.length;

      for (const msg of msgs) {
        const meta = msg.metadata as Record<string, unknown> | null;
        const channelUserId = (meta?.['channelUserId'] as string | undefined) ?? null;
        await this.rabbitmq.publish('data.whatsapp.message.received', {
          messageId: msg.externalId ?? msg.id,
          senderId: channelUserId ?? '',
          channelUserId: channelUserId ?? '',
          conversationId: msg.conversationId,
          content: msg.content ?? '',
          mediaUrl: msg.mediaUrl ?? null,
          userId: null,
          channel: 'whatsapp',
          timestamp: msg.createdAt.toISOString(),
        });
        published++;
        if (published % SLEEP_MS_EVERY_N === 0) await this.sleep(10);
      }
    }

    const durationMs = Date.now() - started;
    this.logger.log(
      `Backfill done: convs=${scannedConversations} msgs=${scannedMessages} ` +
        `published=${published} durationMs=${durationMs}`,
    );
    return {
      service: 'whatsapp',
      conversations: scannedConversations,
      messages: scannedMessages,
      published,
      durationMs,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
