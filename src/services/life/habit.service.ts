import "server-only";

import type { Habit, HabitLog, Prisma } from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import { toDateOnly } from "@/services/academics/academic.dates";
import { recordActivity } from "@/services/activity/activity.service";
import type { z } from "zod";
import type {
  CreateHabitInput,
  logHabitSchema,
  updateHabitSchema,
} from "@/services/life/life.schema";

/**
 * Habit mutations.
 *
 * Note what this service does NOT do: maintain a streak counter. Streaks are
 * computed from the logs on read (`habit.derive.ts`), because a stored streak
 * silently becomes wrong the moment a log is back-dated, edited or deleted —
 * and users do all three.
 */

export const ENTITY_HABIT = "habit";

export async function requireOwnedHabit(
  profileId: string,
  habitId: string,
): Promise<Habit> {
  const habit = await db.habit.findFirst({ where: { id: habitId, profileId } });

  if (!habit) {
    throw notFound("Habit");
  }

  return habit;
}

/** Normalises weekday input: sorted, de-duplicated, and only for the cadence
 * that uses it — a DAILY habit carrying stray weekdays would confuse every
 * reader of the row. */
function normaliseWeekdays(
  cadence: Habit["cadence"],
  weekdays: readonly number[] | undefined,
): number[] {
  if (cadence !== "SPECIFIC_DAYS") {
    return [];
  }

  return [...new Set(weekdays ?? [])].sort((a, b) => a - b);
}

export async function createHabit(
  profileId: string,
  timeZone: string,
  input: CreateHabitInput,
): Promise<Habit> {
  // A habit linked to a goal must be linked to one the caller owns.
  if (input.goalId) {
    const goal = await db.goal.findFirst({
      where: { id: input.goalId, profileId },
      select: { id: true },
    });

    if (!goal) {
      throw notFound("Goal");
    }
  }

  const habit = await db.habit.create({
    data: {
      profileId,
      goalId: input.goalId || null,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind,
      cadence: input.cadence,
      targetPerPeriod: input.targetPerPeriod,
      weekdays: normaliseWeekdays(input.cadence, input.weekdays),
      targetAmount: input.targetAmount ?? null,
      unit: input.unit ?? null,
      reminderMinute: input.reminderMinute ?? null,
      // Defaults to today in the PROFILE's zone: days before a habit existed
      // must never be counted as misses.
      startDate: toDateOnly(
        input.startDate ?? localDateKey(new Date(), timeZone),
      ),
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_HABIT,
    entityId: habit.id,
    action: "CREATED",
  });

  return habit;
}

export async function updateHabit(
  profileId: string,
  input: z.infer<typeof updateHabitSchema>,
): Promise<Habit> {
  const existing = await requireOwnedHabit(profileId, input.habitId);

  if (input.goalId) {
    const goal = await db.goal.findFirst({
      where: { id: input.goalId, profileId },
      select: { id: true },
    });

    if (!goal) {
      throw notFound("Goal");
    }
  }

  const data: Prisma.HabitUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.targetPerPeriod !== undefined) {
    data.targetPerPeriod = input.targetPerPeriod;
  }
  if (input.targetAmount !== undefined) data.targetAmount = input.targetAmount;
  if (input.unit !== undefined) data.unit = input.unit ?? null;
  if (input.reminderMinute !== undefined) {
    data.reminderMinute = input.reminderMinute ?? null;
  }
  if (input.startDate) data.startDate = toDateOnly(input.startDate);

  data.description = input.description ?? null;

  if (input.goalId !== undefined) {
    data.goal = input.goalId
      ? { connect: { id: input.goalId } }
      : { disconnect: true };
  }

  const cadence = input.cadence ?? existing.cadence;

  if (input.cadence !== undefined || input.weekdays !== undefined) {
    data.cadence = cadence;
    data.weekdays = normaliseWeekdays(
      cadence,
      input.weekdays ?? existing.weekdays,
    );
  }

  return db.habit.update({ where: { id: existing.id }, data });
}

export async function setHabitArchived(
  profileId: string,
  habitId: string,
  isArchived: boolean,
): Promise<Habit> {
  const existing = await requireOwnedHabit(profileId, habitId);

  const habit = await db.habit.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_HABIT,
    entityId: habit.id,
    action: isArchived ? "ARCHIVED" : "UNARCHIVED",
  });

  return habit;
}

/** Deletes a habit and, by cascade, its history. Archiving is the reversible
 * option the UI offers first. */
export async function deleteHabit(
  profileId: string,
  habitId: string,
): Promise<void> {
  const existing = await requireOwnedHabit(profileId, habitId);

  await db.habit.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_HABIT,
    entityId: existing.id,
    action: "DELETED",
    metadata: { name: existing.name.slice(0, 60) },
  });
}

/**
 * Records one day for one habit.
 *
 * Upsert on `(habitId, logDate)`: a habit is done or not done on a given
 * LOCAL day, and re-answering must correct the day rather than add a second
 * row. Logging a deliberate miss (`isCompleted: false`) is stored, and is not
 * the same as having no row, which means "not answered yet".
 */
export async function logHabit(
  profileId: string,
  input: z.infer<typeof logHabitSchema>,
): Promise<HabitLog> {
  const habit = await requireOwnedHabit(profileId, input.habitId);
  const logDate = toDateOnly(input.logDate);

  return db.habitLog.upsert({
    where: { habitId_logDate: { habitId: habit.id, logDate } },
    create: {
      profileId,
      habitId: habit.id,
      logDate,
      isCompleted: input.isCompleted,
      amount: input.amount ?? null,
      note: input.note ?? null,
    },
    update: {
      isCompleted: input.isCompleted,
      amount: input.amount ?? null,
      note: input.note ?? null,
    },
  });
}

/**
 * Removes a day's answer entirely, returning it to "not answered".
 *
 * Distinct from logging a miss: this is how a user undoes a mis-tap without
 * leaving a false failure in their history.
 */
export async function clearHabitLog(
  profileId: string,
  habitId: string,
  logDateKey: string,
): Promise<void> {
  const habit = await requireOwnedHabit(profileId, habitId);

  await db.habitLog.deleteMany({
    where: { habitId: habit.id, profileId, logDate: toDateOnly(logDateKey) },
  });
}

/** Convenience for the one-tap check on the habits page. */
export async function toggleHabitToday(
  profileId: string,
  habitId: string,
  todayKey: string,
): Promise<{ readonly isCompleted: boolean }> {
  const habit = await requireOwnedHabit(profileId, habitId);
  const logDate = toDateOnly(todayKey);

  const existing = await db.habitLog.findUnique({
    where: { habitId_logDate: { habitId: habit.id, logDate } },
  });

  // Three states, cycled in the order a thumb expects: unanswered → done →
  // unanswered. A deliberate miss is recorded from the menu, not by tapping
  // twice, so an accidental double-tap cannot write a failure.
  if (existing?.isCompleted) {
    await db.habitLog.delete({ where: { id: existing.id } });
    return { isCompleted: false };
  }

  await db.habitLog.upsert({
    where: { habitId_logDate: { habitId: habit.id, logDate } },
    create: { profileId, habitId: habit.id, logDate, isCompleted: true },
    update: { isCompleted: true },
  });

  return { isCompleted: true };
}
