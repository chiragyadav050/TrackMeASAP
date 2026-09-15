import { describe, expect, test } from "vitest";

import { instantFromLocalTime } from "@/lib/time";
import {
  daysSinceActivity,
  isMilestoneOverdue,
  isProjectActive,
  milestoneProgress,
  nextMilestone,
  projectHealth,
  projectProgress,
  type DerivableMilestone,
  type HealthInput,
} from "@/services/work/project.derive";

const KOLKATA = "Asia/Kolkata";

/** 2026-09-15, 10:00 in Kolkata. */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, KOLKATA);
const at = (day: number, month = 9) =>
  instantFromLocalTime(2026, month, day, 9 * 60, KOLKATA);

function health(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    status: "ACTIVE",
    targetEndAt: null,
    completedAt: null,
    openBlockerCount: 0,
    taskCounts: { completed: 2, total: 5 },
    overdueTaskCount: 0,
    overdueMilestoneCount: 0,
    ...overrides,
  };
}

function milestone(
  overrides: Partial<DerivableMilestone> = {},
): DerivableMilestone {
  return {
    id: "m1",
    title: "Milestone",
    status: "PENDING",
    dueAt: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("projectProgress", () => {
  test("is completed / total as a percentage", () => {
    expect(projectProgress({ completed: 3, total: 4 })).toBe(75);
    expect(projectProgress({ completed: 0, total: 4 })).toBe(0);
    expect(projectProgress({ completed: 4, total: 4 })).toBe(100);
  });

  test("is null for a project with no tasks", () => {
    // "Not started" is different from "0% done".
    expect(projectProgress({ completed: 0, total: 0 })).toBeNull();
  });

  test("never exceeds 100", () => {
    expect(projectProgress({ completed: 9, total: 4 })).toBe(100);
  });

  test("milestone progress is reported separately", () => {
    expect(milestoneProgress({ completed: 1, total: 3 })).toBeCloseTo(33.33, 1);
    expect(milestoneProgress({ completed: 0, total: 0 })).toBeNull();
  });
});

describe("projectHealth — precedence", () => {
  test("COMPLETED wins over everything", () => {
    expect(
      projectHealth(
        health({
          status: "COMPLETED",
          openBlockerCount: 3,
          targetEndAt: at(1),
          overdueTaskCount: 5,
        }),
        NOW,
        KOLKATA,
      ),
    ).toBe("COMPLETED");
  });

  test("a finished task list reads COMPLETED even while status lags", () => {
    expect(
      projectHealth(
        health({ status: "ACTIVE", taskCounts: { completed: 5, total: 5 } }),
        NOW,
        KOLKATA,
      ),
    ).toBe("COMPLETED");
  });

  test("BLOCKED outranks OVERDUE — the blocker is the thing to act on", () => {
    expect(
      projectHealth(
        health({ openBlockerCount: 1, targetEndAt: at(1) }),
        NOW,
        KOLKATA,
      ),
    ).toBe("BLOCKED");
  });

  test("an unresolved blocker alone is enough", () => {
    expect(projectHealth(health({ openBlockerCount: 1 }), NOW, KOLKATA)).toBe(
      "BLOCKED",
    );
  });

  test("OVERDUE when the target end date has passed", () => {
    expect(projectHealth(health({ targetEndAt: at(10) }), NOW, KOLKATA)).toBe(
      "OVERDUE",
    );
  });

  test("AT_RISK when tasks or milestones are already late", () => {
    expect(projectHealth(health({ overdueTaskCount: 1 }), NOW, KOLKATA)).toBe(
      "AT_RISK",
    );

    expect(
      projectHealth(health({ overdueMilestoneCount: 1 }), NOW, KOLKATA),
    ).toBe("AT_RISK");
  });

  test("AT_RISK when the deadline is close and less than half is done", () => {
    // Due in 3 days, 1 of 5 tasks complete (20%).
    expect(
      projectHealth(
        health({
          targetEndAt: at(18),
          taskCounts: { completed: 1, total: 5 },
        }),
        NOW,
        KOLKATA,
      ),
    ).toBe("AT_RISK");
  });

  test("…but ON_TRACK at the same deadline when most of the work is done", () => {
    expect(
      projectHealth(
        health({
          targetEndAt: at(18),
          taskCounts: { completed: 4, total: 5 },
        }),
        NOW,
        KOLKATA,
      ),
    ).toBe("ON_TRACK");
  });

  test("a distant deadline with little progress is NOT yet at risk", () => {
    expect(
      projectHealth(
        health({
          targetEndAt: at(20, 12),
          taskCounts: { completed: 1, total: 20 },
        }),
        NOW,
        KOLKATA,
      ),
    ).toBe("ON_TRACK");
  });

  test("NOT_STARTED when there are no tasks", () => {
    expect(
      projectHealth(
        health({ taskCounts: { completed: 0, total: 0 } }),
        NOW,
        KOLKATA,
      ),
    ).toBe("NOT_STARTED");
  });

  test("ON_TRACK is the default", () => {
    expect(projectHealth(health(), NOW, KOLKATA)).toBe("ON_TRACK");
  });

  test("health is judged in the user's zone", () => {
    // 18:45Z on the 15th is 00:15 on the 16th in Kolkata — so a target of the
    // 15th has passed locally while it is still the 15th in UTC.
    const target = instantFromLocalTime(2026, 9, 15, 23 * 60, KOLKATA);
    const justAfterLocalMidnight = new Date("2026-09-15T19:00:00.000Z");

    expect(
      projectHealth(
        health({ targetEndAt: target }),
        justAfterLocalMidnight,
        KOLKATA,
      ),
    ).toBe("OVERDUE");
  });
});

describe("nextMilestone", () => {
  test("picks the soonest incomplete milestone", () => {
    const result = nextMilestone([
      milestone({ id: "later", dueAt: at(25) }),
      milestone({ id: "soon", dueAt: at(18) }),
      milestone({ id: "done", dueAt: at(16), status: "COMPLETED" }),
    ]);

    expect(result?.id).toBe("soon");
  });

  test("dated milestones beat undated ones whatever the manual order", () => {
    const result = nextMilestone([
      milestone({ id: "undated", sortOrder: 0 }),
      milestone({ id: "dated", dueAt: at(30), sortOrder: 9000 }),
    ]);

    expect(result?.id).toBe("dated");
  });

  test("falls back to manual order when nothing is dated", () => {
    const result = nextMilestone([
      milestone({ id: "second", sortOrder: 2000 }),
      milestone({ id: "first", sortOrder: 1000 }),
    ]);

    expect(result?.id).toBe("first");
  });

  test("is null when everything is complete, or there is nothing", () => {
    expect(nextMilestone([milestone({ status: "COMPLETED" })])).toBeNull();
    expect(nextMilestone([])).toBeNull();
  });

  test("blocked milestones are still 'next' — they are not done", () => {
    const result = nextMilestone([milestone({ id: "b", status: "BLOCKED" })]);
    expect(result?.id).toBe("b");
  });
});

describe("isMilestoneOverdue", () => {
  test("past due and incomplete", () => {
    expect(isMilestoneOverdue({ status: "PENDING", dueAt: at(10) }, NOW)).toBe(
      true,
    );
  });

  test("completed or undated milestones are never overdue", () => {
    expect(
      isMilestoneOverdue({ status: "COMPLETED", dueAt: at(10) }, NOW),
    ).toBe(false);
    expect(isMilestoneOverdue({ status: "PENDING", dueAt: null }, NOW)).toBe(
      false,
    );
  });
});

describe("isProjectActive", () => {
  test("live statuses count as active", () => {
    for (const status of ["PLANNED", "ACTIVE", "PAUSED", "BLOCKED"]) {
      expect(isProjectActive({ status, archivedAt: null }), status).toBe(true);
    }
  });

  test("finished and archived projects do not", () => {
    for (const status of ["COMPLETED", "CANCELLED", "ARCHIVED"]) {
      expect(isProjectActive({ status, archivedAt: null }), status).toBe(false);
    }

    expect(isProjectActive({ status: "ACTIVE", archivedAt: NOW })).toBe(false);
  });
});

describe("daysSinceActivity", () => {
  test("counts local calendar days", () => {
    expect(daysSinceActivity(at(10), NOW, KOLKATA)).toBe(5);
  });

  test("is null without a last-activity timestamp", () => {
    expect(daysSinceActivity(null, NOW, KOLKATA)).toBeNull();
  });
});
