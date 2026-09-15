import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime, localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import {
  createSubtask,
  createTask,
  deleteTask,
  getSubtaskProgress,
  quickCreateTask,
  rescheduleTask,
  resolveDueAt,
  setTaskArchived,
  setTaskCompletion,
  setTaskPriority,
  updateTask,
} from "@/services/task/task.service";
import { getTaskStatistics, listTasks } from "@/services/task/task.query";
import {
  cleanupTestData,
  countActivity,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Task CRUD against a real PostgreSQL database.
 *
 * Everything here exercises the genuine service layer and the genuine
 * migration — enum defaults, cascade deletes and the derived-overdue queries
 * are all properties of the database, and a mocked Prisma would assert none
 * of them.
 */

let profile: Profile;

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const ACTIVE_FILTERS = {
  status: "ACTIVE",
  date: "ANY",
  sort: "SMART",
} as const;

describe("createTask", () => {
  test("persists a task with the supplied fields", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Finish DBMS assignment",
      description: "Chapters 4 and 5",
      priority: "HIGH",
      category: "COLLEGE",
      energy: "HIGH",
      estimatedMinutes: 90,
    });

    const stored = await db.task.findUnique({ where: { id: task.id } });

    expect(stored).not.toBeNull();
    expect(stored?.title).toBe("Finish DBMS assignment");
    expect(stored?.description).toBe("Chapters 4 and 5");
    expect(stored?.priority).toBe("HIGH");
    expect(stored?.category).toBe("COLLEGE");
    expect(stored?.energy).toBe("HIGH");
    expect(stored?.estimatedMinutes).toBe(90);
    expect(stored?.profileId).toBe(profile.id);
    expect(stored?.status).toBe("TODO");
    expect(stored?.completedAt).toBeNull();
    expect(stored?.archivedAt).toBeNull();
  });

  test("applies the schema's enum defaults", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Minimal",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    });

    const stored = await db.task.findUnique({ where: { id: task.id } });

    expect(stored?.priority).toBe("MEDIUM");
    expect(stored?.isAllDay).toBe(false);
    expect(stored?.dueAt).toBeNull();
  });

  test("stores an all-day due date anchored to the user's local midnight", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "All-day task",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: "2026-09-15",
    });

    expect(task.isAllDay).toBe(true);
    // 00:00 IST on the 15th is 18:30Z on the 14th.
    expect(task.dueAt?.toISOString()).toBe("2026-09-14T18:30:00.000Z");
    // …and reads back as the 15th in the user's zone, which is what matters.
    expect(localDateKey(task.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-15");
  });

  test("stores a timed due date converted from the user's zone", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Timed task",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: "2026-09-15",
      dueTime: "17:30",
    });

    expect(task.isAllDay).toBe(false);
    expect(task.dueAt?.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  test("records a CREATED activity event", async () => {
    await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Audited",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    });

    expect(await countActivity(profile.id, "CREATED")).toBe(1);
  });

  test("quick capture creates a usable task from a title alone", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Buy milk");

    expect(task.title).toBe("Buy milk");
    expect(task.status).toBe("TODO");
    expect(task.priority).toBe("MEDIUM");
  });

  test("new tasks are ordered above existing ones", async () => {
    const first = await quickCreateTask(profile.id, TEST_TIME_ZONE, "First");
    const second = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Second");

    expect(second.position).toBeLessThan(first.position);
  });
});

describe("resolveDueAt", () => {
  test("is zone-aware and round-trips through the stored instant", () => {
    const kolkata = resolveDueAt("2026-09-15", "09:00", "Asia/Kolkata");
    const newYork = resolveDueAt("2026-09-15", "09:00", "America/New_York");

    expect(kolkata.dueAt?.toISOString()).toBe("2026-09-15T03:30:00.000Z");
    expect(newYork.dueAt?.toISOString()).toBe("2026-09-15T13:00:00.000Z");
  });

  test("returns no due date when none was given", () => {
    expect(resolveDueAt(undefined, undefined, "UTC")).toEqual({
      dueAt: null,
      isAllDay: false,
    });
  });
});

describe("updateTask", () => {
  test("changes the fields supplied and leaves the rest alone", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Original",
      description: "Keep me",
      priority: "LOW",
      category: "PERSONAL",
      energy: "LOW",
      estimatedMinutes: 30,
    });

    const updated = await updateTask(profile.id, TEST_TIME_ZONE, {
      taskId: task.id,
      title: "Renamed",
      description: "Keep me",
      priority: "URGENT",
    });

    expect(updated.title).toBe("Renamed");
    expect(updated.priority).toBe("URGENT");
    expect(updated.description).toBe("Keep me");
    expect(updated.estimatedMinutes).toBe(30);
    expect(updated.category).toBe("PERSONAL");
  });

  test("clears the due date on request", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Dated",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: "2026-09-15",
    });

    const cleared = await updateTask(profile.id, TEST_TIME_ZONE, {
      taskId: task.id,
      clearDue: true,
    });

    expect(cleared.dueAt).toBeNull();
    expect(cleared.isAllDay).toBe(false);
  });

  test("stamps completedAt when the status becomes COMPLETED", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Via status",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    });

    const completed = await updateTask(profile.id, TEST_TIME_ZONE, {
      taskId: task.id,
      status: "COMPLETED",
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeInstanceOf(Date);
  });
});

describe("setTaskCompletion", () => {
  test("completes a task and stamps the time", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Done soon");

    const completed = await setTaskCompletion(profile.id, task.id, true);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(await countActivity(profile.id, "COMPLETED")).toBe(1);
  });

  test("reopening clears completedAt so it cannot be counted twice", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Reopen me");

    await setTaskCompletion(profile.id, task.id, true);
    const reopened = await setTaskCompletion(profile.id, task.id, false);

    expect(reopened.status).toBe("TODO");
    expect(reopened.completedAt).toBeNull();
    expect(await countActivity(profile.id, "REOPENED")).toBe(1);
  });
});

describe("setTaskPriority", () => {
  test("changes priority and records the change", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Bump me");

    const updated = await setTaskPriority(profile.id, task.id, "URGENT");

    expect(updated.priority).toBe("URGENT");
  });
});

describe("rescheduleTask", () => {
  // A fixed "now" so preset arithmetic is deterministic: Tue 15 Sep 2026,
  // 10:00 in Kolkata.
  const now = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

  test("TODAY moves the task to the user's current local day", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Move me");

    const moved = await rescheduleTask(
      profile.id,
      TEST_TIME_ZONE,
      { taskId: task.id, preset: "TODAY" },
      now,
    );

    expect(moved.isAllDay).toBe(true);
    expect(localDateKey(moved.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-15");
  });

  test("TOMORROW moves it one local day forward", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Tomorrow");

    const moved = await rescheduleTask(
      profile.id,
      TEST_TIME_ZONE,
      { taskId: task.id, preset: "TOMORROW" },
      now,
    );

    expect(localDateKey(moved.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-16");
  });

  test("THIS_WEEKEND lands on the coming Saturday", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Weekend");

    const moved = await rescheduleTask(
      profile.id,
      TEST_TIME_ZONE,
      { taskId: task.id, preset: "THIS_WEEKEND" },
      now,
    );

    // 15 Sep 2026 is a Tuesday; the coming Saturday is the 19th.
    expect(localDateKey(moved.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-19");
  });

  test("NEXT_WEEK lands on the coming Monday", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Next week");

    const moved = await rescheduleTask(
      profile.id,
      TEST_TIME_ZONE,
      { taskId: task.id, preset: "NEXT_WEEK" },
      now,
    );

    expect(localDateKey(moved.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-21");
  });

  test("CLEAR removes the due date", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Undate me",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: "2026-09-15",
    });

    const cleared = await rescheduleTask(
      profile.id,
      TEST_TIME_ZONE,
      { taskId: task.id, preset: "CLEAR" },
      now,
    );

    expect(cleared.dueAt).toBeNull();
  });

  test("a custom date is honoured", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Custom");

    const moved = await rescheduleTask(
      profile.id,
      TEST_TIME_ZONE,
      { taskId: task.id, dueDate: "2026-12-25" },
      now,
    );

    expect(localDateKey(moved.dueAt!, TEST_TIME_ZONE)).toBe("2026-12-25");
    expect(await countActivity(profile.id, "RESCHEDULED")).toBe(1);
  });
});

describe("archiving", () => {
  test("archived tasks leave the active list but remain in the database", async () => {
    const task = await quickCreateTask(
      profile.id,
      TEST_TIME_ZONE,
      "Archive me",
    );

    await setTaskArchived(profile.id, task.id, true);

    const active = await listTasks(profile, ACTIVE_FILTERS);
    expect(active.map((entry) => entry.id)).not.toContain(task.id);

    // Still retrievable — archiving is not deletion.
    expect(await db.task.findUnique({ where: { id: task.id } })).not.toBeNull();

    const archived = await listTasks(profile, {
      ...ACTIVE_FILTERS,
      status: "ARCHIVED",
    });
    expect(archived.map((entry) => entry.id)).toContain(task.id);
  });

  test("archived tasks are excluded from statistics", async () => {
    const kept = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Kept");
    const archived = await quickCreateTask(
      profile.id,
      TEST_TIME_ZONE,
      "Archived",
    );

    await setTaskArchived(profile.id, archived.id, true);

    const stats = await getTaskStatistics(profile);

    expect(stats.activeCount).toBe(1);
    expect(kept.id).toBeTruthy();
  });

  test("unarchiving restores the task to active views", async () => {
    const task = await quickCreateTask(
      profile.id,
      TEST_TIME_ZONE,
      "Round trip",
    );

    await setTaskArchived(profile.id, task.id, true);
    await setTaskArchived(profile.id, task.id, false);

    const active = await listTasks(profile, ACTIVE_FILTERS);
    expect(active.map((entry) => entry.id)).toContain(task.id);
  });
});

describe("deleteTask", () => {
  test("removes the task and cascades to its subtasks", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Doomed");
    await createSubtask(profile.id, task.id, "Child one");
    await createSubtask(profile.id, task.id, "Child two");

    expect(await db.subtask.count({ where: { taskId: task.id } })).toBe(2);

    await deleteTask(profile.id, task.id);

    expect(await db.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await db.subtask.count({ where: { taskId: task.id } })).toBe(0);
  });

  test("the audit trail survives the deleted task", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Audited");

    await deleteTask(profile.id, task.id);

    // An audit trail that vanishes with the evidence is not an audit trail.
    expect(await countActivity(profile.id, "DELETED")).toBe(1);
  });

  test("deleting a non-existent task reports NOT_FOUND", async () => {
    await expect(deleteTask(profile.id, "does-not-exist")).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
    );
  });
});

describe("getSubtaskProgress", () => {
  test("reports completed and total", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");

    await createSubtask(profile.id, task.id, "One");
    const second = await createSubtask(profile.id, task.id, "Two");

    await db.subtask.update({
      where: { id: second.id },
      data: { isCompleted: true, completedAt: new Date() },
    });

    expect(await getSubtaskProgress(profile.id, task.id)).toEqual({
      completed: 1,
      total: 2,
    });
  });
});
