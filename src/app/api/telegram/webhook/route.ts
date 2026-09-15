import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { createInMemoryRateLimiter } from "@/lib/rate-limit";
import { db } from "@/server/db";
import {
  isConfigured,
  sendMessage,
  verifyWebhookSecret,
} from "@/services/telegram/telegram.client";
import {
  handleMessage,
  recordMessage,
} from "@/services/telegram/telegram.handler";
import { findProfileByChatId } from "@/services/telegram/telegram.link";

/**
 * The Telegram webhook.
 *
 * SECURITY BOUNDARY. This endpoint is unauthenticated by necessity — Telegram
 * calls it — so everything that protects it lives here:
 *
 *   1. The `X-Telegram-Bot-Api-Secret-Token` header is verified in constant
 *      time and FAILS CLOSED. No configured secret means no requests accepted.
 *   2. Identity comes ONLY from `message.chat.id`, matched against a linked
 *      chat. Nothing in the message body can name a profile.
 *   3. Per-chat rate limiting, so one chat cannot exhaust the database.
 *   4. It ALWAYS returns 200 once the secret checks out. Telegram retries
 *      anything else, and a retry storm on a handler bug is worse than a
 *      dropped message — the failure is logged instead.
 *
 * Never cached, never pre-rendered.
 */

export const dynamic = "force-dynamic";

const log = logger.child({ service: "telegram.webhook" });

/**
 * Per-chat limiter. Generous for a human, ruinous for a script.
 *
 * Keyed on the Telegram chat id, which the secret-token check has already
 * established came from Telegram — so it is not attacker-controlled in the
 * way a raw header would be.
 */
const webhookRateLimiter = createInMemoryRateLimiter({
  limit: 30,
  windowMs: 60_000,
});

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string };
    from?: {
      username?: string;
      first_name?: string;
      is_bot?: boolean;
    };
  };
};

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authenticity. Checked BEFORE the body is read, so an unauthenticated
  //    caller cannot make the server parse arbitrary JSON.
  if (
    !verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))
  ) {
    log.warn("Telegram webhook rejected: bad or missing secret");

    // 401 with no body: an attacker learns nothing about why.
    return new NextResponse(null, { status: 401 });
  }

  let update: TelegramUpdate;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    // Malformed JSON from an authenticated caller is not worth retrying.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text;

  // Nothing actionable — an edit, a photo, a join event. Acknowledged so
  // Telegram stops retrying it.
  if (chatId === undefined || typeof text !== "string") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Bots talking to bots is a loop waiting to happen.
  if (message?.from?.is_bot) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const chat = String(chatId);

  // 3. Rate limit per chat.
  const rate = await webhookRateLimiter.check(`telegram:${chat}`);

  if (!rate.allowed) {
    log.warn("Telegram webhook rate limited", { chatId: chat });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const context = await findProfileByChatId(chat);

    // Telegram retries deliveries it believes failed. Recording the inbound
    // message first, keyed on its own id, makes the whole handler idempotent
    // for linked chats.
    if (context && message?.message_id !== undefined) {
      const { isDuplicate } = await recordMessage({
        linkId: context.link.id,
        direction: "INBOUND",
        telegramMessageId: String(message.message_id),
        text,
        command: null,
        wasHandled: false,
      });

      if (isDuplicate) {
        log.debug("Telegram duplicate delivery ignored", { chatId: chat });
        return NextResponse.json({ ok: true }, { status: 200 });
      }
    }

    const result = await handleMessage(
      chat,
      text,
      {
        username: message?.from?.username ?? null,
        firstName: message?.from?.first_name ?? null,
      },
      new Date(),
    );

    if (result.reply.length > 0 && isConfigured()) {
      const sent = await sendMessage(chat, result.reply, {
        parseMode: result.parseMode,
      });

      // Re-resolved: /link and /unlink change whether a link exists.
      const after = await findProfileByChatId(chat);

      if (after) {
        await recordMessage({
          linkId: after.link.id,
          direction: "OUTBOUND",
          telegramMessageId: sent.ok ? sent.messageId : null,
          text: result.reply,
          command: result.command,
          wasHandled: result.wasHandled,
          error: sent.ok ? result.error : sent.error,
        });

        await db.telegramLink.update({
          where: { id: after.link.id },
          data: { lastMessageAt: new Date() },
        });
      }
    }
  } catch (error) {
    // 4. Logged, not surfaced, and still a 200.
    log.error("Telegram webhook failed", {
      chatId: chat,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * GET is refused.
 *
 * Telegram only ever POSTs. Answering GET would make the endpoint trivially
 * discoverable by a crawler.
 */
export function GET(): NextResponse {
  return new NextResponse(null, { status: 405 });
}
