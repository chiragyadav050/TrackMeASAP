import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";

/**
 * The Telegram Bot API client.
 *
 * SECRET HANDLING. The bot token is read from the environment on every call
 * and never returned, logged, or included in an error message. A token in a
 * log line is a token in a log aggregator, and a Telegram bot token grants
 * full control of the bot — including reading every message sent to it.
 *
 * The client is also OPTIONAL: with no token configured, `isConfigured()`
 * returns false and callers degrade honestly rather than throwing at a user
 * who never set up a bot.
 */

const log = logger.child({ service: "telegram.client" });

const API_BASE = "https://api.telegram.org";

/** Requests are bounded so a hung upstream cannot hold a webhook open. */
const REQUEST_TIMEOUT_MS = 10_000;

function getToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export function isConfigured(): boolean {
  return getToken() !== null;
}

/**
 * The secret Telegram echoes back in `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Separate from the bot token on purpose: the webhook URL is effectively
 * public, and this header is what proves a request actually came from
 * Telegram rather than from anyone who guessed the path.
 */
function getWebhookSecret(): string | null {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

/**
 * Verifies the webhook secret in constant time.
 *
 * Returns false when no secret is configured — FAIL CLOSED. An unconfigured
 * secret must not mean "accept everything"; that would leave the webhook open
 * to anyone who found the URL.
 */
export function verifyWebhookSecret(header: string | null): boolean {
  const expected = getWebhookSecret();

  if (!expected) {
    log.error("TELEGRAM_WEBHOOK_SECRET is not configured; refusing webhook.");
    return false;
  }

  if (!header) {
    return false;
  }

  const left = Buffer.from(header, "utf8");
  const right = Buffer.from(expected, "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/** Login-widget verification, kept for a future web-login flow. */
export function verifyLoginHash(
  data: Record<string, string>,
  hash: string,
): boolean {
  const token = getToken();

  if (!token) {
    return false;
  }

  const checkString = Object.keys(data)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const computed = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  const left = Buffer.from(computed, "utf8");
  const right = Buffer.from(hash, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
}

export type SendResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly error: string };

/**
 * Sends a message.
 *
 * Never throws: a failed send must not break the webhook response, because
 * Telegram retries any request that does not return 200 and a retry storm is
 * worse than a missed reply.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  options: { parseMode?: "MarkdownV2" | "HTML"; silent?: boolean } = {},
): Promise<SendResult> {
  const token = getToken();

  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parseMode,
        disable_notification: options.silent ?? false,
        link_preview_options: { is_disabled: true },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!response.ok || !payload.ok) {
      // Telegram's description is safe to keep — it describes OUR request, not
      // the token. It is truncated so an unexpected body cannot bloat a row.
      const error = (payload.description ?? `HTTP ${response.status}`).slice(
        0,
        200,
      );

      log.warn("Telegram send failed", { chatId, error });
      return { ok: false, error };
    }

    return { ok: true, messageId: String(payload.result?.message_id ?? "") };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Telegram request timed out."
        : "Telegram request failed.";

    // Deliberately NOT logging the raw error: a fetch failure can include the
    // request URL, which contains the bot token.
    log.warn("Telegram send errored", { chatId, message });

    return { ok: false, error: message };
  } finally {
    // Cleared on every path. An uncleared timer keeps the event loop alive
    // for its full duration, which in a worker process means a shutdown that
    // hangs for ten seconds per in-flight send.
    clearTimeout(timeout);
  }
}

/**
 * Registers the webhook URL with Telegram.
 *
 * Exposed as an operator command rather than run automatically at startup:
 * every deployment would otherwise race to claim the webhook, and Telegram
 * only honours the last one.
 */
export async function setWebhook(url: string): Promise<SendResult> {
  const token = getToken();
  const secret = getWebhookSecret();

  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
  }

  if (!secret) {
    return {
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET is not configured; refusing to register.",
    };
  }

  try {
    const response = await fetch(`${API_BASE}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ["message"],
      }),
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      description?: string;
    };

    return payload.ok
      ? { ok: true, messageId: "" }
      : { ok: false, error: (payload.description ?? "unknown").slice(0, 200) };
  } catch {
    return { ok: false, error: "Telegram request failed." };
  }
}

/** A redacted description of configuration, safe to show in the UI. */
export function describeConfiguration(): {
  readonly hasToken: boolean;
  readonly hasWebhookSecret: boolean;
} {
  return {
    hasToken: getToken() !== null,
    hasWebhookSecret: getWebhookSecret() !== null,
  };
}
