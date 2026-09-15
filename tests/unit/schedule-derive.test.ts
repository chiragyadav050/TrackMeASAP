import { describe, expect, test } from "vitest";

import { addLocalDays, instantFromLocalTime } from "@/lib/time";
import {
  blocksOverlap,
  buildDedupeKey,
  busyMinutesIn,
  findConflicts,
  findFreeSlots,
  isWithinQuietHours,
  nextAudibleMinute,
  nextOccurrence,
  shouldDeliver,
  type QuietHours,
  type RecurrenceSpec,
  type TimeBlock,
} from "@/services/schedule/schedule.derive";

const KOLKATA = "Asia/Kolkata";

const at = (hour: number, minute = 0, day = 15) =>
  instantFromLocalTime(2026, 9, day, hour * 60 + minute, KOLKATA);

const block = (
  id: string,
  startHour: number,
  endHour: number,
  isBusy = true,
): TimeBlock => ({
  id,
  title: id,
  startAt: at(startHour),
  endAt: at(endHour),
  isBusy,
});

describe("isWithinQuietHours", () => {
  const overnight: QuietHours = {
    isEnabled: true,
    startMinute: 22 * 60,
    endMinute: 7 * 60,
  };

  const daytime: QuietHours = {
    isEnabled: true,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  };

  test("a window that wraps midnight covers both sides of it", () => {
    // The bug this guards: naive `m >= start && m <= end` is false for EVERY
    // minute of 22:00–07:00, which would deliver notifications at 3am.
    expect(isWithinQuietHours(23 * 60, overnight)).toBe(true);
    expect(isWithinQuietHours(3 * 60, overnight)).toBe(true);
    expect(isWithinQuietHours(0, overnight)).toBe(true);
  });

  test("…and excludes the hours outside it", () => {
    expect(isWithinQuietHours(12 * 60, overnight)).toBe(false);
    expect(isWithinQuietHours(21 * 60 + 59, overnight)).toBe(false);
  });

  test("boundaries: start is inside, end is outside", () => {
    expect(isWithinQuietHours(22 * 60, overnight)).toBe(true);
    expect(isWithinQuietHours(7 * 60, overnight)).toBe(false);
  });

  test("a same-day window behaves normally", () => {
    expect(isWithinQuietHours(12 * 60, daytime)).toBe(true);
    expect(isWithinQuietHours(8 * 60, daytime)).toBe(false);
    expect(isWithinQuietHours(18 * 60, daytime)).toBe(false);
  });

  test("disabled quiet hours silence nothing", () => {
    expect(isWithinQuietHours(3 * 60, { ...overnight, isEnabled: false })).toBe(
      false,
    );
  });

  test("an unset window silences nothing", () => {
    expect(
      isWithinQuietHours(3 * 60, {
        isEnabled: true,
        startMinute: null,
        endMinute: null,
      }),
    ).toBe(false);
  });

  test("a zero-length window silences nothing", () => {
    // Otherwise a single mis-set field would mute the app permanently.
    expect(
      isWithinQuietHours(3 * 60, {
        isEnabled: true,
        startMinute: 600,
        endMinute: 600,
      }),
    ).toBe(false);
  });
});

describe("nextAudibleMinute", () => {
  const overnight: QuietHours = {
    isEnabled: true,
    startMinute: 22 * 60,
    endMinute: 7 * 60,
  };

  test("defers to the end of quiet hours rather than dropping", () => {
    expect(nextAudibleMinute(3 * 60, overnight)).toBe(7 * 60);
  });

  test("leaves an audible minute alone", () => {
    expect(nextAudibleMinute(12 * 60, overnight)).toBe(12 * 60);
  });
});

describe("nextOccurrence", () => {
  const helpers = {
    addDays: (date: Date, days: number) => addLocalDays(date, KOLKATA, days),
    addMonths: (date: Date, months: number) => {
      const next = new Date(date.getTime());
      next.setUTCMonth(next.getUTCMonth() + months);
      return next;
    },
    addYears: (date: Date, years: number) => {
      const next = new Date(date.getTime());
      next.setUTCFullYear(next.getUTCFullYear() + years);
      return next;
    },
    weekdayOf: (date: Date) => {
      const day = new Date(date.getTime()).getUTCDay();
      return day === 0 ? 7 : day;
    },
  };

  const spec = (overrides: Partial<RecurrenceSpec> = {}): RecurrenceSpec => ({
    recurrence: "DAILY",
    weekdays: [],
    recurUntil: null,
    ...overrides,
  });

  test("a non-recurring reminder has no next occurrence", () => {
    expect(
      nextOccurrence(at(9), spec({ recurrence: "NONE" }), helpers),
    ).toBeNull();
  });

  test("daily advances one day and keeps the clock time", () => {
    const next = nextOccurrence(at(9, 30), spec(), helpers);

    expect(next).toEqual(at(9, 30, 16));
  });

  test("weekly advances seven days", () => {
    const next = nextOccurrence(at(9), spec({ recurrence: "WEEKLY" }), helpers);

    expect(next).toEqual(at(9, 0, 22));
  });

  test("monthly means the same date next month, not +30 days", () => {
    const next = nextOccurrence(
      at(9),
      spec({ recurrence: "MONTHLY" }),
      helpers,
    );

    expect(next?.getUTCMonth()).toBe(9); // October, zero-indexed
  });

  test("yearly advances a calendar year", () => {
    const next = nextOccurrence(at(9), spec({ recurrence: "YEARLY" }), helpers);

    expect(next?.getUTCFullYear()).toBe(2027);
  });

  test("WEEKDAYS finds the next selected day", () => {
    // The 15th is a Tuesday; asking for Mon/Wed/Fri gives Wednesday the 16th.
    const next = nextOccurrence(
      at(9),
      spec({ recurrence: "WEEKDAYS", weekdays: [1, 3, 5] }),
      helpers,
    );

    expect(next).toEqual(at(9, 0, 16));
  });

  test("WEEKDAYS wraps to next week when only an earlier day is selected", () => {
    // Tuesday, wanting Mondays only → next Monday, the 21st.
    const next = nextOccurrence(
      at(9),
      spec({ recurrence: "WEEKDAYS", weekdays: [1] }),
      helpers,
    );

    expect(next).toEqual(at(9, 0, 21));
  });

  test("WEEKDAYS with no days selected returns null instead of looping", () => {
    expect(
      nextOccurrence(
        at(9),
        spec({ recurrence: "WEEKDAYS", weekdays: [] }),
        helpers,
      ),
    ).toBeNull();
  });

  test("recurrence stops at recurUntil", () => {
    expect(
      nextOccurrence(at(9), spec({ recurUntil: at(23, 0, 15) }), helpers),
    ).toBeNull();

    expect(
      nextOccurrence(at(9), spec({ recurUntil: at(23, 0, 20) }), helpers),
    ).not.toBeNull();
  });
});

describe("blocksOverlap", () => {
  test("overlapping blocks conflict", () => {
    expect(blocksOverlap(block("a", 9, 11), block("b", 10, 12))).toBe(true);
  });

  test("back-to-back blocks do NOT conflict", () => {
    // Half-open intervals. Flagging consecutive meetings would make the
    // warning noise a user learns to ignore.
    expect(blocksOverlap(block("a", 9, 10), block("b", 10, 11))).toBe(false);
  });

  test("a non-busy block never conflicts", () => {
    expect(blocksOverlap(block("a", 9, 11), block("b", 10, 12, false))).toBe(
      false,
    );
  });

  test("a block fully inside another conflicts", () => {
    expect(blocksOverlap(block("a", 9, 17), block("b", 10, 11))).toBe(true);
  });
});

describe("findConflicts", () => {
  test("finds every overlapping pair with the overlap length", () => {
    const conflicts = findConflicts([
      block("a", 9, 11),
      block("b", 10, 12),
      block("c", 14, 15),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlapMinutes).toBe(60);
  });

  test("finds all three pairs when three blocks overlap", () => {
    expect(
      findConflicts([
        block("a", 9, 12),
        block("b", 10, 13),
        block("c", 11, 14),
      ]),
    ).toHaveLength(3);
  });

  test("ignores non-busy blocks", () => {
    expect(
      findConflicts([block("a", 9, 11), block("b", 10, 12, false)]),
    ).toHaveLength(0);
  });

  test("a clear day has no conflicts", () => {
    expect(findConflicts([block("a", 9, 10), block("b", 11, 12)])).toHaveLength(
      0,
    );
    expect(findConflicts([])).toHaveLength(0);
  });
});

describe("findFreeSlots", () => {
  test("finds the gaps between blocks", () => {
    const slots = findFreeSlots(at(9), at(17), [
      block("a", 10, 11),
      block("b", 14, 15),
    ]);

    expect(slots.map((slot) => slot.minutes)).toEqual([60, 180, 120]);
  });

  test("merges overlapping blocks before measuring", () => {
    // Two overlapping meetings are ONE busy period; treating them separately
    // would invent a negative-length gap between them.
    const slots = findFreeSlots(at(9), at(17), [
      block("a", 10, 13),
      block("b", 11, 14),
    ]);

    expect(slots.map((slot) => slot.minutes)).toEqual([60, 180]);
  });

  test("drops slots shorter than the minimum", () => {
    // A seven-minute gap is not usable time; offering it is worse than silence.
    const slots = findFreeSlots(
      at(9),
      at(17),
      [block("a", 9, 10), block("b", 10, 17)],
      15,
    );

    expect(slots).toHaveLength(0);
  });

  test("a completely free window is one slot", () => {
    const slots = findFreeSlots(at(9), at(17), []);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.minutes).toBe(480);
  });

  test("a completely booked window has no slots", () => {
    expect(findFreeSlots(at(9), at(17), [block("a", 9, 17)])).toHaveLength(0);
  });

  test("blocks are clipped to the window", () => {
    const slots = findFreeSlots(at(9), at(17), [block("a", 6, 10)]);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.minutes).toBe(420);
  });

  test("blocks entirely outside the window are ignored", () => {
    const slots = findFreeSlots(at(9), at(17), [block("a", 18, 20)]);

    expect(slots[0]?.minutes).toBe(480);
  });
});

describe("busyMinutesIn", () => {
  test("sums busy time, counting an overlap once", () => {
    expect(
      busyMinutesIn(at(9), at(17), [block("a", 10, 12), block("b", 11, 13)]),
    ).toBe(180);
  });

  test("is zero for an empty day", () => {
    expect(busyMinutesIn(at(9), at(17), [])).toBe(0);
  });
});

describe("buildDedupeKey", () => {
  test("joins the parts that make an alert unique", () => {
    expect(buildDedupeKey(["reminder", "abc123", "2026-09-15"])).toBe(
      "reminder:abc123:2026-09-15",
    );
  });

  test("drops empty parts rather than leaving blanks", () => {
    expect(buildDedupeKey(["task", null, undefined, "", "x"])).toBe("task:x");
  });

  test("is stable across calls — that is the whole point", () => {
    const first = buildDedupeKey(["habit", "h1", "2026-09-15"]);
    const second = buildDedupeKey(["habit", "h1", "2026-09-15"]);

    expect(first).toBe(second);
  });
});

describe("shouldDeliver", () => {
  const quiet: QuietHours = {
    isEnabled: true,
    startMinute: 22 * 60,
    endMinute: 7 * 60,
  };

  const base = {
    isUrgent: false,
    minuteOfDay: 12 * 60,
    quiet,
    sentToday: 0,
    dailyLimit: 20,
  };

  test("allows an ordinary notification in the daytime", () => {
    expect(shouldDeliver(base)).toEqual({ allow: true });
  });

  test("holds a notification during quiet hours", () => {
    expect(shouldDeliver({ ...base, minuteOfDay: 3 * 60 })).toEqual({
      allow: false,
      reason: "QUIET_HOURS",
    });
  });

  test("holds a notification once the daily limit is reached", () => {
    expect(shouldDeliver({ ...base, sentToday: 20 })).toEqual({
      allow: false,
      reason: "DAILY_LIMIT",
    });
  });

  test("urgent bypasses BOTH quiet hours and the limit", () => {
    // An exam starting in ten minutes is exactly what notifications are for.
    expect(
      shouldDeliver({
        ...base,
        isUrgent: true,
        minuteOfDay: 3 * 60,
        sentToday: 999,
      }),
    ).toEqual({ allow: true });
  });

  test("a zero limit means unlimited, not silence", () => {
    expect(shouldDeliver({ ...base, dailyLimit: 0, sentToday: 500 })).toEqual({
      allow: true,
    });
  });
});
