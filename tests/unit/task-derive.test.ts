import { describe, expect, test } from "vitest";

import { endOfLocalDay, instantFromLocalTime } from "@/lib/time";
import {
  buildTaskLabels,
  daysUntilDue,
  effectiveDeadline,
  isActive,
  isDueToday,
  isOverdue,
  isTerminal,
  subtaskProgress,
  wasCompletedToday,
  type DerivableTask,
} from "@/services/task/task.derive";

const KOLKATA = "Asia/Kolkata";

function makeTask(overrides: Partial<DerivableTask> = {}): DerivableTask {
  return {
    status: "TODO",
    dueAt: null,
    isAllDay: false,
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** 2026-09-15, 14:00 in Kolkata. */
const NOW = instantFromLocalTime(2026, 9, 15, 14 * 60, KOLKATA);

describe("isTerminal / isActive", () => {
  test("completed and cancelled tasks are terminal", () => {
    expect(isTerminal(makeTask({ status: "COMPLETED" }))).toBe(true);
    expect(isTerminal(makeTask({ status: "CANCELLED" }))).toBe(true);
  });

  test("todo, in-progress and blocked tasks are not terminal", () => {
    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED"]) {
      expect(isTerminal(makeTask({ status }))).toBe(false);
    }
  });

  test("archiving removes a task from active work without completing it", () => {
    const archived = makeTask({ archivedAt: new Date() });

    expect(isTerminal(archived)).toBe(false);
    expect(isActive(archived)).toBe(false);
  });
});

describe("effectiveDeadline", () => {
  test("a timed task is due at its instant", () => {
    const dueAt = instantFromLocalTime(2026, 9, 15, 17 * 60, KOLKATA);
    const task = makeTask({ dueAt, isAllDay: false });

    expect(effectiveDeadline(task, KOLKATA, endOfLocalDay)?.toISOString()).toBe(
      dueAt.toISOString(),
    );
  });

  test("an all-day task is due at the END of its local day", () => {
    // This is the rule that stops "due Friday" reading as overdue at 00:01
    // on Friday.
    const dueAt = instantFromLocalTime(2026, 9, 15, 0, KOLKATA);
    const task = makeTask({ dueAt, isAllDay: true });

    const deadline = effectiveDeadline(task, KOLKATA, endOfLocalDay);

    expect(deadline?.toISOString()).toBe(
      instantFromLocalTime(2026, 9, 16, 0, KOLKATA).toISOString(),
    );
  });

  test("an undated task has no deadline", () => {
    expect(effectiveDeadline(makeTask(), KOLKATA, endOfLocalDay)).toBeNull();
  });
});

describe("isOverdue", () => {
  test("a timed task past its instant is overdue", () => {
    const task = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 9 * 60, KOLKATA),
    });

    expect(isOverdue(task, NOW, KOLKATA, endOfLocalDay)).toBe(true);
  });

  test("a timed task later today is not overdue", () => {
    const task = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 18 * 60, KOLKATA),
    });

    expect(isOverdue(task, NOW, KOLKATA, endOfLocalDay)).toBe(false);
  });

  test("an all-day task due TODAY is not overdue, even in the afternoon", () => {
    const task = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 0, KOLKATA),
      isAllDay: true,
    });

    expect(isOverdue(task, NOW, KOLKATA, endOfLocalDay)).toBe(false);
  });

  test("an all-day task due YESTERDAY is overdue", () => {
    const task = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 14, 0, KOLKATA),
      isAllDay: true,
    });

    expect(isOverdue(task, NOW, KOLKATA, endOfLocalDay)).toBe(true);
  });

  test("completed, cancelled and archived tasks are never overdue", () => {
    const longPast = instantFromLocalTime(2026, 1, 1, 9 * 60, KOLKATA);

    for (const overrides of [
      { status: "COMPLETED" },
      { status: "CANCELLED" },
      { archivedAt: new Date() },
    ]) {
      const task = makeTask({ dueAt: longPast, ...overrides });
      expect(isOverdue(task, NOW, KOLKATA, endOfLocalDay)).toBe(false);
    }
  });

  test("an undated task is never overdue", () => {
    expect(isOverdue(makeTask(), NOW, KOLKATA, endOfLocalDay)).toBe(false);
  });

  test("the same instant is overdue in one zone and not in another", () => {
    // 19:00Z on the 15th = 00:30 on the 16th in Kolkata, but 15:00 on the
    // 15th in New York. A task due 20:00Z is future in both; a task due
    // 18:00Z is past in both. The interesting case is the local DAY flip for
    // an all-day task.
    const allDayFifteenthKolkata = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 0, KOLKATA),
      isAllDay: true,
    });

    const justAfterMidnightKolkata = new Date("2026-09-15T19:00:00.000Z");

    expect(
      isOverdue(
        allDayFifteenthKolkata,
        justAfterMidnightKolkata,
        KOLKATA,
        endOfLocalDay,
      ),
    ).toBe(true);

    // Same instant, but the task is anchored to a UTC day that has not ended.
    const allDayFifteenthUtc = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 0, "UTC"),
      isAllDay: true,
    });

    expect(
      isOverdue(
        allDayFifteenthUtc,
        justAfterMidnightKolkata,
        "UTC",
        endOfLocalDay,
      ),
    ).toBe(false);
  });
});

describe("isDueToday", () => {
  test("matches the user's local day, not UTC's", () => {
    // 23:30 local on the 15th is 18:00Z — still the 15th in Kolkata.
    const lateTonight = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 15, 23 * 60 + 30, KOLKATA),
    });

    expect(isDueToday(lateTonight, NOW, KOLKATA)).toBe(true);
    // The same instant belongs to the 15th in UTC too, but 00:30 on the 16th
    // locally would not — check the flip explicitly.
    const justAfterMidnight = makeTask({
      dueAt: instantFromLocalTime(2026, 9, 16, 30, KOLKATA),
    });

    expect(isDueToday(justAfterMidnight, NOW, KOLKATA)).toBe(false);
  });

  test("excludes completed and archived tasks", () => {
    const dueAt = instantFromLocalTime(2026, 9, 15, 10 * 60, KOLKATA);

    expect(
      isDueToday(makeTask({ dueAt, status: "COMPLETED" }), NOW, KOLKATA),
    ).toBe(false);
    expect(
      isDueToday(makeTask({ dueAt, archivedAt: new Date() }), NOW, KOLKATA),
    ).toBe(false);
  });
});

describe("wasCompletedToday", () => {
  test("counts a completion inside the user's local day", () => {
    const task = makeTask({
      status: "COMPLETED",
      completedAt: instantFromLocalTime(2026, 9, 15, 11 * 60, KOLKATA),
    });

    expect(wasCompletedToday(task, NOW, KOLKATA)).toBe(true);
  });

  test("does not count yesterday's completion", () => {
    const task = makeTask({
      status: "COMPLETED",
      completedAt: instantFromLocalTime(2026, 9, 14, 23 * 60, KOLKATA),
    });

    expect(wasCompletedToday(task, NOW, KOLKATA)).toBe(false);
  });

  test("does not count an archived task", () => {
    const task = makeTask({
      status: "COMPLETED",
      completedAt: NOW,
      archivedAt: NOW,
    });

    expect(wasCompletedToday(task, NOW, KOLKATA)).toBe(false);
  });
});

describe("daysUntilDue", () => {
  test("counts local calendar days in both directions", () => {
    expect(
      daysUntilDue(
        { dueAt: instantFromLocalTime(2026, 9, 17, 9 * 60, KOLKATA) },
        NOW,
        KOLKATA,
      ),
    ).toBe(2);

    expect(
      daysUntilDue(
        { dueAt: instantFromLocalTime(2026, 9, 13, 9 * 60, KOLKATA) },
        NOW,
        KOLKATA,
      ),
    ).toBe(-2);
  });

  test("is null without a due date", () => {
    expect(daysUntilDue({ dueAt: null }, NOW, KOLKATA)).toBeNull();
  });
});

describe("buildTaskLabels", () => {
  test("produces finished, zone-correct strings for the client", () => {
    const labels = buildTaskLabels(
      {
        ...makeTask({
          dueAt: instantFromLocalTime(2026, 9, 15, 17 * 60 + 30, KOLKATA),
        }),
        estimatedMinutes: 90,
      },
      NOW,
      KOLKATA,
      "en-GB",
      endOfLocalDay,
    );

    expect(labels.dueLabel).toBe("Today");
    // en-GB is a 24-hour locale. The clock format follows the profile's
    // locale rather than a hard-coded convention — which is the point.
    expect(labels.dueTimeLabel).toBe("17:30");
    expect(labels.estimateLabel).toBe("1h 30m");
    expect(labels.overdueLabel).toBeNull();
  });

  test("renders the clock in the profile's locale", () => {
    const task = {
      ...makeTask({
        dueAt: instantFromLocalTime(2026, 9, 15, 17 * 60 + 30, KOLKATA),
      }),
      estimatedMinutes: null,
    };

    expect(
      buildTaskLabels(task, NOW, KOLKATA, "en-US", endOfLocalDay).dueTimeLabel,
    ).toBe("5:30 PM");

    expect(
      buildTaskLabels(task, NOW, KOLKATA, "en-GB", endOfLocalDay).dueTimeLabel,
    ).toBe("17:30");
  });

  test("omits a time label for an all-day task", () => {
    const labels = buildTaskLabels(
      {
        ...makeTask({
          dueAt: instantFromLocalTime(2026, 9, 16, 0, KOLKATA),
          isAllDay: true,
        }),
        estimatedMinutes: null,
      },
      NOW,
      KOLKATA,
      "en-GB",
      endOfLocalDay,
    );

    expect(labels.dueLabel).toBe("Tomorrow");
    expect(labels.dueTimeLabel).toBeNull();
    expect(labels.estimateLabel).toBeNull();
  });

  test("reports how late an overdue task is", () => {
    const labels = buildTaskLabels(
      {
        ...makeTask({
          dueAt: instantFromLocalTime(2026, 9, 13, 9 * 60, KOLKATA),
        }),
        estimatedMinutes: null,
      },
      NOW,
      KOLKATA,
      "en-GB",
      endOfLocalDay,
    );

    expect(labels.overdueLabel).toBe("2 days overdue");
  });
});

describe("subtaskProgress", () => {
  test("reports completed, total and a rounded percentage", () => {
    expect(subtaskProgress(3, 5)).toEqual({
      completed: 3,
      total: 5,
      percent: 60,
    });
  });

  test("does not divide by zero for an empty checklist", () => {
    expect(subtaskProgress(0, 0)).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
    });
  });

  test("reaches exactly 100 when everything is done", () => {
    expect(subtaskProgress(4, 4).percent).toBe(100);
  });
});
