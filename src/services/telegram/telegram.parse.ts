/**
 * Pure Telegram message parsing.
 *
 * No Prisma, no network, no secrets. Turning a chat message into a structured
 * intent is exactly the kind of fiddly string handling that should be
 * testable with plain strings, and keeping it pure means the webhook never
 * has to be run to check that "/task buy milk" is understood.
 */

export const TELEGRAM_COMMANDS = [
  "start",
  "link",
  "help",
  "today",
  "tasks",
  "task",
  "done",
  "habits",
  "check",
  "agenda",
  "remind",
  "status",
  "unlink",
] as const;

export type TelegramCommand = (typeof TELEGRAM_COMMANDS)[number];

export type ParsedMessage =
  | {
      readonly kind: "COMMAND";
      readonly command: TelegramCommand;
      readonly argument: string;
    }
  | { readonly kind: "UNKNOWN_COMMAND"; readonly raw: string }
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "EMPTY" };

/** Telegram's own cap. Longer input is refused rather than silently cut. */
export const MAX_MESSAGE_LENGTH = 4096;

/** What we store. A bot log must not become an unbounded text store. */
export const MAX_STORED_LENGTH = 500;

/**
 * Parses one incoming message.
 *
 * Handles the `/command@BotName` form Telegram uses in group chats, which is
 * otherwise a silent no-match that makes the bot look broken to anyone who
 * added it to a group.
 */
export function parseMessage(input: string): ParsedMessage {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { kind: "EMPTY" };
  }

  if (!trimmed.startsWith("/")) {
    return { kind: "TEXT", text: trimmed };
  }

  const spaceIndex = trimmed.indexOf(" ");
  const head = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const argument =
    spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

  // `/tasks@LifeOsBot` → `tasks`
  const name = head.slice(1).split("@")[0]!.toLowerCase();

  if ((TELEGRAM_COMMANDS as readonly string[]).includes(name)) {
    return {
      kind: "COMMAND",
      command: name as TelegramCommand,
      argument,
    };
  }

  return { kind: "UNKNOWN_COMMAND", raw: name };
}

/** Truncates for storage, marking the cut so a reader knows it happened. */
export function truncateForStorage(text: string): string {
  if (text.length <= MAX_STORED_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_STORED_LENGTH - 1)}…`;
}

/**
 * Escapes text for Telegram's MarkdownV2.
 *
 * Every one of these characters is special in MarkdownV2, and an unescaped
 * one in USER CONTENT — a task title containing an underscore, say — makes
 * Telegram reject the whole message with a 400. Since task titles are user
 * input, this is also the boundary that stops a crafted title from injecting
 * formatting or a link into the bot's own output.
 */
const MARKDOWN_V2_SPECIALS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIALS, (character) => `\\${character}`);
}

/**
 * Parses a natural-ish reminder request: "/remind 18:30 call mum".
 *
 * Deliberately narrow. A full natural-language date parser would be wrong
 * often enough to be dangerous for reminders, so the bot accepts one explicit
 * form and says so when it does not match, rather than guessing.
 */
export function parseReminderArgument(argument: string): {
  readonly time: string;
  readonly title: string;
} | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)\s+(.+)$/.exec(argument.trim());

  if (!match) {
    return null;
  }

  const [, hours, minutes, title] = match;

  return {
    time: `${hours!.padStart(2, "0")}:${minutes}`,
    title: title!.trim(),
  };
}

/** The help text. Exported so a test can assert every command is documented. */
export function helpText(): string {
  return [
    "*Life OS*",
    "",
    "/today — what is on today",
    "/agenda — the next seven days",
    "/tasks — your open tasks",
    "/task <title> — capture a task",
    "/done <number> — complete a task from the last /tasks list",
    "/habits — today's habits",
    "/check <number> — mark a habit done",
    "/remind HH:MM <what> — set a reminder for today",
    "/status — what Life OS knows right now",
    "/unlink — disconnect this chat",
    "/help — this message",
  ].join("\n");
}
