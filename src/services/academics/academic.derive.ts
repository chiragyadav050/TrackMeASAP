import { endOfLocalDay, localDayDifference } from "@/lib/time";

/**
 * Pure academic derivations.
 *
 * As with `task.derive.ts`, nothing here touches Prisma, React or
 * `server-only`. Every rule is a function of (entity, now, timeZone), which
 * makes the ones students act on — is this overdue, how ready am I — testable
 * with plain objects and impossible to reimplement by accident in a component.
 */

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export type DerivableAssignment = {
  readonly status: string;
  readonly submissionStatus: string;
  readonly dueAt: Date | null;
  readonly isAllDay: boolean;
  readonly archivedAt: Date | null;
};

/**
 * Statuses that close an assignment's WORK.
 *
 * Note that SUBMITTED is not among them — it is not a work status at all.
 * See the enum comments in `schema.prisma`.
 */
const CLOSED_WORK_STATUSES: readonly string[] = ["COMPLETED", "CANCELLED"];

/**
 * Submission states that mean the institution has it, so a passed deadline no
 * longer matters.
 */
const SETTLED_SUBMISSIONS: readonly string[] = [
  "SUBMITTED",
  "LATE",
  "ACCEPTED",
];

/**
 * THE OVERDUE RULE FOR ASSIGNMENTS.
 *
 * An assignment is overdue when its deadline has passed AND it is neither
 * finished nor handed in:
 *
 *   • archived        → never overdue (it has left active work)
 *   • CANCELLED       → never overdue
 *   • COMPLETED       → never overdue (the work is done)
 *   • submitted/late/accepted → never overdue, even if the work status still
 *     says IN_PROGRESS. Handing it in is what the deadline was for.
 *   • otherwise, overdue once the effective deadline is past.
 *
 * This deliberately mirrors `task.derive.ts#isOverdue` — same all-day
 * semantics, same "derived, never stored" stance — so Tasks and Assignments
 * can never disagree about what "late" means.
 */
export function isAssignmentOverdue(
  assignment: DerivableAssignment,
  now: Date,
  timeZone: string,
): boolean {
  if (assignment.archivedAt !== null) {
    return false;
  }

  if (CLOSED_WORK_STATUSES.includes(assignment.status)) {
    return false;
  }

  if (SETTLED_SUBMISSIONS.includes(assignment.submissionStatus)) {
    return false;
  }

  if (!assignment.dueAt) {
    return false;
  }

  // All-day deadlines are due at the END of their local day, exactly as for
  // tasks — otherwise "due Friday" reads as late from 00:01 on Friday.
  const deadline = assignment.isAllDay
    ? endOfLocalDay(assignment.dueAt, timeZone)
    : assignment.dueAt;

  return deadline.getTime() < now.getTime();
}

/** An assignment still needing work or submission. */
export function isAssignmentOpen(assignment: DerivableAssignment): boolean {
  if (assignment.archivedAt !== null) {
    return false;
  }

  if (CLOSED_WORK_STATUSES.includes(assignment.status)) {
    // Completed work can still be outstanding administratively.
    return (
      assignment.status === "COMPLETED" &&
      !SETTLED_SUBMISSIONS.includes(assignment.submissionStatus)
    );
  }

  return true;
}

/** `marksObtained != null` is the only definition of "graded". */
export function isGraded(entity: {
  readonly marksObtained: number | null;
}): boolean {
  return entity.marksObtained !== null;
}

/**
 * Score as a percentage, or `null` when it cannot be computed.
 *
 * `maxMarks` of zero yields `null` rather than a division by zero — some
 * institutions record ungraded practicals that way.
 */
export function marksPercentage(entity: {
  readonly marksObtained: number | null;
  readonly maxMarks: number | null;
}): number | null {
  if (entity.marksObtained === null || entity.maxMarks === null) {
    return null;
  }

  if (entity.maxMarks <= 0) {
    return null;
  }

  return (entity.marksObtained / entity.maxMarks) * 100;
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

export type DerivableTopic = {
  readonly isCompleted: boolean;
  readonly importance: string;
  readonly confidence: number | null;
};

/**
 * EXAM PREPARATION PERCENTAGE = completed topics / total topics × 100.
 *
 * A plain count, on purpose. Weighting by `importance` was considered and
 * rejected: a student who has covered 5 of 8 topics expects to see 62.5%, and
 * a weighted figure that reads 71% because the finished topics happened to be
 * the important ones is harder to trust and impossible to verify at a glance.
 *
 * `importance` and `confidence` still matter — they drive WHICH topic the
 * priority engine suggests studying next. They just do not silently distort
 * the headline number.
 *
 * Returns `null` for an exam with no topics: preparation tracking has not
 * started, which is different from being 0% prepared.
 */
export function calculatePreparation(
  topics: readonly DerivableTopic[],
): number | null {
  if (topics.length === 0) {
    return null;
  }

  const completed = topics.filter((topic) => topic.isCompleted).length;

  return (completed / topics.length) * 100;
}

export type PreparationSummary = {
  readonly totalTopics: number;
  readonly completedTopics: number;
  readonly percentage: number | null;
  /** Topics left, hardest-first by importance. */
  readonly remainingHighImportance: number;
  /** Mean self-rated confidence across rated topics, or `null`. */
  readonly averageConfidence: number | null;
};

export function summarisePreparation(
  topics: readonly DerivableTopic[],
): PreparationSummary {
  const completed = topics.filter((topic) => topic.isCompleted);
  const rated = topics.filter((topic) => topic.confidence !== null);

  return {
    totalTopics: topics.length,
    completedTopics: completed.length,
    percentage: calculatePreparation(topics),
    remainingHighImportance: topics.filter(
      (topic) => !topic.isCompleted && topic.importance === "HIGH",
    ).length,
    averageConfidence:
      rated.length === 0
        ? null
        : rated.reduce((sum, topic) => sum + (topic.confidence ?? 0), 0) /
          rated.length,
  };
}

/**
 * Whole days until an exam, in the student's zone. Negative once past.
 * `null` when the exam has no date yet.
 */
export function daysUntil(
  startAt: Date | null,
  now: Date,
  timeZone: string,
): number | null {
  return startAt === null ? null : localDayDifference(now, startAt, timeZone);
}

// ---------------------------------------------------------------------------
// Study
// ---------------------------------------------------------------------------

/** "8h 30m" from a minute total. Zero renders as "0m", not an empty string. */
export function formatStudyDuration(minutes: number): string {
  if (minutes <= 0) {
    return "0m";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder}m`;
  }

  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/**
 * Sums study minutes per subject, highest first.
 *
 * Kept pure so the weekly dashboard can be asserted without a database; the
 * query layer supplies the rows.
 */
export function totalsBySubject(
  sessions: readonly {
    readonly subjectId: string;
    readonly durationMinutes: number;
  }[],
): readonly { subjectId: string; minutes: number }[] {
  const totals = new Map<string, number>();

  for (const session of sessions) {
    totals.set(
      session.subjectId,
      (totals.get(session.subjectId) ?? 0) + session.durationMinutes,
    );
  }

  return [...totals.entries()]
    .map(([subjectId, minutes]) => ({ subjectId, minutes }))
    .sort(
      (a, b) => b.minutes - a.minutes || a.subjectId.localeCompare(b.subjectId),
    );
}

/**
 * Distinct local days on which any studying happened.
 *
 * Counted in the student's zone rather than by elapsed time, so a session at
 * 00:30 counts toward that day and not the previous one.
 */
export function studyDayCount(
  sessions: readonly { readonly startedAt: Date }[],
  timeZone: string,
  localDateKey: (date: Date, timeZone: string) => string,
): number {
  return new Set(
    sessions.map((session) => localDateKey(session.startedAt, timeZone)),
  ).size;
}

// ---------------------------------------------------------------------------
// Semester
// ---------------------------------------------------------------------------

/**
 * How far through a semester today is, 0–100.
 *
 * Both dates are DATE-ONLY (`@db.Date`), so they arrive as UTC midnight and
 * are compared as such — no zone conversion, because a semester does not
 * start at a clock time.
 */
export function semesterProgress(
  startDate: Date,
  endDate: Date,
  now: Date,
): number | null {
  const start = startDate.getTime();
  const end = endDate.getTime();

  if (end <= start) {
    return null;
  }

  const elapsed = now.getTime() - start;
  const total = end - start;

  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}
