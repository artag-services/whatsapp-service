export interface AIResponse {
  aiResponse: string
  confidence?: number
  model?: string
  processingTime?: number
}

export interface AIInvokeInput {
  userId: string
  userName: string
  userPhone: string
  message: string
  messageId: string
}

export interface IAIService {
  invoke(input: AIInvokeInput): Promise<AIResponse | null>
}
