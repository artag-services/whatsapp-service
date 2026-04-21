"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ConversationCacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationCacheService = void 0;
const common_1 = require("@nestjs/common");
let ConversationCacheService = ConversationCacheService_1 = class ConversationCacheService {
    constructor() {
        this.logger = new common_1.Logger(ConversationCacheService_1.name);
        this.cache = new Map();
    }
    set(channelUserId, data) {
        this.cache.set(channelUserId, data);
        this.logger.debug(`Cached conversation for user ${channelUserId}`);
    }
    get(channelUserId) {
        return this.cache.get(channelUserId);
    }
    has(channelUserId) {
        return this.cache.has(channelUserId);
    }
    update(channelUserId, updates) {
        const existing = this.cache.get(channelUserId);
        if (existing) {
            this.cache.set(channelUserId, { ...existing, ...updates });
            this.logger.debug(`Updated cached conversation for user ${channelUserId}`);
        }
    }
    delete(channelUserId) {
        this.cache.delete(channelUserId);
        this.logger.debug(`Deleted cached conversation for user ${channelUserId}`);
    }
    getAll() {
        return Array.from(this.cache.values());
    }
    size() {
        return this.cache.size;
    }
    clear() {
        this.cache.clear();
        this.logger.log('Cleared all cached conversations');
    }
};
exports.ConversationCacheService = ConversationCacheService;
exports.ConversationCacheService = ConversationCacheService = ConversationCacheService_1 = __decorate([
    (0, common_1.Injectable)()
], ConversationCacheService);
//# sourceMappingURL=conversation-cache.service.js.map