-- WhatsApp Service Schema Migration

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "WaMessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DELIVERED', 'READ');
CREATE TYPE "AIResponseStatus" AS ENUM ('PENDING', 'SENT', 'PARTIAL', 'FAILED');
CREATE TYPE "ChunkStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "status" "WaMessageStatus" NOT NULL DEFAULT 'PENDING',
    "waMessageId" TEXT,
    "errorReason" TEXT,
    "templateUsed" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "channelUserId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "metadata" JSONB,
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "originalMessage" TEXT NOT NULL,
    "aiResponse" TEXT NOT NULL,
    "model" TEXT,
    "confidence" DOUBLE PRECISION,
    "processingTime" INTEGER,
    "status" "AIResponseStatus" NOT NULL DEFAULT 'PENDING',
    "sentChunks" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIResponseChunk" (
    "id" TEXT NOT NULL,
    "aiResponseId" TEXT NOT NULL,
    "chunkNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "channel" TEXT,
    "status" "ChunkStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIResponseChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "N8NRateLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callsToday" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "N8NRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaMessage_messageId_key" ON "WaMessage"("messageId");
CREATE UNIQUE INDEX "UserIdentity_channelUserId_channel_key" ON "UserIdentity"("channelUserId", "channel");
CREATE UNIQUE INDEX "N8NRateLimit_userId_key" ON "N8NRateLimit"("userId");

CREATE INDEX "WaMessage_recipient_idx" ON "WaMessage"("recipient");
CREATE INDEX "WaMessage_status_idx" ON "WaMessage"("status");
CREATE INDEX "WaMessage_createdAt_idx" ON "WaMessage"("createdAt");
CREATE INDEX "UserIdentity_channel_idx" ON "UserIdentity"("channel");
CREATE INDEX "UserIdentity_trustScore_idx" ON "UserIdentity"("trustScore");
CREATE INDEX "User_aiEnabled_idx" ON "User"("aiEnabled");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "AIResponse_userId_idx" ON "AIResponse"("userId");
CREATE INDEX "AIResponse_status_idx" ON "AIResponse"("status");
CREATE INDEX "AIResponse_senderId_idx" ON "AIResponse"("senderId");
CREATE INDEX "AIResponse_createdAt_idx" ON "AIResponse"("createdAt");
CREATE INDEX "AIResponseChunk_aiResponseId_idx" ON "AIResponseChunk"("aiResponseId");
CREATE INDEX "AIResponseChunk_status_idx" ON "AIResponseChunk"("status");
CREATE INDEX "N8NRateLimit_userId_idx" ON "N8NRateLimit"("userId");
CREATE INDEX "N8NRateLimit_resetAt_idx" ON "N8NRateLimit"("resetAt");

ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIResponse" ADD CONSTRAINT "AIResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIResponseChunk" ADD CONSTRAINT "AIResponseChunk_aiResponseId_fkey" FOREIGN KEY ("aiResponseId") REFERENCES "AIResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
