import { describe, expect, test } from "vitest";

import { instantFromLocalTime, localDayDifference } from "@/lib/time";
import {
  assignmentToPriorityItem,
  attendanceToPriorityItem,
  examToPriorityItem,
  rankAcademicItems,
  scoreAcademicItem,
  type AcademicPriorityItem,
} from "@/services/academics/academic.priority";

const KOLKATA = "Asia/Kolkata";
const HELPERS = { localDayDifference };

/** 2026-09-15, 10:00 in Kolkata. */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, KOLKATA);

let sequence = 0;

function item(
  overrides: Partial<AcademicPriorityItem> = {},
): AcademicPriorityItem {
  sequence += 1;

  return {
    id: `item-${sequence}`,
    kind: "ASSIGNMENT",
    title: "Something academic",
    subjectId: "subject-1",
    subjectName: "DBMS",
    dueAt: null,
    isAllDay: false,
    estimatedMinutes: null,
    priority: "MEDIUM",
    preparationPercent: null,
    attendanceRisk: null,
    isOpen: true,
    isOverdue: false,
    ...overrides,
  };
}

const score = (value: AcademicPriorityItem) =>
  scoreAcademicItem(value, NOW, KOLKATA, HELPERS).score;

const reasons = (value: AcademicPriorityItem) =>
  scoreAcademicItem(value, NOW, KOLKATA, HELPERS).reasons;

const at = (day: number, hour = 9) =>
  instantFromLocalTime(2026, 9, day, hour * 60, KOLKATA);

describe("deadline proximity", () => {
  test("overdue outranks everything still to come", () => {
    const overdue = item({ dueAt: at(13), isOverdue: true });
    const dueToday = item({ dueAt: at(15, 18) });

    expect(score(overdue)).toBeGreaterThan(score(dueToday));
    expect(reasons(overdue)).toContain("Overdue");
  });

  test("closer deadlines outrank further ones", () => {
    const today = item({ dueAt: at(15, 18) });
    const tomorrow = item({ dueAt: at(16) });
    const soon = item({ dueAt: at(18) });
    const thisWeek = item({ dueAt: at(21) });
    const later = item({ dueAt: at(30) });

    expect(score(today)).toBeGreaterThan(score(tomorrow));
    expect(score(tomorrow)).toBeGreaterThan(score(soon));
    expect(score(soon)).toBeGreaterThan(score(thisWeek));
    expect(score(thisWeek)).toBeGreaterThan(score(later));
  });

  test("an undated item scores below anything scheduled", () => {
    expect(score(item())).toBeLessThan(score(item({ dueAt: at(30) })));
  });

  test("being further overdue raises the score, but the bonus is capped", () => {
    const oneDay = item({ dueAt: at(14), isOverdue: true });
    const oneWeek = item({ dueAt: at(8), isOverdue: true });
    const ancient = item({
      dueAt: instantFromLocalTime(2025, 1, 1, 9 * 60, KOLKATA),
      isOverdue: true,
    });
    const veryAncient = item({
      dueAt: instantFromLocalTime(2024, 1, 1, 9 * 60, KOLKATA),
      isOverdue: true,
    });

    expect(score(oneWeek)).toBeGreaterThan(score(oneDay));
    // Past the cap, age stops mattering — a forgotten assignment from last
    // year must not permanently outrank this week's real work.
    expect(score(veryAncient)).toBe(score(ancient));
  });
});

describe("assignment priority", () => {
  test("ranks URGENT > HIGH > MEDIUM > LOW, all else equal", () => {
    const urgent = item({ priority: "URGENT" });
    const high = item({ priority: "HIGH" });
    const medium = item({ priority: "MEDIUM" });
    const low = item({ priority: "LOW" });

    expect(score(urgent)).toBeGreaterThan(score(high));
    expect(score(high)).toBeGreaterThan(score(medium));
    expect(score(medium)).toBeGreaterThan(score(low));
  });

  test("proximity still beats priority", () => {
    const lowDueToday = item({ priority: "LOW", dueAt: at(15, 18) });
    const urgentNextMonth = item({ priority: "URGENT", dueAt: at(30) });

    expect(score(lowDueToday)).toBeGreaterThan(score(urgentNextMonth));
  });
});

describe("exam preparation", () => {
  test("exams carry standing weight above ordinary coursework", () => {
    const exam = item({ kind: "EXAM", priority: null, dueAt: at(20) });
    const assignment = item({
      kind: "ASSIGNMENT",
      priority: null,
      dueAt: at(20),
    });

    expect(score(exam)).toBeGreaterThan(score(assignment));
  });

  test("THE BRIEF'S CASE: an exam in 5 days at 20% prepared ranks high", () => {
    const unprepared = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(20),
      preparationPercent: 20,
    });

    const wellPrepared = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(20),
      preparationPercent: 95,
    });

    expect(score(unprepared)).toBeGreaterThan(score(wellPrepared));
    expect(reasons(unprepared)).toContain("20% prepared");
  });

  test("the preparation gap bites harder as the exam approaches", () => {
    const soon = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(17),
      preparationPercent: 10,
    });

    const distant = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(28),
      preparationPercent: 10,
    });

    expect(score(soon)).toBeGreaterThan(score(distant));
  });

  test("an unprepared exam outside the window is not yet urgent", () => {
    // Same preparation, but two months away — it should not dominate today.
    const farOff = item({
      kind: "EXAM",
      priority: null,
      dueAt: instantFromLocalTime(2026, 11, 20, 9 * 60, KOLKATA),
      preparationPercent: 0,
    });

    const dueTomorrow = item({ kind: "ASSIGNMENT", dueAt: at(16) });

    expect(score(dueTomorrow)).toBeGreaterThan(score(farOff));
  });

  test("an untracked exam close by is flagged rather than assumed ready", () => {
    const untracked = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(18),
      preparationPercent: null,
    });

    expect(reasons(untracked)).toContain("Preparation not tracked");
  });

  test("a fully prepared exam gains nothing from the preparation term", () => {
    const ready = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(18),
      preparationPercent: 100,
    });

    const halfReady = item({
      kind: "EXAM",
      priority: null,
      dueAt: at(18),
      preparationPercent: 50,
    });

    expect(score(halfReady)).toBeGreaterThan(score(ready));
  });
});

describe("attendance items", () => {
  test("rank by risk severity", () => {
    const critical = item({ kind: "ATTENDANCE", attendanceRisk: "CRITICAL" });
    const atRisk = item({ kind: "ATTENDANCE", attendanceRisk: "AT_RISK" });
    const watch = item({ kind: "ATTENDANCE", attendanceRisk: "WATCH" });

    expect(score(critical)).toBeGreaterThan(score(atRisk));
    expect(score(atRisk)).toBeGreaterThan(score(watch));
  });

  test("critical attendance outranks an assignment due today", () => {
    // Falling below the requirement can cost a whole semester; one late
    // assignment usually cannot.
    const critical = item({ kind: "ATTENDANCE", attendanceRisk: "CRITICAL" });
    const dueToday = item({ dueAt: at(15, 18), priority: "HIGH" });

    expect(score(critical)).toBeGreaterThan(score(dueToday));
  });

  test("explain themselves", () => {
    expect(
      reasons(item({ kind: "ATTENDANCE", attendanceRisk: "CRITICAL" })),
    ).toContain("Attendance critical");
  });

  test("safe attendance is not surfaced at all", () => {
    const safe = attendanceToPriorityItem({ id: "s1", name: "DBMS" }, "SAFE");

    expect(safe.isOpen).toBe(false);
    expect(score(safe)).toBe(-Infinity);
  });
});

describe("effort", () => {
  test("a quick win gets a small bonus", () => {
    const quick = item({ estimatedMinutes: 15 });
    const unknown = item({ estimatedMinutes: null });

    expect(score(quick)).toBeGreaterThan(score(unknown));
    expect(reasons(quick)).toContain("Quick win");
  });

  test("the quick-win bonus never outweighs a real deadline", () => {
    const quickButDistant = item({ estimatedMinutes: 10, dueAt: at(30) });
    const longButDueToday = item({ estimatedMinutes: 300, dueAt: at(15, 18) });

    expect(score(longButDueToday)).toBeGreaterThan(score(quickButDistant));
  });
});

describe("closed items", () => {
  test("score -Infinity and never appear in a ranking", () => {
    const closed = item({ isOpen: false });

    expect(score(closed)).toBe(-Infinity);
    expect(
      rankAcademicItems([closed, item()], NOW, KOLKATA, HELPERS),
    ).toHaveLength(1);
  });
});

describe("rankAcademicItems", () => {
  test("orders most pressing first", () => {
    const ranked = rankAcademicItems(
      [
        item({ id: "someday", priority: "LOW" }),
        item({ id: "today", dueAt: at(15, 18) }),
        item({ id: "overdue", dueAt: at(12), isOverdue: true }),
      ],
      NOW,
      KOLKATA,
      HELPERS,
    );

    expect(ranked.map((entry) => entry.item.id)).toEqual([
      "overdue",
      "today",
      "someday",
    ]);
  });

  test("is stable and total — input order does not change output", () => {
    const a = item({ id: "aaa", priority: "MEDIUM" });
    const b = item({ id: "bbb", priority: "MEDIUM" });

    const first = rankAcademicItems([a, b], NOW, KOLKATA, HELPERS).map(
      (entry) => entry.item.id,
    );
    const second = rankAcademicItems([b, a], NOW, KOLKATA, HELPERS).map(
      (entry) => entry.item.id,
    );

    expect(first).toEqual(second);
    expect(first).toEqual(["aaa", "bbb"]);
  });

  test("mixes kinds into one coherent order", () => {
    const ranked = rankAcademicItems(
      [
        item({ id: "exam", kind: "EXAM", priority: null, dueAt: at(25) }),
        item({ id: "assignment", dueAt: at(16), priority: "HIGH" }),
        item({
          id: "attendance",
          kind: "ATTENDANCE",
          attendanceRisk: "CRITICAL",
        }),
      ],
      NOW,
      KOLKATA,
      HELPERS,
    );

    expect(ranked[0]?.item.id).toBe("attendance");
    expect(ranked.map((entry) => entry.item.id)).toHaveLength(3);
  });

  test("returns an empty array for no input", () => {
    expect(rankAcademicItems([], NOW, KOLKATA, HELPERS)).toEqual([]);
  });
});

describe("adapters", () => {
  test("assignmentToPriorityItem carries the academic state across", () => {
    const converted = assignmentToPriorityItem(
      {
        id: "a1",
        title: "DBMS report",
        subjectId: "s1",
        priority: "HIGH",
        estimatedMinutes: 120,
        status: "IN_PROGRESS",
        submissionStatus: "NOT_SUBMITTED",
        dueAt: at(14),
        isAllDay: false,
        archivedAt: null,
      },
      "DBMS",
      NOW,
      KOLKATA,
    );

    expect(converted.kind).toBe("ASSIGNMENT");
    expect(converted.subjectName).toBe("DBMS");
    expect(converted.isOpen).toBe(true);
    expect(converted.isOverdue).toBe(true);
  });

  test("a submitted assignment is closed, so it never ranks", () => {
    const converted = assignmentToPriorityItem(
      {
        id: "a2",
        title: "Done and handed in",
        subjectId: "s1",
        priority: "HIGH",
        estimatedMinutes: null,
        status: "COMPLETED",
        submissionStatus: "SUBMITTED",
        dueAt: at(14),
        isAllDay: false,
        archivedAt: null,
      },
      "DBMS",
      NOW,
      KOLKATA,
    );

    expect(converted.isOpen).toBe(false);
  });

  test("examToPriorityItem computes preparation from its topics", () => {
    const converted = examToPriorityItem(
      {
        id: "e1",
        title: "DBMS Midterm",
        subjectId: "s1",
        startAt: at(20),
        status: "UPCOMING",
      },
      [
        { isCompleted: true, importance: "HIGH", confidence: 4 },
        { isCompleted: false, importance: "HIGH", confidence: null },
        { isCompleted: false, importance: "LOW", confidence: null },
        { isCompleted: false, importance: "MEDIUM", confidence: null },
      ],
      "DBMS",
      NOW,
      KOLKATA,
    );

    expect(converted.kind).toBe("EXAM");
    expect(converted.preparationPercent).toBe(25);
    expect(converted.isOpen).toBe(true);
  });

  test("a completed exam is closed", () => {
    const converted = examToPriorityItem(
      {
        id: "e2",
        title: "Done",
        subjectId: "s1",
        startAt: at(10),
        status: "COMPLETED",
      },
      [],
      "DBMS",
      NOW,
      KOLKATA,
    );

    expect(converted.isOpen).toBe(false);
  });
});
