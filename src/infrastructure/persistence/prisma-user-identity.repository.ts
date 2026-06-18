import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  IUserIdentityRepository,
  UserIdentityData,
} from '../../domain/ports/IUserIdentityRepository'

@Injectable()
export class PrismaUserIdentityRepository implements IUserIdentityRepository {
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
}
