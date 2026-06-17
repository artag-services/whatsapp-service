export type ConvStatus = 'ACTIVE' | 'WAITING_AGENT' | 'WITH_AGENT' | 'ARCHIVED' | 'CLOSED'

export class Conversation {
  constructor(
    public readonly id: string,
    public readonly channelUserId: string,
    public readonly channel: string,
    public topic: string | null,
    public aiEnabled: boolean,
    public status: ConvStatus,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public readonly wasCreated: boolean,
  ) {}

  isAIActive(): boolean {
    return this.aiEnabled && this.status === 'ACTIVE'
  }

  assignAgent(agentId: string): void {
    this.agentAssigned(agentId)
    this.aiEnabled = false
    this.status = 'WITH_AGENT'
  }

  unassignAgent(): void {
    this.agentAssigned(null)
    this.aiEnabled = true
    this.status = 'ACTIVE'
  }

  toggleAI(enabled: boolean): void {
    this.aiEnabled = enabled
  }

  private agentAssigned(_agentId: string | null): void {
    // side-effect free marker for future use
  }
}
