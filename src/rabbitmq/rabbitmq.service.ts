import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { RABBITMQ_EXCHANGE } from './constants/queues';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: amqp.Channel | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(retries = 10, delayMs = 3000) {
    const url = this.config.get<string>('RABBITMQ_URL');

    if (!url) {
      throw new Error('RABBITMQ_URL is not defined in environment variables');
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.connection = await amqp.connect(url);
        this.channel = await this.connection.createChannel();

        await this.channel.assertExchange(RABBITMQ_EXCHANGE, 'topic', {
          durable: true,
        });

        this.logger.log('Connected to RabbitMQ');
        return;
      } catch (err) {
        this.logger.warn(`RabbitMQ connection attempt ${attempt}/${retries} failed. Retrying in ${delayMs}ms...`);
        if (attempt === retries) throw err;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async disconnect() {
    try {
      await this.channel?.close();
      await this.connection?.close();
      this.logger.log('Disconnected from RabbitMQ');
    } catch {
      // Ignorar errores al cerrar
    }
  }

  publish(routingKey: string, payload: Record<string, unknown>): void {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }

    const content = Buffer.from(JSON.stringify(payload));

    this.channel.publish(RABBITMQ_EXCHANGE, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
    });

    this.logger.debug(`Published → [${routingKey}]`);
  }

  async subscribe(
    queue: string,
    routingKey: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }

    await this.channel.assertQueue(queue, { durable: true });
    await this.channel.bindQueue(queue, RABBITMQ_EXCHANGE, routingKey);
    this.channel.prefetch(1);

    await this.channel.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
        await handler(payload);
        this.channel!.ack(msg);
      } catch (error) {
        this.logger.error(`Error processing message from [${queue}]`, error);
        this.channel!.nack(msg, false, false);
      }
    });

    this.logger.log(`Subscribed → queue [${queue}] | routing key [${routingKey}]`);
  }
}
