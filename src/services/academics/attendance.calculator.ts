/**
 * Attendance arithmetic.
 *
 * Pure: no Prisma, no React, no clock of its own. Every rule a student will
 * actually act on lives here, which is why it is unit tested exhaustively
 * rather than trusted to a dashboard query.
 *
 * ===========================================================================
 * THE RULES, STATED ONCE
 * ===========================================================================
 *
 * 1. ELIGIBLE CLASSES = PRESENT + ABSENT.
 *
 *    EXCUSED is excluded from BOTH the numerator and the denominator — it
 *    neither helps nor hurts. This matches how duty leave, medical leave and
 *    institution-approved absence are normally treated in Indian colleges:
 *    the class is struck from the record rather than forgiven.
 *
 *    The alternative (counting excused as present) would let a student with
 *    two attended classes and twenty medical leaves report 100% attendance,
 *    which is true arithmetic and a useless signal.
 *
 * 2. PERCENTAGE = present / eligible × 100.
 *
 *    With zero eligible classes the percentage is UNDEFINED, not zero. A new
 *    subject has not failed its attendance requirement; it has no data. Every
 *    function here returns `null` in that case and the UI says so.
 *
 * 3. UNMARKED CLASSES COUNT FOR NOTHING.
 *
 *    Attendance is a fact about a class that happened. A scheduled future
 *    class, or a past one nobody marked, produces no record and therefore
 *    does not move the percentage. Cancelled classes likewise.
 *
 * 4. NO ROUNDING IN THE MATHS.
 *
 *    Rounding is a presentation concern and is applied only at the very end.
 *    `canMiss` and `mustAttend` work from exact ratios, so a student sitting
 *    at 74.9% is never told they are "at 75%" and safe to skip.
 * ===========================================================================
 */

export type AttendanceCounts = {
  readonly present: number;
  readonly absent: number;
  readonly excused: number;
};

export const EMPTY_ATTENDANCE: AttendanceCounts = {
  present: 0,
  absent: 0,
  excused: 0,
};

/** Classes that count toward the percentage. Rule 1. */
export function eligibleClasses(counts: AttendanceCounts): number {
  return counts.present + counts.absent;
}

/** Every class with a record, including excused ones. For display only. */
export function recordedClasses(counts: AttendanceCounts): number {
  return counts.present + counts.absent + counts.excused;
}

/**
 * Attendance as a percentage, or `null` when there is nothing to divide by.
 *
 * Unrounded — see rule 4. Use {@link formatPercentage} for display.
 */
export function attendancePercentage(counts: AttendanceCounts): number | null {
  const eligible = eligibleClasses(counts);

  return eligible === 0 ? null : (counts.present / eligible) * 100;
}

/** One decimal place, which is how attendance is quoted in practice. */
export function formatPercentage(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/**
 * How many further classes can be missed while staying AT OR ABOVE the
 * threshold.
 *
 *   present / (eligible + k) ≥ threshold
 *   ⇒ k ≤ present / threshold − eligible
 *
 * Floored, because a fractional class cannot be missed, and clamped at 0 —
 * a student already below the line can miss none.
 *
 * Returns `null` when there is no data to reason from, or when the threshold
 * is 100% (where the answer is trivially zero and the division degenerate).
 */
export function classesCanMiss(
  counts: AttendanceCounts,
  thresholdPercent: number,
): number | null {
  const eligible = eligibleClasses(counts);

  if (eligible === 0) {
    return null;
  }

  if (thresholdPercent <= 0) {
    // No requirement to satisfy; the question is meaningless rather than
    // infinite, so it is reported as unanswerable.
    return null;
  }

  const threshold = thresholdPercent / 100;
  const allowance = counts.present / threshold - eligible;

  return Math.max(0, Math.floor(allowance + EPSILON));
}

/**
 * How many consecutive classes must be attended to REACH the threshold.
 *
 *   (present + n) / (eligible + n) ≥ threshold
 *   ⇒ n ≥ (threshold × eligible − present) / (1 − threshold)
 *
 * Ceiled, and clamped at 0 when the threshold is already met.
 *
 * Returns `null` when the target is unreachable: a 100% requirement that has
 * already been broken can never be recovered, and saying "attend 999 classes"
 * would be worse than saying so.
 */
export function classesMustAttend(
  counts: AttendanceCounts,
  thresholdPercent: number,
): number | null {
  const eligible = eligibleClasses(counts);
  const threshold = thresholdPercent / 100;

  if (eligible === 0) {
    return null;
  }

  const current = counts.present / eligible;

  if (current >= threshold - EPSILON) {
    return 0;
  }

  if (threshold >= 1) {
    // Every remaining class would have to be attended AND the existing
    // absences undone. Unreachable.
    return null;
  }

  const required = (threshold * eligible - counts.present) / (1 - threshold);

  return Math.max(0, Math.ceil(required - EPSILON));
}

/**
 * The percentage that would result from attending `attend` more classes and
 * missing `miss` more. Used by the interactive calculator.
 */
export function projectPercentage(
  counts: AttendanceCounts,
  attend: number,
  miss: number,
): number | null {
  const projected: AttendanceCounts = {
    present: counts.present + Math.max(0, attend),
    absent: counts.absent + Math.max(0, miss),
    excused: counts.excused,
  };

  return attendancePercentage(projected);
}

/**
 * Risk bands.
 *
 * `UNKNOWN` is a real answer, not a failure: a subject with no marked classes
 * genuinely has no risk to report, and colouring it green or red would both
 * be lies.
 */
export type AttendanceRisk =
  "UNKNOWN" | "SAFE" | "WATCH" | "AT_RISK" | "CRITICAL";

/**
 * Classifies attendance.
 *
 * The bands are defined in terms of the student's actual MARGIN, not an
 * arbitrary percentage-point gap, because a 10-point cushion means something
 * very different at five classes than at fifty:
 *
 *   SAFE      at or above the threshold with at least 2 classes of slack
 *   WATCH     at or above the threshold, but 0–1 absences from dropping below
 *   AT_RISK   below the threshold, but recoverable within `remainingClasses`
 *   CRITICAL  below the threshold and NOT recoverable in the classes that
 *             remain — or below it with no remaining-class data at all
 *
 * `remainingClasses` is optional because it is only known once a timetable
 * exists. Without it the function degrades honestly rather than guessing.
 */
export function attendanceRisk(
  counts: AttendanceCounts,
  thresholdPercent: number,
  remainingClasses?: number,
): AttendanceRisk {
  const percentage = attendancePercentage(counts);

  if (percentage === null) {
    return "UNKNOWN";
  }

  const meetsThreshold = percentage >= thresholdPercent - EPSILON;

  if (meetsThreshold) {
    const slack = classesCanMiss(counts, thresholdPercent);
    return slack !== null && slack >= 2 ? "SAFE" : "WATCH";
  }

  const needed = classesMustAttend(counts, thresholdPercent);

  if (needed === null) {
    return "CRITICAL";
  }

  if (remainingClasses === undefined) {
    return "AT_RISK";
  }

  return needed <= remainingClasses ? "AT_RISK" : "CRITICAL";
}

/** Everything the UI needs about one subject's attendance, computed once. */
export type AttendanceSummary = {
  readonly counts: AttendanceCounts;
  readonly eligible: number;
  readonly recorded: number;
  readonly percentage: number | null;
  readonly thresholdPercent: number;
  readonly meetsThreshold: boolean;
  readonly canMiss: number | null;
  readonly mustAttend: number | null;
  readonly risk: AttendanceRisk;
};

export function summariseAttendance(
  counts: AttendanceCounts,
  thresholdPercent: number,
  remainingClasses?: number,
): AttendanceSummary {
  const percentage = attendancePercentage(counts);

  return {
    counts,
    eligible: eligibleClasses(counts),
    recorded: recordedClasses(counts),
    percentage,
    thresholdPercent,
    meetsThreshold:
      percentage !== null && percentage >= thresholdPercent - EPSILON,
    canMiss: classesCanMiss(counts, thresholdPercent),
    mustAttend: classesMustAttend(counts, thresholdPercent),
    risk: attendanceRisk(counts, thresholdPercent, remainingClasses),
  };
}

/**
 * Guards against floating-point noise.
 *
 * Without this, 45/60 compares as 74.99999999999999 against a threshold of
 * 75 and a student who is exactly at the line is told they are below it.
 */
const EPSILON = 1e-9;
