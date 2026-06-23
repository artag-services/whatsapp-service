import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  IConversationRepository,
  ConversationData,
  UpsertConversationInput,
  CreateMessageInput,
} from '../../domain/ports/IConversationRepository'

@Injectable()
export class PrismaConversationRepository implements IConversationRepository {
  private readonly logger = new Logger(PrismaConversationRepository.name)

  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertConversationInput): Promise<{ conversation: ConversationData; wasCreated: boolean }> {
    const conversation = await this.prisma.conversation.upsert({
      where: {
        channelUserId_channel_status: {
          channelUserId: input.channelUserId,
          channel: input.channel,
          status: 'ACTIVE',
        },
      },
      update: {
        messageCount: { increment: 1 },
        lastMessageAt: input.timestamp,
        updatedAt: new Date(),
      },
      create: {
        userId: null,
        channelUserId: input.channelUserId,
        channel: input.channel,
        topic: input.topic,
        detectionMethod: 'KEYWORDS',
        keywords: input.keywords,
        aiEnabled: true,
        status: 'ACTIVE',
        messageCount: 1,
        aiMessageCount: 0,
        lastMessageAt: input.timestamp,
      },
    })

    const wasCreated = conversation.createdAt.getTime() === conversation.updatedAt.getTime()
    return { conversation: this.toData(conversation), wasCreated }
  }

  async findActiveByChannelUser(channelUserId: string, channel: string): Promise<ConversationData | null> {
    const record = await this.prisma.conversation.findFirst({
      where: { channelUserId, channel, status: 'ACTIVE' },
    })
    return record ? this.toData(record) : null
  }

  async update(id: string, data: Partial<ConversationData>): Promise<ConversationData> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (data.topic !== undefined) updateData.topic = data.topic
    if (data.aiEnabled !== undefined) updateData.aiEnabled = data.aiEnabled
    if (data.agentAssigned !== undefined) updateData.agentAssigned = data.agentAssigned
    if (data.status !== undefined) updateData.status = data.status

    const record = await this.prisma.conversation.update({ where: { id }, data: updateData as any })
    return this.toData(record)
  }

  async createMessage(data: CreateMessageInput): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: {
        conversationId: data.conversationId,
        sender: data.sender as any,
        content: data.content,
        mediaUrl: data.mediaUrl || null,
        externalId: data.externalId,
        metadata: (data.metadata ?? {}) as any,
      },
    })
  }

  async incrementAiMessageCount(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { aiMessageCount: { increment: 1 } },
    })
  }

  private toData(record: any): ConversationData {
    return {
      id: record.id,
      userId: record.userId ?? null,
      channelUserId: record.channelUserId,
      channel: record.channel,
      topic: record.topic ?? null,
      detectionMethod: record.detectionMethod,
      keywords: record.keywords ?? [],
      aiEnabled: record.aiEnabled,
      agentAssigned: record.agentAssigned ?? null,
      status: record.status,
      messageCount: record.messageCount,
      aiMessageCount: record.aiMessageCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastMessageAt: record.lastMessageAt ?? null,
      archivedAt: record.archivedAt ?? null,
    }
  }
}
