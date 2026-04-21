"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RabbitMQService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RabbitMQService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const amqp = require("amqplib");
const queues_1 = require("./constants/queues");
let RabbitMQService = RabbitMQService_1 = class RabbitMQService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(RabbitMQService_1.name);
        this.connection = null;
        this.channel = null;
    }
    async onModuleInit() {
        await this.connect();
    }
    async onModuleDestroy() {
        await this.disconnect();
    }
    async connect(retries = 10, delayMs = 3000) {
        const url = this.config.get('RABBITMQ_URL');
        if (!url) {
            throw new Error('RABBITMQ_URL is not defined in environment variables');
        }
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                this.connection = await amqp.connect(url);
                this.channel = await this.connection.createChannel();
                await this.channel.assertExchange(queues_1.RABBITMQ_EXCHANGE, 'topic', {
                    durable: true,
                });
                this.logger.log('Connected to RabbitMQ');
                return;
            }
            catch (err) {
                this.logger.warn(`RabbitMQ connection attempt ${attempt}/${retries} failed. Retrying in ${delayMs}ms...`);
                if (attempt === retries)
                    throw err;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    async disconnect() {
        try {
            await this.channel?.close();
            await this.connection?.close();
            this.logger.log('Disconnected from RabbitMQ');
        }
        catch {
        }
    }
    publish(routingKey, payload) {
        if (!this.channel) {
            throw new Error('RabbitMQ channel not available');
        }
        const content = Buffer.from(JSON.stringify(payload));
        this.channel.publish(queues_1.RABBITMQ_EXCHANGE, routingKey, content, {
            persistent: true,
            contentType: 'application/json',
        });
        this.logger.debug(`Published → [${routingKey}]`);
    }
    async subscribe(queue, routingKey, handler) {
        if (!this.channel) {
            throw new Error('RabbitMQ channel not available');
        }
        await this.channel.assertQueue(queue, { durable: true });
        await this.channel.bindQueue(queue, queues_1.RABBITMQ_EXCHANGE, routingKey);
        this.channel.prefetch(1);
        await this.channel.consume(queue, async (msg) => {
            if (!msg)
                return;
            try {
                const payload = JSON.parse(msg.content.toString());
                await handler(payload);
                this.channel.ack(msg);
            }
            catch (error) {
                this.logger.error(`Error processing message from [${queue}]`, error);
                this.channel.nack(msg, false, false);
            }
        });
        this.logger.log(`Subscribed → queue [${queue}] | routing key [${routingKey}]`);
    }
};
exports.RabbitMQService = RabbitMQService;
exports.RabbitMQService = RabbitMQService = RabbitMQService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RabbitMQService);
//# sourceMappingURL=rabbitmq.service.js.map