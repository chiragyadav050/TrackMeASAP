import { describe, expect, test } from "vitest";

import { instantFromLocalTime, localDateKey } from "@/lib/time";
import {
  calculatePreparation,
  daysUntil,
  formatStudyDuration,
  isAssignmentOpen,
  isAssignmentOverdue,
  isGraded,
  marksPercentage,
  semesterProgress,
  studyDayCount,
  summarisePreparation,
  totalsBySubject,
  type DerivableAssignment,
  type DerivableTopic,
} from "@/services/academics/academic.derive";

const KOLKATA = "Asia/Kolkata";

/** 2026-09-15, 14:00 in Kolkata. */
const NOW = instantFromLocalTime(2026, 9, 15, 14 * 60, KOLKATA);

function assignment(
  overrides: Partial<DerivableAssignment> = {},
): DerivableAssignment {
  return {
    status: "NOT_STARTED",
    submissionStatus: "NOT_SUBMITTED",
    dueAt: null,
    isAllDay: false,
    archivedAt: null,
    ...overrides,
  };
}

function topic(overrides: Partial<DerivableTopic> = {}): DerivableTopic {
  return {
    isCompleted: false,
    importance: "MEDIUM",
    confidence: null,
    ...overrides,
  };
}

describe("isAssignmentOverdue", () => {
  test("a timed deadline in the past is overdue", () => {
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 15, 9 * 60, KOLKATA),
    });

    expect(isAssignmentOverdue(item, NOW, KOLKATA)).toBe(true);
  });

  test("a timed deadline later today is not", () => {
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 15, 18 * 60, KOLKATA),
    });

    expect(isAssignmentOverdue(item, NOW, KOLKATA)).toBe(false);
  });

  test("an all-day deadline TODAY is not overdue in the afternoon", () => {
    // Identical semantics to Task: "due Friday" means end of Friday.
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 15, 0, KOLKATA),
      isAllDay: true,
    });

    expect(isAssignmentOverdue(item, NOW, KOLKATA)).toBe(false);
  });

  test("an all-day deadline YESTERDAY is overdue", () => {
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 14, 0, KOLKATA),
      isAllDay: true,
    });

    expect(isAssignmentOverdue(item, NOW, KOLKATA)).toBe(true);
  });

  test("SUBMITTING closes it, even while the work says IN_PROGRESS", () => {
    // Handing it in is what the deadline was for. This is the case that
    // conflating "completed" and "submitted" gets wrong.
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 10, 9 * 60, KOLKATA),
      status: "IN_PROGRESS",
      submissionStatus: "SUBMITTED",
    });

    expect(isAssignmentOverdue(item, NOW, KOLKATA)).toBe(false);
  });

  test("LATE and ACCEPTED also close it", () => {
    for (const submissionStatus of ["LATE", "ACCEPTED"]) {
      const item = assignment({
        dueAt: instantFromLocalTime(2026, 9, 10, 9 * 60, KOLKATA),
        submissionStatus,
      });

      expect(isAssignmentOverdue(item, NOW, KOLKATA), submissionStatus).toBe(
        false,
      );
    }
  });

  test("COMPLETED work is not overdue even if unsubmitted", () => {
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 10, 9 * 60, KOLKATA),
      status: "COMPLETED",
    });

    expect(isAssignmentOverdue(item, NOW, KOLKATA)).toBe(false);
  });

  test("cancelled and archived assignments are never overdue", () => {
    const past = instantFromLocalTime(2026, 1, 1, 9 * 60, KOLKATA);

    expect(
      isAssignmentOverdue(
        assignment({ dueAt: past, status: "CANCELLED" }),
        NOW,
        KOLKATA,
      ),
    ).toBe(false);

    expect(
      isAssignmentOverdue(
        assignment({ dueAt: past, archivedAt: new Date() }),
        NOW,
        KOLKATA,
      ),
    ).toBe(false);
  });

  test("an undated assignment is never overdue", () => {
    expect(isAssignmentOverdue(assignment(), NOW, KOLKATA)).toBe(false);
  });

  test("the verdict follows the student's zone", () => {
    // 19:00Z on the 15th is 00:30 on the 16th in Kolkata but still the 15th
    // in UTC, so an all-day deadline of the 15th differs between them.
    const item = assignment({
      dueAt: instantFromLocalTime(2026, 9, 15, 0, KOLKATA),
      isAllDay: true,
    });

    const justAfterLocalMidnight = new Date("2026-09-15T19:00:00.000Z");

    expect(isAssignmentOverdue(item, justAfterLocalMidnight, KOLKATA)).toBe(
      true,
    );
  });
});

describe("isAssignmentOpen", () => {
  test("outstanding work is open", () => {
    expect(isAssignmentOpen(assignment())).toBe(true);
    expect(isAssignmentOpen(assignment({ status: "IN_PROGRESS" }))).toBe(true);
  });

  test("completed-but-unsubmitted is still open", () => {
    // The work is done; handing it in is not.
    expect(isAssignmentOpen(assignment({ status: "COMPLETED" }))).toBe(true);
  });

  test("completed AND submitted is closed", () => {
    expect(
      isAssignmentOpen(
        assignment({ status: "COMPLETED", submissionStatus: "SUBMITTED" }),
      ),
    ).toBe(false);
  });

  test("cancelled and archived are closed", () => {
    expect(isAssignmentOpen(assignment({ status: "CANCELLED" }))).toBe(false);
    expect(isAssignmentOpen(assignment({ archivedAt: new Date() }))).toBe(
      false,
    );
  });
});

describe("marks", () => {
  test("graded means marksObtained is present", () => {
    expect(isGraded({ marksObtained: 0 })).toBe(true);
    expect(isGraded({ marksObtained: 18 })).toBe(true);
    expect(isGraded({ marksObtained: null })).toBe(false);
  });

  test("percentage is computed only when both numbers exist", () => {
    expect(marksPercentage({ marksObtained: 18, maxMarks: 20 })).toBe(90);
    expect(marksPercentage({ marksObtained: null, maxMarks: 20 })).toBeNull();
    expect(marksPercentage({ marksObtained: 18, maxMarks: null })).toBeNull();
  });

  test("a zero maximum yields null rather than dividing by zero", () => {
    expect(marksPercentage({ marksObtained: 0, maxMarks: 0 })).toBeNull();
  });

  test("bonus marks above the maximum are reported honestly, not clamped", () => {
    // Some institutions award bonus marks; silently capping at 100% would
    // hide a real result.
    // `toBeCloseTo`, not `toBe`: the function deliberately does not round, so
    // 22/20 carries IEEE-754 noise. Rounding is a presentation concern.
    expect(marksPercentage({ marksObtained: 22, maxMarks: 20 })).toBeCloseTo(
      110,
      6,
    );
  });
});

describe("calculatePreparation", () => {
  test("the worked example from the brief", () => {
    const topics = [
      ...Array.from({ length: 5 }, () => topic({ isCompleted: true })),
      ...Array.from({ length: 3 }, () => topic()),
    ];

    expect(calculatePreparation(topics)).toBe(62.5);
  });

  test("is null when no topics exist", () => {
    // "Preparation tracking not started" — different from 0% prepared.
    expect(calculatePreparation([])).toBeNull();
  });

  test("covers both extremes", () => {
    expect(calculatePreparation([topic({ isCompleted: true })])).toBe(100);
    expect(calculatePreparation([topic()])).toBe(0);
  });

  test("importance does NOT weight the percentage", () => {
    // A deliberate decision: 1 of 2 must read 50% whichever topic was done,
    // so the figure is verifiable at a glance.
    const highDone = [
      topic({ isCompleted: true, importance: "HIGH" }),
      topic({ importance: "LOW" }),
    ];
    const lowDone = [
      topic({ importance: "HIGH" }),
      topic({ isCompleted: true, importance: "LOW" }),
    ];

    expect(calculatePreparation(highDone)).toBe(50);
    expect(calculatePreparation(lowDone)).toBe(50);
  });
});

describe("summarisePreparation", () => {
  test("reports counts, remaining high-importance topics and mean confidence", () => {
    const summary = summarisePreparation([
      topic({ isCompleted: true, importance: "HIGH", confidence: 4 }),
      topic({ importance: "HIGH", confidence: 2 }),
      topic({ importance: "LOW" }),
      topic({ importance: "HIGH" }),
    ]);

    expect(summary.totalTopics).toBe(4);
    expect(summary.completedTopics).toBe(1);
    expect(summary.percentage).toBe(25);
    expect(summary.remainingHighImportance).toBe(2);
    expect(summary.averageConfidence).toBe(3);
  });

  test("averages only the rated topics, and is null when none are rated", () => {
    expect(
      summarisePreparation([topic(), topic()]).averageConfidence,
    ).toBeNull();
  });

  test("handles an empty topic list", () => {
    const summary = summarisePreparation([]);

    expect(summary.totalTopics).toBe(0);
    expect(summary.percentage).toBeNull();
    expect(summary.remainingHighImportance).toBe(0);
  });
});

describe("daysUntil", () => {
  test("counts local calendar days in both directions", () => {
    expect(
      daysUntil(
        instantFromLocalTime(2026, 9, 20, 9 * 60, KOLKATA),
        NOW,
        KOLKATA,
      ),
    ).toBe(5);

    expect(
      daysUntil(
        instantFromLocalTime(2026, 9, 13, 9 * 60, KOLKATA),
        NOW,
        KOLKATA,
      ),
    ).toBe(-2);

    expect(
      daysUntil(
        instantFromLocalTime(2026, 9, 15, 23 * 60, KOLKATA),
        NOW,
        KOLKATA,
      ),
    ).toBe(0);
  });

  test("is null for an undated exam", () => {
    expect(daysUntil(null, NOW, KOLKATA)).toBeNull();
  });
});

describe("formatStudyDuration", () => {
  test("renders minutes, hours and mixed totals", () => {
    expect(formatStudyDuration(45)).toBe("45m");
    expect(formatStudyDuration(60)).toBe("1h");
    expect(formatStudyDuration(90)).toBe("1h 30m");
    expect(formatStudyDuration(510)).toBe("8h 30m");
  });

  test("renders zero and negative input as 0m rather than an empty string", () => {
    expect(formatStudyDuration(0)).toBe("0m");
    expect(formatStudyDuration(-10)).toBe("0m");
  });
});

describe("totalsBySubject", () => {
  test("sums per subject, highest first", () => {
    const totals = totalsBySubject([
      { subjectId: "dbms", durationMinutes: 60 },
      { subjectId: "os", durationMinutes: 105 },
      { subjectId: "dbms", durationMinutes: 70 },
      { subjectId: "cloud", durationMinutes: 150 },
    ]);

    expect(totals).toEqual([
      { subjectId: "cloud", minutes: 150 },
      { subjectId: "dbms", minutes: 130 },
      { subjectId: "os", minutes: 105 },
    ]);
  });

  test("is deterministic when totals tie", () => {
    const totals = totalsBySubject([
      { subjectId: "bbb", durationMinutes: 30 },
      { subjectId: "aaa", durationMinutes: 30 },
    ]);

    expect(totals.map((entry) => entry.subjectId)).toEqual(["aaa", "bbb"]);
  });

  test("returns nothing for no sessions", () => {
    expect(totalsBySubject([])).toEqual([]);
  });
});

describe("studyDayCount", () => {
  test("counts distinct local days, not sessions", () => {
    const sessions = [
      { startedAt: instantFromLocalTime(2026, 9, 15, 10 * 60, KOLKATA) },
      { startedAt: instantFromLocalTime(2026, 9, 15, 20 * 60, KOLKATA) },
      { startedAt: instantFromLocalTime(2026, 9, 16, 9 * 60, KOLKATA) },
    ];

    expect(studyDayCount(sessions, KOLKATA, localDateKey)).toBe(2);
  });

  test("a late-night session counts toward its own local day", () => {
    // 00:30 IST on the 16th is 19:00Z on the 15th — the same UTC day as an
    // evening session on the 15th, but a different local day.
    const sessions = [
      { startedAt: instantFromLocalTime(2026, 9, 15, 21 * 60, KOLKATA) },
      { startedAt: instantFromLocalTime(2026, 9, 16, 30, KOLKATA) },
    ];

    expect(studyDayCount(sessions, KOLKATA, localDateKey)).toBe(2);
    expect(studyDayCount(sessions, "UTC", localDateKey)).toBe(1);
  });
});

describe("semesterProgress", () => {
  // Date-only values arrive as UTC midnight.
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-05-31T00:00:00.000Z");

  test("is 0 before, 100 after, and proportional between", () => {
    expect(semesterProgress(start, end, new Date("2025-12-01T00:00:00Z"))).toBe(
      0,
    );
    expect(semesterProgress(start, end, new Date("2026-12-01T00:00:00Z"))).toBe(
      100,
    );
    expect(
      semesterProgress(start, end, new Date("2026-03-17T00:00:00Z")),
    ).toBeCloseTo(50, 0);
  });

  test("is null when the range is not a real range", () => {
    expect(semesterProgress(end, start, new Date())).toBeNull();
    expect(semesterProgress(start, start, new Date())).toBeNull();
  });
});
