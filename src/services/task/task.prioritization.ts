import { isActive, isOverdue } from "@/services/task/task.derive";

/**
 * Deterministic task prioritisation.
 *
 * This is NOT AI and does not call a model. It is an explicit, inspectable
 * scoring function — which is the point: the ranking has to be explainable
 * and reproducible before Phase 9 is allowed to layer a planner on top of it.
 *
 * Pure by construction: (tasks, now, timeZone) in, ordering out. No database,
 * no React, no clock of its own. Every weight below is a named constant so
 * tuning the behaviour never means hunting through arithmetic.
 */

export type PrioritizableTask = {
  readonly id: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: Date | null;
  readonly isAllDay: boolean;
  readonly estimatedMinutes: number | null;
  readonly completedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
};

/** Base weight per priority level. The dominant term for undated work. */
const PRIORITY_WEIGHT: Readonly<Record<string, number>> = {
  URGENT: 400,
  HIGH: 250,
  MEDIUM: 120,
  LOW: 40,
};

const URGENCY = {
  /** Overdue work outranks everything else that is merely scheduled. */
  OVERDUE_BASE: 500,
  /** Additional weight per day late, capped so week-old items do not bury today's. */
  OVERDUE_PER_DAY: 25,
  OVERDUE_MAX_DAYS: 14,
  DUE_TODAY: 300,
  DUE_TOMORROW: 150,
  DUE_THIS_WEEK: 80,
  /** Decay for anything further out, so next month does not crowd next week. */
  DUE_LATER: 20,
  /** Undated work is real work, but it is never the thing that is on fire. */
  NO_DUE_DATE: 0,
} as const;

const EFFORT = {
  /** A small nudge for quick wins, never enough to outrank real urgency. */
  QUICK_WIN_MINUTES: 15,
  QUICK_WIN_BONUS: 30,
  /** Large unestimated-feeling blocks are slightly deprioritised for "now". */
  LONG_TASK_MINUTES: 180,
  LONG_TASK_PENALTY: 20,
} as const;

const STATUS = {
  /** Something already begun is the cheapest thing to finish. */
  IN_PROGRESS_BONUS: 120,
  /**
   * Blocked work cannot be acted on. Heavily penalised rather than excluded,
   * so it still appears if it is genuinely all that is left.
   */
  BLOCKED_PENALTY: 400,
} as const;

export type TaskScore = {
  readonly taskId: string;
  readonly score: number;
  /** Human-readable justifications, highest-impact first. */
  readonly reasons: readonly string[];
};

/**
 * Scores one task for "what should I do right now?".
 *
 * Higher is more pressing. Terminal and archived tasks score `-Infinity` so
 * they can never be recommended.
 */
export function scoreTask(
  task: PrioritizableTask,
  now: Date,
  timeZone: string,
  helpers: {
    endOfLocalDay: (date: Date, timeZone: string) => Date;
    localDayDifference: (from: Date, to: Date, timeZone: string) => number;
  },
): TaskScore {
  if (!isActive(task)) {
    return { taskId: task.id, score: -Infinity, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;

  // --- Urgency -----------------------------------------------------------
  if (task.dueAt === null) {
    score += URGENCY.NO_DUE_DATE;
  } else if (isOverdue(task, now, timeZone, helpers.endOfLocalDay)) {
    const daysLate = Math.min(
      Math.max(helpers.localDayDifference(task.dueAt, now, timeZone), 0),
      URGENCY.OVERDUE_MAX_DAYS,
    );

    score += URGENCY.OVERDUE_BASE + daysLate * URGENCY.OVERDUE_PER_DAY;
    reasons.push("Overdue");
  } else {
    const daysUntil = helpers.localDayDifference(now, task.dueAt, timeZone);

    if (daysUntil <= 0) {
      score += URGENCY.DUE_TODAY;
      reasons.push("Due today");
    } else if (daysUntil === 1) {
      score += URGENCY.DUE_TOMORROW;
      reasons.push("Due tomorrow");
    } else if (daysUntil <= 7) {
      score += URGENCY.DUE_THIS_WEEK;
      reasons.push("Due this week");
    } else {
      score += URGENCY.DUE_LATER;
    }
  }

  // --- Priority ----------------------------------------------------------
  score += PRIORITY_WEIGHT[task.priority] ?? PRIORITY_WEIGHT.MEDIUM;

  if (task.priority === "URGENT" || task.priority === "HIGH") {
    reasons.push(`${task.priority === "URGENT" ? "Urgent" : "High"} priority`);
  }

  // --- Status ------------------------------------------------------------
  if (task.status === "IN_PROGRESS") {
    score += STATUS.IN_PROGRESS_BONUS;
    reasons.push("Already started");
  }

  if (task.status === "BLOCKED") {
    score -= STATUS.BLOCKED_PENALTY;
    reasons.push("Blocked");
  }

  // --- Effort ------------------------------------------------------------
  if (task.estimatedMinutes !== null) {
    if (task.estimatedMinutes <= EFFORT.QUICK_WIN_MINUTES) {
      score += EFFORT.QUICK_WIN_BONUS;
      reasons.push("Quick win");
    } else if (task.estimatedMinutes >= EFFORT.LONG_TASK_MINUTES) {
      score -= EFFORT.LONG_TASK_PENALTY;
    }
  }

  return { taskId: task.id, score, reasons };
}

/**
 * Orders tasks by score, most pressing first.
 *
 * Ties break on due date, then on creation time, then on id — so the ordering
 * is total and stable. An unstable ranking would reshuffle the list on every
 * refresh, which reads as a bug even when the scores are right.
 */
export function rankTasks<T extends PrioritizableTask>(
  tasks: readonly T[],
  now: Date,
  timeZone: string,
  helpers: {
    endOfLocalDay: (date: Date, timeZone: string) => Date;
    localDayDifference: (from: Date, to: Date, timeZone: string) => number;
  },
): readonly { task: T; score: TaskScore }[] {
  return tasks
    .map((task) => ({ task, score: scoreTask(task, now, timeZone, helpers) }))
    .sort((a, b) => {
      if (b.score.score !== a.score.score) {
        return b.score.score - a.score.score;
      }

      const dueA = a.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const dueB = b.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;

      if (dueA !== dueB) {
        return dueA - dueB;
      }

      const createdDelta =
        a.task.createdAt.getTime() - b.task.createdAt.getTime();

      return createdDelta !== 0
        ? createdDelta
        : a.task.id.localeCompare(b.task.id);
    });
}

/**
 * The single task to lead with, or `null` when there is nothing actionable.
 *
 * Blocked tasks are excluded here even though they are only penalised in the
 * score: recommending something the user has explicitly marked as unable to
 * proceed would be actively unhelpful.
 */
export function selectNextBestAction<T extends PrioritizableTask>(
  tasks: readonly T[],
  now: Date,
  timeZone: string,
  helpers: {
    endOfLocalDay: (date: Date, timeZone: string) => Date;
    localDayDifference: (from: Date, to: Date, timeZone: string) => number;
  },
): { task: T; reasons: readonly string[] } | null {
  const ranked = rankTasks(
    tasks.filter((task) => task.status !== "BLOCKED"),
    now,
    timeZone,
    helpers,
  );

  const best = ranked[0];

  if (!best || best.score.score === -Infinity) {
    return null;
  }

  return { task: best.task, reasons: best.score.reasons };
}

/** Exposed so tests assert against the real weights, not copies of them. */
export const PRIORITIZATION_WEIGHTS = {
  PRIORITY_WEIGHT,
  URGENCY,
  EFFORT,
  STATUS,
} as const;
