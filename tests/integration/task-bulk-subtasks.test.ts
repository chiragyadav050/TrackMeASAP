import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime, localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import { getTaskDetail } from "@/services/task/task.query";
import {
  bulkUpdateTasks,
  createSubtask,
  createTask,
  deleteSubtask,
  getSubtaskProgress,
  quickCreateTask,
  reorderSubtasks,
  setSubtaskCompletion,
  setTaskCompletion,
  updateSubtask,
} from "@/services/task/task.service";
import {
  cleanupTestData,
  countActivity,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

let profile: Profile;

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

async function seedThree() {
  return Promise.all([
    quickCreateTask(profile.id, TEST_TIME_ZONE, "One"),
    quickCreateTask(profile.id, TEST_TIME_ZONE, "Two"),
    quickCreateTask(profile.id, TEST_TIME_ZONE, "Three"),
  ]);
}

describe("bulkUpdateTasks", () => {
  test("COMPLETE closes every selected task and stamps the time", async () => {
    const tasks = await seedThree();

    const affected = await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "COMPLETE", taskIds: tasks.map((task) => task.id) },
      NOW,
    );

    expect(affected).toBe(3);

    const stored = await db.task.findMany({ where: { profileId: profile.id } });
    expect(stored.every((task) => task.status === "COMPLETED")).toBe(true);
    expect(stored.every((task) => task.completedAt !== null)).toBe(true);
  });

  test("REOPEN clears completedAt so nothing is double-counted", async () => {
    const tasks = await seedThree();
    const ids = tasks.map((task) => task.id);

    await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "COMPLETE", taskIds: ids },
      NOW,
    );
    await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "REOPEN", taskIds: ids },
      NOW,
    );

    const stored = await db.task.findMany({ where: { profileId: profile.id } });
    expect(stored.every((task) => task.status === "TODO")).toBe(true);
    expect(stored.every((task) => task.completedAt === null)).toBe(true);
  });

  test("ARCHIVE stamps archivedAt without completing anything", async () => {
    const tasks = await seedThree();

    await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "ARCHIVE", taskIds: tasks.map((task) => task.id) },
      NOW,
    );

    const stored = await db.task.findMany({ where: { profileId: profile.id } });
    expect(stored.every((task) => task.archivedAt !== null)).toBe(true);
    expect(stored.every((task) => task.status === "TODO")).toBe(true);
  });

  test("SET_PRIORITY applies to the whole selection", async () => {
    const tasks = await seedThree();

    await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      {
        action: "SET_PRIORITY",
        taskIds: tasks.map((task) => task.id),
        priority: "URGENT",
      },
      NOW,
    );

    const stored = await db.task.findMany({ where: { profileId: profile.id } });
    expect(stored.every((task) => task.priority === "URGENT")).toBe(true);
  });

  test("RESCHEDULE resolves the preset in the profile's zone", async () => {
    const tasks = await seedThree();

    await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      {
        action: "RESCHEDULE",
        taskIds: tasks.map((task) => task.id),
        preset: "TOMORROW",
      },
      NOW,
    );

    const stored = await db.task.findMany({ where: { profileId: profile.id } });

    for (const task of stored) {
      expect(task.isAllDay).toBe(true);
      expect(localDateKey(task.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-16");
    }
  });

  test("applies only to the ids submitted, leaving the rest alone", async () => {
    const [first, , third] = await seedThree();

    const affected = await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "COMPLETE", taskIds: [first.id] },
      NOW,
    );

    expect(affected).toBe(1);

    const untouched = await db.task.findUnique({ where: { id: third.id } });
    expect(untouched?.status).toBe("TODO");
  });

  test("writes one activity event per affected task", async () => {
    const tasks = await seedThree();

    await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "COMPLETE", taskIds: tasks.map((task) => task.id) },
      NOW,
    );

    expect(await countActivity(profile.id, "COMPLETED")).toBe(3);
  });

  test("reports zero for ids that do not exist", async () => {
    const affected = await bulkUpdateTasks(
      profile.id,
      TEST_TIME_ZONE,
      { action: "ARCHIVE", taskIds: ["nope-1", "nope-2"] },
      NOW,
    );

    expect(affected).toBe(0);
  });
});

describe("subtasks", () => {
  test("are created in order and reported back in it", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");

    await createSubtask(profile.id, task.id, "Read requirements");
    await createSubtask(profile.id, task.id, "Implement");
    await createSubtask(profile.id, task.id, "Submit");

    const detail = await getTaskDetail(profile, task.id, NOW);

    expect(detail?.subtasks.map((subtask) => subtask.title)).toEqual([
      "Read requirements",
      "Implement",
      "Submit",
    ]);
  });

  test("completion is tracked per subtask and stamped", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");
    const subtask = await createSubtask(profile.id, task.id, "Step");

    const completed = await setSubtaskCompletion(profile.id, subtask.id, true);

    expect(completed.isCompleted).toBe(true);
    expect(completed.completedAt).toBeInstanceOf(Date);

    const reopened = await setSubtaskCompletion(profile.id, subtask.id, false);

    expect(reopened.isCompleted).toBe(false);
    expect(reopened.completedAt).toBeNull();
  });

  test("progress is reported as completed / total", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");

    const created = await Promise.all([
      createSubtask(profile.id, task.id, "A"),
      createSubtask(profile.id, task.id, "B"),
      createSubtask(profile.id, task.id, "C"),
    ]);

    await setSubtaskCompletion(profile.id, created[0].id, true);
    await setSubtaskCompletion(profile.id, created[1].id, true);

    expect(await getSubtaskProgress(profile.id, task.id)).toEqual({
      completed: 2,
      total: 3,
    });

    const detail = await getTaskDetail(profile, task.id, NOW);
    expect(detail?.subtaskCompleted).toBe(2);
    expect(detail?.subtaskTotal).toBe(3);
  });

  test("COMPLETING EVERY SUBTASK DOES NOT COMPLETE THE PARENT", async () => {
    // A deliberate product decision, asserted so a future change to it has to
    // be explicit: the last subtask is often ticked while the parent still
    // needs review or submission. The UI offers a suggestion instead.
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");

    const subtasks = await Promise.all([
      createSubtask(profile.id, task.id, "A"),
      createSubtask(profile.id, task.id, "B"),
    ]);

    for (const subtask of subtasks) {
      await setSubtaskCompletion(profile.id, subtask.id, true);
    }

    const parent = await db.task.findUnique({ where: { id: task.id } });

    expect(parent?.status).toBe("TODO");
    expect(parent?.completedAt).toBeNull();
  });

  test("completing the PARENT leaves subtasks untouched", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");
    const subtask = await createSubtask(profile.id, task.id, "Still open");

    await setTaskCompletion(profile.id, task.id, true);

    const stored = await db.subtask.findUnique({ where: { id: subtask.id } });
    expect(stored?.isCompleted).toBe(false);
  });

  test("renaming and deleting work", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");
    const subtask = await createSubtask(profile.id, task.id, "Typo");

    const renamed = await updateSubtask(profile.id, subtask.id, "Fixed");
    expect(renamed.title).toBe("Fixed");

    await deleteSubtask(profile.id, subtask.id);
    expect(
      await db.subtask.findUnique({ where: { id: subtask.id } }),
    ).toBeNull();
  });

  test("reordering rewrites positions in the submitted order", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");

    const a = await createSubtask(profile.id, task.id, "A");
    const b = await createSubtask(profile.id, task.id, "B");
    const c = await createSubtask(profile.id, task.id, "C");

    await reorderSubtasks(profile.id, task.id, [c.id, a.id, b.id]);

    const detail = await getTaskDetail(profile, task.id, NOW);
    expect(detail?.subtasks.map((subtask) => subtask.title)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  test("reordering rejects an incomplete list rather than partially applying it", async () => {
    const task = await quickCreateTask(profile.id, TEST_TIME_ZONE, "Parent");

    const a = await createSubtask(profile.id, task.id, "A");
    await createSubtask(profile.id, task.id, "B");

    await expect(
      reorderSubtasks(profile.id, task.id, [a.id]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.code === "VALIDATION_FAILED",
    );

    // Order is unchanged.
    const detail = await getTaskDetail(profile, task.id, NOW);
    expect(detail?.subtasks.map((subtask) => subtask.title)).toEqual([
      "A",
      "B",
    ]);
  });

  test("subtask counts appear on the task view model", async () => {
    const task = await createTask(profile.id, TEST_TIME_ZONE, {
      title: "Counted",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    });

    await createSubtask(profile.id, task.id, "One");

    const detail = await getTaskDetail(profile, task.id, NOW);

    expect(detail?.subtaskTotal).toBe(1);
    expect(detail?.subtaskCompleted).toBe(0);
  });
});
