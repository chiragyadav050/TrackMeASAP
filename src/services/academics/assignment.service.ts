import "server-only";

import type { Assignment, Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import {
  ENTITY_ASSIGNMENT,
  recordAcademicActivity,
} from "@/services/academics/academic.activity";
import { toDateOnly, toInstant } from "@/services/academics/academic.dates";
import {
  requireOwnedAssignment,
  requireOwnedSubject,
} from "@/services/academics/academic.ownership";
import type {
  CreateAssignmentInput,
  updateAssignmentSchema,
} from "@/services/academics/academic.schema";
import type { z } from "zod";

/**
 * Assignment mutations, and the bridge into the task system.
 *
 * ===========================================================================
 * THE TWO-STATE MODEL
 * ===========================================================================
 *
 *   status            NOT_STARTED → IN_PROGRESS → COMPLETED (or CANCELLED)
 *                     How far along the WORK is.
 *
 *   submissionStatus  NOT_SUBMITTED → SUBMITTED / LATE / ACCEPTED
 *                     What the INSTITUTION has received.
 *
 * These move independently and routinely in the wrong order: a student
 * finishes a report on Tuesday and uploads it on Thursday, or submits a
 * half-finished draft to beat a deadline. Collapsing them into one enum makes
 * both of those unrepresentable, which is why they are separate columns.
 *
 * "Graded" is not a third state — it is `marksObtained != null`. A flag would
 * only give something else to fall out of step with.
 * ===========================================================================
 */

const log = logger.child({ service: "assignment" });

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createAssignment(
  profileId: string,
  timeZone: string,
  input: CreateAssignmentInput,
): Promise<Assignment> {
  const subject = await requireOwnedSubject(profileId, input.subjectId);

  const due = resolveDue(input.dueDate, input.dueTime, timeZone);

  const assignment = await db.assignment.create({
    data: {
      profileId,
      subjectId: subject.id,
      // Denormalised from the subject so semester-wide queries need no join.
      semesterId: subject.semesterId,
      title: input.title,
      description: input.description ?? null,
      notes: input.notes ?? null,
      assignedAt: input.assignedAt ? toDateOnly(input.assignedAt) : null,
      dueAt: due.dueAt,
      isAllDay: due.isAllDay,
      priority: input.priority,
      status: input.status,
      estimatedMinutes: input.estimatedMinutes ?? null,
      actualMinutes: input.actualMinutes ?? null,
      submissionStatus: input.submissionStatus,
      submissionUrl: input.submissionUrl ?? null,
      marksObtained: input.marksObtained ?? null,
      maxMarks: input.maxMarks ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    assignment.id,
    "CREATED",
    { subjectId: subject.id },
  );

  if (input.createTask) {
    await createTaskForAssignment(profileId, assignment.id);
  }

  return assignment;
}

function resolveDue(
  dueDate: string | undefined,
  dueTime: string | undefined,
  timeZone: string,
): { dueAt: Date | null; isAllDay: boolean } {
  if (!dueDate) {
    return { dueAt: null, isAllDay: false };
  }

  return {
    dueAt: toInstant(dueDate, dueTime, timeZone),
    // Same convention as Task: no clock time means due at the END of the day.
    isAllDay: !dueTime,
  };
}

// ---------------------------------------------------------------------------
// Task integration
// ---------------------------------------------------------------------------

/**
 * Creates a schedulable Task from an assignment.
 *
 * A REFERENCE, NOT A COPY. The assignment stays the academic record; the task
 * is the unit of work that appears on Today and in the task list. They are
 * linked by `Assignment.taskId` and by `Task.subjectId`, so neither has to
 * duplicate the other's data.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: completing the task does not mark the
 * assignment submitted. Finishing the work and handing it in are separate
 * events, and conflating them would tell a student their assignment was in
 * when it was still sitting on their laptop.
 *
 * Idempotent — calling it twice returns the existing task rather than
 * creating a second one.
 */
export async function createTaskForAssignment(
  profileId: string,
  assignmentId: string,
): Promise<{ taskId: string; created: boolean }> {
  const assignment = await requireOwnedAssignment(profileId, assignmentId);

  if (assignment.taskId) {
    const existing = await db.task.findFirst({
      where: { id: assignment.taskId, profileId },
      select: { id: true },
    });

    if (existing) {
      return { taskId: existing.id, created: false };
    }
    // The task was deleted; fall through and make a fresh one.
  }

  const subject = await db.subject.findFirst({
    where: { id: assignment.subjectId, profileId },
    select: { name: true, code: true },
  });

  const lowest = await db.task.aggregate({
    where: { profileId, archivedAt: null },
    _min: { position: true },
  });

  const task = await db.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        profileId,
        // The subject prefix is what makes the task legible on Today, where
        // academic and personal work sit side by side.
        title: subject?.code
          ? `${subject.code}: ${assignment.title}`
          : assignment.title,
        description: assignment.description,
        category: "COLLEGE",
        priority: assignment.priority,
        // Carried across, not recomputed — the assignment already resolved
        // these in the profile's zone.
        dueAt: assignment.dueAt,
        isAllDay: assignment.isAllDay,
        estimatedMinutes: assignment.estimatedMinutes,
        subjectId: assignment.subjectId,
        position: (lowest._min.position ?? 0) - 1000,
      },
    });

    await tx.assignment.update({
      where: { id: assignment.id },
      data: { taskId: created.id },
    });

    return created;
  });

  log.info("Task created from assignment", {
    assignmentId: assignment.id,
    taskId: task.id,
  });

  return { taskId: task.id, created: true };
}

/** Breaks the link without destroying either record. */
export async function unlinkAssignmentTask(
  profileId: string,
  assignmentId: string,
): Promise<void> {
  const assignment = await requireOwnedAssignment(profileId, assignmentId);

  await db.assignment.update({
    where: { id: assignment.id },
    data: { taskId: null },
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateAssignment(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateAssignmentSchema>,
): Promise<Assignment> {
  const existing = await requireOwnedAssignment(profileId, input.assignmentId);

  const data: Prisma.AssignmentUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.estimatedMinutes !== undefined) {
    data.estimatedMinutes = input.estimatedMinutes;
  }
  if (input.actualMinutes !== undefined) {
    data.actualMinutes = input.actualMinutes;
  }
  if (input.marksObtained !== undefined) {
    data.marksObtained = input.marksObtained;
  }
  if (input.maxMarks !== undefined) data.maxMarks = input.maxMarks;

  data.description = input.description ?? null;
  data.notes = input.notes ?? null;
  data.submissionUrl = input.submissionUrl ?? null;

  if (input.assignedAt !== undefined) {
    data.assignedAt = input.assignedAt ? toDateOnly(input.assignedAt) : null;
  }

  if (input.clearDue) {
    data.dueAt = null;
    data.isAllDay = false;
  } else if (input.dueDate) {
    const due = resolveDue(input.dueDate, input.dueTime, timeZone);
    data.dueAt = due.dueAt;
    data.isAllDay = due.isAllDay;
  }

  // Status and submission route through the dedicated helpers' semantics so
  // the stamps can never drift from the enums.
  if (input.status !== undefined && input.status !== existing.status) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }

  if (
    input.submissionStatus !== undefined &&
    input.submissionStatus !== existing.submissionStatus
  ) {
    data.submissionStatus = input.submissionStatus;
    data.submittedAt =
      input.submissionStatus === "NOT_SUBMITTED" ? null : new Date();
  }

  const assignment = await db.assignment.update({
    where: { id: existing.id },
    data,
  });

  // The linked task mirrors the schedulable facts only. Status is NOT
  // mirrored: the user completes the task when the work is done, and that is
  // their call to make, not a side effect of editing the assignment.
  if (assignment.taskId) {
    await db.task.updateMany({
      where: { id: assignment.taskId, profileId },
      data: {
        dueAt: assignment.dueAt,
        isAllDay: assignment.isAllDay,
        priority: assignment.priority,
        estimatedMinutes: assignment.estimatedMinutes,
      },
    });
  }

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    assignment.id,
    "UPDATED",
  );

  return assignment;
}

export async function setAssignmentStatus(
  profileId: string,
  assignmentId: string,
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
): Promise<Assignment> {
  const existing = await requireOwnedAssignment(profileId, assignmentId);

  const assignment = await db.assignment.update({
    where: { id: existing.id },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    assignment.id,
    status === "COMPLETED" ? "COMPLETED" : "UPDATED",
    { status },
  );

  return assignment;
}

/**
 * Records what the institution has received.
 *
 * Independent of `status` on purpose — see the header. Submitting does not
 * complete the work, and completing the work does not submit it.
 */
export async function setSubmission(
  profileId: string,
  assignmentId: string,
  submissionStatus: "NOT_SUBMITTED" | "SUBMITTED" | "LATE" | "ACCEPTED",
  submissionUrl?: string,
): Promise<Assignment> {
  const existing = await requireOwnedAssignment(profileId, assignmentId);

  const assignment = await db.assignment.update({
    where: { id: existing.id },
    data: {
      submissionStatus,
      submittedAt: submissionStatus === "NOT_SUBMITTED" ? null : new Date(),
      ...(submissionUrl === undefined
        ? {}
        : { submissionUrl: submissionUrl || null }),
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    assignment.id,
    "UPDATED",
    { submissionStatus },
  );

  return assignment;
}

export async function recordMarks(
  profileId: string,
  assignmentId: string,
  marksObtained: number | undefined,
  maxMarks: number | undefined,
): Promise<Assignment> {
  const existing = await requireOwnedAssignment(profileId, assignmentId);

  const assignment = await db.assignment.update({
    where: { id: existing.id },
    data: {
      marksObtained: marksObtained ?? null,
      maxMarks: maxMarks ?? existing.maxMarks,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    assignment.id,
    "UPDATED",
    { fields: ["marks"] },
  );

  return assignment;
}

export async function setAssignmentArchived(
  profileId: string,
  assignmentId: string,
  isArchived: boolean,
): Promise<Assignment> {
  const existing = await requireOwnedAssignment(profileId, assignmentId);

  const assignment = await db.assignment.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    assignment.id,
    isArchived ? "ARCHIVED" : "UNARCHIVED",
  );

  return assignment;
}

/**
 * Permanent deletion.
 *
 * The linked task SURVIVES — `Assignment.taskId` is the owning side, and the
 * student may still want the work item. Deleting their task because the
 * academic record went would be destroying something they did not ask to lose.
 */
export async function deleteAssignment(
  profileId: string,
  assignmentId: string,
): Promise<void> {
  const existing = await requireOwnedAssignment(profileId, assignmentId);

  await db.assignment.delete({ where: { id: existing.id } });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSIGNMENT,
    existing.id,
    "DELETED",
    { title: existing.title.slice(0, 60) },
  );
}
