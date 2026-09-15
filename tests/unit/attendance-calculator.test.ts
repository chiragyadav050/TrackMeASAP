import { describe, expect, test } from "vitest";

import {
  attendancePercentage,
  attendanceRisk,
  classesCanMiss,
  classesMustAttend,
  eligibleClasses,
  formatPercentage,
  projectPercentage,
  recordedClasses,
  summariseAttendance,
  type AttendanceCounts,
} from "@/services/academics/attendance.calculator";

/**
 * Attendance is the number a student makes real decisions on — whether to
 * skip a lecture, whether they are in trouble. Getting it slightly wrong is
 * worse than not showing it, so every rule and every edge is pinned here.
 */

const counts = (
  present: number,
  absent: number,
  excused = 0,
): AttendanceCounts => ({ present, absent, excused });

describe("eligible and recorded classes", () => {
  test("eligible excludes excused; recorded includes it", () => {
    const value = counts(41, 9, 3);

    expect(eligibleClasses(value)).toBe(50);
    expect(recordedClasses(value)).toBe(53);
  });

  test("both are zero for a subject with no marked classes", () => {
    expect(eligibleClasses(counts(0, 0))).toBe(0);
    expect(recordedClasses(counts(0, 0))).toBe(0);
  });
});

describe("attendancePercentage", () => {
  test("computes present / eligible", () => {
    expect(attendancePercentage(counts(41, 9))).toBe(82);
    expect(attendancePercentage(counts(3, 1))).toBe(75);
  });

  test("EXCUSED classes neither help nor hurt", () => {
    // 8/10 with no excused, and 8/10 with five excused, are the same figure.
    expect(attendancePercentage(counts(8, 2))).toBe(80);
    expect(attendancePercentage(counts(8, 2, 5))).toBe(80);
  });

  test("a subject with only excused classes has no percentage", () => {
    // Not 0%, and not 100% — there is simply nothing to divide by.
    expect(attendancePercentage(counts(0, 0, 4))).toBeNull();
  });

  test("returns null rather than zero when nothing is marked", () => {
    // A new subject has not failed its requirement; it has no data.
    expect(attendancePercentage(counts(0, 0))).toBeNull();
  });

  test("handles the extremes", () => {
    expect(attendancePercentage(counts(10, 0))).toBe(100);
    expect(attendancePercentage(counts(0, 10))).toBe(0);
  });

  test("does not round internally", () => {
    // 2/3 must stay 66.66… so downstream comparisons are exact.
    expect(attendancePercentage(counts(2, 1))).toBeCloseTo(66.666666, 4);
  });
});

describe("formatPercentage", () => {
  test("renders one decimal place", () => {
    expect(formatPercentage(82)).toBe("82%");
    expect(formatPercentage(66.66666)).toBe("66.7%");
    expect(formatPercentage(74.95)).toBe("75%");
  });
});

describe("classesCanMiss", () => {
  test("the worked example from the brief", () => {
    // 41/50 = 82% against a 75% requirement.
    // 41/0.75 = 54.67 → 54 total eligible allowed → 4 more absences.
    expect(classesCanMiss(counts(41, 9), 75)).toBe(4);
  });

  test("the resulting percentage genuinely stays at or above the threshold", () => {
    const value = counts(41, 9);
    const allowed = classesCanMiss(value, 75)!;

    const afterAllowed = projectPercentage(value, 0, allowed)!;
    const afterOneMore = projectPercentage(value, 0, allowed + 1)!;

    expect(afterAllowed).toBeGreaterThanOrEqual(75);
    // …and the very next absence must break it, or the answer was too low.
    expect(afterOneMore).toBeLessThan(75);
  });

  test("is zero when sitting exactly on the threshold", () => {
    // 3/4 = 75%. One more absence drops below, so nothing can be missed.
    expect(classesCanMiss(counts(3, 1), 75)).toBe(0);
  });

  test("is zero when already below the threshold", () => {
    expect(classesCanMiss(counts(5, 5), 75)).toBe(0);
  });

  test("perfect attendance still yields a finite allowance", () => {
    // 10/10 at 75%: 10/0.75 = 13.33 → 13 eligible → 3 misses.
    expect(classesCanMiss(counts(10, 0), 75)).toBe(3);
  });

  test("a 100% requirement allows nothing", () => {
    expect(classesCanMiss(counts(10, 0), 100)).toBe(0);
    expect(classesCanMiss(counts(9, 1), 100)).toBe(0);
  });

  test("returns null with no data, or with no requirement", () => {
    expect(classesCanMiss(counts(0, 0), 75)).toBeNull();
    expect(classesCanMiss(counts(10, 0), 0)).toBeNull();
  });

  test("respects a non-standard threshold", () => {
    // Labs often demand 85%. 17/20 = 85% exactly → no slack.
    expect(classesCanMiss(counts(17, 3), 85)).toBe(0);
    // 18/20 = 90% → 18/0.85 = 21.18 → 21 eligible → 1 spare.
    expect(classesCanMiss(counts(18, 2), 85)).toBe(1);
  });
});

describe("classesMustAttend", () => {
  test("the worked example from the brief", () => {
    // 6/10 = 60% against 75%: (0.75×10 − 6) / 0.25 = 6.
    expect(classesMustAttend(counts(6, 4), 75)).toBe(6);
  });

  test("attending exactly that many genuinely reaches the threshold", () => {
    const value = counts(6, 4);
    const needed = classesMustAttend(value, 75)!;

    expect(projectPercentage(value, needed, 0)!).toBeGreaterThanOrEqual(75);
    // …and one fewer must fall short, or the answer was too high.
    expect(projectPercentage(value, needed - 1, 0)!).toBeLessThan(75);
  });

  test("is zero when the threshold is already met", () => {
    expect(classesMustAttend(counts(41, 9), 75)).toBe(0);
    expect(classesMustAttend(counts(3, 1), 75)).toBe(0);
    expect(classesMustAttend(counts(10, 0), 75)).toBe(0);
  });

  test("returns null when the target can never be recovered", () => {
    // A single absence against a 100% requirement is terminal.
    expect(classesMustAttend(counts(9, 1), 100)).toBeNull();
  });

  test("returns null with no data", () => {
    expect(classesMustAttend(counts(0, 0), 75)).toBeNull();
  });

  test("scales with how far below the line the student is", () => {
    const mild = classesMustAttend(counts(7, 3), 75)!;
    const severe = classesMustAttend(counts(1, 9), 75)!;

    expect(severe).toBeGreaterThan(mild);
  });

  test("handles a zero-present record", () => {
    // 0/5 at 75%: (0.75×5 − 0) / 0.25 = 15.
    expect(classesMustAttend(counts(0, 5), 75)).toBe(15);
  });
});

describe("floating-point boundaries", () => {
  test("45 of 60 is treated as exactly 75%, not 74.999…", () => {
    // The classic case: 45/60 evaluates to 74.99999999999999 in IEEE 754.
    const value = counts(45, 15);

    expect(attendancePercentage(value)).toBeCloseTo(75, 9);
    expect(classesMustAttend(value, 75)).toBe(0);
    expect(summariseAttendance(value, 75).meetsThreshold).toBe(true);
  });

  test("a student one class short is not rounded into safety", () => {
    // 44/60 = 73.3% — genuinely below, and must be reported as such.
    const value = counts(44, 16);

    expect(summariseAttendance(value, 75).meetsThreshold).toBe(false);
    expect(classesMustAttend(value, 75)).toBeGreaterThan(0);
  });
});

describe("projectPercentage", () => {
  test("models attending and missing further classes", () => {
    const value = counts(8, 2);

    expect(projectPercentage(value, 2, 0)).toBeCloseTo(83.33, 1);
    expect(projectPercentage(value, 0, 2)).toBeCloseTo(66.66, 1);
    expect(projectPercentage(value, 5, 5)).toBe(65);
  });

  test("ignores negative input rather than inventing attendance", () => {
    const value = counts(8, 2);

    expect(projectPercentage(value, -5, 0)).toBe(80);
  });

  test("can answer from a standing start", () => {
    expect(projectPercentage(counts(0, 0), 3, 1)).toBe(75);
  });
});

describe("attendanceRisk", () => {
  test("UNKNOWN when nothing has been marked", () => {
    expect(attendanceRisk(counts(0, 0), 75)).toBe("UNKNOWN");
  });

  test("SAFE with real slack above the threshold", () => {
    // 41/50 = 82%, four absences to spare.
    expect(attendanceRisk(counts(41, 9), 75)).toBe("SAFE");
  });

  test("WATCH when at the threshold but one absence from dropping below", () => {
    // 3/4 = 75% exactly: meets it, but zero slack.
    expect(attendanceRisk(counts(3, 1), 75)).toBe("WATCH");
  });

  test("AT_RISK when below but recoverable", () => {
    expect(attendanceRisk(counts(6, 4), 75, 20)).toBe("AT_RISK");
  });

  test("CRITICAL when below and not recoverable in the classes that remain", () => {
    // Needs 6 more; only 2 are left in the semester.
    expect(attendanceRisk(counts(6, 4), 75, 2)).toBe("CRITICAL");
  });

  test("CRITICAL when the threshold is mathematically unreachable", () => {
    expect(attendanceRisk(counts(9, 1), 100)).toBe("CRITICAL");
  });

  test("degrades to AT_RISK, not CRITICAL, when remaining classes are unknown", () => {
    // Without a timetable the system cannot know whether recovery is possible,
    // so it reports the honest lesser claim.
    expect(attendanceRisk(counts(6, 4), 75)).toBe("AT_RISK");
  });

  test("excused classes do not alter the risk band", () => {
    expect(attendanceRisk(counts(41, 9), 75)).toBe(
      attendanceRisk(counts(41, 9, 6), 75),
    );
  });
});

describe("summariseAttendance", () => {
  test("bundles the whole picture consistently", () => {
    const summary = summariseAttendance(counts(41, 9, 2), 75);

    expect(summary.eligible).toBe(50);
    expect(summary.recorded).toBe(52);
    expect(summary.percentage).toBe(82);
    expect(summary.thresholdPercent).toBe(75);
    expect(summary.meetsThreshold).toBe(true);
    expect(summary.canMiss).toBe(4);
    expect(summary.mustAttend).toBe(0);
    expect(summary.risk).toBe("SAFE");
  });

  test("reports an empty subject without inventing figures", () => {
    const summary = summariseAttendance(counts(0, 0), 75);

    expect(summary.percentage).toBeNull();
    expect(summary.canMiss).toBeNull();
    expect(summary.mustAttend).toBeNull();
    expect(summary.meetsThreshold).toBe(false);
    expect(summary.risk).toBe("UNKNOWN");
  });

  test("canMiss and mustAttend are never both positive", () => {
    // They are opposite sides of the same line; having both would be
    // incoherent advice.
    for (const value of [
      counts(41, 9),
      counts(6, 4),
      counts(3, 1),
      counts(0, 5),
      counts(10, 0),
    ]) {
      const summary = summariseAttendance(value, 75);
      const bothPositive =
        (summary.canMiss ?? 0) > 0 && (summary.mustAttend ?? 0) > 0;

      expect(bothPositive, JSON.stringify(value)).toBe(false);
    }
  });
});
