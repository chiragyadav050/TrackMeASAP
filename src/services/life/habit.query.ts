import "server-only";

import type { Habit, HabitLog, Profile } from "@/generated/prisma/client";
import {
  formatDuration,
  formatInTimeZone,
  formatMinutesAsTime,
  localDateKey,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  eachLocalDate,
  fromDateOnly,
  isoWeekdayOf,
  toDateOnly,
} from "@/services/academics/academic.dates";
import {
  calculateStreak,
  completionRate,
  daysClean,
  goalPace,
  goalProgress,
  isDueOn,
  weeklyProgress,
  type HabitCadenceSpec,
  type HabitLogEntry,
  type Weekday,
} from "@/services/life/habit.derive";
import type {
  GoalDetailDto,
  GoalDto,
  HabitDto,
  HabitSummaryDto,
} from "@/types/life";

/**
 * Habit and goal reads.
 *
 * The calendar is built HERE, in the profile's zone, and handed to the pure
 * derive functions — those know nothing about time zones on purpose, so the
 * one place that can get "which day is it" wrong is this file, and it is the
 * one place that has the profile to get it right.
 */

/** How far back completion rate is measured. A month is long enough to be
 * meaningful and short enough that a bad fortnight still shows. */
const RATE_WINDOW_DAYS = 30;
const RECENT_STRIP_DAYS = 7;

/**
 * Hard cap on log rows loaded for one habits page.
 *
 * Roughly a decade of a single daily habit, or two years of five. Reaching it
 * would understate a streak rather than crash, and nothing in a personal
 * tracker legitimately gets near it.
 */
const MAX_LOGS_PER_PAGE = 4000;

/**
 * Days of calendar the streak walk will consider.
 *
 * A habit started years ago should not build a multi-thousand-entry array on
 * every page load. Beyond this the streak is computed from the recent window,
 * which can only ever UNDERSTATE a streak — never inflate one.
 */
const MAX_STREAK_WINDOW_DAYS = 1100;

function specOf(habit: Habit): HabitCadenceSpec {
  return {
    cadence: habit.cadence,
    targetPerPeriod: habit.targetPerPeriod,
    weekdays: habit.weekdays,
  };
}

/** Local calendar days in `[fromKey, toKey]`, each with its ISO weekday. */
function calendarBetween(
  fromKey: string,
  toKey: string,
): { dateKey: string; weekday: Weekday }[] {
  if (fromKey > toKey) {
    return [];
  }

  return eachLocalDate(fromKey, toKey).map((dateKey) => ({
    dateKey,
    weekday: isoWeekdayOf(dateKey) as Weekday,
  }));
}

/** The local week containing `dateKey`, honouring the profile's week start. */
function weekKeysAround(
  dateKey: string,
  weekStartsOnMonday: boolean,
): string[] {
  const weekday = isoWeekdayOf(dateKey);
  const offset = weekStartsOnMonday ? weekday - 1 : weekday % 7;

  const start = toDateOnly(dateKey);
  start.setUTCDate(start.getUTCDate() - offset);

  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);

  return eachLocalDate(fromDateOnly(start), fromDateOnly(end));
}

function toLogEntries(logs: readonly HabitLog[]): HabitLogEntry[] {
  return logs.map((log) => ({
    dateKey: fromDateOnly(log.logDate),
    isCompleted: log.isCompleted,
    amount: log.amount,
  }));
}

function hydrateHabit(
  habit: Habit & { goal: { title: string } | null },
  logs: readonly HabitLog[],
  profile: Profile,
  todayKey: string,
): HabitDto {
  const spec = specOf(habit);
  const entries = toLogEntries(logs);
  const startKey = fromDateOnly(habit.startDate);

  const streakFloor = toDateOnly(todayKey);
  streakFloor.setUTCDate(streakFloor.getUTCDate() - MAX_STREAK_WINDOW_DAYS);
  const streakStart =
    fromDateOnly(streakFloor) > startKey ? fromDateOnly(streakFloor) : startKey;

  const streak = calculateStreak(
    calendarBetween(streakStart, todayKey),
    entries,
    spec,
    todayKey,
  );

  // The rate window never reaches back before the habit existed — days that
  // predate it are not misses.
  const windowStart = toDateOnly(todayKey);
  windowStart.setUTCDate(windowStart.getUTCDate() - (RATE_WINDOW_DAYS - 1));
  const rateCalendar = calendarBetween(
    fromDateOnly(windowStart) > startKey ? fromDateOnly(windowStart) : startKey,
    todayKey,
  );

  const week = weekKeysAround(todayKey, profile.weekStart === "MONDAY");
  const weekProgress = weeklyProgress(week, entries, spec);

  const byDate = new Map(entries.map((entry) => [entry.dateKey, entry]));
  const todayEntry = byDate.get(todayKey);

  const stripStart = toDateOnly(todayKey);
  stripStart.setUTCDate(stripStart.getUTCDate() - (RECENT_STRIP_DAYS - 1));

  const recentDays = calendarBetween(fromDateOnly(stripStart), todayKey).map(
    (day) => {
      const entry = byDate.get(day.dateKey);

      return {
        dateKey: day.dateKey,
        shortLabel: formatInTimeZone(
          toDateOnly(day.dateKey),
          "UTC",
          { weekday: "narrow" },
          profile.locale,
        ),
        // Before the habit existed, nothing was scheduled.
        isScheduled: day.dateKey >= startKey && isDueOn(spec, day.weekday),
        isToday: day.dateKey === todayKey,
        status: entry ? (entry.isCompleted ? "DONE" : "MISSED") : null,
      } as const;
    },
  );

  return {
    id: habit.id,
    name: habit.name,
    description: habit.description,
    kind: habit.kind,
    cadence: habit.cadence,
    targetPerPeriod: habit.targetPerPeriod,
    weekdays: habit.weekdays,
    targetAmount: habit.targetAmount,
    unit: habit.unit,
    reminderLabel:
      habit.reminderMinute === null
        ? null
        : formatMinutesAsTime(habit.reminderMinute),
    goalId: habit.goalId,
    goalTitle: habit.goal?.title ?? null,
    isDueToday:
      todayKey >= startKey && isDueOn(spec, isoWeekdayOf(todayKey) as Weekday),
    todayStatus: todayEntry
      ? todayEntry.isCompleted
        ? "DONE"
        : "MISSED"
      : null,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    completionRate30: completionRate(rateCalendar, entries, spec),
    weekCompleted: weekProgress.completed,
    weekTarget: weekProgress.target,
    daysClean:
      habit.kind === "QUIT"
        ? daysClean(
            entries.filter((e) => !e.isCompleted).map((e) => e.dateKey),
            startKey,
            todayKey,
            (fromKey, toKey) =>
              Math.round(
                (toDateOnly(toKey).getTime() - toDateOnly(fromKey).getTime()) /
                  86_400_000,
              ),
          )
        : null,
    startDateInput: startKey,
    isArchived: habit.archivedAt !== null,
    recentDays,
  };
}

/**
 * Every habit with its derived figures.
 *
 * One query for the habits and ONE for all their logs — the per-habit maths
 * then runs in memory, so cost does not grow with the number of habits.
 */
export async function listHabits(
  profile: Profile,
  options: { includeArchived?: boolean } = {},
  now: Date = new Date(),
): Promise<readonly HabitDto[]> {
  const todayKey = localDateKey(now, profile.timeZone);

  const habits = await db.habit.findMany({
    where: {
      profileId: profile.id,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    include: { goal: { select: { title: true } } },
    orderBy: [{ createdAt: "asc" }],
  });

  if (habits.length === 0) {
    return [];
  }

  // The FULL history, not just the rate window: `longestStreak` spans the
  // whole life of a habit, and loading only the recent window would silently
  // report a personal best that is merely the best of the last month.
  //
  // This is bounded in practice — one row per day per habit, so even several
  // years of daily habits is a few thousand narrow rows — and the hard cap
  // below stops a pathological case from loading without limit.
  const logs = await db.habitLog.findMany({
    where: {
      profileId: profile.id,
      habitId: { in: habits.map((habit) => habit.id) },
    },
    orderBy: { logDate: "desc" },
    take: MAX_LOGS_PER_PAGE,
  });

  const byHabit = new Map<string, HabitLog[]>();

  for (const log of logs) {
    const list = byHabit.get(log.habitId) ?? [];
    list.push(log);
    byHabit.set(log.habitId, list);
  }

  return habits.map((habit) =>
    hydrateHabit(habit, byHabit.get(habit.id) ?? [], profile, todayKey),
  );
}

export async function getHabitSummary(
  profile: Profile,
  now: Date = new Date(),
): Promise<HabitSummaryDto> {
  const habits = await listHabits(profile, {}, now);
  const due = habits.filter((habit) => habit.isDueToday);

  return {
    dueTodayCount: due.length,
    doneTodayCount: due.filter((habit) => habit.todayStatus === "DONE").length,
    bestStreak: habits.reduce(
      (best, habit) => Math.max(best, habit.currentStreak),
      0,
    ),
    habits,
  };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/**
 * Goals with progress and pace.
 *
 * Milestone, habit and task counts come from three GROUPED queries over the
 * whole page rather than three per goal.
 */
export async function listGoals(
  profile: Profile,
  options: { includeArchived?: boolean; status?: string } = {},
  now: Date = new Date(),
): Promise<readonly GoalDto[]> {
  const goals = await db.goal.findMany({
    where: {
      profileId: profile.id,
      ...(options.includeArchived
        ? { archivedAt: { not: null } }
        : { archivedAt: null }),
      ...(options.status ? { status: options.status as never } : {}),
    },
    orderBy: [
      { targetDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: 100,
  });

  if (goals.length === 0) {
    return [];
  }

  const goalIds = goals.map((goal) => goal.id);

  const [milestones, habitCounts, taskCounts] = await Promise.all([
    db.goalMilestone.findMany({
      where: { profileId: profile.id, goalId: { in: goalIds } },
      select: { goalId: true, completedAt: true },
    }),
    db.habit.groupBy({
      by: ["goalId"],
      where: {
        profileId: profile.id,
        goalId: { in: goalIds },
        archivedAt: null,
      },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["goalId"],
      where: {
        profileId: profile.id,
        goalId: { in: goalIds },
        archivedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const milestoneStats = new Map<
    string,
    { total: number; completed: number }
  >();

  for (const milestone of milestones) {
    const current = milestoneStats.get(milestone.goalId) ?? {
      total: 0,
      completed: 0,
    };

    milestoneStats.set(milestone.goalId, {
      total: current.total + 1,
      completed: current.completed + (milestone.completedAt ? 1 : 0),
    });
  }

  const habitsByGoal = new Map(
    habitCounts
      .filter((row) => row.goalId)
      .map((row) => [row.goalId!, row._count._all]),
  );
  const tasksByGoal = new Map(
    taskCounts
      .filter((row) => row.goalId)
      .map((row) => [row.goalId!, row._count._all]),
  );

  const todayKey = localDateKey(now, profile.timeZone);

  return goals.map((goal) => {
    const stats = milestoneStats.get(goal.id) ?? { total: 0, completed: 0 };

    const progressPercent = goalProgress({
      targetValue: goal.targetValue,
      currentValue: goal.currentValue,
      milestonesTotal: stats.total,
      milestonesCompleted: stats.completed,
      status: goal.status,
    });

    const targetKey = goal.targetDate ? fromDateOnly(goal.targetDate) : null;
    const startKey = localDateKey(goal.createdAt, profile.timeZone);

    const dayGap = (fromKey: string, toKey: string) =>
      Math.round(
        (toDateOnly(toKey).getTime() - toDateOnly(fromKey).getTime()) /
          86_400_000,
      );

    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      category: goal.category,
      timeframe: goal.timeframe,
      status: goal.status,
      targetDateInput: targetKey,
      targetLabel: goal.targetDate
        ? formatInTimeZone(
            goal.targetDate,
            "UTC",
            { day: "numeric", month: "short", year: "numeric" },
            profile.locale,
          )
        : null,
      daysRemaining: targetKey ? dayGap(todayKey, targetKey) : null,
      progressPercent,
      pace: targetKey
        ? goalPace(
            progressPercent,
            dayGap(startKey, todayKey),
            dayGap(startKey, targetKey),
          )
        : "UNKNOWN",
      targetValue: goal.targetValue,
      currentValue: goal.currentValue,
      unit: goal.unit,
      isMeasured: goal.targetValue !== null,
      milestonesTotal: stats.total,
      milestonesCompleted: stats.completed,
      habitCount: habitsByGoal.get(goal.id) ?? 0,
      taskCount: tasksByGoal.get(goal.id) ?? 0,
      isArchived: goal.archivedAt !== null,
    };
  });
}

export async function getGoalDetail(
  profile: Profile,
  goalId: string,
  now: Date = new Date(),
): Promise<GoalDetailDto | null> {
  const owned = await db.goal.findFirst({
    where: { id: goalId, profileId: profile.id },
    select: { id: true, archivedAt: true },
  });

  if (!owned) {
    return null;
  }

  const [goals, milestones, habits] = await Promise.all([
    listGoals(profile, { includeArchived: owned.archivedAt !== null }, now),
    db.goalMilestone.findMany({
      where: { profileId: profile.id, goalId },
      orderBy: { sortOrder: "asc" },
    }),
    listHabits(profile, {}, now),
  ]);

  const goal = goals.find((entry) => entry.id === goalId);

  if (!goal) {
    return null;
  }

  const todayKey = localDateKey(now, profile.timeZone);

  return {
    goal,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      isCompleted: milestone.completedAt !== null,
      dueLabel: milestone.dueDate
        ? formatInTimeZone(
            milestone.dueDate,
            "UTC",
            { day: "numeric", month: "short" },
            profile.locale,
          )
        : null,
      isOverdue:
        milestone.completedAt === null &&
        milestone.dueDate !== null &&
        fromDateOnly(milestone.dueDate) < todayKey,
    })),
    habits: habits.filter((habit) => habit.goalId === goalId),
  };
}

/** Life results for the global command palette. */
export async function searchLife(profile: Profile, query: string, limit = 6) {
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const contains = { contains: trimmed, mode: "insensitive" as const };

  const [goals, habits] = await Promise.all([
    db.goal.findMany({
      where: {
        profileId: profile.id,
        archivedAt: null,
        OR: [{ title: contains }, { description: contains }],
      },
      select: { id: true, title: true, category: true },
      take: 4,
    }),
    db.habit.findMany({
      where: { profileId: profile.id, archivedAt: null, name: contains },
      select: { id: true, name: true, kind: true },
      take: 3,
    }),
  ]);

  return [
    ...goals.map((goal) => ({
      id: goal.id,
      kind: "GOAL" as const,
      title: goal.title,
      subtitle: goal.category,
      href: `/goals/${goal.id}`,
    })),
    ...habits.map((habit) => ({
      id: habit.id,
      kind: "HABIT" as const,
      title: habit.name,
      subtitle: habit.kind === "QUIT" ? "Quitting" : "Habit",
      href: "/habits",
    })),
  ].slice(0, limit);
}

/** Exported for the check-in card, which shows sleep as "7h 30m". */
export function formatSleep(minutes: number | null): string | null {
  return minutes === null ? null : formatDuration(minutes);
}
