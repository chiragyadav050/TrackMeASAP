-- CreateEnum
CREATE TYPE "TelegramDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "telegram_first_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinked_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_tokens" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_by" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_messages" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "direction" "TelegramDirection" NOT NULL,
    "telegram_message_id" TEXT,
    "text" TEXT NOT NULL,
    "command" TEXT,
    "was_handled" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_profile_id_key" ON "telegram_links"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_telegram_chat_id_key" ON "telegram_links"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "telegram_links_profile_id_is_active_idx" ON "telegram_links"("profile_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_tokens_token_hash_key" ON "telegram_link_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_profile_id_consumed_at_idx" ON "telegram_link_tokens"("profile_id", "consumed_at");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_expires_at_idx" ON "telegram_link_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "telegram_messages_link_id_created_at_idx" ON "telegram_messages"("link_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_messages_link_id_telegram_message_id_key" ON "telegram_messages"("link_id", "telegram_message_id");

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "telegram_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
