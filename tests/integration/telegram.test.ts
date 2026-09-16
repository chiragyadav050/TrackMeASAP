import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { createHash } from "node:crypto";

import type { Profile } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import {
  findProfileByChatId,
  getLinkForProfile,
  issueLinkToken,
  purgeExpiredTokens,
  redeemLinkToken,
  TOKEN_TTL_MINUTES,
  unlinkTelegram,
} from "@/services/telegram/telegram.link";
import {
  handleMessage,
  recordMessage,
} from "@/services/telegram/telegram.handler";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Telegram linking and command handling against a real database.
 *
 * This is the highest-stakes isolation surface in Life OS: a linking flaw
 * does not merely show someone else's data, it hands a stranger's Telegram
 * account ongoing access to a user's tasks, grades, finances and health.
 * These tests attack the flow rather than merely exercising it.
 */

let owner: Profile;
let other: Profile;

const OWNER_CHAT = "111111";
const OTHER_CHAT = "222222";

/** 2026-09-15, 10:00 in Kolkata. */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

beforeEach(async () => {
  await cleanupTestData();
  owner = await createTestProfile();
  other = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

/** Links a chat the honest way, and returns it. */
async function linkChat(profileId: string, chatId: string) {
  const { token } = await issueLinkToken(profileId, NOW);
  const result = await redeemLinkToken(token, { chatId }, NOW);

  if (!result.ok) {
    throw new Error(`Expected link to succeed, got ${result.reason}`);
  }

  return result.link;
}

describe("link tokens", () => {
  test("the plaintext token is NEVER stored", async () => {
    const { token } = await issueLinkToken(owner.id, NOW);

    const rows = await db.telegramLinkToken.findMany({
      where: { profileId: owner.id },
    });

    expect(rows).toHaveLength(1);
    // Only the hash. A database dump must not contain usable tokens.
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );

    // And nothing anywhere in the row equals the plaintext.
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  test("a token is long enough to make brute force irrelevant", async () => {
    const { token } = await issueLinkToken(owner.id, NOW);

    // 16 random bytes as hex — 128 bits.
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  test("generating a new token invalidates the previous one", async () => {
    const first = await issueLinkToken(owner.id, NOW);
    const second = await issueLinkToken(owner.id, NOW);

    // A user who clicks "generate" twice must not end up holding two live
    // secrets.
    expect(
      await db.telegramLinkToken.count({ where: { profileId: owner.id } }),
    ).toBe(1);

    const stale = await redeemLinkToken(
      first.token,
      { chatId: OWNER_CHAT },
      NOW,
    );
    expect(stale).toEqual({ ok: false, reason: "INVALID" });

    const fresh = await redeemLinkToken(
      second.token,
      { chatId: OWNER_CHAT },
      NOW,
    );
    expect(fresh.ok).toBe(true);
  });

  test("a token works exactly once", async () => {
    const { token } = await issueLinkToken(owner.id, NOW);

    expect((await redeemLinkToken(token, { chatId: OWNER_CHAT }, NOW)).ok).toBe(
      true,
    );

    // Replaying an intercepted message must not link a second account.
    const replay = await redeemLinkToken(token, { chatId: OTHER_CHAT }, NOW);
    expect(replay).toEqual({ ok: false, reason: "ALREADY_USED" });
  });

  test("a token expires", async () => {
    const { token } = await issueLinkToken(owner.id, NOW);

    const tooLate = new Date(NOW.getTime() + (TOKEN_TTL_MINUTES + 1) * 60_000);

    expect(
      await redeemLinkToken(token, { chatId: OWNER_CHAT }, tooLate),
    ).toEqual({ ok: false, reason: "EXPIRED" });
  });

  test("…but works right up to the deadline", async () => {
    const { token } = await issueLinkToken(owner.id, NOW);
    const justInTime = new Date(
      NOW.getTime() + TOKEN_TTL_MINUTES * 60_000 - 1000,
    );

    expect(
      (await redeemLinkToken(token, { chatId: OWNER_CHAT }, justInTime)).ok,
    ).toBe(true);
  });

  test("a guessed or empty token is refused", async () => {
    await issueLinkToken(owner.id, NOW);

    for (const guess of ["", "   ", "deadbeef", "0".repeat(32)]) {
      expect(
        await redeemLinkToken(guess, { chatId: OTHER_CHAT }, NOW),
        guess,
      ).toEqual({ ok: false, reason: "INVALID" });
    }

    // Nothing was linked by any of those attempts.
    expect(await db.telegramLink.count()).toBe(0);
  });

  test("a chat already linked to ANOTHER profile cannot be re-pointed", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    // `other` now tries to claim the same chat with their own valid token.
    const { token } = await issueLinkToken(other.id, NOW);
    const result = await redeemLinkToken(token, { chatId: OWNER_CHAT }, NOW);

    expect(result).toEqual({ ok: false, reason: "CHAT_ALREADY_LINKED" });

    // The original owner still owns the chat.
    const context = await findProfileByChatId(OWNER_CHAT);
    expect(context?.profile.id).toBe(owner.id);
  });

  test("relinking the SAME profile to a new chat is allowed", async () => {
    await linkChat(owner.id, OWNER_CHAT);
    const link = await linkChat(owner.id, "333333");

    expect(link.telegramChatId).toBe("333333");
    // One link per profile, moved rather than duplicated.
    expect(
      await db.telegramLink.count({ where: { profileId: owner.id } }),
    ).toBe(1);
  });

  test("expired tokens are purged", async () => {
    await issueLinkToken(owner.id, NOW);

    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(await purgeExpiredTokens(later)).toBe(1);
    expect(await db.telegramLinkToken.count()).toBe(0);
  });
});

describe("unlinking", () => {
  test("revokes access and kills pending tokens", async () => {
    await linkChat(owner.id, OWNER_CHAT);
    await issueLinkToken(owner.id, NOW);

    await unlinkTelegram(owner.id);

    // The chat can no longer reach the profile…
    expect(await findProfileByChatId(OWNER_CHAT)).toBeNull();

    // …and an old code cannot re-establish what was just revoked.
    expect(
      await db.telegramLinkToken.count({
        where: { profileId: owner.id, consumedAt: null },
      }),
    ).toBe(0);

    // The row survives for history.
    const link = await getLinkForProfile(owner.id);
    expect(link?.isActive).toBe(false);
    expect(link?.unlinkedAt).not.toBeNull();
  });

  test("unlinking a profile with no link is NOT_FOUND", async () => {
    await expect(unlinkTelegram(owner.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
    );
  });
});

describe("command handling", () => {
  test("an unlinked chat gets instructions and NO data", async () => {
    await db.task.create({
      data: { profileId: owner.id, title: "[TEST] Secret task", position: 0 },
    });

    const result = await handleMessage("999999", "/today", {}, NOW);

    expect(result.wasHandled).toBe(false);
    expect(result.reply).toContain("/start");
    // The crucial assertion: no data crossed the boundary.
    expect(result.reply).not.toContain("Secret task");
  });

  test("/start explains linking without requiring a link", async () => {
    const result = await handleMessage("999999", "/start", {}, NOW);

    expect(result.wasHandled).toBe(true);
    expect(result.reply).toContain("/link");
  });

  test("/link redeems a code and connects the chat", async () => {
    const { token } = await issueLinkToken(owner.id, NOW);

    const result = await handleMessage(
      OWNER_CHAT,
      `/link ${token}`,
      { username: "owner" },
      NOW,
    );

    expect(result.wasHandled).toBe(true);
    expect((await findProfileByChatId(OWNER_CHAT))?.profile.id).toBe(owner.id);
  });

  test("a bad /link gives ONE message regardless of why", async () => {
    // Invalid, expired and already-used must be indistinguishable, or the bot
    // becomes an oracle for probing token validity.
    const invalid = await handleMessage(OWNER_CHAT, "/link nope", {}, NOW);

    const { token } = await issueLinkToken(owner.id, NOW);
    const expired = await handleMessage(
      OWNER_CHAT,
      `/link ${token}`,
      {},
      new Date(NOW.getTime() + 60 * 60_000),
    );

    expect(invalid.reply).toBe(expired.reply);
    expect(invalid.wasHandled).toBe(false);
  });

  test("/task captures through the real service", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    const result = await handleMessage(OWNER_CHAT, "/task buy milk", {}, NOW);

    expect(result.wasHandled).toBe(true);

    const task = await db.task.findFirst({
      where: { profileId: owner.id, title: "buy milk" },
    });

    // Created through `createTask`, so it has the service's defaults and an
    // activity record — not a raw Prisma insert from the bot.
    expect(task).not.toBeNull();
    expect(task?.priority).toBe("MEDIUM");

    const activity = await db.activityEvent.count({
      where: { profileId: owner.id, entityId: task!.id },
    });
    expect(activity).toBeGreaterThan(0);
  });

  test("/task with no title asks rather than creating an empty task", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    const result = await handleMessage(OWNER_CHAT, "/task", {}, NOW);

    expect(result.wasHandled).toBe(false);
    expect(await db.task.count({ where: { profileId: owner.id } })).toBe(0);
  });

  test("/tasks then /done completes the right task", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    await db.task.createMany({
      data: [
        {
          profileId: owner.id,
          title: "[TEST] First",
          position: 0,
          dueAt: NOW,
        },
        {
          profileId: owner.id,
          title: "[TEST] Second",
          position: 1,
          dueAt: NOW,
        },
      ],
    });

    const listed = await handleMessage(OWNER_CHAT, "/tasks", {}, NOW);
    expect(listed.wasHandled).toBe(true);

    const done = await handleMessage(OWNER_CHAT, "/done 1", {}, NOW);
    expect(done.wasHandled).toBe(true);

    const completed = await db.task.count({
      where: { profileId: owner.id, status: "COMPLETED" },
    });
    expect(completed).toBe(1);
  });

  test("/done without a prior /tasks refuses rather than guessing", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    const result = await handleMessage(OWNER_CHAT, "/done 1", {}, NOW);

    expect(result.wasHandled).toBe(false);
    expect(result.reply).toContain("/tasks");
  });

  test("/done with a nonsense index is refused", async () => {
    await linkChat(owner.id, OWNER_CHAT);
    await db.task.create({
      data: {
        profileId: owner.id,
        title: "[TEST] Only",
        position: 0,
        dueAt: NOW,
      },
    });

    await handleMessage(OWNER_CHAT, "/tasks", {}, NOW);

    for (const bad of ["/done 0", "/done 99", "/done abc", "/done"]) {
      const result = await handleMessage(OWNER_CHAT, bad, {}, NOW);
      expect(result.wasHandled, bad).toBe(false);
    }

    expect(
      await db.task.count({
        where: { profileId: owner.id, status: "COMPLETED" },
      }),
    ).toBe(0);
  });

  test("/habits then /check marks the habit", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    await db.habit.create({
      data: {
        profileId: owner.id,
        name: "[TEST] Meditate",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    await handleMessage(OWNER_CHAT, "/habits", {}, NOW);
    const result = await handleMessage(OWNER_CHAT, "/check 1", {}, NOW);

    expect(result.wasHandled).toBe(true);
    expect(await db.habitLog.count({ where: { profileId: owner.id } })).toBe(1);
  });

  test("/remind creates a reminder for today", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    const result = await handleMessage(
      OWNER_CHAT,
      "/remind 18:30 call mum",
      {},
      NOW,
    );

    expect(result.wasHandled).toBe(true);

    const reminder = await db.reminder.findFirst({
      where: { profileId: owner.id },
    });

    expect(reminder?.title).toBe("call mum");
    // 18:30 Kolkata is 13:00 UTC — converted using the PROFILE's zone.
    expect(reminder?.remindAt.toISOString()).toBe("2026-09-15T13:00:00.000Z");
  });

  test("/remind with unparseable input refuses rather than guessing", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    const result = await handleMessage(
      OWNER_CHAT,
      "/remind sometime tomorrow call mum",
      {},
      NOW,
    );

    // A wrong guess means a reminder that never fires, or fires at 3am.
    expect(result.wasHandled).toBe(false);
    expect(await db.reminder.count({ where: { profileId: owner.id } })).toBe(0);
  });

  test("/unlink revokes access immediately", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    const result = await handleMessage(OWNER_CHAT, "/unlink", {}, NOW);
    expect(result.wasHandled).toBe(true);

    // The very next message gets nothing.
    const after = await handleMessage(OWNER_CHAT, "/today", {}, NOW);
    expect(after.wasHandled).toBe(false);
    expect(after.reply).toContain("/start");
  });

  test("plain text with no AI configured is refused honestly, not faked", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    // The key is REMOVED for this test rather than relied upon. Two reasons:
    // a suite that calls the real Gemini API is slow, costs quota and is not
    // deterministic; and the behaviour actually worth pinning down is what
    // happens when the assistant CANNOT answer.
    vi.stubEnv("GEMINI_API_KEY", "");

    const result = await handleMessage(
      OWNER_CHAT,
      "what should I do today?",
      {},
      NOW,
    );

    vi.unstubAllEnvs();

    // The reply says why, and does not invent an answer. This assertion used
    // to check for "/help" because free text was unsupported — Phase 8 shipped
    // and the bot now routes it to the same agent the web app uses, so what
    // matters is that an unavailable agent degrades honestly instead of
    // producing something that reads like a real answer.
    expect(result.wasHandled).toBe(false);
    expect(result.reply).toMatch(/AI provider is configured|could not answer/i);
    expect(result.reply).not.toMatch(/here is|you should|i have added/i);
  });
});

describe("cross-user isolation", () => {
  test("a linked chat can only ever see its OWN profile's data", async () => {
    await linkChat(owner.id, OWNER_CHAT);
    await linkChat(other.id, OTHER_CHAT);

    await db.task.create({
      data: {
        profileId: other.id,
        title: "[TEST] Other user secret",
        position: 0,
        dueAt: NOW,
      },
    });

    await db.task.create({
      data: {
        profileId: owner.id,
        title: "[TEST] Owner task",
        position: 0,
        dueAt: NOW,
      },
    });

    const ownerReply = await handleMessage(OWNER_CHAT, "/today", {}, NOW);

    expect(ownerReply.reply).toContain("Owner task");
    expect(ownerReply.reply).not.toContain("Other user secret");
  });

  test("a remembered task list cannot be used from another chat", async () => {
    await linkChat(owner.id, OWNER_CHAT);
    await linkChat(other.id, OTHER_CHAT);

    await db.task.create({
      data: {
        profileId: owner.id,
        title: "[TEST] Owner task",
        position: 0,
        dueAt: NOW,
      },
    });

    // The owner lists their tasks, populating the per-chat memory.
    await handleMessage(OWNER_CHAT, "/tasks", {}, NOW);

    // The other chat tries to complete "task 1".
    const result = await handleMessage(OTHER_CHAT, "/done 1", {}, NOW);

    expect(result.wasHandled).toBe(false);
    expect(
      await db.task.count({
        where: { profileId: owner.id, status: "COMPLETED" },
      }),
    ).toBe(0);
  });

  test("identity comes from the chat id, not from the message body", async () => {
    await linkChat(owner.id, OWNER_CHAT);

    // A message that names another profile must change nothing.
    const result = await handleMessage(
      OWNER_CHAT,
      `/task profileId=${other.id} steal`,
      {},
      NOW,
    );

    expect(result.wasHandled).toBe(true);

    // The task landed on the OWNER, title taken literally.
    expect(await db.task.count({ where: { profileId: other.id } })).toBe(0);
    expect(await db.task.count({ where: { profileId: owner.id } })).toBe(1);
  });
});

describe("message recording", () => {
  test("a duplicate delivery is recognised, not appended", async () => {
    const link = await linkChat(owner.id, OWNER_CHAT);

    const first = await recordMessage({
      linkId: link.id,
      direction: "INBOUND",
      telegramMessageId: "555",
      text: "/today",
      command: "/today",
      wasHandled: true,
    });

    const second = await recordMessage({
      linkId: link.id,
      direction: "INBOUND",
      telegramMessageId: "555",
      text: "/today",
      command: "/today",
      wasHandled: true,
    });

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(await db.telegramMessage.count({ where: { linkId: link.id } })).toBe(
      1,
    );
  });

  test("long message text is truncated on write", async () => {
    const link = await linkChat(owner.id, OWNER_CHAT);

    await recordMessage({
      linkId: link.id,
      direction: "INBOUND",
      telegramMessageId: "556",
      text: "x".repeat(5000),
      command: null,
      wasHandled: false,
    });

    const stored = await db.telegramMessage.findFirstOrThrow({
      where: { linkId: link.id },
    });

    // A bot log must not become an unbounded store of arbitrary user text.
    expect(stored.text.length).toBeLessThanOrEqual(500);
  });

  test("messages die with their link", async () => {
    const link = await linkChat(owner.id, OWNER_CHAT);

    await recordMessage({
      linkId: link.id,
      direction: "INBOUND",
      telegramMessageId: "557",
      text: "/today",
      command: "/today",
      wasHandled: true,
    });

    await db.telegramLink.delete({ where: { id: link.id } });

    expect(await db.telegramMessage.count({ where: { linkId: link.id } })).toBe(
      0,
    );
  });
});
