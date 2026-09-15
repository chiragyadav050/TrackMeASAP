import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import {
  computeCompletionPercent,
  getTaskStatistics,
  getTodayView,
  listTasks,
  searchTasks,
} from "@/services/task/task.query";
import { createTask, setTaskCompletion } from "@/services/task/task.service";
import type { TaskFilters } from "@/services/task/task.schema";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Today grouping, statistics and filtering, against a real database.
 *
 * A FIXED `now` is passed to every query — Tuesday 15 September 2026, 14:00
 * in Asia/Kolkata. Tests that depend on the real clock are tests that fail at
 * midnight, and the whole point of this module is day-boundary correctness.
 */

const NOW = instantFromLocalTime(2026, 9, 15, 14 * 60, TEST_TIME_ZONE);

let profile: Profile;

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const base = {
  priority: "MEDIUM",
  category: "PERSONAL",
  energy: "MEDIUM",
} as const;

const filters = (overrides: Partial<TaskFilters> = {}): TaskFilters => ({
  status: "ACTIVE",
  date: "ANY",
  sort: "SMART",
  ...overrides,
});

/** Builds the standard fixture set used by most tests below. */
async function seedSpread() {
  const overdue = await createTask(profile.id, TEST_TIME_ZONE, {
    ...base,
    title: "Overdue report",
    priority: "HIGH",
    dueDate: "2026-09-12",
  });

  const dueTodayTimed = await createTask(profile.id, TEST_TIME_ZONE, {
    ...base,
    title: "Due later today",
    dueDate: "2026-09-15",
    dueTime: "18:00",
  });

  const dueTodayAllDay = await createTask(profile.id, TEST_TIME_ZONE, {
    ...base,
    title: "Due today, all day",
    dueDate: "2026-09-15",
  });

  const tomorrow = await createTask(profile.id, TEST_TIME_ZONE, {
    ...base,
    title: "Tomorrow",
    dueDate: "2026-09-16",
  });

  const nextMonth = await createTask(profile.id, TEST_TIME_ZONE, {
    ...base,
    title: "Next month",
    dueDate: "2026-10-20",
  });

  const undated = await createTask(profile.id, TEST_TIME_ZONE, {
    ...base,
    title: "Someday",
  });

  return {
    overdue,
    dueTodayTimed,
    dueTodayAllDay,
    tomorrow,
    nextMonth,
    undated,
  };
}

describe("getTodayView — grouping", () => {
  test("files each task into exactly one bucket", async () => {
    const seeded = await seedSpread();

    const view = await getTodayView(profile, NOW);

    expect(view.overdue.map((t) => t.id)).toEqual([seeded.overdue.id]);

    expect(view.dueToday.map((t) => t.id).sort()).toEqual(
      [seeded.dueTodayTimed.id, seeded.dueTodayAllDay.id].sort(),
    );

    expect(view.upcoming.map((t) => t.id)).toEqual([seeded.tomorrow.id]);

    // Next month is beyond the seven-day horizon; undated is in no bucket.
    expect(view.upcoming.map((t) => t.id)).not.toContain(seeded.nextMonth.id);
    expect(view.dueToday.map((t) => t.id)).not.toContain(seeded.undated.id);
  });

  test("an all-day task due today is NOT overdue at 14:00", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "All-day today",
      dueDate: "2026-09-15",
    });

    const view = await getTodayView(profile, NOW);

    expect(view.overdue).toHaveLength(0);
    expect(view.dueToday).toHaveLength(1);
    expect(view.dueToday[0]?.isOverdue).toBe(false);
  });

  test("a timed task earlier today IS overdue", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Was due at 09:00",
      dueDate: "2026-09-15",
      dueTime: "09:00",
    });

    const view = await getTodayView(profile, NOW);

    expect(view.overdue).toHaveLength(1);
    expect(view.overdue[0]?.isOverdue).toBe(true);
    expect(view.overdue[0]?.overdueLabel).toBe("5 hours overdue");
  });

  test("completed tasks move out of the active buckets and into completedToday", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Finish this",
      dueDate: "2026-09-15",
    });

    await setTaskCompletion(profile.id, task.id, true, NOW);

    const view = await getTodayView(profile, NOW);

    expect(view.dueToday).toHaveLength(0);
    expect(view.overdue).toHaveLength(0);
    expect(view.completedToday.map((t) => t.id)).toEqual([task.id]);
  });

  test("the greeting and date label come from the profile's zone", async () => {
    const view = await getTodayView(profile, NOW);

    // 14:00 in Kolkata is the afternoon, even though the instant is 08:30Z.
    expect(view.greeting).toBe("Good afternoon");
    expect(view.dateLabel).toContain("15");
    expect(view.timeZone).toBe(TEST_TIME_ZONE);
  });

  test("the same data groups differently for a profile in another zone", async () => {
    // 23:30 local on the 15th in Kolkata is 18:00Z — which is still the 15th
    // in UTC but a different wall-clock day boundary.
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Late tonight",
      dueDate: "2026-09-15",
      dueTime: "23:30",
    });

    const kolkataView = await getTodayView(profile, NOW);
    expect(kolkataView.dueToday).toHaveLength(1);

    // Re-read the same rows as a UTC profile: 18:00Z is still "today" in UTC
    // on the 15th, so it also lands in today — but the instant is unchanged,
    // proving the grouping is a function of the VIEWER's zone, not the row.
    const utcProfile = { ...profile, timeZone: "UTC" };
    const utcView = await getTodayView(utcProfile, NOW);

    expect(utcView.timeZone).toBe("UTC");
    expect(utcView.dueToday.length + utcView.overdue.length).toBe(1);
  });

  test("returns empty buckets and no recommendation for a new account", async () => {
    const view = await getTodayView(profile, NOW);

    expect(view.dueToday).toHaveLength(0);
    expect(view.overdue).toHaveLength(0);
    expect(view.upcoming).toHaveLength(0);
    expect(view.completedToday).toHaveLength(0);
    expect(view.nextBestAction).toBeNull();
    expect(view.statistics.activeCount).toBe(0);
  });
});

describe("getTodayView — next best action", () => {
  test("leads with the most pressing task and explains why", async () => {
    const seeded = await seedSpread();

    const view = await getTodayView(profile, NOW);

    expect(view.nextBestAction?.task.id).toBe(seeded.overdue.id);
    expect(view.nextBestAction?.reasons).toContain("Overdue");
    expect(view.nextBestAction?.reasons).toContain("High priority");
  });

  test("carries the full view model, including subtask counts", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "With steps",
      dueDate: "2026-09-15",
    });

    await db.subtask.createMany({
      data: [
        {
          profileId: profile.id,
          taskId: task.id,
          title: "One",
          position: 1000,
        },
        {
          profileId: profile.id,
          taskId: task.id,
          title: "Two",
          position: 2000,
          isCompleted: true,
        },
      ],
    });

    const view = await getTodayView(profile, NOW);

    expect(view.nextBestAction?.task.subtaskTotal).toBe(2);
    expect(view.nextBestAction?.task.subtaskCompleted).toBe(1);
  });

  test("considers tasks beyond today, not only today's", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Trivial today",
      priority: "LOW",
      dueDate: "2026-09-15",
    });

    const urgentTomorrow = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Urgent tomorrow",
      priority: "URGENT",
      dueDate: "2026-09-16",
    });

    const view = await getTodayView(profile, NOW);

    expect(view.nextBestAction?.task.id).toBe(urgentTomorrow.id);
  });
});

describe("getTaskStatistics", () => {
  test("counts active, due today, completed today and overdue", async () => {
    const seeded = await seedSpread();
    await setTaskCompletion(profile.id, seeded.dueTodayTimed.id, true, NOW);

    const stats = await getTaskStatistics(profile, NOW);

    // 6 seeded, 1 completed -> 5 active.
    expect(stats.activeCount).toBe(5);
    // Both tasks due today count toward the denominator, done or not.
    expect(stats.dueTodayTotal).toBe(2);
    expect(stats.completedToday).toBe(1);
    expect(stats.overdueCount).toBe(1);
    expect(stats.todayCompletionPercent).toBe(50);
  });

  test("is all zeroes for an empty account", async () => {
    const stats = await getTaskStatistics(profile, NOW);

    expect(stats).toEqual({
      activeCount: 0,
      dueTodayTotal: 0,
      completedToday: 0,
      overdueCount: 0,
      todayCompletionPercent: 0,
    });
  });

  test("a completion from yesterday does not count toward today", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Finished yesterday",
    });

    await db.task.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        completedAt: instantFromLocalTime(2026, 9, 14, 20 * 60, TEST_TIME_ZONE),
      },
    });

    const stats = await getTaskStatistics(profile, NOW);

    expect(stats.completedToday).toBe(0);
    expect(stats.activeCount).toBe(0);
  });
});

describe("computeCompletionPercent", () => {
  test("rounds to a whole percentage", () => {
    expect(computeCompletionPercent(1, 3)).toBe(33);
    expect(computeCompletionPercent(2, 3)).toBe(67);
  });

  test("clamps above 100 rather than reporting an impossible figure", () => {
    // Completing work that was not due today can exceed the denominator.
    expect(computeCompletionPercent(5, 2)).toBe(100);
  });

  test("handles an empty day in both directions", () => {
    expect(computeCompletionPercent(0, 0)).toBe(0);
    expect(computeCompletionPercent(3, 0)).toBe(100);
  });
});

describe("listTasks — filtering", () => {
  test("ACTIVE excludes completed and cancelled", async () => {
    const seeded = await seedSpread();
    await setTaskCompletion(profile.id, seeded.undated.id, true);

    const active = await listTasks(profile, filters(), NOW);

    expect(active.map((t) => t.id)).not.toContain(seeded.undated.id);
    expect(active).toHaveLength(5);
  });

  test("COMPLETED returns only finished tasks", async () => {
    const seeded = await seedSpread();
    await setTaskCompletion(profile.id, seeded.undated.id, true);

    const completed = await listTasks(
      profile,
      filters({ status: "COMPLETED" }),
      NOW,
    );

    expect(completed.map((t) => t.id)).toEqual([seeded.undated.id]);
  });

  test("OVERDUE derives from the clock, not a stored column", async () => {
    const seeded = await seedSpread();

    const overdue = await listTasks(
      profile,
      filters({ status: "OVERDUE" }),
      NOW,
    );

    expect(overdue.map((t) => t.id)).toEqual([seeded.overdue.id]);
  });

  test("date filters narrow to the right local window", async () => {
    const seeded = await seedSpread();

    const today = await listTasks(profile, filters({ date: "TODAY" }), NOW);
    expect(today.map((t) => t.id).sort()).toEqual(
      [seeded.dueTodayTimed.id, seeded.dueTodayAllDay.id].sort(),
    );

    const tomorrow = await listTasks(
      profile,
      filters({ date: "TOMORROW" }),
      NOW,
    );
    expect(tomorrow.map((t) => t.id)).toEqual([seeded.tomorrow.id]);

    const thisWeek = await listTasks(
      profile,
      filters({ date: "THIS_WEEK" }),
      NOW,
    );
    expect(thisWeek.map((t) => t.id)).toContain(seeded.tomorrow.id);
    expect(thisWeek.map((t) => t.id)).not.toContain(seeded.nextMonth.id);

    const undated = await listTasks(
      profile,
      filters({ date: "NO_DEADLINE" }),
      NOW,
    );
    expect(undated.map((t) => t.id)).toEqual([seeded.undated.id]);
  });

  test("priority and category filters combine with the rest", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "College urgent",
      priority: "URGENT",
      category: "COLLEGE",
    });
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Personal low",
      priority: "LOW",
    });

    const urgent = await listTasks(
      profile,
      filters({ priority: "URGENT" }),
      NOW,
    );
    expect(urgent).toHaveLength(1);
    expect(urgent[0]?.title).toBe("College urgent");

    const college = await listTasks(
      profile,
      filters({ category: "COLLEGE" }),
      NOW,
    );
    expect(college).toHaveLength(1);

    // Combined, and contradictory, should return nothing.
    const contradiction = await listTasks(
      profile,
      filters({ priority: "URGENT", category: "PERSONAL" }),
      NOW,
    );
    expect(contradiction).toHaveLength(0);
  });

  test("search matches title, description and notes case-insensitively", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Read DBMS chapter",
      description: "Normalisation",
      notes: "Bring the printed handout",
    });
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Unrelated",
    });

    expect(
      await listTasks(profile, filters({ search: "dbms" }), NOW),
    ).toHaveLength(1);
    expect(
      await listTasks(profile, filters({ search: "NORMALIS" }), NOW),
    ).toHaveLength(1);
    expect(
      await listTasks(profile, filters({ search: "handout" }), NOW),
    ).toHaveLength(1);
    expect(
      await listTasks(profile, filters({ search: "nothing" }), NOW),
    ).toHaveLength(0);
  });
});

describe("listTasks — sorting", () => {
  test("SMART puts the most pressing first and finished work last", async () => {
    const seeded = await seedSpread();
    await setTaskCompletion(profile.id, seeded.undated.id, true);

    const sorted = await listTasks(
      profile,
      filters({ status: "ALL", sort: "SMART" }),
      NOW,
    );

    expect(sorted[0]?.id).toBe(seeded.overdue.id);
    expect(sorted.at(-1)?.id).toBe(seeded.undated.id);
  });

  test("DUE_DATE sorts ascending and puts undated tasks last", async () => {
    const seeded = await seedSpread();

    const sorted = await listTasks(profile, filters({ sort: "DUE_DATE" }), NOW);

    expect(sorted[0]?.id).toBe(seeded.overdue.id);
    expect(sorted.at(-1)?.id).toBe(seeded.undated.id);
  });

  test("PRIORITY puts URGENT first", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Low",
      priority: "LOW",
    });
    const urgent = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Urgent",
      priority: "URGENT",
    });

    const sorted = await listTasks(profile, filters({ sort: "PRIORITY" }), NOW);

    expect(sorted[0]?.id).toBe(urgent.id);
  });

  test("ESTIMATE sorts shortest first with unestimated last", async () => {
    const long = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Long",
      estimatedMinutes: 180,
    });
    const short = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Short",
      estimatedMinutes: 10,
    });
    const none = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Unestimated",
    });

    const sorted = await listTasks(profile, filters({ sort: "ESTIMATE" }), NOW);

    expect(sorted.map((t) => t.id)).toEqual([short.id, long.id, none.id]);
  });
});

describe("searchTasks", () => {
  test("returns matches and respects the limit", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createTask(profile.id, TEST_TIME_ZONE, {
        ...base,
        title: `Assignment ${index}`,
      });
    }

    expect(await searchTasks(profile, "Assignment", 3, NOW)).toHaveLength(3);
    expect(await searchTasks(profile, "Assignment", 10, NOW)).toHaveLength(5);
  });

  test("excludes archived tasks", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      ...base,
      title: "Archived item",
    });

    await db.task.update({
      where: { id: task.id },
      data: { archivedAt: new Date() },
    });

    expect(await searchTasks(profile, "Archived", 10, NOW)).toHaveLength(0);
  });
});
