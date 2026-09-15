import { describe, expect, test } from "vitest";

import {
  addLocalDays,
  endOfLocalDay,
  formatDueDateLabel,
  formatDuration,
  formatOverdueBy,
  instantFromLocalTime,
  isSameLocalDay,
  localDateKey,
  localDayDifference,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";

/**
 * Day boundaries are the foundation of Today, Overdue and Upcoming. A bug
 * here silently mis-files every task, so these tests deliberately use the two
 * cases that break naive implementations:
 *
 *   • Asia/Kolkata — a +05:30 offset, which defeats whole-hour arithmetic
 *   • America/New_York — DST, where a local day is 23 or 25 hours long
 */

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";
const AUCKLAND = "Pacific/Auckland";
const KATHMANDU = "Asia/Kathmandu"; // +05:45

describe("startOfLocalDay", () => {
  test("resolves local midnight for a half-hour offset zone", () => {
    // 2026-03-10T20:00Z is 2026-03-11 01:30 in Kolkata, so that local day
    // began at 2026-03-10T18:30Z.
    const instant = new Date("2026-03-10T20:00:00.000Z");

    expect(startOfLocalDay(instant, KOLKATA).toISOString()).toBe(
      "2026-03-10T18:30:00.000Z",
    );
  });

  test("resolves local midnight for a quarter-hour offset zone", () => {
    // Kathmandu is +05:45.
    const instant = new Date("2026-03-10T20:00:00.000Z");

    expect(startOfLocalDay(instant, KATHMANDU).toISOString()).toBe(
      "2026-03-10T18:15:00.000Z",
    );
  });

  test("is idempotent", () => {
    const instant = new Date("2026-06-15T09:13:47.221Z");
    const once = startOfLocalDay(instant, KOLKATA);

    expect(startOfLocalDay(once, KOLKATA).toISOString()).toBe(
      once.toISOString(),
    );
  });

  test("an instant exactly at local midnight belongs to the day it opens", () => {
    // 18:30Z is exactly 00:00 the following morning in Kolkata (+05:30).
    const midnight = new Date("2026-03-09T18:30:00.000Z");

    expect(localDateKey(midnight, KOLKATA)).toBe("2026-03-10");
    expect(startOfLocalDay(midnight, KOLKATA).toISOString()).toBe(
      midnight.toISOString(),
    );
  });

  test("handles a southern-hemisphere zone ahead of UTC", () => {
    // 2026-06-30T20:00Z is 2026-07-01 08:00 in Auckland (NZST, +12).
    const instant = new Date("2026-06-30T20:00:00.000Z");

    expect(localDateKey(instant, AUCKLAND)).toBe("2026-07-01");
    expect(startOfLocalDay(instant, AUCKLAND).toISOString()).toBe(
      "2026-06-30T12:00:00.000Z",
    );
  });
});

describe("startOfLocalDay across DST", () => {
  test("spring forward — the local day is only 23 hours long", () => {
    // US DST begins 2026-03-08. Local midnight is still EST (-05:00).
    const duringDay = new Date("2026-03-08T18:00:00.000Z"); // 14:00 EDT

    const start = startOfLocalDay(duringDay, NEW_YORK);
    const end = endOfLocalDay(duringDay, NEW_YORK);

    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  test("fall back — the local day is 25 hours long", () => {
    // US DST ends 2026-11-01. Local midnight is still EDT (-04:00).
    const duringDay = new Date("2026-11-01T16:00:00.000Z");

    const start = startOfLocalDay(duringDay, NEW_YORK);
    const end = endOfLocalDay(duringDay, NEW_YORK);

    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});

describe("instantFromLocalTime", () => {
  test("builds the right instant for a half-hour offset", () => {
    // 09:00 on 2026-09-15 in Kolkata is 03:30Z.
    expect(
      instantFromLocalTime(2026, 9, 15, 9 * 60, KOLKATA).toISOString(),
    ).toBe("2026-09-15T03:30:00.000Z");
  });

  test("builds the right instant either side of a DST transition", () => {
    // Before: EST (-05:00). 09:00 local -> 14:00Z.
    expect(
      instantFromLocalTime(2026, 3, 1, 9 * 60, NEW_YORK).toISOString(),
    ).toBe("2026-03-01T14:00:00.000Z");

    // After: EDT (-04:00). 09:00 local -> 13:00Z.
    expect(
      instantFromLocalTime(2026, 3, 15, 9 * 60, NEW_YORK).toISOString(),
    ).toBe("2026-03-15T13:00:00.000Z");
  });

  test("round-trips through localDateKey", () => {
    const instant = instantFromLocalTime(2026, 12, 31, 23 * 60 + 59, KOLKATA);
    expect(localDateKey(instant, KOLKATA)).toBe("2026-12-31");
  });

  test("falls back to UTC for an unknown zone rather than throwing", () => {
    expect(
      instantFromLocalTime(2026, 9, 15, 0, "Not/AZone").toISOString(),
    ).toBe("2026-09-15T00:00:00.000Z");
  });
});

describe("addLocalDays", () => {
  test("keeps the wall clock across a DST transition", () => {
    // 09:00 EST on 2026-03-07, + 1 day, must still read 09:00 (now EDT) —
    // which is a different number of elapsed hours.
    const before = instantFromLocalTime(2026, 3, 7, 9 * 60, NEW_YORK);
    const after = addLocalDays(before, NEW_YORK, 1);

    expect(localDateKey(after, NEW_YORK)).toBe("2026-03-08");
    expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  test("rolls over month and year boundaries", () => {
    const instant = instantFromLocalTime(2026, 12, 31, 12 * 60, KOLKATA);

    expect(localDateKey(addLocalDays(instant, KOLKATA, 1), KOLKATA)).toBe(
      "2027-01-01",
    );
    expect(localDateKey(addLocalDays(instant, KOLKATA, -365), KOLKATA)).toBe(
      "2025-12-31",
    );
  });

  test("moves backwards", () => {
    const instant = new Date("2026-09-15T12:00:00.000Z");
    expect(localDateKey(addLocalDays(instant, KOLKATA, -1), KOLKATA)).toBe(
      "2026-09-14",
    );
  });
});

describe("startOfLocalDayOffset", () => {
  test("gives tomorrow's local midnight", () => {
    const instant = new Date("2026-09-15T20:00:00.000Z"); // 2026-09-16 in IST

    expect(startOfLocalDayOffset(instant, KOLKATA, 1).toISOString()).toBe(
      "2026-09-16T18:30:00.000Z",
    );
  });
});

describe("isSameLocalDay", () => {
  test("distinguishes days that differ only in the user's zone", () => {
    // Both are 2026-09-15 in UTC, but straddle midnight in Kolkata.
    const before = new Date("2026-09-15T18:00:00.000Z"); // 23:30 IST, 15th
    const after = new Date("2026-09-15T19:00:00.000Z"); // 00:30 IST, 16th

    expect(isSameLocalDay(before, after, "UTC")).toBe(true);
    expect(isSameLocalDay(before, after, KOLKATA)).toBe(false);
  });
});

describe("localDayDifference", () => {
  test("counts calendar days, not elapsed 24-hour blocks", () => {
    // 23 hours apart, but two different local days.
    const from = new Date("2026-09-15T18:00:00.000Z"); // 23:30 IST 15th
    const to = new Date("2026-09-16T17:00:00.000Z"); // 22:30 IST 16th

    expect(localDayDifference(from, to, KOLKATA)).toBe(1);
  });

  test("is unaffected by a DST-shortened day", () => {
    const from = instantFromLocalTime(2026, 3, 7, 9 * 60, NEW_YORK);
    const to = instantFromLocalTime(2026, 3, 9, 9 * 60, NEW_YORK);

    expect(localDayDifference(from, to, NEW_YORK)).toBe(2);
  });

  test("is negative when going backwards", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const past = new Date("2026-09-13T12:00:00.000Z");

    expect(localDayDifference(now, past, KOLKATA)).toBe(-2);
  });
});

describe("formatOverdueBy", () => {
  const timeZone = KOLKATA;

  test("returns an empty string when not yet due", () => {
    const due = new Date("2026-09-15T12:00:00.000Z");
    const now = new Date("2026-09-15T11:00:00.000Z");

    expect(formatOverdueBy(due, now, timeZone)).toBe("");
  });

  test("counts whole calendar days once past them", () => {
    const due = instantFromLocalTime(2026, 9, 13, 10 * 60, timeZone);
    const now = instantFromLocalTime(2026, 9, 15, 10 * 60, timeZone);

    expect(formatOverdueBy(due, now, timeZone)).toBe("2 days overdue");
  });

  test("uses the singular for one day", () => {
    const due = instantFromLocalTime(2026, 9, 14, 10 * 60, timeZone);
    const now = instantFromLocalTime(2026, 9, 15, 10 * 60, timeZone);

    expect(formatOverdueBy(due, now, timeZone)).toBe("1 day overdue");
  });

  test("falls back to hours within the same local day", () => {
    const due = instantFromLocalTime(2026, 9, 15, 9 * 60, timeZone);
    const now = instantFromLocalTime(2026, 9, 15, 12 * 60, timeZone);

    expect(formatOverdueBy(due, now, timeZone)).toBe("3 hours overdue");
  });

  test("falls back to minutes, then to a generic phrase", () => {
    const due = new Date("2026-09-15T06:00:00.000Z");

    expect(
      formatOverdueBy(due, new Date("2026-09-15T06:20:00.000Z"), timeZone),
    ).toBe("20 min overdue");

    expect(
      formatOverdueBy(due, new Date("2026-09-15T06:00:30.000Z"), timeZone),
    ).toBe("Just overdue");
  });
});

describe("formatDueDateLabel", () => {
  const timeZone = KOLKATA;
  const now = instantFromLocalTime(2026, 9, 15, 10 * 60, timeZone);

  test("uses relative words for the adjacent days", () => {
    expect(
      formatDueDateLabel(
        instantFromLocalTime(2026, 9, 15, 18 * 60, timeZone),
        now,
        timeZone,
      ),
    ).toBe("Today");

    expect(
      formatDueDateLabel(
        instantFromLocalTime(2026, 9, 16, 9 * 60, timeZone),
        now,
        timeZone,
      ),
    ).toBe("Tomorrow");

    expect(
      formatDueDateLabel(
        instantFromLocalTime(2026, 9, 14, 9 * 60, timeZone),
        now,
        timeZone,
      ),
    ).toBe("Yesterday");
  });

  test("uses a weekday name within the coming week", () => {
    const label = formatDueDateLabel(
      instantFromLocalTime(2026, 9, 18, 9 * 60, timeZone),
      now,
      timeZone,
    );

    expect(label).toMatch(
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/,
    );
  });

  test("uses a date beyond a week, and includes the year only when it differs", () => {
    // Day/month ORDER follows the profile's locale, which is exactly the
    // behaviour we want — nothing here assumes one region's convention.
    expect(
      formatDueDateLabel(
        instantFromLocalTime(2026, 11, 2, 9 * 60, timeZone),
        now,
        timeZone,
        "en-GB",
      ),
    ).toBe("2 Nov");

    expect(
      formatDueDateLabel(
        instantFromLocalTime(2026, 11, 2, 9 * 60, timeZone),
        now,
        timeZone,
        "en-US",
      ),
    ).toBe("Nov 2");

    expect(
      formatDueDateLabel(
        instantFromLocalTime(2027, 1, 5, 9 * 60, timeZone),
        now,
        timeZone,
        "en-GB",
      ),
    ).toBe("5 Jan 2027");
  });

  test("labels a late-evening task as Today, not Tomorrow", () => {
    // 23:30 IST on the 15th is 18:00Z — still the 15th locally.
    const lateTonight = instantFromLocalTime(
      2026,
      9,
      15,
      23 * 60 + 30,
      timeZone,
    );

    expect(formatDueDateLabel(lateTonight, now, timeZone)).toBe("Today");
  });
});

describe("formatDuration", () => {
  test("renders minutes, hours and mixed durations", () => {
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(185)).toBe("3h 5m");
  });
});
