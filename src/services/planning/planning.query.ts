import "server-only";

import type { Profile } from "@/generated/prisma/client";
import {
  formatMinutesAsTime,
  localDateKey,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  eachLocalDate,
  fromDateOnly,
  toDateOnly,
} from "@/services/academics/academic.dates";
import { listHabits } from "@/services/life/habit.query";
import { getFreeTime } from "@/services/schedule/calendar.query";
import { getTodayView } from "@/services/task/task.query";
import {
  assessWorkload,
  buildDailyPlan,
  buildExamMode,
  buildRecoveryPlan,
  buildWeeklyReview,
  detectProcrastination,
  type DailyPlan,
  type PlannableItem,
  type PlanSlot,
} from "@/services/planning/planning.derive";

/**
 * Planning reads.
 *
 * Feeds REAL data into the pure engines. Nothing here calls a model: a daily
 * plan is scheduling arithmetic, and a student whose API key runs out should
 * not lose the ability to plan their day.
 *
 * The AI layer may later PHRASE a plan — it does not compute one.
 */

/** How long a topic takes, absent better information. Stated, not hidden. */
const DEFAULT_MINUTES_PER_TOPIC = 30;

/** Fallback estimate for a task with no stated duration. */
const DEFAULT_TASK_MINUTES = 30;

export type DailyPlanDto = {
  readonly dayKey: string;
  readonly blocks: readonly {
    readonly id: string;
    readonly title: string;
    readonly timeLabel: string;
    readonly minutes: number;
    readonly reasons: readonly string[];
    readonly kind: string;
    readonly isPartial: boolean;
  }[];
  readonly unplanned: readonly {
    readonly title: string;
    readonly reason: string;
  }[];
  readonly plannedMinutes: number;
  readonly availableMinutes: number;
  readonly workload: {
    readonly verdict: string;
    readonly ratio: number | null;
  };
  /** True when there is genuinely nothing to plan. */
  readonly isEmpty: boolean;
};

/**
 * Builds a plan for one local day.
 *
 * Slots come from the calendar's free-time engine, so a plan never books a
 * user over a class. Peak hours are the profile's own study window.
 */
export async function buildPlanForDay(
  profile: Profile,
  dayKey: string,
  now: Date = new Date(),
): Promise<DailyPlanDto> {
  const [slots, today] = await Promise.all([
    getFreeTime(profile, dayKey, 15, now),
    getTodayView(profile, now),
  ]);

  const dayStart = startOfLocalDay(toDateOnly(dayKey), profile.timeZone);
  const toMinute = (date: Date) =>
    Math.round((date.getTime() - dayStart.getTime()) / 60_000);

  const planSlots: PlanSlot[] = slots.map((slot) => {
    const startMinute = toMinute(slot.startAt);

    return {
      startMinute,
      endMinute: toMinute(slot.endAt),
      // The profile's own stated study window is treated as peak.
      isPeak:
        startMinute >= profile.studyHoursStart &&
        startMinute < profile.studyHoursEnd,
    };
  });

  // Overdue first, then today's — the order the priority engine already
  // produced, converted into plannable items.
  const candidates: PlannableItem[] = [...today.overdue, ...today.dueToday]
    .filter((task) => !task.isCompleted)
    .map((task, index) => ({
      id: task.id,
      title: task.title,
      // Preserve the engine's ordering as a descending score.
      score: 1000 - index,
      estimatedMinutes: task.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
      energy: task.energy,
      dueDayKey: task.dueLabel ? dayKey : null,
      isOverdue: task.isOverdue,
      kind: "TASK" as const,
    }));

  const plan: DailyPlan = buildDailyPlan(candidates, planSlots);

  const requiredMinutes = candidates.reduce(
    (total, candidate) => total + candidate.estimatedMinutes,
    0,
  );

  const workload = assessWorkload(requiredMinutes, plan.availableMinutes);

  return {
    dayKey,
    blocks: plan.blocks.map((block) => ({
      id: block.item.id,
      title: block.item.title,
      timeLabel: `${formatMinutesAsTime(block.startMinute)}–${formatMinutesAsTime(block.endMinute)}`,
      minutes: block.minutes,
      reasons: block.reasons,
      kind: block.item.kind,
      isPartial: block.isPartial,
    })),
    unplanned: plan.unplanned.map((entry) => ({
      title: entry.item.title,
      reason: entry.reason,
    })),
    plannedMinutes: plan.plannedMinutes,
    availableMinutes: plan.availableMinutes,
    workload: { verdict: workload.verdict, ratio: workload.ratio },
    isEmpty: candidates.length === 0,
  };
}

/** The weekend planner: the same engine, run across Saturday and Sunday. */
export async function buildWeekendPlan(
  profile: Profile,
  now: Date = new Date(),
): Promise<readonly DailyPlanDto[]> {
  const todayKey = localDateKey(now, profile.timeZone);
  const cursor = toDateOnly(todayKey);

  const days: string[] = [];

  // The next Saturday and Sunday, inclusive of today if it is one.
  for (let offset = 0; offset < 7 && days.length < 2; offset += 1) {
    const candidate = new Date(cursor.getTime() + offset * 86_400_000);
    const weekday = candidate.getUTCDay();

    if (weekday === 6 || weekday === 0) {
      days.push(fromDateOnly(candidate));
    }
  }

  return Promise.all(
    days.map((dayKey) => buildPlanForDay(profile, dayKey, now)),
  );
}

/**
 * Items the user keeps deferring.
 *
 * Reschedule counts come from the ACTIVITY LOG — the record of what actually
 * happened — rather than a counter that could drift.
 */
export async function getProcrastinationSignals(
  profile: Profile,
  now: Date = new Date(),
) {
  const tasks = await db.task.findMany({
    where: {
      profileId: profile.id,
      archivedAt: null,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: { id: true, title: true, createdAt: true, status: true },
    take: 200,
  });

  if (tasks.length === 0) {
    return [];
  }

  const reschedules = await db.activityEvent.groupBy({
    by: ["entityId"],
    where: {
      profileId: profile.id,
      entityType: "task",
      action: "RESCHEDULED",
      entityId: { in: tasks.map((task) => task.id) },
    },
    _count: { _all: true },
  });

  const countById = new Map(
    reschedules.map((row) => [row.entityId, row._count._all]),
  );

  return detectProcrastination(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      rescheduleCount: countById.get(task.id) ?? 0,
      daysSinceCreated: Math.floor(
        (now.getTime() - task.createdAt.getTime()) / 86_400_000,
      ),
      isCompleted: false,
    })),
  );
}

/** Whether the user is badly enough behind to need triage. */
export async function getRecoveryPlan(
  profile: Profile,
  now: Date = new Date(),
) {
  const [today, slots] = await Promise.all([
    getTodayView(profile, now),
    getFreeTime(profile, localDateKey(now, profile.timeZone), 15, now),
  ]);

  const availableMinutes = slots.reduce(
    (total, slot) => total + slot.minutes,
    0,
  );

  const active = [...today.overdue, ...today.dueToday].filter(
    (task) => !task.isCompleted,
  );

  return buildRecoveryPlan({
    overdueCount: today.statistics.overdueCount,
    dueTodayCount: today.statistics.dueTodayTotal,
    availableMinutes,
    requiredMinutes: active.reduce(
      (total, task) => total + (task.estimatedMinutes ?? DEFAULT_TASK_MINUTES),
      0,
    ),
    rankedTitles: active.map((task) => task.title),
  });
}

/** Study pacing for the nearest upcoming exam. */
export async function getExamMode(profile: Profile, now: Date = new Date()) {
  const exam = await db.exam.findFirst({
    where: {
      profileId: profile.id,
      startAt: { gte: startOfLocalDay(now, profile.timeZone) },
    },
    include: { topics: { select: { isCompleted: true } } },
    orderBy: { startAt: "asc" },
  });

  if (!exam || !exam.startAt) {
    return buildExamMode({
      examTitle: null,
      daysUntil: null,
      topicsTotal: 0,
      topicsCompleted: 0,
      minutesPerTopic: DEFAULT_MINUTES_PER_TOPIC,
      dailyStudyCapacityMinutes: 0,
    });
  }

  const daysUntil = Math.floor(
    (startOfLocalDay(exam.startAt, profile.timeZone).getTime() -
      startOfLocalDay(now, profile.timeZone).getTime()) /
      86_400_000,
  );

  return buildExamMode({
    examTitle: exam.title,
    daysUntil,
    topicsTotal: exam.topics.length,
    topicsCompleted: exam.topics.filter((topic) => topic.isCompleted).length,
    minutesPerTopic: DEFAULT_MINUTES_PER_TOPIC,
    // The profile's own stated study window — not an invented capacity.
    dailyStudyCapacityMinutes: profile.studyHoursEnd - profile.studyHoursStart,
  });
}

/** The week just gone, summarised from counts. */
export async function getWeeklyReview(
  profile: Profile,
  now: Date = new Date(),
) {
  const weekStart = startOfLocalDayOffset(now, profile.timeZone, -7);
  const todayKey = localDateKey(now, profile.timeZone);

  const [completed, created, due, habits, sessions] = await Promise.all([
    db.task.count({
      where: {
        profileId: profile.id,
        completedAt: { gte: weekStart },
      },
    }),
    db.task.count({
      where: { profileId: profile.id, createdAt: { gte: weekStart } },
    }),
    db.task.count({
      where: {
        profileId: profile.id,
        archivedAt: null,
        dueAt: { gte: weekStart, lt: now },
      },
    }),
    listHabits(profile, {}, now),
    db.studySession.findMany({
      where: { profileId: profile.id, startedAt: { gte: weekStart } },
      select: { startedAt: true, durationMinutes: true },
    }),
  ]);

  // Habit scheduling across the week, from each habit's own recent strip.
  let habitScheduled = 0;
  let habitCompleted = 0;

  for (const habit of habits) {
    for (const day of habit.recentDays) {
      if (!day.isScheduled) continue;

      habitScheduled += 1;
      if (day.status === "DONE") habitCompleted += 1;
    }
  }

  const minutesPerDay: Record<string, number> = {};

  for (const dayKey of eachLocalDate(
    localDateKey(weekStart, profile.timeZone),
    todayKey,
  )) {
    minutesPerDay[dayKey] = 0;
  }

  for (const session of sessions) {
    const dayKey = localDateKey(session.startedAt, profile.timeZone);
    minutesPerDay[dayKey] =
      (minutesPerDay[dayKey] ?? 0) + (session.durationMinutes ?? 0);
  }

  return buildWeeklyReview({
    completedCount: completed,
    createdCount: created,
    dueCount: due,
    habitScheduled,
    habitCompleted,
    minutesPerDay,
  });
}
