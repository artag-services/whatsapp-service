export class UserIdentity {
  constructor(
    public readonly userId: string,
    public readonly channelUserId: string,
    public readonly channel: string,
    public readonly displayName: string | null,
    public readonly aiEnabled: boolean,
  ) {}

  hasAIAccess(): boolean {
    return this.aiEnabled
  }
}
