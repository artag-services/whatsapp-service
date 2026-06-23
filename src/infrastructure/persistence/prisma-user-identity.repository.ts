import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  IUserIdentityRepository,
  UserIdentityData,
} from '../../domain/ports/IUserIdentityRepository'

@Injectable()
export class PrismaUserIdentityRepository implements IUserIdentityRepository {
  private readonly logger = new Logger(PrismaUserIdentityRepository.name)

  constructor(private readonly prisma: PrismaService) {}

  async findByChannelUser(channelUserId: string, channel: string): Promise<UserIdentityData | null> {
    const record = await this.prisma.userIdentity.findUnique({
      where: { channelUserId_channel: { channelUserId, channel } },
      include: { user: true },
    })

    if (!record) return null

    return {
      userId: record.userId,
      channelUserId: record.channelUserId,
      channel: record.channel,
      displayName: record.displayName ?? null,
      aiEnabled: record.user.aiEnabled,
    }
  }

  async ensureExists(data: { channelUserId: string; channel: string; displayName: string | null }): Promise<string> {
    const existing = await this.prisma.userIdentity.findUnique({
      where: { channelUserId_channel: { channelUserId: data.channelUserId, channel: data.channel } },
      include: { user: true },
    })

    if (existing) {
      if (data.displayName && existing.displayName !== data.displayName) {
        await this.prisma.userIdentity.update({
          where: { id: existing.id },
          data: { displayName: data.displayName },
        })
      }
      return existing.userId
    }

    const user = await this.prisma.user.create({
      data: { aiEnabled: true },
    })

    await this.prisma.userIdentity.create({
      data: {
        channelUserId: data.channelUserId,
        channel: data.channel,
        displayName: data.displayName,
        userId: user.id,
      },
    })

    this.logger.log(`Created local identity for ${data.channelUserId} (${data.channel}) → user ${user.id}`)
    return user.id
  }
}
