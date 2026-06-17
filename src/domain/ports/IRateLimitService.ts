export interface RateLimitInfo {
  callsToday: number
  limit: number
  remaining: number
  resetAt: Date
}

export interface IRateLimitService {
  checkAndIncrement(userId: string, service: string): Promise<boolean>
  refund(userId: string, service: string): Promise<void>
  getUsage(userId: string, service: string): Promise<RateLimitInfo>
}
