/**
 * Pure scheduling intelligence.
 *
 * No Prisma, no React, no clock of its own — same contract as every other
 * derive module. Everything here is a function of values passed in, so the
 * rules that decide whether a user gets woken at 3am are testable with plain
 * objects.
 */

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

export type QuietHours = {
  readonly isEnabled: boolean;
  /** Minutes since local midnight, 0–1439. */
  readonly startMinute: number | null;
  readonly endMinute: number | null;
};

/**
 * Whether a local minute falls inside quiet hours.
 *
 * A window that WRAPS MIDNIGHT (22:00–07:00, i.e. start > end) is the normal
 * case for sleep, and naive `minute >= start && minute <= end` returns false
 * for every minute of it. That bug would deliver notifications at 3am, so the
 * wrap is handled explicitly and tested in both directions.
 */
export function isWithinQuietHours(
  minuteOfDay: number,
  quiet: QuietHours,
): boolean {
  if (
    !quiet.isEnabled ||
    quiet.startMinute === null ||
    quiet.endMinute === null
  ) {
    return false;
  }

  const { startMinute, endMinute } = quiet;

  if (startMinute === endMinute) {
    // A zero-length window silences nothing. Treating it as "always quiet"
    // would mute the app permanently from a single mis-set field.
    return false;
  }

  if (startMinute < endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  }

  // Wraps midnight: inside if it is after the start OR before the end.
  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

/**
 * The first minute at or after `minuteOfDay` that is NOT quiet.
 *
 * Returns the same minute when already outside quiet hours. Callers use this
 * to DEFER a notification to the end of quiet hours rather than dropping it —
 * a silenced reminder that never arrives is worse than a late one.
 */
export function nextAudibleMinute(
  minuteOfDay: number,
  quiet: QuietHours,
): number {
  if (!isWithinQuietHours(minuteOfDay, quiet) || quiet.endMinute === null) {
    return minuteOfDay;
  }

  return quiet.endMinute;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export type Recurrence =
  "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "WEEKDAYS";

export type RecurrenceSpec = {
  readonly recurrence: Recurrence;
  /** WEEKDAYS only. ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  readonly weekdays: readonly number[];
  /** Recurrence stops after this instant. */
  readonly recurUntil: Date | null;
};

/**
 * The next occurrence strictly AFTER `from`.
 *
 * `null` when the reminder does not recur, or when the next occurrence would
 * fall past `recurUntil`.
 *
 * Calendar arithmetic, not millisecond arithmetic: "monthly" means the same
 * date next month, not +30 days, and "yearly" survives a leap year. The clock
 * TIME is preserved from the original instant.
 *
 * The caller supplies the zone-aware helpers, because this module must not
 * know about time zones — the profile's zone lives one layer up.
 */
export function nextOccurrence(
  current: Date,
  spec: RecurrenceSpec,
  helpers: {
    /** Adds whole local days, DST-correctly. */
    addDays: (date: Date, days: number) => Date;
    addMonths: (date: Date, months: number) => Date;
    addYears: (date: Date, years: number) => Date;
    /** ISO weekday of an instant in the user's zone. */
    weekdayOf: (date: Date) => number;
  },
): Date | null {
  if (spec.recurrence === "NONE") {
    return null;
  }

  let next: Date;

  switch (spec.recurrence) {
    case "DAILY":
      next = helpers.addDays(current, 1);
      break;
    case "WEEKLY":
      next = helpers.addDays(current, 7);
      break;
    case "MONTHLY":
      next = helpers.addMonths(current, 1);
      break;
    case "YEARLY":
      next = helpers.addYears(current, 1);
      break;
    case "WEEKDAYS": {
      const wanted = new Set(spec.weekdays);

      if (wanted.size === 0) {
        // No days selected would loop forever looking for a match.
        return null;
      }

      // Walk forward at most a full week; one of the seven must match.
      next = current;

      for (let step = 0; step < 7; step += 1) {
        next = helpers.addDays(next, 1);

        if (wanted.has(helpers.weekdayOf(next))) {
          break;
        }
      }
      break;
    }
    default:
      return null;
  }

  if (spec.recurUntil && next.getTime() > spec.recurUntil.getTime()) {
    return null;
  }

  return next;
}

// ---------------------------------------------------------------------------
// Conflicts and free time
// ---------------------------------------------------------------------------

export type TimeBlock = {
  readonly id: string;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  /** Only busy blocks conflict; tentative or informational ones do not. */
  readonly isBusy: boolean;
};

/**
 * Whether two blocks overlap.
 *
 * Half-open intervals: a block ending at 10:00 and one starting at 10:00 do
 * NOT conflict. Back-to-back meetings are the normal case, and flagging them
 * would make the conflict warning noise the user learns to ignore.
 */
export function blocksOverlap(a: TimeBlock, b: TimeBlock): boolean {
  if (!a.isBusy || !b.isBusy) {
    return false;
  }

  return (
    a.startAt.getTime() < b.endAt.getTime() &&
    b.startAt.getTime() < a.endAt.getTime()
  );
}

export type Conflict = {
  readonly first: TimeBlock;
  readonly second: TimeBlock;
  readonly overlapMinutes: number;
};

/**
 * Every pair of overlapping busy blocks.
 *
 * Sorted by start time first so the sweep is O(n log n) on the comparisons
 * that matter rather than comparing every pair blindly: once a later block
 * starts after the current one ends, nothing further can overlap it.
 */
export function findConflicts(
  blocks: readonly TimeBlock[],
): readonly Conflict[] {
  const busy = blocks
    .filter((block) => block.isBusy)
    .slice()
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const conflicts: Conflict[] = [];

  for (let index = 0; index < busy.length; index += 1) {
    const current = busy[index]!;

    for (let other = index + 1; other < busy.length; other += 1) {
      const candidate = busy[other]!;

      // Sorted by start, so nothing beyond this point can overlap `current`.
      if (candidate.startAt.getTime() >= current.endAt.getTime()) {
        break;
      }

      conflicts.push({
        first: current,
        second: candidate,
        overlapMinutes: Math.round(
          (Math.min(current.endAt.getTime(), candidate.endAt.getTime()) -
            Math.max(current.startAt.getTime(), candidate.startAt.getTime())) /
            60_000,
        ),
      });
    }
  }

  return conflicts;
}

export type FreeSlot = {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly minutes: number;
};

/**
 * Gaps between busy blocks inside a window.
 *
 * Overlapping blocks are MERGED first — two overlapping meetings are one busy
 * period, and treating them separately would invent a negative-length gap
 * between them. Slots shorter than `minimumMinutes` are dropped, because a
 * seven-minute gap is not usable time and offering it is worse than silence.
 */
export function findFreeSlots(
  windowStart: Date,
  windowEnd: Date,
  blocks: readonly TimeBlock[],
  minimumMinutes = 15,
): readonly FreeSlot[] {
  const busy = blocks
    .filter(
      (block) =>
        block.isBusy &&
        block.endAt.getTime() > windowStart.getTime() &&
        block.startAt.getTime() < windowEnd.getTime(),
    )
    .slice()
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const merged: { start: number; end: number }[] = [];

  for (const block of busy) {
    const start = Math.max(block.startAt.getTime(), windowStart.getTime());
    const end = Math.min(block.endAt.getTime(), windowEnd.getTime());
    const last = merged.at(-1);

    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      continue;
    }

    merged.push({ start, end });
  }

  const slots: FreeSlot[] = [];
  let cursor = windowStart.getTime();

  const pushSlot = (from: number, to: number) => {
    const minutes = Math.round((to - from) / 60_000);

    if (minutes >= minimumMinutes) {
      slots.push({
        startAt: new Date(from),
        endAt: new Date(to),
        minutes,
      });
    }
  };

  for (const period of merged) {
    pushSlot(cursor, period.start);
    cursor = Math.max(cursor, period.end);
  }

  pushSlot(cursor, windowEnd.getTime());

  return slots;
}

/** Total busy minutes inside a window, overlaps counted once. */
export function busyMinutesIn(
  windowStart: Date,
  windowEnd: Date,
  blocks: readonly TimeBlock[],
): number {
  const windowMinutes = Math.round(
    (windowEnd.getTime() - windowStart.getTime()) / 60_000,
  );

  const free = findFreeSlots(windowStart, windowEnd, blocks, 1).reduce(
    (total, slot) => total + slot.minutes,
    0,
  );

  return Math.max(0, windowMinutes - free);
}

// ---------------------------------------------------------------------------
// Delivery throttling
// ---------------------------------------------------------------------------

/**
 * A stable identity for one logical alert.
 *
 * This is the idempotency key: a worker that retries, or two workers racing,
 * must produce ONE notification rather than two identical ones. Composed from
 * the things that make an alert unique — never from a timestamp or a random
 * value, which would defeat the whole purpose.
 */
export function buildDedupeKey(
  parts: readonly (string | number | null | undefined)[],
): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(":");
}

export type ThrottleDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: "QUIET_HOURS" | "DAILY_LIMIT" };

/**
 * Whether a notification may be delivered now.
 *
 * Urgent notifications bypass BOTH quiet hours and the daily limit — an exam
 * starting in ten minutes is exactly what a user turned notifications on for.
 * Everything else defers rather than being dropped.
 */
export function shouldDeliver(input: {
  readonly isUrgent: boolean;
  readonly minuteOfDay: number;
  readonly quiet: QuietHours;
  readonly sentToday: number;
  readonly dailyLimit: number;
}): ThrottleDecision {
  if (input.isUrgent) {
    return { allow: true };
  }

  if (isWithinQuietHours(input.minuteOfDay, input.quiet)) {
    return { allow: false, reason: "QUIET_HOURS" };
  }

  if (input.dailyLimit > 0 && input.sentToday >= input.dailyLimit) {
    return { allow: false, reason: "DAILY_LIMIT" };
  }

  return { allow: true };
}
