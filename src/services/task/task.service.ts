import "server-only";

import type { Prisma, Task } from "@/generated/prisma/client";
import { notFound, validationFailed } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  addLocalDays,
  instantFromLocalTime,
  localDateKey,
  parseMinutesFromTime,
  startOfLocalDay,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  ENTITY_SUBTASK,
  ENTITY_TASK,
  changedFieldNames,
  recordActivity,
  recordActivityBatch,
} from "@/services/activity/activity.service";
import type {
  BulkTaskActionInput,
  CreateTaskInput,
  RescheduleTaskInput,
  UpdateTaskInput,
} from "@/services/task/task.schema";

/**
 * Task mutations.
 *
 * OWNERSHIP IS THE WHOLE POINT OF THIS FILE.
 *
 * Every exported function takes `profileId` as its first argument, and that
 * value always originates from the Clerk session (see `src/server/auth.ts`) —
 * never from a request payload. No function here reads the ambient session,
 * so it is structurally impossible to write one that trusts a client-supplied
 * owner.
 *
 * Every read and write is scoped by `profileId`. A task belonging to someone
 * else is reported as NOT FOUND rather than FORBIDDEN, so the API cannot be
 * used to probe which ids exist.
 */

const log = logger.child({ service: "task" });

/** Sparse manual-ordering step, so a reorder rarely renumbers neighbours. */
const POSITION_STEP = 1000;

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Loads a task the caller demonstrably owns, or throws.
 *
 * Every mutation below starts here. Note the `profileId` in the WHERE clause:
 * ownership is enforced by the query itself, not by a check afterwards that
 * someone could forget to write.
 */
export async function requireOwnedTask(
  profileId: string,
  taskId: string,
): Promise<Task> {
  const task = await db.task.findFirst({ where: { id: taskId, profileId } });

  if (!task) {
    // Deliberately NOT_FOUND, not FORBIDDEN — a 403 would confirm the id is
    // real and belongs to somebody.
    throw notFound("Task");
  }

  return task;
}

async function requireOwnedSubtask(profileId: string, subtaskId: string) {
  const subtask = await db.subtask.findFirst({
    where: { id: subtaskId, profileId },
  });

  if (!subtask) {
    throw notFound("Subtask");
  }

  return subtask;
}

// ---------------------------------------------------------------------------
// Due-date resolution
// ---------------------------------------------------------------------------

/**
 * Turns the day (and optional clock time) the user picked into a UTC instant,
 * using the PROFILE's zone.
 *
 * The client deliberately never sends an instant: doing so would bake the
 * browser's zone into the value, which is wrong the moment the user travels
 * or sets a different zone in Settings.
 */
export function resolveDueAt(
  dueDate: string | undefined,
  dueTime: string | undefined,
  timeZone: string,
): { dueAt: Date | null; isAllDay: boolean } {
  if (!dueDate) {
    return { dueAt: null, isAllDay: false };
  }

  const [year, month, day] = dueDate.split("-").map(Number);

  if (!dueTime) {
    // All-day: anchored at local midnight and flagged, so the deadline is the
    // END of that day (see `effectiveDeadline`). Without the flag a task due
    // "Friday" would read as overdue from 00:01 on Friday.
    return {
      dueAt: instantFromLocalTime(year, month, day, 0, timeZone),
      isAllDay: true,
    };
  }

  const minutes = parseMinutesFromTime(dueTime);

  if (minutes === null) {
    throw validationFailed({ dueTime: ["Use a valid time."] });
  }

  return {
    dueAt: instantFromLocalTime(year, month, day, minutes, timeZone),
    isAllDay: false,
  };
}

/** Resolves a named reschedule preset against the user's local calendar. */
export function resolvePreset(
  preset: RescheduleTaskInput["preset"],
  now: Date,
  timeZone: string,
): { dueAt: Date | null; isAllDay: boolean } {
  if (preset === "CLEAR" || preset === undefined) {
    return { dueAt: null, isAllDay: false };
  }

  const toAllDay = (date: Date) => ({
    dueAt: startOfLocalDay(date, timeZone),
    isAllDay: true,
  });

  if (preset === "TODAY") {
    return toAllDay(now);
  }

  if (preset === "TOMORROW") {
    return toAllDay(addLocalDays(now, timeZone, 1));
  }

  if (preset === "THIS_WEEKEND") {
    return toAllDay(
      addLocalDays(now, timeZone, daysUntilWeekday(now, timeZone, 6)),
    );
  }

  // NEXT_WEEK — the coming Monday.
  return toAllDay(
    addLocalDays(now, timeZone, daysUntilWeekday(now, timeZone, 1)),
  );
}

/**
 * Days forward to the next occurrence of an ISO weekday (1 = Monday …
 * 7 = Sunday), always at least 1 so "this weekend" on a Saturday means the
 * next one rather than today.
 */
function daysUntilWeekday(
  now: Date,
  timeZone: string,
  isoWeekday: number,
): number {
  const today = isoWeekdayIn(now, timeZone);
  const delta = (isoWeekday - today + 7) % 7;

  return delta === 0 ? 7 : delta;
}

/** ISO weekday (1 = Monday … 7 = Sunday) for an instant, in a zone. */
export function isoWeekdayIn(date: Date, timeZone: string): number {
  const [year, month, day] = localDateKey(date, timeZone)
    .split("-")
    .map(Number);

  // getUTCDay on a UTC-anchored calendar date is zone-safe here because the
  // Y/M/D already came from the target zone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createTask(
  profileId: string,
  timeZone: string,
  input: CreateTaskInput,
): Promise<Task> {
  const { dueAt, isAllDay } = resolveDueAt(
    input.dueDate,
    input.dueTime,
    timeZone,
  );

  // New tasks go to the top of the manual order.
  const lowest = await db.task.aggregate({
    where: { profileId, archivedAt: null },
    _min: { position: true },
  });

  const task = await db.task.create({
    data: {
      profileId,
      title: input.title,
      description: input.description ?? null,
      notes: input.notes ?? null,
      priority: input.priority,
      category: input.category,
      energy: input.energy,
      estimatedMinutes: input.estimatedMinutes ?? null,
      dueAt,
      isAllDay,
      position: (lowest._min.position ?? 0) - POSITION_STEP,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: task.id,
    action: "CREATED",
    metadata: { priority: task.priority, category: task.category },
  });

  log.info("Task created", { taskId: task.id });

  return task;
}

/** Quick capture — a title and the defaults. */
export async function quickCreateTask(
  profileId: string,
  timeZone: string,
  title: string,
): Promise<Task> {
  return createTask(profileId, timeZone, {
    title,
    priority: "MEDIUM",
    category: "PERSONAL",
    energy: "MEDIUM",
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateTask(
  profileId: string,
  timeZone: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const existing = await requireOwnedTask(profileId, input.taskId);

  const data: Prisma.TaskUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.category !== undefined) data.category = input.category;
  if (input.energy !== undefined) data.energy = input.energy;

  // These are optional-with-transform, so `undefined` means "not submitted"
  // and an emptied field arrives as `undefined` too. The form always submits
  // every text field, so treating undefined as "clear" is correct here.
  data.description = input.description ?? null;
  data.notes = input.notes ?? null;

  if (input.estimatedMinutes !== undefined) {
    data.estimatedMinutes = input.estimatedMinutes;
  }

  if (input.actualMinutes !== undefined) {
    data.actualMinutes = input.actualMinutes;
  }

  if (input.clearDue) {
    data.dueAt = null;
    data.isAllDay = false;
  } else if (input.dueDate) {
    const resolved = resolveDueAt(input.dueDate, input.dueTime, timeZone);
    data.dueAt = resolved.dueAt;
    data.isAllDay = resolved.isAllDay;
  }

  // Status changes route through the completion helpers so `completedAt` and
  // the audit action can never drift apart from `status`.
  if (input.status !== undefined && input.status !== existing.status) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }

  const task = await db.task.update({ where: { id: existing.id }, data });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: task.id,
    action: "UPDATED",
    metadata: {
      fields: changedFieldNames(
        existing as unknown as Record<string, unknown>,
        task as unknown as Record<string, unknown>,
      ),
    },
  });

  return task;
}

export async function setTaskCompletion(
  profileId: string,
  taskId: string,
  isCompleted: boolean,
  /**
   * Injectable clock, defaulting to now.
   *
   * `completedAt` decides which local day a task counts as "completed today"
   * on, so a test that fixes the view's clock must be able to fix this one
   * too — otherwise the assertion silently depends on what time the suite
   * happens to run, and fails only around local midnight.
   */
  now: Date = new Date(),
): Promise<Task> {
  const existing = await requireOwnedTask(profileId, taskId);

  const task = await db.task.update({
    where: { id: existing.id },
    data: {
      status: isCompleted ? "COMPLETED" : "TODO",
      completedAt: isCompleted ? now : null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: task.id,
    action: isCompleted ? "COMPLETED" : "REOPENED",
  });

  return task;
}

export async function setTaskPriority(
  profileId: string,
  taskId: string,
  priority: Task["priority"],
): Promise<Task> {
  const existing = await requireOwnedTask(profileId, taskId);

  const task = await db.task.update({
    where: { id: existing.id },
    data: { priority },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: task.id,
    action: "UPDATED",
    metadata: { fields: ["priority"], priority },
  });

  return task;
}

export async function rescheduleTask(
  profileId: string,
  timeZone: string,
  input: RescheduleTaskInput,
  now: Date = new Date(),
): Promise<Task> {
  const existing = await requireOwnedTask(profileId, input.taskId);

  const resolved = input.preset
    ? resolvePreset(input.preset, now, timeZone)
    : resolveDueAt(input.dueDate, input.dueTime, timeZone);

  const task = await db.task.update({
    where: { id: existing.id },
    data: { dueAt: resolved.dueAt, isAllDay: resolved.isAllDay },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: task.id,
    action: "RESCHEDULED",
    metadata: { preset: input.preset ?? "CUSTOM" },
  });

  return task;
}

// ---------------------------------------------------------------------------
// Archive / delete
// ---------------------------------------------------------------------------

export async function setTaskArchived(
  profileId: string,
  taskId: string,
  isArchived: boolean,
): Promise<Task> {
  const existing = await requireOwnedTask(profileId, taskId);

  const task = await db.task.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: task.id,
    action: isArchived ? "ARCHIVED" : "UNARCHIVED",
  });

  return task;
}

/**
 * Permanent deletion.
 *
 * Archiving is the default everywhere in the UI; this exists for the explicit
 * "delete permanently" action only. Subtasks cascade at the database level.
 * The activity row deliberately survives the task it describes — an audit
 * trail that disappears with the evidence is not an audit trail.
 */
export async function deleteTask(
  profileId: string,
  taskId: string,
): Promise<void> {
  const existing = await requireOwnedTask(profileId, taskId);

  await db.task.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_TASK,
    entityId: existing.id,
    action: "DELETED",
    metadata: { title: existing.title.slice(0, 60) },
  });

  log.info("Task deleted", { taskId: existing.id });
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

/**
 * Applies one action to many tasks.
 *
 * Ownership is enforced inside the WHERE clause of a single `updateMany`, so
 * ids belonging to another profile simply do not match — there is no path by
 * which a foreign task is touched, and no per-id round trip either.
 *
 * Returns the number of rows actually affected, which may be fewer than the
 * ids submitted.
 */
export async function bulkUpdateTasks(
  profileId: string,
  timeZone: string,
  input: BulkTaskActionInput,
  now: Date = new Date(),
): Promise<number> {
  const scope = { id: { in: [...input.taskIds] }, profileId };

  const data: Prisma.TaskUpdateManyMutationInput = {};
  let action: Parameters<typeof recordActivityBatch>[0][number]["action"];

  switch (input.action) {
    case "COMPLETE":
      data.status = "COMPLETED";
      data.completedAt = now;
      action = "COMPLETED";
      break;

    case "REOPEN":
      data.status = "TODO";
      data.completedAt = null;
      action = "REOPENED";
      break;

    case "ARCHIVE":
      data.archivedAt = now;
      action = "ARCHIVED";
      break;

    case "SET_PRIORITY":
      data.priority = input.priority;
      action = "UPDATED";
      break;

    case "RESCHEDULE": {
      const resolved = resolvePreset(input.preset, now, timeZone);
      data.dueAt = resolved.dueAt;
      data.isAllDay = resolved.isAllDay;
      action = "RESCHEDULED";
      break;
    }
  }

  const result = await db.task.updateMany({ where: scope, data });

  // Only the ids that genuinely matched are known to be owned, so re-read
  // them rather than logging activity for ids that were never touched.
  if (result.count > 0) {
    const affected = await db.task.findMany({
      where: scope,
      select: { id: true },
    });

    await recordActivityBatch(
      affected.map((task) => ({
        profileId,
        entityType: ENTITY_TASK,
        entityId: task.id,
        action,
        metadata: { bulk: true, action: input.action },
      })),
    );
  }

  log.info("Bulk task update", {
    action: input.action,
    requested: input.taskIds.length,
    affected: result.count,
  });

  return result.count;
}

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

export async function createSubtask(
  profileId: string,
  taskId: string,
  title: string,
) {
  // Proves the PARENT is owned before anything is attached to it.
  await requireOwnedTask(profileId, taskId);

  const highest = await db.subtask.aggregate({
    where: { taskId },
    _max: { position: true },
  });

  const subtask = await db.subtask.create({
    data: {
      profileId,
      taskId,
      title,
      position: (highest._max.position ?? 0) + POSITION_STEP,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_SUBTASK,
    entityId: subtask.id,
    action: "CREATED",
    metadata: { taskId },
  });

  return subtask;
}

export async function setSubtaskCompletion(
  profileId: string,
  subtaskId: string,
  isCompleted: boolean,
) {
  const existing = await requireOwnedSubtask(profileId, subtaskId);

  const subtask = await db.subtask.update({
    where: { id: existing.id },
    data: { isCompleted, completedAt: isCompleted ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_SUBTASK,
    entityId: subtask.id,
    action: isCompleted ? "COMPLETED" : "REOPENED",
    metadata: { taskId: subtask.taskId },
  });

  return subtask;
}

export async function updateSubtask(
  profileId: string,
  subtaskId: string,
  title: string,
) {
  const existing = await requireOwnedSubtask(profileId, subtaskId);

  return db.subtask.update({ where: { id: existing.id }, data: { title } });
}

export async function deleteSubtask(
  profileId: string,
  subtaskId: string,
): Promise<void> {
  const existing = await requireOwnedSubtask(profileId, subtaskId);

  await db.subtask.delete({ where: { id: existing.id } });
}

/**
 * Rewrites subtask order.
 *
 * The submitted ids must be exactly the task's own subtasks. Anything else —
 * a foreign id, a missing id — is rejected rather than partially applied, so
 * a malformed request cannot silently reorder half a list or attach another
 * user's subtask to this task.
 */
export async function reorderSubtasks(
  profileId: string,
  taskId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await requireOwnedTask(profileId, taskId);

  const existing = await db.subtask.findMany({
    where: { taskId, profileId },
    select: { id: true },
  });

  const existingIds = new Set(existing.map((subtask) => subtask.id));
  const submitted = new Set(orderedIds);

  const isCompleteSet =
    existingIds.size === submitted.size &&
    [...submitted].every((id) => existingIds.has(id));

  if (!isCompleteSet) {
    throw validationFailed({
      orderedIds: ["The reordered list does not match this task's subtasks."],
    });
  }

  await db.$transaction(
    orderedIds.map((id, index) =>
      db.subtask.update({
        where: { id },
        data: { position: (index + 1) * POSITION_STEP },
      }),
    ),
  );
}

/**
 * Checklist progress for a task the caller owns.
 *
 * Used by the UI to decide whether to SUGGEST completing the parent. It
 * deliberately does not complete anything: auto-completing a parent would
 * take an irreversible-feeling action the user never asked for, and the last
 * subtask is often ticked while the parent still needs review or submission.
 */
export async function getSubtaskProgress(
  profileId: string,
  taskId: string,
): Promise<{ completed: number; total: number }> {
  await requireOwnedTask(profileId, taskId);

  const [total, completed] = await Promise.all([
    db.subtask.count({ where: { taskId } }),
    db.subtask.count({ where: { taskId, isCompleted: true } }),
  ]);

  return { completed, total };
}
