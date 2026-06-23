export interface UserIdentityData {
  userId: string
  channelUserId: string
  channel: string
  displayName: string | null
  aiEnabled: boolean
}

export interface IUserIdentityRepository {
  findByChannelUser(channelUserId: string, channel: string): Promise<UserIdentityData | null>
  ensureExists(data: { channelUserId: string; channel: string; displayName: string | null }): Promise<string>
}
