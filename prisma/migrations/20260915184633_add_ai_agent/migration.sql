-- CreateEnum
CREATE TYPE "AIConversationSource" AS ENUM ('WEB', 'TELEGRAM', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AIMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AIActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXECUTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AIActionRisk" AS ENUM ('SAFE', 'MODERATE', 'DESTRUCTIVE');

-- CreateEnum
CREATE TYPE "AIMemoryKind" AS ENUM ('PREFERENCE', 'FACT', 'PATTERN', 'GOAL_CONTEXT');

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT,
    "source" "AIConversationSource" NOT NULL DEFAULT 'WEB',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "AIMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "risk" "AIActionRisk" NOT NULL DEFAULT 'SAFE',
    "status" "AIActionStatus" NOT NULL DEFAULT 'EXECUTED',
    "summary" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memories" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "kind" "AIMemoryKind" NOT NULL DEFAULT 'FACT',
    "content" TEXT NOT NULL,
    "source_conversation_id" TEXT,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "usage_date" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_profile_id_archived_at_updated_at_idx" ON "ai_conversations"("profile_id", "archived_at", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_messages_profile_id_created_at_idx" ON "ai_messages"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_actions_profile_id_status_created_at_idx" ON "ai_actions"("profile_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_actions_profile_id_created_at_idx" ON "ai_actions"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_memories_profile_id_kind_idx" ON "ai_memories"("profile_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_logs_profile_id_usage_date_key" ON "ai_usage_logs"("profile_id", "usage_date");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
