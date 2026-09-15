import "server-only";

import type { Goal, GoalMilestone, Prisma } from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { db } from "@/server/db";
import { toDateOnly } from "@/services/academics/academic.dates";
import { recordActivity } from "@/services/activity/activity.service";
import type { z } from "zod";
import type {
  CreateGoalInput,
  createGoalMilestoneSchema,
  updateGoalSchema,
} from "@/services/life/life.schema";

/**
 * Goal mutations.
 *
 * Same contract as every other service: `profileId` first, always from the
 * Clerk session. Guards put `profileId` in the WHERE clause and throw
 * NOT_FOUND rather than FORBIDDEN, so a valid id belonging to someone else is
 * indistinguishable from one that never existed.
 */

const POSITION_STEP = 1000;

export const ENTITY_GOAL = "goal";
export const ENTITY_GOAL_MILESTONE = "goal_milestone";

export async function requireOwnedGoal(
  profileId: string,
  goalId: string,
): Promise<Goal> {
  const goal = await db.goal.findFirst({ where: { id: goalId, profileId } });

  if (!goal) {
    throw notFound("Goal");
  }

  return goal;
}

export async function requireOwnedGoalMilestone(
  profileId: string,
  milestoneId: string,
): Promise<GoalMilestone> {
  const milestone = await db.goalMilestone.findFirst({
    where: { id: milestoneId, profileId },
  });

  if (!milestone) {
    throw notFound("Milestone");
  }

  return milestone;
}

export async function createGoal(
  profileId: string,
  input: CreateGoalInput,
): Promise<Goal> {
  const goal = await db.goal.create({
    data: {
      profileId,
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      timeframe: input.timeframe,
      targetDate: input.targetDate ? toDateOnly(input.targetDate) : null,
      targetValue: input.targetValue ?? null,
      unit: input.unit ?? null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_GOAL,
    entityId: goal.id,
    action: "CREATED",
  });

  return goal;
}

export async function updateGoal(
  profileId: string,
  input: z.infer<typeof updateGoalSchema>,
): Promise<Goal> {
  const existing = await requireOwnedGoal(profileId, input.goalId);

  const data: Prisma.GoalUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.category !== undefined) data.category = input.category;
  if (input.timeframe !== undefined) data.timeframe = input.timeframe;
  if (input.unit !== undefined) data.unit = input.unit ?? null;

  data.description = input.description ?? null;

  if (input.clearTargetDate) {
    data.targetDate = null;
  } else if (input.targetDate) {
    data.targetDate = toDateOnly(input.targetDate);
  }

  // Clearing `targetValue` converts a measured goal back to a milestone-based
  // one; the derive layer reads the null and switches, so no flag is needed.
  if (input.targetValue !== undefined) {
    data.targetValue = input.targetValue;
  }

  const goal = await db.goal.update({ where: { id: existing.id }, data });

  await recordActivity({
    profileId,
    entityType: ENTITY_GOAL,
    entityId: goal.id,
    action: "UPDATED",
  });

  return goal;
}

/**
 * Sets the measured progress of a goal.
 *
 * Separate from `updateGoal` because it is the one field a user touches
 * repeatedly, and it should not require opening the whole edit form.
 */
export async function setGoalProgress(
  profileId: string,
  goalId: string,
  currentValue: number,
): Promise<Goal> {
  const existing = await requireOwnedGoal(profileId, goalId);

  const reachedTarget =
    existing.targetValue !== null && currentValue >= existing.targetValue;

  return db.goal.update({
    where: { id: existing.id },
    data: {
      currentValue,
      // Hitting the number marks the goal achieved, but MISSING it never
      // un-achieves one — a user who declared the goal met has the final say.
      ...(reachedTarget && existing.status === "ACTIVE"
        ? { status: "ACHIEVED" as const, achievedAt: new Date() }
        : {}),
    },
  });
}

export async function setGoalStatus(
  profileId: string,
  goalId: string,
  status: Goal["status"],
): Promise<Goal> {
  const existing = await requireOwnedGoal(profileId, goalId);

  const goal = await db.goal.update({
    where: { id: existing.id },
    data: {
      status,
      achievedAt: status === "ACHIEVED" ? new Date() : null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_GOAL,
    entityId: goal.id,
    action: status === "ACHIEVED" ? "COMPLETED" : "UPDATED",
    metadata: { status },
  });

  return goal;
}

export async function setGoalArchived(
  profileId: string,
  goalId: string,
  isArchived: boolean,
): Promise<Goal> {
  const existing = await requireOwnedGoal(profileId, goalId);

  const goal = await db.goal.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_GOAL,
    entityId: goal.id,
    action: isArchived ? "ARCHIVED" : "UNARCHIVED",
  });

  return goal;
}

/**
 * Deletes a goal.
 *
 * Milestones cascade. HABITS AND TASKS DO NOT — both carry `SetNull`, so
 * abandoning a goal never destroys the work already done toward it.
 */
export async function deleteGoal(
  profileId: string,
  goalId: string,
): Promise<void> {
  const existing = await requireOwnedGoal(profileId, goalId);

  await db.goal.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_GOAL,
    entityId: existing.id,
    action: "DELETED",
    metadata: { title: existing.title.slice(0, 60) },
  });
}

export async function createGoalMilestone(
  profileId: string,
  input: z.infer<typeof createGoalMilestoneSchema>,
): Promise<GoalMilestone> {
  await requireOwnedGoal(profileId, input.goalId);

  const highest = await db.goalMilestone.aggregate({
    where: { goalId: input.goalId },
    _max: { sortOrder: true },
  });

  return db.goalMilestone.create({
    data: {
      profileId,
      goalId: input.goalId,
      title: input.title,
      dueDate: input.dueDate ? toDateOnly(input.dueDate) : null,
      sortOrder: (highest._max.sortOrder ?? 0) + POSITION_STEP,
    },
  });
}

export async function setGoalMilestoneDone(
  profileId: string,
  milestoneId: string,
  isCompleted: boolean,
): Promise<GoalMilestone> {
  const existing = await requireOwnedGoalMilestone(profileId, milestoneId);

  return db.goalMilestone.update({
    where: { id: existing.id },
    data: { completedAt: isCompleted ? new Date() : null },
  });
}

export async function deleteGoalMilestone(
  profileId: string,
  milestoneId: string,
): Promise<void> {
  const existing = await requireOwnedGoalMilestone(profileId, milestoneId);

  await db.goalMilestone.delete({ where: { id: existing.id } });
}
