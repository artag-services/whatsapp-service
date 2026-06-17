import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  IRateLimitService,
  RateLimitInfo,
} from '../../domain/ports/IRateLimitService'

const DEFAULT_DAILY_LIMIT = 20

@Injectable()
export class PrismaRateLimitRepository implements IRateLimitService {
  private readonly logger = new Logger(PrismaRateLimitRepository.name)

  constructor(private readonly prisma: PrismaService) {}

  async checkAndIncrement(userId: string, service: string): Promise<boolean> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const rateLimit = await this.prisma.n8NRateLimit.upsert({
      where: { userId_service_date: { userId, service, date: today } },
      create: { userId, service, date: today, callCount: 1 },
      update: { callCount: { increment: 1 } },
    })

    if (rateLimit.callCount > DEFAULT_DAILY_LIMIT) {
      await this.prisma.n8NRateLimit.update({
        where: { id: rateLimit.id },
        data: { callCount: { decrement: 1 } },
      })
      return false
    }

    return true
  }

  async refund(userId: string, service: string): Promise<void> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    await this.prisma.n8NRateLimit.update({
      where: { userId_service_date: { userId, service, date: today } },
      data: { callCount: { decrement: 1 } },
    })
  }

  async getUsage(userId: string, service: string): Promise<RateLimitInfo> {
    const dateKey = new Date()
    dateKey.setUTCHours(0, 0, 0, 0)
    const tomorrow = new Date(dateKey.getTime() + 24 * 60 * 60 * 1000)

    const rateLimit = await this.prisma.n8NRateLimit.findUnique({
      where: { userId_service_date: { userId, service, date: dateKey } },
    })

    if (!rateLimit) {
      return { callsToday: 0, limit: DEFAULT_DAILY_LIMIT, remaining: DEFAULT_DAILY_LIMIT, resetAt: tomorrow }
    }

    return {
      callsToday: rateLimit.callCount,
      limit: DEFAULT_DAILY_LIMIT,
      remaining: Math.max(0, DEFAULT_DAILY_LIMIT - rateLimit.callCount),
      resetAt: tomorrow,
    }
  }
}
