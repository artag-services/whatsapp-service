import { Injectable, Logger } from '@nestjs/common'
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service'
import { IEventPublisher } from '../../domain/ports/IEventPublisher'

@Injectable()
export class RabbitMQEventPublisher implements IEventPublisher {
  private readonly logger = new Logger(RabbitMQEventPublisher.name)

  constructor(private readonly rabbitmq: RabbitMQService) {}

  publish(routingKey: string, payload: Record<string, unknown>): void {
    this.rabbitmq.publish(routingKey, payload)
  }
}
