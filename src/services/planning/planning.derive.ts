/**
 * Pure planning intelligence.
 *
 * NO MODEL REQUIRED. This is the deliberate architectural choice of Phase 9:
 * a daily plan is scheduling arithmetic, not a language problem, and a student
 * whose API key runs out should not lose the ability to plan their day. The AI
 * layer above may PHRASE a plan, but it does not compute one.
 *
 * No Prisma, no React, no clock of its own — same contract as every other
 * derive module.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type PlannableItem = {
  readonly id: string;
  readonly title: string;
  /** Higher is more urgent. Supplied by the caller's priority engine. */
  readonly score: number;
  readonly estimatedMinutes: number;
  /** HIGH-energy work belongs in a peak slot, not at 11pm. */
  readonly energy: "LOW" | "MEDIUM" | "HIGH";
  /** Local day key the item is due, if any. */
  readonly dueDayKey: string | null;
  readonly isOverdue: boolean;
  readonly kind: "TASK" | "ASSIGNMENT" | "STUDY" | "HABIT";
};

export type PlanSlot = {
  readonly startMinute: number;
  readonly endMinute: number;
  /** True inside the profile's stated peak hours. */
  readonly isPeak: boolean;
};

export type PlannedBlock = {
  readonly item: PlannableItem;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly minutes: number;
  /** Why this item landed here. Shown to the user verbatim. */
  readonly reasons: readonly string[];
  /** True when the item did not fit whole and was split. */
  readonly isPartial: boolean;
};

export type DailyPlan = {
  readonly blocks: readonly PlannedBlock[];
  /** Items that could not be fitted at all, with the honest reason. */
  readonly unplanned: readonly {
    readonly item: PlannableItem;
    readonly reason: string;
  }[];
  readonly plannedMinutes: number;
  readonly availableMinutes: number;
};

/** Below this, a fragment is interruption rather than work. */
export const MINIMUM_BLOCK_MINUTES = 15;

/** Nobody does four hours of one thing without a break. */
export const MAX_BLOCK_MINUTES = 90;

/** A gap left after each block so a plan is not shoulder-to-shoulder. */
export const BREAK_MINUTES = 10;

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Fits work into the day's free slots.
 *
 * The rules, in order of application:
 *
 *  1. Items are taken in score order — the caller's priority engine decides
 *     what matters, not this function.
 *  2. HIGH-energy work prefers a PEAK slot. If none is free it still gets
 *     scheduled, because an unscheduled important task helps nobody, but the
 *     reason records that it landed outside peak hours.
 *  3. A long item is SPLIT across slots rather than dropped, but never into
 *     fragments below `MINIMUM_BLOCK_MINUTES`.
 *  4. Anything that does not fit is returned in `unplanned` WITH A REASON.
 *     Silently dropping work would make the plan a lie.
 *
 * Deterministic: the same inputs always produce the same plan. A planner that
 * shuffles between refreshes cannot be trusted or debugged.
 */
export function buildDailyPlan(
  items: readonly PlannableItem[],
  slots: readonly PlanSlot[],
): DailyPlan {
  // Copy before sorting: mutating a caller's array is how spooky bugs start.
  const ordered = [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable tiebreak so the plan does not reorder between identical runs.
    return a.id.localeCompare(b.id);
  });

  const remaining = slots
    .map((slot) => ({ ...slot, cursor: slot.startMinute }))
    .sort((a, b) => a.startMinute - b.startMinute);

  const availableMinutes = slots.reduce(
    (total, slot) => total + (slot.endMinute - slot.startMinute),
    0,
  );

  const blocks: PlannedBlock[] = [];
  const unplanned: { item: PlannableItem; reason: string }[] = [];

  for (const item of ordered) {
    let needed = Math.max(MINIMUM_BLOCK_MINUTES, item.estimatedMinutes);
    let placedAny = false;

    // Rule 2: try peak slots first for HIGH-energy work.
    const passes =
      item.energy === "HIGH"
        ? [remaining.filter((slot) => slot.isPeak), remaining]
        : [remaining];

    for (const pass of passes) {
      for (const slot of pass) {
        if (needed < MINIMUM_BLOCK_MINUTES) break;

        const free = slot.endMinute - slot.cursor;

        if (free < MINIMUM_BLOCK_MINUTES) continue;

        const length = Math.min(needed, free, MAX_BLOCK_MINUTES);

        // Rule 3: never create a fragment too small to be useful.
        if (length < MINIMUM_BLOCK_MINUTES) continue;

        const reasons = buildReasons(item, slot, needed > length);

        blocks.push({
          item,
          startMinute: slot.cursor,
          endMinute: slot.cursor + length,
          minutes: length,
          reasons,
          isPartial: needed > length,
        });

        slot.cursor += length + BREAK_MINUTES;
        needed -= length;
        placedAny = true;
      }

      if (needed < MINIMUM_BLOCK_MINUTES) break;
    }

    if (!placedAny) {
      // Rule 4: an honest reason, not silence.
      unplanned.push({
        item,
        reason:
          availableMinutes === 0
            ? "There is no free time today."
            : "There was no gap long enough left in the day.",
      });
      continue;
    }

    if (needed >= MINIMUM_BLOCK_MINUTES) {
      unplanned.push({
        item,
        reason: `Only part of this fitted; ${needed} minutes still need a slot.`,
      });
    }
  }

  return {
    blocks: blocks.sort((a, b) => a.startMinute - b.startMinute),
    unplanned,
    plannedMinutes: blocks.reduce((total, block) => total + block.minutes, 0),
    availableMinutes,
  };
}

function buildReasons(
  item: PlannableItem,
  slot: { isPeak: boolean },
  isSplit: boolean,
): string[] {
  const reasons: string[] = [];

  if (item.isOverdue) {
    reasons.push("Already overdue");
  } else if (item.dueDayKey) {
    reasons.push("Due today");
  }

  if (item.energy === "HIGH") {
    reasons.push(
      slot.isPeak
        ? "Demanding work, placed in your peak hours"
        : "Demanding work, but no peak time was free",
    );
  }

  if (isSplit) {
    reasons.push("Split because no single gap was long enough");
  }

  if (reasons.length === 0) {
    reasons.push("Fits the time available");
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export type WorkloadVerdict =
  "LIGHT" | "COMFORTABLE" | "FULL" | "OVERCOMMITTED";

/**
 * Whether a day's commitments fit the day.
 *
 * Compares required minutes against available minutes. `OVERCOMMITTED` is
 * reported plainly rather than softened — telling a student a 14-hour day is
 * "ambitious" is the kind of dishonesty that makes a planner useless.
 */
export function assessWorkload(
  requiredMinutes: number,
  availableMinutes: number,
): { readonly verdict: WorkloadVerdict; readonly ratio: number | null } {
  if (availableMinutes <= 0) {
    return {
      verdict: requiredMinutes > 0 ? "OVERCOMMITTED" : "LIGHT",
      ratio: null,
    };
  }

  const ratio = requiredMinutes / availableMinutes;

  if (ratio > 1) return { verdict: "OVERCOMMITTED", ratio };
  if (ratio >= 0.8) return { verdict: "FULL", ratio };
  if (ratio >= 0.4) return { verdict: "COMFORTABLE", ratio };

  return { verdict: "LIGHT", ratio };
}

// ---------------------------------------------------------------------------
// Procrastination
// ---------------------------------------------------------------------------

export type ProcrastinationSignal = {
  readonly itemId: string;
  readonly title: string;
  /** How many times the due date has been pushed. */
  readonly rescheduleCount: number;
  readonly daysSinceCreated: number;
  readonly severity: "WATCH" | "STUCK";
};

/**
 * Items that keep being deferred.
 *
 * Deliberately conservative: a task rescheduled once is a person with a
 * changing day, not a problem. The signal fires at THREE reschedules, or at
 * two on something older than a fortnight — patterns rather than moments.
 *
 * This is pattern DETECTION, not diagnosis. It reports what happened; it does
 * not claim to know why, and the UI wording follows suit.
 */
export function detectProcrastination(
  items: readonly {
    id: string;
    title: string;
    rescheduleCount: number;
    daysSinceCreated: number;
    isCompleted: boolean;
  }[],
): readonly ProcrastinationSignal[] {
  return items
    .filter((item) => !item.isCompleted)
    .filter(
      (item) =>
        item.rescheduleCount >= STUCK_RESCHEDULES ||
        (item.rescheduleCount >= WATCH_RESCHEDULES &&
          item.daysSinceCreated >= STALE_DAYS),
    )
    .map((item) => ({
      itemId: item.id,
      title: item.title,
      rescheduleCount: item.rescheduleCount,
      daysSinceCreated: item.daysSinceCreated,
      severity:
        item.rescheduleCount >= STUCK_RESCHEDULES
          ? ("STUCK" as const)
          : ("WATCH" as const),
    }))
    .sort((a, b) => b.rescheduleCount - a.rescheduleCount);
}

const WATCH_RESCHEDULES = 2;
const STUCK_RESCHEDULES = 3;
const STALE_DAYS = 14;

// ---------------------------------------------------------------------------
// Recovery mode
// ---------------------------------------------------------------------------

export type RecoveryPlan = {
  readonly isNeeded: boolean;
  readonly reason: string | null;
  /** The few things to do first, in order. */
  readonly focus: readonly string[];
  /** What to explicitly let go of, named rather than implied. */
  readonly defer: readonly string[];
};

/**
 * What to do when someone is badly behind.
 *
 * Triggered by a real backlog, not by a mood. The output NAMES what to drop —
 * a recovery plan that only says "prioritise" leaves the hardest decision
 * with the person who is already overwhelmed.
 */
export function buildRecoveryPlan(input: {
  readonly overdueCount: number;
  readonly dueTodayCount: number;
  readonly availableMinutes: number;
  readonly requiredMinutes: number;
  /** Already ordered by the priority engine. */
  readonly rankedTitles: readonly string[];
}): RecoveryPlan {
  const workload = assessWorkload(
    input.requiredMinutes,
    input.availableMinutes,
  );

  const isNeeded =
    input.overdueCount >= RECOVERY_OVERDUE_THRESHOLD ||
    workload.verdict === "OVERCOMMITTED";

  if (!isNeeded) {
    return { isNeeded: false, reason: null, focus: [], defer: [] };
  }

  const reason =
    input.overdueCount >= RECOVERY_OVERDUE_THRESHOLD
      ? `${input.overdueCount} things are overdue.`
      : "Today needs more hours than it has.";

  // Only as many as genuinely fit. Promising more is how a recovery plan
  // becomes another thing to fail at.
  const capacity = Math.max(
    1,
    Math.floor(input.availableMinutes / TYPICAL_BLOCK_MINUTES),
  );

  return {
    isNeeded: true,
    reason,
    focus: input.rankedTitles.slice(0, Math.min(capacity, RECOVERY_FOCUS_MAX)),
    defer: input.rankedTitles.slice(Math.min(capacity, RECOVERY_FOCUS_MAX)),
  };
}

const RECOVERY_OVERDUE_THRESHOLD = 5;
const RECOVERY_FOCUS_MAX = 3;
const TYPICAL_BLOCK_MINUTES = 45;

// ---------------------------------------------------------------------------
// Exam mode
// ---------------------------------------------------------------------------

export type ExamModePlan = {
  readonly isActive: boolean;
  readonly examTitle: string | null;
  readonly daysUntil: number | null;
  /** Suggested study minutes per day to cover the remaining topics. */
  readonly dailyStudyMinutes: number | null;
  readonly topicsRemaining: number;
  readonly warning: string | null;
};

/**
 * Study pacing for an approaching exam.
 *
 * Activates inside `EXAM_MODE_DAYS`. The daily figure is arithmetic —
 * remaining topics × minutes each ÷ days left — and when that exceeds what a
 * person can actually do, it SAYS SO instead of quietly recommending a
 * sixteen-hour day.
 */
export function buildExamMode(input: {
  readonly examTitle: string | null;
  readonly daysUntil: number | null;
  readonly topicsTotal: number;
  readonly topicsCompleted: number;
  readonly minutesPerTopic: number;
  readonly dailyStudyCapacityMinutes: number;
}): ExamModePlan {
  if (
    input.examTitle === null ||
    input.daysUntil === null ||
    input.daysUntil < 0 ||
    input.daysUntil > EXAM_MODE_DAYS
  ) {
    return {
      isActive: false,
      examTitle: null,
      daysUntil: null,
      dailyStudyMinutes: null,
      topicsRemaining: 0,
      warning: null,
    };
  }

  const topicsRemaining = Math.max(
    0,
    input.topicsTotal - input.topicsCompleted,
  );

  if (topicsRemaining === 0) {
    return {
      isActive: true,
      examTitle: input.examTitle,
      daysUntil: input.daysUntil,
      dailyStudyMinutes: 0,
      topicsRemaining: 0,
      warning: null,
    };
  }

  // Today still counts as a day to study in.
  const daysToWork = Math.max(1, input.daysUntil);
  const totalMinutes = topicsRemaining * input.minutesPerTopic;
  const dailyStudyMinutes = Math.ceil(totalMinutes / daysToWork);

  return {
    isActive: true,
    examTitle: input.examTitle,
    daysUntil: input.daysUntil,
    dailyStudyMinutes,
    topicsRemaining,
    warning:
      dailyStudyMinutes > input.dailyStudyCapacityMinutes
        ? `Covering everything needs about ${Math.round(dailyStudyMinutes / 60)}h a day, which is more than you have. Pick the topics that matter most.`
        : null,
  };
}

const EXAM_MODE_DAYS = 14;

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

export type WeeklyReview = {
  readonly completedCount: number;
  readonly createdCount: number;
  /** `null` when nothing was due — not 0%. */
  readonly completionRate: number | null;
  readonly habitConsistency: number | null;
  readonly busiestDayKey: string | null;
  readonly observations: readonly string[];
};

/**
 * A week, summarised from counts.
 *
 * Observations are generated from THRESHOLDS on real figures, never from
 * generated prose. Each one is a fact the reader could verify from the numbers
 * beside it.
 */
export function buildWeeklyReview(input: {
  readonly completedCount: number;
  readonly createdCount: number;
  readonly dueCount: number;
  readonly habitScheduled: number;
  readonly habitCompleted: number;
  readonly minutesPerDay: Readonly<Record<string, number>>;
}): WeeklyReview {
  const completionRate =
    input.dueCount > 0 ? (input.completedCount / input.dueCount) * 100 : null;

  const habitConsistency =
    input.habitScheduled > 0
      ? (input.habitCompleted / input.habitScheduled) * 100
      : null;

  const entries = Object.entries(input.minutesPerDay);
  const busiest = entries.sort(([, a], [, b]) => b - a)[0];

  const observations: string[] = [];

  if (completionRate !== null) {
    if (completionRate >= 80) {
      observations.push("You finished most of what was due.");
    } else if (completionRate < 50) {
      observations.push(
        `Less than half of what was due got done (${Math.round(completionRate)}%).`,
      );
    }
  }

  if (input.createdCount > input.completedCount * 2 && input.createdCount > 5) {
    // Arithmetic, not judgement: the list is growing faster than it shrinks.
    observations.push(
      `You added ${input.createdCount} things and finished ${input.completedCount}. The list is growing.`,
    );
  }

  if (habitConsistency !== null && habitConsistency < 50) {
    observations.push(
      `Habits ran at ${Math.round(habitConsistency)}% this week.`,
    );
  }

  if (observations.length === 0) {
    observations.push("A steady week, with nothing unusual in the numbers.");
  }

  return {
    completedCount: input.completedCount,
    createdCount: input.createdCount,
    completionRate,
    habitConsistency,
    busiestDayKey: busiest && busiest[1] > 0 ? busiest[0] : null,
    observations,
  };
}
