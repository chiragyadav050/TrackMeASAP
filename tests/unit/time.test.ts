import { describe, expect, test } from "vitest";

import {
  DEFAULT_TIME_ZONE,
  formatMinutesAsTime,
  greetingFor,
  isValidTimeZone,
  localDateKey,
  parseMinutesFromTime,
} from "@/lib/time";

describe("isValidTimeZone", () => {
  test("accepts real IANA identifiers", () => {
    for (const zone of [
      "UTC",
      "Asia/Kolkata",
      "America/New_York",
      "Australia/Eucla",
    ]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
  });

  test("rejects unknown or empty identifiers", () => {
    for (const zone of ["", "   ", "Mars/Olympus_Mons", "IST", "GMT+5:30"]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });
});

describe("parseMinutesFromTime", () => {
  test("converts a clock time into minutes since midnight", () => {
    expect(parseMinutesFromTime("00:00")).toBe(0);
    expect(parseMinutesFromTime("09:00")).toBe(540);
    expect(parseMinutesFromTime("19:30")).toBe(1170);
    expect(parseMinutesFromTime("23:59")).toBe(1439);
  });

  test("accepts a single-digit hour", () => {
    expect(parseMinutesFromTime("9:05")).toBe(545);
  });

  test("returns null rather than NaN for invalid input", () => {
    for (const value of ["", "24:00", "12:60", "12", "noon", "12:5", "-1:00"]) {
      expect(parseMinutesFromTime(value)).toBeNull();
    }
  });
});

describe("formatMinutesAsTime", () => {
  test("renders zero-padded 24-hour time", () => {
    expect(formatMinutesAsTime(0)).toBe("00:00");
    expect(formatMinutesAsTime(540)).toBe("09:00");
    expect(formatMinutesAsTime(1439)).toBe("23:59");
  });

  test("clamps values outside a single day", () => {
    expect(formatMinutesAsTime(-30)).toBe("00:00");
    expect(formatMinutesAsTime(5000)).toBe("23:59");
  });

  test("round-trips with parseMinutesFromTime", () => {
    for (const minutes of [0, 1, 359, 540, 1020, 1439]) {
      expect(parseMinutesFromTime(formatMinutesAsTime(minutes))).toBe(minutes);
    }
  });
});

describe("localDateKey", () => {
  // 2026-01-01T20:00Z is already 2026-01-02 in Kolkata (+05:30) but still
  // 2026-01-01 in New York — the exact bug a server-timezone implementation
  // would ship.
  const instant = new Date("2026-01-01T20:00:00.000Z");

  test("resolves the date in the requested zone, not the server's", () => {
    expect(localDateKey(instant, "Asia/Kolkata")).toBe("2026-01-02");
    expect(localDateKey(instant, "America/New_York")).toBe("2026-01-01");
    expect(localDateKey(instant, "UTC")).toBe("2026-01-01");
  });

  test("handles a half-hour offset zone correctly", () => {
    // 18:15Z + 05:30 = 23:45 local, still the same day.
    const beforeMidnight = new Date("2026-03-10T18:15:00.000Z");
    expect(localDateKey(beforeMidnight, "Asia/Kolkata")).toBe("2026-03-10");

    // 18:45Z + 05:30 = 00:15 local, the next day.
    const afterMidnight = new Date("2026-03-10T18:45:00.000Z");
    expect(localDateKey(afterMidnight, "Asia/Kolkata")).toBe("2026-03-11");
  });

  test("always emits ISO ordering", () => {
    expect(localDateKey(instant, "Europe/London")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  test("falls back to UTC for an invalid zone instead of throwing", () => {
    expect(localDateKey(instant, "Not/AZone")).toBe(
      localDateKey(instant, DEFAULT_TIME_ZONE),
    );
  });
});

describe("greetingFor", () => {
  test("picks the greeting from the user's local hour", () => {
    // 04:00Z is 09:30 in Kolkata (morning) and 23:00 the previous day in
    // Los Angeles (evening).
    const instant = new Date("2026-06-01T04:00:00.000Z");

    expect(greetingFor(instant, "Asia/Kolkata")).toBe("Good morning");
    expect(greetingFor(instant, "America/Los_Angeles")).toBe("Good evening");
  });

  test("covers each boundary", () => {
    expect(greetingFor(new Date("2026-06-01T00:00:00Z"), "UTC")).toBe(
      "Good morning",
    );
    expect(greetingFor(new Date("2026-06-01T12:00:00Z"), "UTC")).toBe(
      "Good afternoon",
    );
    expect(greetingFor(new Date("2026-06-01T17:00:00Z"), "UTC")).toBe(
      "Good evening",
    );
  });
});
