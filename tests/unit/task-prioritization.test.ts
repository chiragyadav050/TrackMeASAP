import { describe, expect, test } from "vitest";

import {
  endOfLocalDay,
  instantFromLocalTime,
  localDayDifference,
} from "@/lib/time";
import {
  rankTasks,
  scoreTask,
  selectNextBestAction,
  type PrioritizableTask,
} from "@/services/task/task.prioritization";

const KOLKATA = "Asia/Kolkata";
const HELPERS = { endOfLocalDay, localDayDifference };

/** 2026-09-15, 10:00 in Kolkata. */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, KOLKATA);

let sequence = 0;

function makeTask(
  overrides: Partial<PrioritizableTask> = {},
): PrioritizableTask {
  sequence += 1;

  return {
    id: `task-${sequence}`,
    status: "TODO",
    priority: "MEDIUM",
    dueAt: null,
    isAllDay: false,
    estimatedMinutes: null,
    completedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

const score = (task: PrioritizableTask) =>
  scoreTask(task, NOW, KOLKATA, HELPERS).score;

describe("scoreTask — urgency dominates", () => {
  test("overdue outranks due today", () => {
    const overdue = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 14, 9 * 60, KOLKATA),
    });
    const dueToday = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 18 * 60, KOLKATA),
    });

    expect(score(overdue)).toBeGreaterThan(score(dueToday));
  });

  test("due today outranks due tomorrow, which outranks later", () => {
    const today = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 18 * 60, KOLKATA),
    });
    const tomorrow = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 16, 9 * 60, KOLKATA),
    });
    const thisWeek = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 19, 9 * 60, KOLKATA),
    });
    const later = makeTask({
      dueAt: instantFromLocalTime(2026, 11, 1, 9 * 60, KOLKATA),
    });

    expect(score(today)).toBeGreaterThan(score(tomorrow));
    expect(score(tomorrow)).toBeGreaterThan(score(thisWeek));
    expect(score(thisWeek)).toBeGreaterThan(score(later));
  });

  test("being further overdue raises the score, but the bonus is capped", () => {
    const oneDay = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 14, 9 * 60, KOLKATA),
    });
    const oneWeek = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 8, 9 * 60, KOLKATA),
    });
    const oneYear = makeTask({
      dueAt: instantFromLocalTime(2025, 9, 15, 9 * 60, KOLKATA),
    });
    const twoYears = makeTask({
      dueAt: instantFromLocalTime(2024, 9, 15, 9 * 60, KOLKATA),
    });

    expect(score(oneWeek)).toBeGreaterThan(score(oneDay));
    // Beyond the cap, age stops mattering — so an ancient forgotten task
    // cannot permanently outrank everything that is actually on fire.
    expect(score(twoYears)).toBe(score(oneYear));
  });

  test("an undated task scores below anything scheduled", () => {
    const undated = makeTask();
    const distant = makeTask({
      dueAt: instantFromLocalTime(2027, 1, 1, 9 * 60, KOLKATA),
    });

    expect(score(undated)).toBeLessThan(score(distant));
  });

  test("an all-day task due today is NOT treated as overdue", () => {
    const allDayToday = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 0, KOLKATA),
      isAllDay: true,
    });

    expect(scoreTask(allDayToday, NOW, KOLKATA, HELPERS).reasons).toContain(
      "Due today",
    );
    expect(scoreTask(allDayToday, NOW, KOLKATA, HELPERS).reasons).not.toContain(
      "Overdue",
    );
  });
});

describe("scoreTask — priority", () => {
  test("ranks URGENT > HIGH > MEDIUM > LOW, all else equal", () => {
    const urgent = makeTask({ priority: "URGENT" });
    const high = makeTask({ priority: "HIGH" });
    const medium = makeTask({ priority: "MEDIUM" });
    const low = makeTask({ priority: "LOW" });

    expect(score(urgent)).toBeGreaterThan(score(high));
    expect(score(high)).toBeGreaterThan(score(medium));
    expect(score(medium)).toBeGreaterThan(score(low));
  });

  test("urgency still beats priority — a LOW overdue task outranks an idle URGENT one", () => {
    const lowButOverdue = makeTask({
      priority: "LOW",
      dueAt: instantFromLocalTime(2026, 9, 13, 9 * 60, KOLKATA),
    });
    const urgentNoDate = makeTask({ priority: "URGENT" });

    expect(score(lowButOverdue)).toBeGreaterThan(score(urgentNoDate));
  });

  test("explains itself for the priorities that matter", () => {
    expect(
      scoreTask(makeTask({ priority: "URGENT" }), NOW, KOLKATA, HELPERS)
        .reasons,
    ).toContain("Urgent priority");

    expect(
      scoreTask(makeTask({ priority: "LOW" }), NOW, KOLKATA, HELPERS).reasons,
    ).toHaveLength(0);
  });
});

describe("scoreTask — status", () => {
  test("in-progress work is favoured over untouched work", () => {
    const started = makeTask({ status: "IN_PROGRESS" });
    const notStarted = makeTask({ status: "TODO" });

    expect(score(started)).toBeGreaterThan(score(notStarted));
    expect(scoreTask(started, NOW, KOLKATA, HELPERS).reasons).toContain(
      "Already started",
    );
  });

  test("blocked work is heavily penalised", () => {
    const blocked = makeTask({ status: "BLOCKED", priority: "URGENT" });
    const ordinary = makeTask({ status: "TODO", priority: "MEDIUM" });

    expect(score(blocked)).toBeLessThan(score(ordinary));
  });

  test("completed, cancelled and archived tasks are unscoreable", () => {
    for (const overrides of [
      { status: "COMPLETED" },
      { status: "CANCELLED" },
      { archivedAt: new Date() },
    ]) {
      expect(score(makeTask(overrides))).toBe(-Infinity);
    }
  });
});

describe("scoreTask — effort", () => {
  test("a quick win gets a small bonus", () => {
    const quick = makeTask({ estimatedMinutes: 10 });
    const unestimated = makeTask({ estimatedMinutes: null });

    expect(score(quick)).toBeGreaterThan(score(unestimated));
    expect(scoreTask(quick, NOW, KOLKATA, HELPERS).reasons).toContain(
      "Quick win",
    );
  });

  test("the quick-win bonus never outweighs real urgency", () => {
    const quickButIdle = makeTask({ estimatedMinutes: 5, priority: "LOW" });
    const longButDueToday = makeTask({
      estimatedMinutes: 240,
      dueAt: instantFromLocalTime(2026, 9, 15, 18 * 60, KOLKATA),
    });

    expect(score(longButDueToday)).toBeGreaterThan(score(quickButIdle));
  });

  test("a very long task is slightly deprioritised for 'right now'", () => {
    const long = makeTask({ estimatedMinutes: 240 });
    const unestimated = makeTask({ estimatedMinutes: null });

    expect(score(long)).toBeLessThan(score(unestimated));
  });
});

describe("rankTasks", () => {
  test("orders most pressing first", () => {
    const overdue = makeTask({
      id: "overdue",
      dueAt: instantFromLocalTime(2026, 9, 12, 9 * 60, KOLKATA),
    });
    const dueToday = makeTask({
      id: "today",
      dueAt: instantFromLocalTime(2026, 9, 15, 17 * 60, KOLKATA),
    });
    const someday = makeTask({ id: "someday", priority: "LOW" });

    const ranked = rankTasks(
      [someday, dueToday, overdue],
      NOW,
      KOLKATA,
      HELPERS,
    );

    expect(ranked.map((entry) => entry.task.id)).toEqual([
      "overdue",
      "today",
      "someday",
    ]);
  });

  test("is stable and total — identical tasks keep a deterministic order", () => {
    const shared = {
      priority: "MEDIUM" as const,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    };

    const a = makeTask({ id: "aaa", ...shared });
    const b = makeTask({ id: "bbb", ...shared });

    const first = rankTasks([a, b], NOW, KOLKATA, HELPERS).map(
      (entry) => entry.task.id,
    );
    const second = rankTasks([b, a], NOW, KOLKATA, HELPERS).map(
      (entry) => entry.task.id,
    );

    // Input order must not change the result, or the list reshuffles on every
    // refresh and reads as a bug.
    expect(first).toEqual(second);
    expect(first).toEqual(["aaa", "bbb"]);
  });

  test("returns an empty array for no input", () => {
    expect(rankTasks([], NOW, KOLKATA, HELPERS)).toEqual([]);
  });
});

describe("selectNextBestAction", () => {
  test("picks the single most pressing task and explains why", () => {
    const winner = makeTask({
      id: "winner",
      priority: "HIGH",
      dueAt: instantFromLocalTime(2026, 9, 14, 9 * 60, KOLKATA),
    });
    const other = makeTask({ id: "other", priority: "LOW" });

    const result = selectNextBestAction([other, winner], NOW, KOLKATA, HELPERS);

    expect(result?.task.id).toBe("winner");
    expect(result?.reasons).toContain("Overdue");
    expect(result?.reasons).toContain("High priority");
  });

  test("never recommends a blocked task", () => {
    const blocked = makeTask({
      id: "blocked",
      status: "BLOCKED",
      priority: "URGENT",
      dueAt: instantFromLocalTime(2026, 9, 10, 9 * 60, KOLKATA),
    });
    const available = makeTask({ id: "available", priority: "LOW" });

    const result = selectNextBestAction(
      [blocked, available],
      NOW,
      KOLKATA,
      HELPERS,
    );

    expect(result?.task.id).toBe("available");
  });

  test("returns null when nothing is actionable", () => {
    expect(selectNextBestAction([], NOW, KOLKATA, HELPERS)).toBeNull();

    expect(
      selectNextBestAction(
        [
          makeTask({ status: "COMPLETED" }),
          makeTask({ archivedAt: new Date() }),
        ],
        NOW,
        KOLKATA,
        HELPERS,
      ),
    ).toBeNull();
  });

  test("returns null when every remaining task is blocked", () => {
    expect(
      selectNextBestAction(
        [makeTask({ status: "BLOCKED" })],
        NOW,
        KOLKATA,
        HELPERS,
      ),
    ).toBeNull();
  });

  test("the recommendation depends on the user's zone, not the server's", () => {
    // Due 2026-09-15 19:00Z. In Kolkata that is 00:30 on the 16th (tomorrow);
    // in UTC it is still today. The same data must rank differently.
    const task = makeTask({
      id: "boundary",
      dueAt: new Date("2026-09-15T19:00:00.000Z"),
    });

    const inKolkata = scoreTask(task, NOW, KOLKATA, HELPERS);
    const inUtc = scoreTask(task, NOW, "UTC", HELPERS);

    expect(inKolkata.reasons).toContain("Due tomorrow");
    expect(inUtc.reasons).toContain("Due today");
  });
});
