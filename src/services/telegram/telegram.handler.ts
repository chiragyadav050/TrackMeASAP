import "server-only";

import type { Profile, TelegramLink } from "@/generated/prisma/client";
import { toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runAgentTurn } from "@/services/ai/agent.service";
import { formatDuration, localDateKey, localTimeKey } from "@/lib/time";
import { db } from "@/server/db";
import { createTask, setTaskCompletion } from "@/services/task/task.service";
import { getTodayView } from "@/services/task/task.query";
import { listHabits } from "@/services/life/habit.query";
import { toggleHabitToday } from "@/services/life/habit.service";
import { getCalendarView } from "@/services/schedule/calendar.query";
import { createReminder } from "@/services/schedule/reminder.service";
import {
  escapeMarkdown,
  helpText,
  parseMessage,
  parseReminderArgument,
  truncateForStorage,
  type ParsedMessage,
} from "@/services/telegram/telegram.parse";
import {
  findProfileByChatId,
  redeemLinkToken,
  unlinkTelegram,
} from "@/services/telegram/telegram.link";

/**
 * Turns an incoming Telegram message into an action and a reply.
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * FIRST, it NEVER touches Prisma to mutate anything. Every write goes through
 * the same application service the web UI calls — `createTask`,
 * `toggleHabitToday`, `createReminder` — so validation, ownership checks and
 * activity logging cannot be bypassed by coming in through the bot.
 *
 * SECOND, a chat is only ever trusted for the profile it is LINKED to.
 * Identity comes from `telegramChatId`, never from anything in the message
 * body, so no message can address another user's data.
 */

const log = logger.child({ service: "telegram.handler" });

export type HandlerResult = {
  readonly reply: string;
  readonly parseMode?: "MarkdownV2";
  readonly command: string | null;
  readonly wasHandled: boolean;
  readonly error?: string;
};

/**
 * The ordered ids behind "/done 2" and "/check 1" live in the DATABASE.
 *
 * They used to be a process-local Map. That works on a long-lived server and
 * fails on a serverless one: the next webhook routinely lands on a different
 * instance, so the list is simply gone and the user is told to "send /tasks
 * first" immediately after doing exactly that.
 *
 * Stored on the chat's own link row, so it is naturally scoped to one chat
 * AND one profile — a chat that changes owner cannot inherit the previous
 * owner's list. The ids are still passed to services that check ownership,
 * so this is a convenience cache, never an authorisation decision.
 */
async function rememberList(
  linkId: string,
  field: "lastTaskIds" | "lastHabitIds",
  ids: readonly string[],
): Promise<void> {
  await db.telegramLink.update({
    where: { id: linkId },
    data: { [field]: [...ids] },
  });
}

/**
 * Handles one message.
 *
 * Returns the reply rather than sending it, so the webhook controls delivery
 * and this function stays testable without a network.
 */
export async function handleMessage(
  chatId: string,
  text: string,
  chatMeta: { username?: string | null; firstName?: string | null } = {},
  now: Date = new Date(),
): Promise<HandlerResult> {
  const parsed = parseMessage(text);

  if (parsed.kind === "EMPTY") {
    return { reply: "", command: null, wasHandled: false };
  }

  // /start and /link are the ONLY things an unlinked chat may do. Everything
  // else needs a profile, and there is deliberately no way to reach data
  // without one.
  if (parsed.kind === "COMMAND" && parsed.command === "start") {
    return {
      reply: [
        "*Life OS*",
        "",
        "This chat is not linked to an account yet\\.",
        "",
        "Open Life OS → Settings → Telegram, generate a link code, then send:",
        "`/link YOUR\\_CODE`",
      ].join("\n"),
      parseMode: "MarkdownV2",
      command: "/start",
      wasHandled: true,
    };
  }

  if (parsed.kind === "COMMAND" && parsed.command === "link") {
    return handleLink(chatId, parsed.argument, chatMeta, now);
  }

  const context = await findProfileByChatId(chatId);

  if (!context) {
    return {
      reply:
        "This chat isn't linked to a Life OS account. Send /start to find out how.",
      command: commandLabel(parsed),
      wasHandled: false,
    };
  }

  try {
    return await handleLinked(context.profile, context.link, parsed, now);
  } catch (error) {
    // The user gets a plain apology; the detail goes to the log. An internal
    // error message in a chat is an information leak.
    log.error("Telegram command failed", {
      profileId: context.profile.id,
      command: commandLabel(parsed),
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      reply: "Something went wrong handling that. Nothing was changed.",
      command: commandLabel(parsed),
      wasHandled: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    };
  }
}

function commandLabel(parsed: ParsedMessage): string | null {
  if (parsed.kind === "COMMAND") return `/${parsed.command}`;
  if (parsed.kind === "UNKNOWN_COMMAND") return `/${parsed.raw}`;
  return null;
}

async function handleLink(
  chatId: string,
  argument: string,
  chatMeta: { username?: string | null; firstName?: string | null },
  now: Date,
): Promise<HandlerResult> {
  if (argument.trim().length === 0) {
    return {
      reply: "Send the code from Settings → Telegram, like: /link abc123…",
      command: "/link",
      wasHandled: false,
    };
  }

  const result = await redeemLinkToken(
    argument,
    {
      chatId,
      username: chatMeta.username,
      firstName: chatMeta.firstName,
    },
    now,
  );

  if (result.ok) {
    return {
      reply:
        "Linked. Send /help to see what I can do, or /today to see your day.",
      command: "/link",
      wasHandled: true,
    };
  }

  // Deliberately ONE message for invalid, expired and already-used. Telling a
  // stranger which of the three it was turns the bot into an oracle for
  // probing token validity.
  const reply =
    result.reason === "CHAT_ALREADY_LINKED"
      ? "This Telegram account is already linked to a different Life OS account. Unlink it there first."
      : "That code isn't valid any more. Generate a fresh one in Settings → Telegram.";

  return { reply, command: "/link", wasHandled: false };
}

/**
 * Free text, answered by the same assistant the web app uses.
 *
 * This used to reply "Conversational AI arrives in Phase 8" — a placeholder
 * written in Phase 7 that outlived the phase it was waiting for. Phase 8
 * shipped, the agent has been live on the web for some time, and the bot went
 * on telling people to send slash commands.
 *
 * NO SEPARATE BRAIN. It calls `runAgentTurn` with `source: "TELEGRAM"`, so
 * Telegram gets exactly the tools, ownership checks, daily limit and refusal
 * behaviour the web assistant has. A second implementation would be a second
 * place for authorisation to drift.
 *
 * PENDING CONFIRMATIONS ARE SURFACED AS TEXT, and deliberately phrased as not
 * done. A destructive action proposed over chat must never look completed —
 * that is the whole reason the agent returns them instead of acting.
 */
async function handleConversation(
  profile: Profile,
  text: string,
  now: Date,
): Promise<HandlerResult> {
  try {
    const turn = await runAgentTurn(
      profile,
      { message: text, source: "TELEGRAM" },
      now,
    );

    const confirmations = turn.pendingConfirmations
      .map((pending) => `• ${pending.summary}`)
      .join("\n");

    const reply = confirmations
      ? `${turn.reply}\n\nI have NOT done this yet — reply in the app to confirm:\n${confirmations}`
      : turn.reply;

    return { reply, command: null, wasHandled: true };
  } catch (error) {
    // The agent throws a readable message for the cases that matter: no API
    // key configured, and the daily request limit. Relaying it verbatim beats
    // a generic apology, and beats pretending the question was understood.
    const appError = toAppError(error);

    log.warn("Telegram conversation failed", {
      profileId: profile.id,
      code: appError.code,
    });

    return {
      reply:
        appError.fieldErrors?._form?.join(" ") ??
        "I could not answer that just now. Try again in a moment.",
      command: null,
      wasHandled: false,
    };
  }
}

async function handleLinked(
  profile: Profile,
  link: TelegramLink,
  parsed: ParsedMessage,
  now: Date,
): Promise<HandlerResult> {
  if (parsed.kind === "TEXT") {
    return handleConversation(profile, parsed.text, now);
  }

  if (parsed.kind === "UNKNOWN_COMMAND") {
    return {
      reply: `I don't know /${parsed.raw}. Send /help for the list.`,
      command: `/${parsed.raw}`,
      wasHandled: false,
    };
  }

  // `parsed` is narrowed to COMMAND by the two guards above; TypeScript needs
  // this said explicitly because the guards returned rather than narrowed.
  if (parsed.kind !== "COMMAND") {
    return { reply: "", command: null, wasHandled: false };
  }

  const { command, argument } = parsed;
  const label = `/${command}`;

  switch (command) {
    case "help":
      return {
        reply: helpText(),
        parseMode: "MarkdownV2",
        command: label,
        wasHandled: true,
      };

    case "status": {
      const [tasks, habits] = await Promise.all([
        getTodayView(profile, now),
        listHabits(profile, {}, now),
      ]);

      const dueHabits = habits.filter((habit) => habit.isDueToday);

      return {
        reply: [
          `Today: ${tasks.statistics.dueTodayTotal} due, ${tasks.statistics.completedToday} done`,
          `Overdue: ${tasks.statistics.overdueCount}`,
          `Habits: ${dueHabits.filter((h) => h.todayStatus === "DONE").length}/${dueHabits.length} done`,
        ].join("\n"),
        command: label,
        wasHandled: true,
      };
    }

    case "today": {
      const view = await getTodayView(profile, now);

      if (view.dueToday.length === 0 && view.overdue.length === 0) {
        return {
          reply: "Nothing due today and nothing overdue.",
          command: label,
          wasHandled: true,
        };
      }

      const lines = [`*Today*`];

      for (const task of view.overdue.slice(0, 10)) {
        lines.push(`⚠️ ${escapeMarkdown(task.title)} — overdue`);
      }

      for (const task of view.dueToday.slice(0, 15)) {
        const time = task.dueTimeLabel ? ` ${task.dueTimeLabel}` : "";
        lines.push(
          `${task.isCompleted ? "✅" : "▫️"} ${escapeMarkdown(task.title)}${escapeMarkdown(time)}`,
        );
      }

      return {
        reply: lines.join("\n"),
        parseMode: "MarkdownV2",
        command: label,
        wasHandled: true,
      };
    }

    case "agenda": {
      const todayKey = localDateKey(now, profile.timeZone);
      const view = await getCalendarView(profile, todayKey, "AGENDA", now);

      if (view.totalEntries === 0) {
        return {
          reply: "Nothing scheduled in the next seven days.",
          command: label,
          wasHandled: true,
        };
      }

      const lines = ["*Next seven days*"];

      for (const day of view.days) {
        if (day.entries.length === 0) continue;

        lines.push("", `*${escapeMarkdown(day.weekdayLabel)}*`);

        for (const entry of day.entries.slice(0, 8)) {
          lines.push(
            `• ${escapeMarkdown(entry.timeLabel)} — ${escapeMarkdown(entry.title)}`,
          );
        }
      }

      return {
        reply: lines.join("\n"),
        parseMode: "MarkdownV2",
        command: label,
        wasHandled: true,
      };
    }

    case "tasks": {
      const view = await getTodayView(profile, now);
      const open = [...view.overdue, ...view.dueToday, ...view.upcoming]
        .filter((task) => !task.isCompleted)
        .slice(0, 15);

      if (open.length === 0) {
        return {
          reply: "No open tasks. Capture one with /task <title>.",
          command: label,
          wasHandled: true,
        };
      }

      // Remembered so /done 2 refers to what the user just saw.
      await rememberList(
        link.id,
        "lastTaskIds",
        open.map((task) => task.id),
      );

      const lines = ["*Open tasks*"];

      open.forEach((task, index) => {
        const marker = task.isOverdue ? " ⚠️" : "";
        lines.push(
          `${index + 1}\\. ${escapeMarkdown(task.title)}${escapeMarkdown(marker)}`,
        );
      });

      lines.push("", "Complete one with /done <number>\\.");

      return {
        reply: lines.join("\n"),
        parseMode: "MarkdownV2",
        command: label,
        wasHandled: true,
      };
    }

    case "task": {
      const title = argument.trim();

      if (title.length === 0) {
        return {
          reply: "What should I capture? Try: /task buy milk",
          command: label,
          wasHandled: false,
        };
      }

      // Through the SAME service the web UI uses — validation, ownership and
      // activity logging all apply.
      const task = await createTask(profile.id, profile.timeZone, {
        title,
        priority: "MEDIUM",
        category: "PERSONAL",
        energy: "MEDIUM",
      } as never);

      return {
        reply: `Captured: ${task.title}`,
        command: label,
        wasHandled: true,
      };
    }

    case "done": {
      const index = Number.parseInt(argument.trim(), 10);
      const remembered = link.lastTaskIds;

      if (!Number.isInteger(index) || index < 1 || index > remembered.length) {
        return {
          reply:
            remembered.length === 0
              ? "Send /tasks first, then /done <number>."
              : `Pick a number between 1 and ${remembered.length}.`,
          command: label,
          wasHandled: false,
        };
      }

      const taskId = remembered[index - 1]!;

      // `setTaskCompletion` requires the profileId, so a stale id from another
      // user's list could not be completed even if it leaked into this map.
      await setTaskCompletion(profile.id, taskId, true);

      return { reply: "Done.", command: label, wasHandled: true };
    }

    case "habits": {
      const habits = (await listHabits(profile, {}, now)).filter(
        (habit) => habit.isDueToday,
      );

      if (habits.length === 0) {
        return {
          reply: "No habits scheduled for today.",
          command: label,
          wasHandled: true,
        };
      }

      await rememberList(
        link.id,
        "lastHabitIds",
        habits.map((habit) => habit.id),
      );

      const lines = ["*Today's habits*"];

      habits.forEach((habit, index) => {
        const mark =
          habit.todayStatus === "DONE"
            ? "✅"
            : habit.todayStatus === "MISSED"
              ? "❌"
              : "▫️";

        lines.push(`${index + 1}\\. ${mark} ${escapeMarkdown(habit.name)}`);
      });

      lines.push("", "Mark one done with /check <number>\\.");

      return {
        reply: lines.join("\n"),
        parseMode: "MarkdownV2",
        command: label,
        wasHandled: true,
      };
    }

    case "check": {
      const index = Number.parseInt(argument.trim(), 10);
      const remembered = link.lastHabitIds;

      if (!Number.isInteger(index) || index < 1 || index > remembered.length) {
        return {
          reply:
            remembered.length === 0
              ? "Send /habits first, then /check <number>."
              : `Pick a number between 1 and ${remembered.length}.`,
          command: label,
          wasHandled: false,
        };
      }

      const result = await toggleHabitToday(
        profile.id,
        remembered[index - 1]!,
        localDateKey(now, profile.timeZone),
      );

      return {
        reply: result.isCompleted ? "Marked done." : "Unmarked.",
        command: label,
        wasHandled: true,
      };
    }

    case "remind": {
      const parsedReminder = parseReminderArgument(argument);

      if (!parsedReminder) {
        return {
          reply: "Try: /remind 18:30 call mum",
          command: label,
          wasHandled: false,
        };
      }

      await createReminder(profile.id, profile.timeZone, {
        title: parsedReminder.title,
        remindDate: localDateKey(now, profile.timeZone),
        remindTime: parsedReminder.time,
        recurrence: "NONE",
        weekdays: [],
      } as never);

      return {
        reply: `Reminder set for ${parsedReminder.time} today.`,
        command: label,
        wasHandled: true,
      };
    }

    case "unlink": {
      await unlinkTelegram(profile.id);
      // The remembered lists die with the link.
      await rememberList(link.id, "lastTaskIds", []);
      await rememberList(link.id, "lastHabitIds", []);

      return {
        reply:
          "Unlinked. This chat can no longer see your Life OS data. Link again from Settings whenever you like.",
        command: label,
        wasHandled: true,
      };
    }

    default:
      return {
        reply: "Send /help for the list of commands.",
        command: label,
        wasHandled: false,
      };
  }
}

/**
 * Records a message.
 *
 * Idempotent on `(linkId, telegramMessageId)`: Telegram retries deliveries it
 * believes failed, and a retry must not append a second copy of the same
 * message to the user's history.
 */
export async function recordMessage(input: {
  readonly linkId: string;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly telegramMessageId: string | null;
  readonly text: string;
  readonly command: string | null;
  readonly wasHandled: boolean;
  readonly error?: string;
}): Promise<{ readonly isDuplicate: boolean }> {
  const data = {
    linkId: input.linkId,
    direction: input.direction,
    telegramMessageId: input.telegramMessageId,
    text: truncateForStorage(input.text),
    command: input.command,
    wasHandled: input.wasHandled,
    error: input.error?.slice(0, 200) ?? null,
  };

  if (!input.telegramMessageId) {
    await db.telegramMessage.create({ data });
    return { isDuplicate: false };
  }

  const existing = await db.telegramMessage.findUnique({
    where: {
      linkId_telegramMessageId: {
        linkId: input.linkId,
        telegramMessageId: input.telegramMessageId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return { isDuplicate: true };
  }

  try {
    await db.telegramMessage.create({ data });
    return { isDuplicate: false };
  } catch (error) {
    // Losing the race against the unique index means the message is already
    // recorded, which is exactly the outcome we wanted.
    if ((error as { code?: string }).code === "P2002") {
      return { isDuplicate: true };
    }

    throw error;
  }
}

/** Formats a duration for the bot. Kept here so replies stay consistent. */
export function formatBotDuration(minutes: number): string {
  return formatDuration(minutes);
}

export { localTimeKey };
