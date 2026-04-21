"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappModule = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_service_1 = require("./whatsapp.service");
const whatsapp_listener_1 = require("./whatsapp.listener");
const ai_response_service_1 = require("./services/ai-response.service");
const conversations_module_1 = require("../conversations/conversations.module");
let WhatsappModule = class WhatsappModule {
};
exports.WhatsappModule = WhatsappModule;
exports.WhatsappModule = WhatsappModule = __decorate([
    (0, common_1.Module)({
        imports: [conversations_module_1.ConversationsModule],
        providers: [whatsapp_service_1.WhatsappService, whatsapp_listener_1.WhatsappListener, ai_response_service_1.AIResponseService],
        exports: [whatsapp_service_1.WhatsappService, ai_response_service_1.AIResponseService],
    })
], WhatsappModule);
//# sourceMappingURL=whatsapp.module.js.map