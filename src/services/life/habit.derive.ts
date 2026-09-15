/**
 * Pure habit intelligence.
 *
 * No Prisma, no React, no clock of its own — same contract as the task,
 * academic and project derive modules.
 *
 * The central decision here: STREAKS ARE DERIVED, NEVER STORED. A stored
 * streak is a number that becomes wrong the moment a log is back-dated,
 * edited or deleted, and users do all three. Recomputing from the logs is
 * cheap and cannot drift.
 */

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type HabitCadenceSpec = {
  readonly cadence: "DAILY" | "WEEKLY" | "SPECIFIC_DAYS";
  /** WEEKLY only: how many completions per week count as success. */
  readonly targetPerPeriod: number;
  /** SPECIFIC_DAYS only. */
  readonly weekdays: readonly number[];
};

/** A log row reduced to what the maths needs. Keys are `YYYY-MM-DD`. */
export type HabitLogEntry = {
  readonly dateKey: string;
  readonly isCompleted: boolean;
  readonly amount: number | null;
};

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Whether a habit is DUE on a given local day.
 *
 * WEEKLY habits are due every day: "three times a week" does not name which
 * days, so any day is a legitimate opportunity. The weekly TARGET is what
 * judges success — see `weeklyProgress`.
 */
export function isDueOn(spec: HabitCadenceSpec, weekday: Weekday): boolean {
  switch (spec.cadence) {
    case "SPECIFIC_DAYS":
      return spec.weekdays.includes(weekday);
    case "WEEKLY":
    case "DAILY":
    default:
      return true;
  }
}

/** Days a habit is scheduled for in a week. Drives "x of y this week". */
export function scheduledPerWeek(spec: HabitCadenceSpec): number {
  switch (spec.cadence) {
    case "SPECIFIC_DAYS":
      return new Set(spec.weekdays).size;
    case "WEEKLY":
      return Math.max(1, spec.targetPerPeriod);
    case "DAILY":
    default:
      return 7;
  }
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export type StreakResult = {
  readonly current: number;
  readonly longest: number;
};

/**
 * Current and longest streak, counted in SCHEDULED days.
 *
 * Rules, each chosen deliberately:
 *
 *  - Only days the habit was actually due can break a streak. Skipping a
 *    Sunday on a weekdays-only habit is not a failure, and counting it as one
 *    is the fastest way to make a tracker feel punitive and wrong.
 *  - A day with NO LOG is not yet a miss if it is `today` — the day is still
 *    running. Any earlier scheduled day with no log IS a miss; pretending
 *    otherwise would inflate streaks for users who simply stopped logging.
 *  - An explicit `isCompleted: false` is always a miss, wherever it falls.
 *
 * `days` must be every local day from the habit's start through today,
 * ascending, each with its ISO weekday. The CALLER owns the calendar because
 * only it knows the profile's zone.
 */
export function calculateStreak(
  days: readonly { dateKey: string; weekday: Weekday }[],
  logs: readonly HabitLogEntry[],
  spec: HabitCadenceSpec,
  todayKey: string,
): StreakResult {
  const byDate = new Map(logs.map((log) => [log.dateKey, log]));

  let longest = 0;
  let running = 0;
  let current = 0;

  for (const day of days) {
    if (day.dateKey > todayKey) {
      break;
    }

    if (!isDueOn(spec, day.weekday)) {
      continue;
    }

    const log = byDate.get(day.dateKey);

    if (log?.isCompleted) {
      running += 1;
      longest = Math.max(longest, running);
      current = running;
      continue;
    }

    // Today with no answer yet leaves the streak standing — the day is not
    // over. An explicit miss today does break it.
    if (log === undefined && day.dateKey === todayKey) {
      continue;
    }

    running = 0;
    current = 0;
  }

  return { current, longest };
}

// ---------------------------------------------------------------------------
// Completion rate
// ---------------------------------------------------------------------------

/**
 * Completion rate over a window, as a percentage of SCHEDULED days.
 *
 * Returns `null` when nothing was scheduled in the window — "no data" is not
 * "0%", and every surface must be able to tell them apart.
 *
 * Unanswered days count as misses here, unlike in `calculateStreak`. That is
 * intentional: a rate is a historical summary, and silently dropping the days
 * a user ignored would report a flattering number that is not true.
 */
export function completionRate(
  days: readonly { dateKey: string; weekday: Weekday }[],
  logs: readonly HabitLogEntry[],
  spec: HabitCadenceSpec,
): number | null {
  const completed = new Set(
    logs.filter((log) => log.isCompleted).map((log) => log.dateKey),
  );

  const scheduled = days.filter((day) => isDueOn(spec, day.weekday));

  if (scheduled.length === 0) {
    return null;
  }

  const hits = scheduled.filter((day) => completed.has(day.dateKey)).length;

  return (hits / scheduled.length) * 100;
}

/** Completions inside one week, against the weekly target. */
export function weeklyProgress(
  weekDayKeys: readonly string[],
  logs: readonly HabitLogEntry[],
  spec: HabitCadenceSpec,
): { readonly completed: number; readonly target: number } {
  const keys = new Set(weekDayKeys);

  const completed = logs.filter(
    (log) => log.isCompleted && keys.has(log.dateKey),
  ).length;

  return { completed, target: scheduledPerWeek(spec) };
}

// ---------------------------------------------------------------------------
// Quit habits
// ---------------------------------------------------------------------------

/**
 * Days clean for a QUIT habit.
 *
 * Deliberately NOT the same as `calculateStreak`. For quitting, the thing
 * being counted is time since the last relapse — a day with no log is clean,
 * because not smoking requires no action. Treating silence as failure would
 * reset a genuine streak every time someone forgot to open the app.
 *
 * `relapseKeys` are days explicitly marked `isCompleted: false`.
 */
export function daysClean(
  relapseKeys: readonly string[],
  startDateKey: string,
  todayKey: string,
  dayDifference: (fromKey: string, toKey: string) => number,
): number {
  const lastRelapse = [...relapseKeys]
    .filter((key) => key <= todayKey)
    .sort()
    .at(-1);

  // Counted from the relapse day itself, which was not clean — so a relapse
  // yesterday leaves exactly one clean day. With no relapse at all, counted
  // from the day tracking began.
  return Math.max(0, dayDifference(lastRelapse ?? startDateKey, todayKey));
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export type GoalProgressInput = {
  /** Null for milestone-based goals. */
  readonly targetValue: number | null;
  readonly currentValue: number;
  readonly milestonesTotal: number;
  readonly milestonesCompleted: number;
  readonly status: string;
};

/**
 * Goal progress.
 *
 * A measured goal (`targetValue` set) is measured. Otherwise milestones are
 * counted. A goal with NEITHER returns `null` — the user has stated an
 * intention and no way to tell whether it is being met, and inventing a
 * number for that would be the exact dishonesty this project forbids.
 *
 * An ACHIEVED goal reads 100% regardless: the user said it is done, and the
 * measurement was only ever a proxy for that.
 */
export function goalProgress(input: GoalProgressInput): number | null {
  if (input.status === "ACHIEVED") {
    return 100;
  }

  if (input.targetValue !== null && input.targetValue > 0) {
    return Math.min(
      100,
      Math.max(0, (input.currentValue / input.targetValue) * 100),
    );
  }

  if (input.milestonesTotal > 0) {
    return (input.milestonesCompleted / input.milestonesTotal) * 100;
  }

  return null;
}

export type GoalPace = "AHEAD" | "ON_TRACK" | "BEHIND" | "OVERDUE" | "UNKNOWN";

/**
 * Whether a goal is keeping up with its own deadline.
 *
 * Compares the fraction of WORK done against the fraction of TIME elapsed. A
 * goal with no target date, or no measurable progress, returns UNKNOWN rather
 * than a guess.
 */
export function goalPace(
  progressPercent: number | null,
  elapsedDays: number,
  totalDays: number,
): GoalPace {
  if (progressPercent === null || totalDays <= 0) {
    return "UNKNOWN";
  }

  if (elapsedDays > totalDays) {
    return progressPercent >= 100 ? "ON_TRACK" : "OVERDUE";
  }

  const expected = (elapsedDays / totalDays) * 100;

  if (progressPercent >= expected + PACE_TOLERANCE_PERCENT) {
    return "AHEAD";
  }

  if (progressPercent < expected - PACE_TOLERANCE_PERCENT) {
    return "BEHIND";
  }

  return "ON_TRACK";
}

/** Progress rarely tracks time exactly; this keeps ON_TRACK meaningful. */
const PACE_TOLERANCE_PERCENT = 10;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Formats integer MINOR units (paise/cents) as a currency string.
 *
 * Amounts are stored and summed as integers throughout — binary floats cannot
 * represent 0.1 exactly, so a month of float rupees drifts. Conversion to a
 * decimal happens once, here, at the display edge.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / MINOR_UNITS_PER_MAJOR);
}

export const MINOR_UNITS_PER_MAJOR = 100;

/** Parses a user-typed major-unit amount into integer minor units. */
export function parseMoneyToMinor(value: string): number | null {
  const trimmed = value.trim().replace(/[,\s]/g, "");

  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  // Rounding the product, not truncating: 19.99 × 100 is 1998.9999… in
  // binary floating point, and truncation would silently lose a paisa.
  return Math.round(Number(trimmed) * MINOR_UNITS_PER_MAJOR);
}

export type BudgetStatus = "UNDER" | "NEAR" | "OVER" | "UNTRACKED";

/**
 * Where spending stands against a category budget.
 *
 * `UNTRACKED` when no budget is set — not "0% used", which would imply a
 * limit of zero.
 */
export function budgetStatus(
  spentMinor: number,
  budgetMinor: number | null,
): BudgetStatus {
  if (budgetMinor === null || budgetMinor <= 0) {
    return "UNTRACKED";
  }

  const used = (spentMinor / budgetMinor) * 100;

  if (used > 100) return "OVER";
  if (used >= BUDGET_NEAR_PERCENT) return "NEAR";

  return "UNDER";
}

const BUDGET_NEAR_PERCENT = 80;

/** Monthly-equivalent cost of a subscription, in minor units. */
export function monthlyEquivalentMinor(
  amountMinor: number,
  cycle: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY",
): number {
  switch (cycle) {
    // 52 weeks / 12 months, so a weekly charge is not understated as ×4.
    case "WEEKLY":
      return Math.round((amountMinor * 52) / 12);
    case "QUARTERLY":
      return Math.round(amountMinor / 3);
    case "YEARLY":
      return Math.round(amountMinor / 12);
    case "MONTHLY":
    default:
      return amountMinor;
  }
}
