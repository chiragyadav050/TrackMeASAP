import "server-only";

import type { Profile } from "@/generated/prisma/client";
import {
  localDateKey,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { db } from "@/server/db";
import { getAcademicOverview } from "@/services/academics/academic.query";
import { listHabits } from "@/services/life/habit.query";
import { getFreeTime } from "@/services/schedule/calendar.query";
import { getTodayView } from "@/services/task/task.query";
import { listProjects } from "@/services/work/work.query";
import {
  assessDeadlineRisk,
  buildTimeAudit,
  calculateLifeScore,
  detectBehaviourPatterns,
  detectForgotten,
  selectProactiveInsights,
  type DeadlineRisk,
  type Insight,
} from "@/services/intelligence/intelligence.derive";

/**
 * Proactive intelligence reads.
 *
 * Feeds real data into the pure engines. Like Phase 9, NO MODEL IS INVOLVED:
 * every finding is arithmetic over the user's own records, so every claim can
 * be checked against the numbers shown beside it.
 */

const ANALYSIS_WINDOW_DAYS = 28;
const DEFAULT_TASK_MINUTES = 30;

export type IntelligenceReport = {
  readonly forgotten: ReturnType<typeof detectForgotten>;
  readonly deadlineRisks: readonly DeadlineRisk[];
  readonly patterns: ReturnType<typeof detectBehaviourPatterns>;
  readonly lifeScore: ReturnType<typeof calculateLifeScore>;
  readonly timeAudit: ReturnType<typeof buildTimeAudit>;
  readonly insights: readonly Insight[];
  /** True when there is genuinely too little tracked to say anything. */
  readonly isQuiet: boolean;
};

/**
 * Minutes genuinely available per day.
 *
 * Measured from TODAY'S actual free time rather than the theoretical
 * working-hours window: a student whose days are full of classes does not
 * have eight free hours, and telling them a deadline is comfortable on that
 * basis would be exactly the kind of confident wrong answer this phase must
 * avoid.
 *
 * Falls back to the stated working window only when today happens to be
 * entirely booked, so one unusual day cannot make every deadline look
 * impossible.
 */
function dailyCapacityMinutes(
  profile: Profile,
  freeMinutesToday: number,
): number {
  if (freeMinutesToday > 0) {
    return freeMinutesToday;
  }

  return Math.max(0, profile.workingHoursEnd - profile.workingHoursStart);
}

/**
 * Everything the system has noticed, with its evidence.
 *
 * Runs its slices in parallel. Every finding carries the numbers it came
 * from; nothing is asserted without them.
 */
export async function buildIntelligenceReport(
  profile: Profile,
  now: Date = new Date(),
): Promise<IntelligenceReport> {
  const windowStart = startOfLocalDayOffset(
    now,
    profile.timeZone,
    -ANALYSIS_WINDOW_DAYS,
  );

  const [
    staleTasks,
    projects,
    today,
    academics,
    habits,
    completions,
    studySessions,
    checkInCount,
    slots,
  ] = await Promise.all([
    db.task.findMany({
      where: {
        profileId: profile.id,
        archivedAt: null,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        dueAt: null,
      },
      select: { id: true, title: true, updatedAt: true },
      take: 200,
    }),
    listProjects(
      profile,
      { view: "ACTIVE", sort: "TARGET_DATE" } as never,
      now,
    ),
    getTodayView(profile, now),
    getAcademicOverview(profile),
    listHabits(profile, {}, now),
    db.task.findMany({
      where: {
        profileId: profile.id,
        completedAt: { gte: windowStart },
      },
      select: { completedAt: true },
    }),
    db.studySession.findMany({
      where: { profileId: profile.id, startedAt: { gte: windowStart } },
      select: { durationMinutes: true, subject: { select: { name: true } } },
    }),
    db.dailyCheckIn.count({
      where: { profileId: profile.id, checkInDate: { gte: windowStart } },
    }),
    getFreeTime(profile, localDateKey(now, profile.timeZone), 15, now),
  ]);

  // -------------------------------------------------------------------------
  // Forgotten
  // -------------------------------------------------------------------------

  const forgotten = detectForgotten([
    ...staleTasks.map((task) => ({
      id: task.id,
      title: task.title,
      kind: "TASK" as const,
      daysUntouched: Math.floor(
        (now.getTime() - task.updatedAt.getTime()) / 86_400_000,
      ),
      hasDueDate: false,
    })),
    ...projects.map((project) => ({
      id: project.id,
      title: project.name,
      kind: "PROJECT" as const,
      daysUntouched: Math.floor(
        (now.getTime() - project.updatedAt.getTime()) / 86_400_000,
      ),
      hasDueDate: project.targetEndAt !== null,
    })),
  ]);

  // -------------------------------------------------------------------------
  // Deadline risk
  // -------------------------------------------------------------------------

  const capacity = dailyCapacityMinutes(
    profile,
    slots.reduce((total, slot) => total + slot.minutes, 0),
  );

  const deadlineRisks = projects
    .filter((project) => project.daysRemaining !== null)
    .map((project) => {
      const openTasks = project.taskTotal - project.taskCompleted;

      return assessDeadlineRisk({
        id: project.id,
        title: project.name,
        daysRemaining: project.daysRemaining!,
        remainingMinutes: openTasks * DEFAULT_TASK_MINUTES,
        availableMinutesPerDay: capacity,
      });
    })
    .filter((risk) => risk.level === "AT_RISK" || risk.level === "IMPOSSIBLE");

  // -------------------------------------------------------------------------
  // Behaviour patterns
  // -------------------------------------------------------------------------

  const completionsByWeekday: Record<number, number> = {};

  for (const row of completions) {
    if (!row.completedAt) continue;

    // ISO weekday in the PROFILE's zone — a 23:30 completion belongs to that
    // local day, not to the server's.
    const localMidnight = startOfLocalDay(row.completedAt, profile.timeZone);
    const day = new Date(localMidnight.getTime());
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();

    completionsByWeekday[weekday] = (completionsByWeekday[weekday] ?? 0) + 1;
  }

  const halfway = new Date(
    windowStart.getTime() + (now.getTime() - windowStart.getTime()) / 2,
  );

  const recentCount = completions.filter(
    (row) => row.completedAt && row.completedAt >= halfway,
  ).length;
  const previousCount = completions.length - recentCount;

  const patterns = detectBehaviourPatterns({
    completionsByWeekday,
    totalObservations: completions.length,
    // Rates are only meaningful with something to compare; below the sample
    // floor both are null and the engine stays silent.
    recentRate:
      completions.length >= 10
        ? (recentCount / completions.length) * 100
        : null,
    previousRate:
      completions.length >= 10
        ? (previousCount / completions.length) * 100
        : null,
  });

  // -------------------------------------------------------------------------
  // Life score
  // -------------------------------------------------------------------------

  let habitScheduled = 0;
  let habitCompleted = 0;

  for (const habit of habits) {
    for (const day of habit.recentDays) {
      if (!day.isScheduled) continue;

      habitScheduled += 1;
      if (day.status === "DONE") habitCompleted += 1;
    }
  }

  const lifeScore = calculateLifeScore({
    taskCompletionRate:
      today.statistics.dueTodayTotal > 0
        ? today.statistics.todayCompletionPercent
        : null,
    attendancePercent: academics.attendance?.percentage ?? null,
    habitConsistency:
      habitScheduled > 0 ? (habitCompleted / habitScheduled) * 100 : null,
    checkInCount,
    checkInDaysPossible: ANALYSIS_WINDOW_DAYS,
  });

  // -------------------------------------------------------------------------
  // Time audit
  // -------------------------------------------------------------------------

  const timeAudit = buildTimeAudit(
    studySessions.map((session) => ({
      category: session.subject?.name ?? "Unassigned study",
      minutes: session.durationMinutes ?? 0,
    })),
  );

  // -------------------------------------------------------------------------
  // What is worth interrupting for
  // -------------------------------------------------------------------------

  const candidates: Insight[] = [];

  for (const risk of deadlineRisks.slice(0, 3)) {
    candidates.push({
      key: `deadline:${risk.id}:${localDateKey(now, profile.timeZone)}`,
      title:
        risk.level === "IMPOSSIBLE"
          ? `${risk.title} cannot be finished in time`
          : `${risk.title} is at risk`,
      body:
        risk.level === "IMPOSSIBLE"
          ? "Something will have to change — the scope, the deadline, or both."
          : "It needs more time per day than you currently have free.",
      evidence: risk.evidence,
      severity: risk.level === "IMPOSSIBLE" ? "URGENT" : "WARN",
      href: `/projects/${risk.id}`,
    });
  }

  const criticalSubjects = (academics.attendance?.risk ?? null) === "CRITICAL";

  if (criticalSubjects && academics.attendance) {
    candidates.push({
      key: `attendance:${localDateKey(now, profile.timeZone)}`,
      title: "Attendance is below the requirement",
      body: "Missing more classes makes this harder to recover.",
      evidence: `Attendance is ${Math.round(academics.attendance.percentage ?? 0)}% against a ${academics.attendance.thresholdPercent}% requirement.`,
      severity: "URGENT",
      href: "/academics/attendance",
    });
  }

  if (forgotten.length >= 3) {
    candidates.push({
      key: `forgotten:${localDateKey(now, profile.timeZone)}`,
      title: `${forgotten.length} things have gone quiet`,
      body: "They have no due date and have not changed in a month.",
      evidence: forgotten
        .slice(0, 3)
        .map((item) => `${item.title} — ${item.evidence}`)
        .join(" "),
      severity: "INFO",
      href: "/tasks",
    });
  }

  for (const pattern of patterns) {
    candidates.push({
      key: `pattern:${pattern.kind}:${localDateKey(now, profile.timeZone)}`,
      title: pattern.statement,
      body: "Noticed from your completion history.",
      evidence: pattern.evidence,
      severity: "INFO",
      href: "/plan",
    });
  }

  // Already-sent keys come from the notification table, so a restart cannot
  // cause the same insight to be delivered twice.
  const alreadySent = await db.notification.findMany({
    where: {
      profileId: profile.id,
      kind: "PROACTIVE",
      scheduledFor: { gte: startOfLocalDay(now, profile.timeZone) },
    },
    select: { dedupeKey: true },
  });

  const insights = selectProactiveInsights(
    candidates,
    alreadySent.map((row) => row.dedupeKey),
  );

  return {
    forgotten,
    deadlineRisks,
    patterns,
    lifeScore,
    timeAudit,
    insights,
    isQuiet:
      forgotten.length === 0 &&
      deadlineRisks.length === 0 &&
      patterns.length === 0 &&
      lifeScore.overall === null,
  };
}
