import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile, Task } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { db } from "@/server/db";
import {
  getTaskDetail,
  listTasks,
  searchTasks,
} from "@/services/task/task.query";
import {
  bulkUpdateTasks,
  createSubtask,
  deleteSubtask,
  deleteTask,
  getSubtaskProgress,
  quickCreateTask,
  reorderSubtasks,
  requireOwnedTask,
  rescheduleTask,
  setSubtaskCompletion,
  setTaskArchived,
  setTaskCompletion,
  setTaskPriority,
  updateSubtask,
  updateTask,
} from "@/services/task/task.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * CROSS-TENANT ISOLATION.
 *
 * This is the most important file in Phase 2. Every task operation is invoked
 * with the WRONG profile id and must refuse, and — just as importantly — must
 * leave the victim's data untouched.
 *
 * Two real profiles in a real database; no mocks. A mocked repository would
 * assert only that the mock was called correctly, which is precisely the bug
 * class this is meant to catch.
 *
 * NOT_FOUND rather than FORBIDDEN is asserted deliberately: a 403 would
 * confirm that an id exists and belongs to somebody, turning the API into an
 * id oracle.
 */

let owner: Profile;
let attacker: Profile;
let ownedTask: Task;

const expectNotFound = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toSatisfy(
    (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
  );
};

beforeEach(async () => {
  await cleanupTestData();
  owner = await createTestProfile();
  attacker = await createTestProfile();
  ownedTask = await quickCreateTask(
    owner.id,
    TEST_TIME_ZONE,
    "Owner's private task",
  );
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

describe("reads are scoped to the owner", () => {
  test("listTasks never returns another profile's tasks", async () => {
    await quickCreateTask(attacker.id, TEST_TIME_ZONE, "Attacker's own task");

    const attackerList = await listTasks(attacker, {
      status: "ALL",
      date: "ANY",
      sort: "SMART",
    });

    expect(attackerList.map((task) => task.id)).not.toContain(ownedTask.id);
    expect(attackerList).toHaveLength(1);
  });

  test("getTaskDetail returns null for a task the caller does not own", async () => {
    expect(await getTaskDetail(attacker, ownedTask.id)).toBeNull();
    // …and still works for the legitimate owner.
    expect(await getTaskDetail(owner, ownedTask.id)).not.toBeNull();
  });

  test("search cannot reach another profile's tasks", async () => {
    const results = await searchTasks(attacker, "private", 10);

    expect(results).toHaveLength(0);
    expect(await searchTasks(owner, "private", 10)).toHaveLength(1);
  });

  test("requireOwnedTask refuses a foreign id", async () => {
    await expectNotFound(requireOwnedTask(attacker.id, ownedTask.id));
    await expect(
      requireOwnedTask(owner.id, ownedTask.id),
    ).resolves.toMatchObject({ id: ownedTask.id });
  });
});

describe("mutations refuse a foreign task", () => {
  test("updateTask", async () => {
    await expectNotFound(
      updateTask(attacker.id, TEST_TIME_ZONE, {
        taskId: ownedTask.id,
        title: "Hijacked",
      }),
    );

    const stored = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(stored?.title).toBe("Owner's private task");
  });

  test("setTaskCompletion", async () => {
    await expectNotFound(setTaskCompletion(attacker.id, ownedTask.id, true));

    const stored = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(stored?.status).toBe("TODO");
    expect(stored?.completedAt).toBeNull();
  });

  test("setTaskPriority", async () => {
    await expectNotFound(setTaskPriority(attacker.id, ownedTask.id, "URGENT"));

    const stored = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(stored?.priority).toBe("MEDIUM");
  });

  test("rescheduleTask", async () => {
    await expectNotFound(
      rescheduleTask(attacker.id, TEST_TIME_ZONE, {
        taskId: ownedTask.id,
        preset: "TODAY",
      }),
    );

    const stored = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(stored?.dueAt).toBeNull();
  });

  test("setTaskArchived", async () => {
    await expectNotFound(setTaskArchived(attacker.id, ownedTask.id, true));

    const stored = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(stored?.archivedAt).toBeNull();
  });

  test("deleteTask", async () => {
    await expectNotFound(deleteTask(attacker.id, ownedTask.id));

    // The victim's task must still exist.
    expect(
      await db.task.findUnique({ where: { id: ownedTask.id } }),
    ).not.toBeNull();
  });

  test("getSubtaskProgress", async () => {
    await expectNotFound(getSubtaskProgress(attacker.id, ownedTask.id));
  });
});

describe("subtask operations refuse a foreign parent or subtask", () => {
  test("createSubtask cannot attach to another profile's task", async () => {
    await expectNotFound(
      createSubtask(attacker.id, ownedTask.id, "Injected subtask"),
    );

    expect(await db.subtask.count({ where: { taskId: ownedTask.id } })).toBe(0);
  });

  test("setSubtaskCompletion refuses a foreign subtask", async () => {
    const subtask = await createSubtask(owner.id, ownedTask.id, "Private step");

    await expectNotFound(setSubtaskCompletion(attacker.id, subtask.id, true));

    const stored = await db.subtask.findUnique({ where: { id: subtask.id } });
    expect(stored?.isCompleted).toBe(false);
  });

  test("updateSubtask refuses a foreign subtask", async () => {
    const subtask = await createSubtask(owner.id, ownedTask.id, "Original");

    await expectNotFound(updateSubtask(attacker.id, subtask.id, "Hijacked"));

    const stored = await db.subtask.findUnique({ where: { id: subtask.id } });
    expect(stored?.title).toBe("Original");
  });

  test("deleteSubtask refuses a foreign subtask", async () => {
    const subtask = await createSubtask(owner.id, ownedTask.id, "Keep me");

    await expectNotFound(deleteSubtask(attacker.id, subtask.id));

    expect(
      await db.subtask.findUnique({ where: { id: subtask.id } }),
    ).not.toBeNull();
  });

  test("reorderSubtasks refuses a foreign parent", async () => {
    const subtask = await createSubtask(owner.id, ownedTask.id, "Step");

    await expectNotFound(
      reorderSubtasks(attacker.id, ownedTask.id, [subtask.id]),
    );
  });

  test("reorderSubtasks rejects a list containing a foreign subtask id", async () => {
    const ownTask = await quickCreateTask(
      attacker.id,
      TEST_TIME_ZONE,
      "Attacker's task",
    );
    const ownSubtask = await createSubtask(attacker.id, ownTask.id, "Mine");
    const victimSubtask = await createSubtask(
      owner.id,
      ownedTask.id,
      "Not yours",
    );

    // Owns the parent, but smuggles in someone else's subtask id.
    await expect(
      reorderSubtasks(attacker.id, ownTask.id, [
        ownSubtask.id,
        victimSubtask.id,
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.code === "VALIDATION_FAILED",
    );

    // The victim's subtask keeps its original position.
    const stored = await db.subtask.findUnique({
      where: { id: victimSubtask.id },
    });
    expect(stored?.taskId).toBe(ownedTask.id);
  });
});

describe("bulk operations cannot reach across profiles", () => {
  test("foreign ids are silently ignored, not applied", async () => {
    const attackerTask = await quickCreateTask(
      attacker.id,
      TEST_TIME_ZONE,
      "Attacker's own",
    );

    // Submits both its own id and the victim's.
    const affected = await bulkUpdateTasks(attacker.id, TEST_TIME_ZONE, {
      action: "COMPLETE",
      taskIds: [attackerTask.id, ownedTask.id],
    });

    // Only the one it owns.
    expect(affected).toBe(1);

    const victim = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(victim?.status).toBe("TODO");
    expect(victim?.completedAt).toBeNull();

    const own = await db.task.findUnique({ where: { id: attackerTask.id } });
    expect(own?.status).toBe("COMPLETED");
  });

  test("a bulk archive of only foreign ids affects nothing", async () => {
    const affected = await bulkUpdateTasks(attacker.id, TEST_TIME_ZONE, {
      action: "ARCHIVE",
      taskIds: [ownedTask.id],
    });

    expect(affected).toBe(0);

    const victim = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(victim?.archivedAt).toBeNull();
  });

  test("a bulk priority change cannot touch another profile's task", async () => {
    await bulkUpdateTasks(attacker.id, TEST_TIME_ZONE, {
      action: "SET_PRIORITY",
      taskIds: [ownedTask.id],
      priority: "URGENT",
    });

    const victim = await db.task.findUnique({ where: { id: ownedTask.id } });
    expect(victim?.priority).toBe("MEDIUM");
  });

  test("no activity is logged for tasks that were never touched", async () => {
    await bulkUpdateTasks(attacker.id, TEST_TIME_ZONE, {
      action: "COMPLETE",
      taskIds: [ownedTask.id],
    });

    const attackerEvents = await db.activityEvent.count({
      where: { profileId: attacker.id, entityId: ownedTask.id },
    });

    expect(attackerEvents).toBe(0);
  });
});

describe("cascade behaviour", () => {
  test("deleting a profile removes its tasks, subtasks and activity", async () => {
    await createSubtask(owner.id, ownedTask.id, "Child");

    await db.profile.delete({ where: { id: owner.id } });

    expect(await db.task.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await db.subtask.count({ where: { profileId: owner.id } })).toBe(0);
    expect(
      await db.activityEvent.count({ where: { profileId: owner.id } }),
    ).toBe(0);

    // The other profile is untouched.
    expect(
      await db.profile.findUnique({ where: { id: attacker.id } }),
    ).not.toBeNull();
  });
});
