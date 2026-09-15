/**
 * Pure proactive intelligence.
 *
 * THE HARDEST PHASE TO KEEP HONEST. Everything here is a claim about the user
 * made without being asked, so every function obeys three rules:
 *
 *  1. NO CLAIM WITHOUT EVIDENCE. Each finding carries the numbers it was
 *     derived from, and the UI shows them. A user must always be able to check
 *     the reasoning.
 *  2. NEVER DIAGNOSE. Life OS reports what happened — "this has been moved
 *     four times" — never why. It has counts, not insight into a person.
 *  3. INSUFFICIENT DATA MEANS SILENCE. A pattern needs a minimum sample.
 *     Below it the answer is `null`, not a guess dressed as an observation.
 *
 * No Prisma, no React, no clock of its own.
 */

// ---------------------------------------------------------------------------
// Forgotten items
// ---------------------------------------------------------------------------

export type ForgottenItem = {
  readonly id: string;
  readonly title: string;
  readonly kind: "TASK" | "PROJECT" | "GOAL";
  readonly daysUntouched: number;
  readonly evidence: string;
};

/**
 * Things that have quietly stopped moving.
 *
 * `FORGOTTEN_DAYS` is deliberately long. A task untouched for a week is
 * normal life; one untouched for a month with no due date has genuinely
 * fallen out of view. Setting this threshold low would turn the feature into
 * a nagging machine, which users disable — and a disabled feature helps
 * nobody.
 */
export function detectForgotten(
  items: readonly {
    id: string;
    title: string;
    kind: "TASK" | "PROJECT" | "GOAL";
    daysUntouched: number;
    hasDueDate: boolean;
  }[],
): readonly ForgottenItem[] {
  return items
    .filter((item) => !item.hasDueDate && item.daysUntouched >= FORGOTTEN_DAYS)
    .map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      daysUntouched: item.daysUntouched,
      evidence: `No change in ${item.daysUntouched} days.`,
    }))
    .sort((a, b) => b.daysUntouched - a.daysUntouched);
}

export const FORGOTTEN_DAYS = 30;

// ---------------------------------------------------------------------------
// Deadline risk
// ---------------------------------------------------------------------------

export type DeadlineRisk = {
  readonly id: string;
  readonly title: string;
  readonly daysRemaining: number;
  readonly requiredMinutesPerDay: number;
  readonly availableMinutesPerDay: number;
  readonly level: "COMFORTABLE" | "TIGHT" | "AT_RISK" | "IMPOSSIBLE";
  readonly evidence: string;
};

/**
 * Whether a deadline is reachable given the time actually left.
 *
 * Arithmetic, not intuition: remaining work ÷ remaining days, compared with
 * what the user has free per day. `IMPOSSIBLE` is stated as such — telling
 * someone a twelve-hour-a-day requirement is "challenging" wastes the one
 * chance to say something useful.
 */
export function assessDeadlineRisk(input: {
  readonly id: string;
  readonly title: string;
  readonly daysRemaining: number;
  readonly remainingMinutes: number;
  readonly availableMinutesPerDay: number;
}): DeadlineRisk {
  // Today still counts as a day to work in.
  const days = Math.max(1, input.daysRemaining);
  const requiredPerDay = Math.ceil(input.remainingMinutes / days);
  const available = Math.max(0, input.availableMinutesPerDay);

  const ratio = available > 0 ? requiredPerDay / available : Infinity;

  const level: DeadlineRisk["level"] =
    input.daysRemaining < 0 || ratio > 1.5
      ? "IMPOSSIBLE"
      : ratio > 1
        ? "AT_RISK"
        : ratio > 0.7
          ? "TIGHT"
          : "COMFORTABLE";

  return {
    id: input.id,
    title: input.title,
    daysRemaining: input.daysRemaining,
    requiredMinutesPerDay: requiredPerDay,
    availableMinutesPerDay: available,
    level,
    evidence:
      input.daysRemaining < 0
        ? `The deadline passed ${Math.abs(input.daysRemaining)} days ago.`
        : `${Math.round(input.remainingMinutes / 60)}h of work across ${days} ${days === 1 ? "day" : "days"} is about ${Math.round(requiredPerDay / 60)}h a day; you have about ${Math.round(available / 60)}h.`,
  };
}

// ---------------------------------------------------------------------------
// Behaviour patterns
// ---------------------------------------------------------------------------

export type BehaviourPattern = {
  readonly kind: "BEST_DAY" | "WORST_DAY" | "COMPLETION_TREND";
  readonly statement: string;
  readonly evidence: string;
};

/**
 * Patterns in when work actually gets done.
 *
 * REQUIRES A MINIMUM SAMPLE. With fewer than `MIN_PATTERN_SAMPLE`
 * observations the function returns nothing at all: "you're most productive
 * on Tuesdays" drawn from three data points is astrology, not analysis.
 *
 * It also requires a real MARGIN between best and worst. Two days differing
 * by one completion is noise, and reporting it as a pattern would train the
 * user to ignore everything this module says.
 */
export function detectBehaviourPatterns(input: {
  /** Completions per ISO weekday, 1 = Monday. */
  readonly completionsByWeekday: Readonly<Record<number, number>>;
  readonly totalObservations: number;
  /** Completion rate for the two most recent comparable windows. */
  readonly recentRate: number | null;
  readonly previousRate: number | null;
}): readonly BehaviourPattern[] {
  const patterns: BehaviourPattern[] = [];

  if (input.totalObservations >= MIN_PATTERN_SAMPLE) {
    const entries = Object.entries(input.completionsByWeekday)
      .map(([weekday, count]) => ({ weekday: Number(weekday), count }))
      .sort((a, b) => b.count - a.count);

    const best = entries[0];
    const worst = entries.at(-1);

    if (best && worst && best.count - worst.count >= MIN_PATTERN_MARGIN) {
      patterns.push({
        kind: "BEST_DAY",
        statement: `You finish most on ${WEEKDAY_NAMES[best.weekday - 1]}.`,
        evidence: `${best.count} completed on ${WEEKDAY_NAMES[best.weekday - 1]} against ${worst.count} on ${WEEKDAY_NAMES[worst.weekday - 1]}, over ${input.totalObservations} completions.`,
      });
    }
  }

  if (
    input.recentRate !== null &&
    input.previousRate !== null &&
    Math.abs(input.recentRate - input.previousRate) >= MIN_TREND_CHANGE
  ) {
    const isUp = input.recentRate > input.previousRate;

    patterns.push({
      kind: "COMPLETION_TREND",
      statement: isUp
        ? "You are finishing more than you were."
        : "You are finishing less than you were.",
      evidence: `${Math.round(input.recentRate)}% this period against ${Math.round(input.previousRate)}% last.`,
    });
  }

  return patterns;
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Below this, any "pattern" is noise. */
export const MIN_PATTERN_SAMPLE = 20;
const MIN_PATTERN_MARGIN = 3;
const MIN_TREND_CHANGE = 15;

// ---------------------------------------------------------------------------
// Life score
// ---------------------------------------------------------------------------

export type LifeScoreComponent = {
  readonly key: "TASKS" | "ACADEMICS" | "HABITS" | "WELLBEING";
  /** `null` when there is nothing to measure — NOT zero. */
  readonly score: number | null;
  readonly evidence: string;
};

export type LifeScore = {
  /** `null` when too little is tracked to say anything. */
  readonly overall: number | null;
  readonly components: readonly LifeScoreComponent[];
  readonly note: string;
};

/**
 * A single number for "how is life going".
 *
 * THE MOST DANGEROUS FUNCTION IN THIS FILE, and the one most carefully
 * constrained:
 *
 *  - A component with no data scores `null`, not 0. A student who does not
 *    track habits is not failing at habits.
 *  - The overall score averages ONLY the components that have data, and says
 *    how many that was. An average of one component is labelled as such.
 *  - With no components at all, the score is `null` and the note explains
 *    why. There is no default 50 "to have something to show".
 *
 * A wrong number here would be a daily, unprompted, quantified judgement of
 * someone's life. Silence is strictly better.
 */
export function calculateLifeScore(input: {
  readonly taskCompletionRate: number | null;
  readonly attendancePercent: number | null;
  readonly habitConsistency: number | null;
  readonly checkInCount: number;
  readonly checkInDaysPossible: number;
}): LifeScore {
  const components: LifeScoreComponent[] = [
    {
      key: "TASKS",
      score: input.taskCompletionRate,
      evidence:
        input.taskCompletionRate === null
          ? "Nothing was due, so there is nothing to measure."
          : `${Math.round(input.taskCompletionRate)}% of what was due got done.`,
    },
    {
      key: "ACADEMICS",
      score: input.attendancePercent,
      evidence:
        input.attendancePercent === null
          ? "No classes have been marked yet."
          : `Attendance is ${Math.round(input.attendancePercent)}%.`,
    },
    {
      key: "HABITS",
      score: input.habitConsistency,
      evidence:
        input.habitConsistency === null
          ? "No habits are scheduled."
          : `Habits ran at ${Math.round(input.habitConsistency)}%.`,
    },
    {
      key: "WELLBEING",
      /**
       * NULL when there are NO check-ins at all.
       *
       * The obvious implementation — `count / daysPossible` — scores a
       * brand-new account 0%, which drags the overall score to zero and tells
       * someone who signed up an hour ago that their life rates 0 out of 100.
       * Never having logged a check-in is "not tracked", exactly like never
       * having scheduled a habit. Once there is ONE check-in the ratio becomes
       * meaningful and is measured normally.
       */
      score:
        input.checkInCount > 0 && input.checkInDaysPossible > 0
          ? Math.min(
              100,
              (input.checkInCount / input.checkInDaysPossible) * 100,
            )
          : null,
      evidence:
        input.checkInCount > 0
          ? `${input.checkInCount} check-ins in ${input.checkInDaysPossible} days.`
          : "No check-ins recorded yet.",
    },
  ];

  const measured = components.filter(
    (component): component is LifeScoreComponent & { score: number } =>
      component.score !== null,
  );

  if (measured.length === 0) {
    return {
      overall: null,
      components,
      note: "Not enough is tracked yet to say anything useful.",
    };
  }

  const overall =
    measured.reduce((total, component) => total + component.score, 0) /
    measured.length;

  return {
    overall,
    components,
    note:
      measured.length === components.length
        ? "Averaged across all four areas."
        : `Averaged across ${measured.length} of ${components.length} areas — the rest have nothing to measure.`,
  };
}

// ---------------------------------------------------------------------------
// Proactive notifications
// ---------------------------------------------------------------------------

export type Insight = {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  /** The numbers behind it. Always shown. */
  readonly evidence: string;
  readonly severity: "INFO" | "WARN" | "URGENT";
  readonly href: string;
};

/**
 * Chooses which findings are worth interrupting someone for.
 *
 * Two constraints, both about restraint:
 *
 *  - AT MOST `MAX_PROACTIVE_PER_DAY`. A system that surfaces everything it
 *    notices is noise, and noise gets muted.
 *  - The most severe first, then the most specific. If only one thing can be
 *    said, it should be the thing that matters.
 *
 * This is SELECTION, not generation: every insight passed in was already
 * derived from real numbers by one of the functions above.
 */
export function selectProactiveInsights(
  candidates: readonly Insight[],
  alreadySentKeys: readonly string[],
): readonly Insight[] {
  const sent = new Set(alreadySentKeys);
  const severityRank = { URGENT: 0, WARN: 1, INFO: 2 } as const;

  return candidates
    .filter((insight) => !sent.has(insight.key))
    .slice()
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, MAX_PROACTIVE_PER_DAY);
}

export const MAX_PROACTIVE_PER_DAY = 3;

// ---------------------------------------------------------------------------
// Time audit
// ---------------------------------------------------------------------------

export type TimeAudit = {
  readonly totalMinutes: number;
  readonly byCategory: readonly {
    readonly category: string;
    readonly minutes: number;
    readonly percent: number;
  }[];
  /** `null` when nothing was logged — not an empty chart implying zero. */
  readonly isEmpty: boolean;
};

/**
 * Where logged time actually went.
 *
 * Reports ONLY what was logged. It does not estimate unlogged time, and it
 * does not present a partial record as a complete one — the UI says how much
 * was tracked so the reader can judge the rest.
 */
export function buildTimeAudit(
  entries: readonly { category: string; minutes: number }[],
): TimeAudit {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    totals.set(
      entry.category,
      (totals.get(entry.category) ?? 0) + entry.minutes,
    );
  }

  const totalMinutes = [...totals.values()].reduce(
    (total, minutes) => total + minutes,
    0,
  );

  if (totalMinutes === 0) {
    return { totalMinutes: 0, byCategory: [], isEmpty: true };
  }

  return {
    totalMinutes,
    byCategory: [...totals.entries()]
      .map(([category, minutes]) => ({
        category,
        minutes,
        percent: (minutes / totalMinutes) * 100,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    isEmpty: false,
  };
}
