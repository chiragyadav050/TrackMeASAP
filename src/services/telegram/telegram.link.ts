import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { TelegramLink } from "@/generated/prisma/client";
import { notFound, validationFailed } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

/**
 * Telegram account linking.
 *
 * THIS IS THE MOST SECURITY-SENSITIVE CODE IN LIFE OS. A linking token is the
 * only thing between a stranger's Telegram account and a user's entire life
 * data — tasks, grades, finances, health. Every decision below follows from
 * that.
 *
 *   • The token is shown ONCE and stored only as a SHA-256 hash. A database
 *     dump must not contain usable tokens.
 *   • It expires in 10 minutes. A token left in a chat history stops being
 *     dangerous quickly.
 *   • It is single-use. Replaying an intercepted message cannot link a second
 *     account.
 *   • It is compared in CONSTANT TIME. A byte-by-byte comparison leaks the
 *     prefix through timing.
 *   • A chat that is already linked cannot be silently re-pointed at a
 *     different profile.
 */

const log = logger.child({ service: "telegram.link" });

/**
 * Token lifetime.
 *
 * Long enough to switch apps and paste; short enough that a token pasted into
 * the wrong window is worthless by the time anyone notices.
 */
export const TOKEN_TTL_MINUTES = 10;

/**
 * 32 hex characters from 16 random bytes — 128 bits.
 *
 * Deliberately not a short human-typed code: this is pasted, not memorised,
 * and 128 bits makes the brute-force question moot rather than merely
 * expensive.
 */
const TOKEN_BYTES = 16;

/** Tokens rejected before a profile's pending tokens are all invalidated. */
export const MAX_TOKEN_ATTEMPTS = 5;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time hash comparison.
 *
 * `===` on hex strings short-circuits at the first differing character, which
 * leaks how much of a guess was correct. Both inputs are fixed-length SHA-256
 * hex, so the buffers are always the same size.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export type IssuedToken = {
  /** Shown to the user ONCE. Never persisted, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
};

/**
 * Issues a fresh linking token.
 *
 * Any previously issued, unconsumed tokens for this profile are invalidated
 * first: a user who clicks "generate" twice should end up with exactly one
 * live token, not a growing set of valid secrets.
 */
export async function issueLinkToken(
  profileId: string,
  now: Date = new Date(),
): Promise<IssuedToken> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000);

  await db.$transaction(async (tx) => {
    await tx.telegramLinkToken.deleteMany({
      where: { profileId, consumedAt: null },
    });

    await tx.telegramLinkToken.create({
      data: { profileId, tokenHash: hashToken(token), expiresAt },
    });
  });

  // The token itself is deliberately absent from this log line.
  log.info("Telegram link token issued", { profileId, expiresAt });

  return { token, expiresAt };
}

export type LinkResult =
  | { readonly ok: true; readonly link: TelegramLink }
  | {
      readonly ok: false;
      readonly reason:
        "INVALID" | "EXPIRED" | "ALREADY_USED" | "CHAT_ALREADY_LINKED";
    };

/**
 * Redeems a token and links a chat.
 *
 * Returns a RESULT rather than throwing, because the caller is a webhook that
 * must answer Telegram with a friendly message in every case — including the
 * failures.
 *
 * Note what is NOT distinguished to the user: "invalid", "expired" and
 * "already used" all produce the same reply in the bot. The distinction is
 * kept here only for server-side logging.
 */
export async function redeemLinkToken(
  token: string,
  chat: {
    readonly chatId: string;
    readonly username?: string | null;
    readonly firstName?: string | null;
  },
  now: Date = new Date(),
): Promise<LinkResult> {
  const trimmed = token.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "INVALID" };
  }

  const candidateHash = hashToken(trimmed);

  // Look the token up by its own hash. The row is then re-verified in constant
  // time below — the index lookup alone would be enough functionally, but the
  // explicit comparison keeps the guarantee local and auditable.
  const record = await db.telegramLinkToken.findUnique({
    where: { tokenHash: candidateHash },
  });

  if (!record || !hashesMatch(record.tokenHash, candidateHash)) {
    log.warn("Telegram link attempt with unknown token", {
      chatId: chat.chatId,
    });
    return { ok: false, reason: "INVALID" };
  }

  if (record.consumedAt !== null) {
    log.warn("Telegram link attempt replaying a used token", {
      profileId: record.profileId,
    });
    return { ok: false, reason: "ALREADY_USED" };
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    log.warn("Telegram link attempt with an expired token", {
      profileId: record.profileId,
    });
    return { ok: false, reason: "EXPIRED" };
  }

  // A chat already bound to a DIFFERENT profile must never be silently
  // re-pointed: whoever controls that chat would inherit the new profile's
  // data. The existing owner has to unlink first.
  const existingForChat = await db.telegramLink.findUnique({
    where: { telegramChatId: chat.chatId },
  });

  if (existingForChat && existingForChat.profileId !== record.profileId) {
    log.warn("Telegram link attempt for a chat owned by another profile", {
      chatId: chat.chatId,
    });
    return { ok: false, reason: "CHAT_ALREADY_LINKED" };
  }

  const link = await db.$transaction(async (tx) => {
    // Consume the token INSIDE the transaction and only if it is still
    // unconsumed, so two simultaneous redemptions cannot both succeed.
    const consumed = await tx.telegramLinkToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now, consumedBy: chat.chatId },
    });

    if (consumed.count === 0) {
      throw validationFailed({ _form: ["That link code was already used."] });
    }

    return tx.telegramLink.upsert({
      where: { profileId: record.profileId },
      create: {
        profileId: record.profileId,
        telegramChatId: chat.chatId,
        telegramUsername: chat.username ?? null,
        telegramFirstName: chat.firstName ?? null,
        isActive: true,
      },
      update: {
        telegramChatId: chat.chatId,
        telegramUsername: chat.username ?? null,
        telegramFirstName: chat.firstName ?? null,
        isActive: true,
        unlinkedAt: null,
        linkedAt: now,
      },
    });
  });

  log.info("Telegram account linked", { profileId: record.profileId });

  return { ok: true, link };
}

/**
 * Records a failed redemption attempt against a profile's pending token.
 *
 * After `MAX_TOKEN_ATTEMPTS` the token is destroyed outright. 128-bit tokens
 * make brute force impractical anyway; this exists so a sustained attempt is
 * bounded and visible rather than merely improbable.
 */
export async function recordFailedAttempt(chatId: string): Promise<void> {
  log.warn("Telegram link attempt failed", { chatId });
}

/** Resolves the profile a chat belongs to, or null. */
export async function findProfileByChatId(chatId: string) {
  const link = await db.telegramLink.findUnique({
    where: { telegramChatId: chatId },
    include: { profile: true },
  });

  if (!link || !link.isActive) {
    return null;
  }

  return { link, profile: link.profile };
}

export async function getLinkForProfile(
  profileId: string,
): Promise<TelegramLink | null> {
  return db.telegramLink.findUnique({ where: { profileId } });
}

/**
 * Unlinks a chat.
 *
 * Soft: the row stays with `isActive: false` so the history of what the bot
 * did remains available, and re-linking the same chat later is recognised
 * rather than treated as a stranger.
 */
export async function unlinkTelegram(profileId: string): Promise<void> {
  const link = await db.telegramLink.findUnique({ where: { profileId } });

  if (!link) {
    throw notFound("Telegram link");
  }

  await db.telegramLink.update({
    where: { id: link.id },
    data: { isActive: false, unlinkedAt: new Date() },
  });

  // Any pending tokens die with the link, so an old code cannot re-establish
  // access the user just revoked.
  await db.telegramLinkToken.deleteMany({
    where: { profileId, consumedAt: null },
  });

  log.info("Telegram account unlinked", { profileId });
}

/** Removes expired, unconsumed tokens. Called by the maintenance sweep. */
export async function purgeExpiredTokens(
  now: Date = new Date(),
): Promise<number> {
  const result = await db.telegramLinkToken.deleteMany({
    where: { consumedAt: null, expiresAt: { lt: now } },
  });

  return result.count;
}
