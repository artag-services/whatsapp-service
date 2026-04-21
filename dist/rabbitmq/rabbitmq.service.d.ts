import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class RabbitMQService implements OnModuleInit, OnModuleDestroy {
    private readonly config;
    private readonly logger;
    private connection;
    private channel;
    constructor(config: ConfigService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private connect;
    private disconnect;
    publish(routingKey: string, payload: Record<string, unknown>): void;
    subscribe(queue: string, routingKey: string, handler: (payload: Record<string, unknown>) => Promise<void>): Promise<void>;
}
