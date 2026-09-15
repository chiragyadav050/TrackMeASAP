import { describe, expect, test } from "vitest";

import {
  escapeMarkdown,
  helpText,
  MAX_STORED_LENGTH,
  parseMessage,
  parseReminderArgument,
  TELEGRAM_COMMANDS,
  truncateForStorage,
} from "@/services/telegram/telegram.parse";

describe("parseMessage", () => {
  test("recognises a bare command", () => {
    expect(parseMessage("/today")).toEqual({
      kind: "COMMAND",
      command: "today",
      argument: "",
    });
  });

  test("captures the argument after a command", () => {
    expect(parseMessage("/task buy milk")).toEqual({
      kind: "COMMAND",
      command: "task",
      argument: "buy milk",
    });
  });

  test("handles the /command@BotName form used in groups", () => {
    // Without this the bot silently ignores every message in a group chat and
    // looks broken to whoever added it.
    expect(parseMessage("/tasks@LifeOsBot")).toEqual({
      kind: "COMMAND",
      command: "tasks",
      argument: "",
    });

    expect(parseMessage("/task@LifeOsBot write report")).toEqual({
      kind: "COMMAND",
      command: "task",
      argument: "write report",
    });
  });

  test("is case-insensitive about the command name", () => {
    expect(parseMessage("/TODAY")).toMatchObject({ command: "today" });
  });

  test("collapses surrounding whitespace", () => {
    expect(parseMessage("   /task    buy milk   ")).toEqual({
      kind: "COMMAND",
      command: "task",
      argument: "buy milk",
    });
  });

  test("reports an unknown command rather than guessing", () => {
    expect(parseMessage("/teleport")).toEqual({
      kind: "UNKNOWN_COMMAND",
      raw: "teleport",
    });
  });

  test("plain text is text, not a command", () => {
    expect(parseMessage("what is on today?")).toEqual({
      kind: "TEXT",
      text: "what is on today?",
    });
  });

  test("an empty or whitespace-only message is EMPTY", () => {
    expect(parseMessage("")).toEqual({ kind: "EMPTY" });
    expect(parseMessage("   \n  ")).toEqual({ kind: "EMPTY" });
  });

  test("a lone slash is an unknown command, not a crash", () => {
    expect(parseMessage("/")).toEqual({ kind: "UNKNOWN_COMMAND", raw: "" });
  });

  test("every documented command parses", () => {
    for (const command of TELEGRAM_COMMANDS) {
      expect(parseMessage(`/${command}`), command).toMatchObject({
        kind: "COMMAND",
        command,
      });
    }
  });
});

describe("escapeMarkdown", () => {
  test("escapes every MarkdownV2 special character", () => {
    // An unescaped special in user content makes Telegram reject the whole
    // message with a 400 — so a task called "re_read notes" would break the
    // bot entirely.
    expect(escapeMarkdown("re_read notes")).toBe("re\\_read notes");
    expect(escapeMarkdown("a*b")).toBe("a\\*b");
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\]\\(url\\)");
    expect(escapeMarkdown("3 - 1 = 2")).toBe("3 \\- 1 \\= 2");
  });

  test("neutralises formatting injected through user content", () => {
    // A task title is user input; it must not be able to inject a link or
    // bold text into the bot's own output.
    const injected = "[click me](https://evil.example)";

    expect(escapeMarkdown(injected)).not.toContain("](");
    expect(escapeMarkdown(injected)).toContain("\\[");
  });

  test("escapes backslashes so escaping cannot be escaped", () => {
    expect(escapeMarkdown("a\\b")).toBe("a\\\\b");
  });

  test("leaves ordinary text alone", () => {
    expect(escapeMarkdown("buy milk")).toBe("buy milk");
  });
});

describe("truncateForStorage", () => {
  test("leaves short text untouched", () => {
    expect(truncateForStorage("hello")).toBe("hello");
  });

  test("truncates long text and marks the cut", () => {
    const long = "x".repeat(MAX_STORED_LENGTH + 100);
    const result = truncateForStorage(long);

    expect(result).toHaveLength(MAX_STORED_LENGTH);
    expect(result.endsWith("…")).toBe(true);
  });

  test("text exactly at the limit is not truncated", () => {
    const exact = "x".repeat(MAX_STORED_LENGTH);

    expect(truncateForStorage(exact)).toBe(exact);
  });
});

describe("parseReminderArgument", () => {
  test("accepts HH:MM followed by a title", () => {
    expect(parseReminderArgument("18:30 call mum")).toEqual({
      time: "18:30",
      title: "call mum",
    });
  });

  test("pads a single-digit hour", () => {
    expect(parseReminderArgument("9:05 standup")).toEqual({
      time: "09:05",
      title: "standup",
    });
  });

  test("rejects an impossible time rather than guessing", () => {
    expect(parseReminderArgument("25:00 nope")).toBeNull();
    expect(parseReminderArgument("12:60 nope")).toBeNull();
  });

  test("rejects a time with no title", () => {
    expect(parseReminderArgument("18:30")).toBeNull();
  });

  test("rejects free text rather than guessing a time", () => {
    // A wrong guess here means a reminder that never fires, or fires at 3am.
    expect(parseReminderArgument("tomorrow morning call mum")).toBeNull();
    expect(parseReminderArgument("")).toBeNull();
  });
});

describe("helpText", () => {
  test("documents every command a user can type", () => {
    const text = helpText();

    // /start and /link are part of the linking flow and are documented in the
    // app, not in the in-chat help; everything else must be discoverable.
    const documented = TELEGRAM_COMMANDS.filter(
      (command) => command !== "start" && command !== "link",
    );

    for (const command of documented) {
      expect(text, command).toContain(`/${command}`);
    }
  });
});
