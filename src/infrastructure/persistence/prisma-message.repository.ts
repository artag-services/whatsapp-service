import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  IMessageRepository,
  WaMessageData,
  CreateWaMessageInput,
} from '../../domain/ports/IMessageRepository'

@Injectable()
export class PrismaMessageRepository implements IMessageRepository {
  private readonly logger = new Logger(PrismaMessageRepository.name)

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateWaMessageInput): Promise<WaMessageData> {
    const record = await this.prisma.waMessage.create({
      data: {
        id: data.id,
        messageId: data.messageId,
        recipient: data.recipient,
        body: data.body,
        mediaUrl: data.mediaUrl ?? null,
        status: 'PENDING',
        templateUsed: data.templateUsed ?? false,
      },
    })
    return this.toData(record)
  }

  async updateStatus(id: string, status: string, extra?: Partial<WaMessageData>): Promise<void> {
    const updateData: Record<string, unknown> = { status }
    if (extra) {
      if (extra.waMessageId !== undefined) updateData.waMessageId = extra.waMessageId
      if (extra.sentAt !== undefined) updateData.sentAt = extra.sentAt
      if (extra.errorReason !== undefined) updateData.errorReason = extra.errorReason
      if (extra.templateUsed !== undefined) updateData.templateUsed = extra.templateUsed
    }
    await this.prisma.waMessage.update({
      where: { id },
      data: updateData as any,
    })
  }

  async findById(id: string): Promise<WaMessageData | null> {
    const record = await this.prisma.waMessage.findUnique({ where: { id } })
    return record ? this.toData(record) : null
  }

  private toData(record: any): WaMessageData {
    return {
      id: record.id,
      messageId: record.messageId,
      recipient: record.recipient,
      body: record.body,
      mediaUrl: record.mediaUrl ?? null,
      status: record.status,
      waMessageId: record.waMessageId ?? null,
      errorReason: record.errorReason ?? null,
      templateUsed: record.templateUsed,
      sentAt: record.sentAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
}
