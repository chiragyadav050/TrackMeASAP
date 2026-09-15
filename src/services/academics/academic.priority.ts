import {
  calculatePreparation,
  daysUntil,
  isAssignmentOverdue,
  type DerivableAssignment,
  type DerivableTopic,
} from "@/services/academics/academic.derive";
import type { AttendanceRisk } from "@/services/academics/attendance.calculator";

/**
 * Deterministic academic prioritisation.
 *
 * NOT AI. No model is called, nothing is generated. This is an explicit,
 * inspectable scoring function, and it is the baseline Phase 8/9 will be
 * measured against — an AI planner that cannot beat arithmetic is not worth
 * shipping.
 *
 * Pure by construction: (items, now, timeZone) in, ranking out. Every weight
 * is a named constant, and every item explains why it scored what it did.
 *
 * It mirrors `task.prioritization.ts` deliberately. Two ranking engines with
 * different philosophies would produce a Today page that contradicts itself.
 */

export type AcademicItemKind =
  "ASSIGNMENT" | "EXAM" | "ASSESSMENT" | "ATTENDANCE";

/** The common shape the engine ranks, whatever the underlying entity. */
export type AcademicPriorityItem = {
  readonly id: string;
  readonly kind: AcademicItemKind;
  readonly title: string;
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  /** Deadline, exam start, or assessment time. `null` for undated items. */
  readonly dueAt: Date | null;
  readonly isAllDay: boolean;
  readonly estimatedMinutes: number | null;
  /** Assignment priority; `null` for kinds that have none. */
  readonly priority: string | null;
  /** 0–100 for exams with topics; `null` when tracking has not started. */
  readonly preparationPercent: number | null;
  /** Only meaningful for ATTENDANCE items. */
  readonly attendanceRisk: AttendanceRisk | null;
  /** Whether the underlying work is still outstanding. */
  readonly isOpen: boolean;
  readonly isOverdue: boolean;
};

const PRIORITY_WEIGHT: Readonly<Record<string, number>> = {
  URGENT: 220,
  HIGH: 140,
  MEDIUM: 70,
  LOW: 25,
};

const PROXIMITY = {
  /** Overdue academic work outranks everything still in the future. */
  OVERDUE_BASE: 520,
  OVERDUE_PER_DAY: 22,
  OVERDUE_MAX_DAYS: 14,
  DUE_TODAY: 320,
  DUE_TOMORROW: 190,
  /** Two to three days out — the window where starting actually matters. */
  DUE_SOON: 120,
  DUE_THIS_WEEK: 70,
  DUE_LATER: 18,
  UNDATED: 0,
} as const;

const EXAM = {
  /**
   * Exams carry standing weight above ordinary coursework: a midterm is worth
   * more than a homework sheet even at equal distance.
   */
  BASE: 90,
  /**
   * The preparation gap, scaled. An exam in five days at 20% prepared should
   * dominate; the same exam at 95% should not. Multiplied by the fraction
   * UNPREPARED so a well-prepared exam quietly falls down the list.
   */
  UNPREPARED_WEIGHT: 240,
  /** Applied when an exam is close and topic tracking never started. */
  UNTRACKED_PENALTY: 60,
  /** Inside this many days, the preparation gap starts to bite. */
  URGENCY_WINDOW_DAYS: 14,
} as const;

const ATTENDANCE_WEIGHT: Readonly<Record<AttendanceRisk, number>> = {
  CRITICAL: 480,
  AT_RISK: 300,
  WATCH: 90,
  SAFE: 0,
  UNKNOWN: 0,
};

const EFFORT = {
  QUICK_WIN_MINUTES: 20,
  QUICK_WIN_BONUS: 25,
  LONG_TASK_MINUTES: 240,
  LONG_TASK_PENALTY: 15,
} as const;

export type AcademicScore = {
  readonly itemId: string;
  readonly score: number;
  readonly reasons: readonly string[];
};

/**
 * Scores one academic item. Higher is more pressing.
 *
 * Closed items score `-Infinity` so they can never be recommended.
 */
export function scoreAcademicItem(
  item: AcademicPriorityItem,
  now: Date,
  timeZone: string,
  helpers: {
    localDayDifference: (from: Date, to: Date, timeZone: string) => number;
  },
): AcademicScore {
  if (!item.isOpen) {
    return { itemId: item.id, score: -Infinity, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;

  // --- Attendance is its own thing -------------------------------------
  if (item.kind === "ATTENDANCE") {
    const risk = item.attendanceRisk ?? "UNKNOWN";
    score += ATTENDANCE_WEIGHT[risk];

    if (risk === "CRITICAL") {
      reasons.push("Attendance critical");
    } else if (risk === "AT_RISK") {
      reasons.push("Attendance below requirement");
    } else if (risk === "WATCH") {
      reasons.push("Attendance has no margin");
    }

    return { itemId: item.id, score, reasons };
  }

  // --- Proximity ---------------------------------------------------------
  const days = item.dueAt
    ? helpers.localDayDifference(now, item.dueAt, timeZone)
    : null;

  if (item.isOverdue) {
    const daysLate = Math.min(
      Math.max(days === null ? 0 : -days, 0),
      PROXIMITY.OVERDUE_MAX_DAYS,
    );

    score += PROXIMITY.OVERDUE_BASE + daysLate * PROXIMITY.OVERDUE_PER_DAY;
    reasons.push("Overdue");
  } else if (days === null) {
    score += PROXIMITY.UNDATED;
  } else if (days <= 0) {
    score += PROXIMITY.DUE_TODAY;
    reasons.push(item.kind === "EXAM" ? "Exam today" : "Due today");
  } else if (days === 1) {
    score += PROXIMITY.DUE_TOMORROW;
    reasons.push(item.kind === "EXAM" ? "Exam tomorrow" : "Due tomorrow");
  } else if (days <= 3) {
    score += PROXIMITY.DUE_SOON;
    reasons.push(`In ${days} days`);
  } else if (days <= 7) {
    score += PROXIMITY.DUE_THIS_WEEK;
    reasons.push("This week");
  } else {
    score += PROXIMITY.DUE_LATER;
  }

  // --- Assignment priority ----------------------------------------------
  if (item.priority) {
    score += PRIORITY_WEIGHT[item.priority] ?? PRIORITY_WEIGHT.MEDIUM;

    if (item.priority === "URGENT" || item.priority === "HIGH") {
      reasons.push(
        `${item.priority === "URGENT" ? "Urgent" : "High"} priority`,
      );
    }
  }

  // --- Exam preparation --------------------------------------------------
  if (item.kind === "EXAM") {
    score += EXAM.BASE;

    const withinWindow =
      days !== null && days >= 0 && days <= EXAM.URGENCY_WINDOW_DAYS;

    if (item.preparationPercent === null) {
      if (withinWindow) {
        score += EXAM.UNTRACKED_PENALTY;
        reasons.push("Preparation not tracked");
      }
    } else {
      const unprepared = Math.max(0, 100 - item.preparationPercent) / 100;

      // Scaled by closeness: an unprepared exam next month is not yet the
      // most pressing thing, the same exam next week very much is.
      const proximityFactor = withinWindow
        ? 1 - (days ?? 0) / EXAM.URGENCY_WINDOW_DAYS
        : 0;

      score += unprepared * EXAM.UNPREPARED_WEIGHT * proximityFactor;

      if (unprepared >= 0.5 && withinWindow) {
        reasons.push(`${Math.round(item.preparationPercent)}% prepared`);
      }
    }
  }

  // --- Effort ------------------------------------------------------------
  if (item.estimatedMinutes !== null) {
    if (item.estimatedMinutes <= EFFORT.QUICK_WIN_MINUTES) {
      score += EFFORT.QUICK_WIN_BONUS;
      reasons.push("Quick win");
    } else if (item.estimatedMinutes >= EFFORT.LONG_TASK_MINUTES) {
      score -= EFFORT.LONG_TASK_PENALTY;
    }
  }

  return { itemId: item.id, score, reasons };
}

/**
 * Orders academic items, most pressing first.
 *
 * Ties break on due date, then kind, then id — a total, stable order, so the
 * list does not reshuffle between page loads.
 */
export function rankAcademicItems(
  items: readonly AcademicPriorityItem[],
  now: Date,
  timeZone: string,
  helpers: {
    localDayDifference: (from: Date, to: Date, timeZone: string) => number;
  },
): readonly { item: AcademicPriorityItem; score: AcademicScore }[] {
  return items
    .map((item) => ({
      item,
      score: scoreAcademicItem(item, now, timeZone, helpers),
    }))
    .filter((entry) => entry.score.score !== -Infinity)
    .sort((a, b) => {
      if (b.score.score !== a.score.score) {
        return b.score.score - a.score.score;
      }

      const dueA = a.item.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const dueB = b.item.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;

      if (dueA !== dueB) {
        return dueA - dueB;
      }

      return (
        a.item.kind.localeCompare(b.item.kind) ||
        a.item.id.localeCompare(b.item.id)
      );
    });
}

/** Convenience wrappers so callers do not hand-roll the item shape. */

export function assignmentToPriorityItem(
  assignment: DerivableAssignment & {
    readonly id: string;
    readonly title: string;
    readonly subjectId: string;
    readonly priority: string;
    readonly estimatedMinutes: number | null;
  },
  subjectName: string | null,
  now: Date,
  timeZone: string,
): AcademicPriorityItem {
  return {
    id: assignment.id,
    kind: "ASSIGNMENT",
    title: assignment.title,
    subjectId: assignment.subjectId,
    subjectName,
    dueAt: assignment.dueAt,
    isAllDay: assignment.isAllDay,
    estimatedMinutes: assignment.estimatedMinutes,
    priority: assignment.priority,
    preparationPercent: null,
    attendanceRisk: null,
    isOpen:
      assignment.archivedAt === null &&
      assignment.status !== "CANCELLED" &&
      !(
        assignment.status === "COMPLETED" &&
        ["SUBMITTED", "LATE", "ACCEPTED"].includes(assignment.submissionStatus)
      ),
    isOverdue: isAssignmentOverdue(assignment, now, timeZone),
  };
}

export function examToPriorityItem(
  exam: {
    readonly id: string;
    readonly title: string;
    readonly subjectId: string | null;
    readonly startAt: Date | null;
    readonly status: string;
  },
  topics: readonly DerivableTopic[],
  subjectName: string | null,
  now: Date,
  timeZone: string,
): AcademicPriorityItem {
  const remaining = daysUntil(exam.startAt, now, timeZone);

  return {
    id: exam.id,
    kind: "EXAM",
    title: exam.title,
    subjectId: exam.subjectId,
    subjectName,
    dueAt: exam.startAt,
    isAllDay: false,
    estimatedMinutes: null,
    priority: null,
    preparationPercent: calculatePreparation(topics),
    attendanceRisk: null,
    isOpen: exam.status === "UPCOMING",
    // An exam does not become "overdue"; it happens. Once its day has passed
    // and it is still UPCOMING the record simply needs closing, which the
    // exams page surfaces separately.
    isOverdue:
      remaining !== null && remaining < 0 && exam.status === "UPCOMING",
  };
}

export function attendanceToPriorityItem(
  subject: { readonly id: string; readonly name: string },
  risk: AttendanceRisk,
): AcademicPriorityItem {
  return {
    id: `attendance:${subject.id}`,
    kind: "ATTENDANCE",
    title: `${subject.name} attendance`,
    subjectId: subject.id,
    subjectName: subject.name,
    dueAt: null,
    isAllDay: false,
    estimatedMinutes: null,
    priority: null,
    preparationPercent: null,
    attendanceRisk: risk,
    // Only worth surfacing when something is actually wrong.
    isOpen: risk === "CRITICAL" || risk === "AT_RISK" || risk === "WATCH",
    isOverdue: false,
  };
}

/** Exported so tests assert against the real weights rather than copies. */
export const ACADEMIC_PRIORITY_WEIGHTS = {
  PRIORITY_WEIGHT,
  PROXIMITY,
  EXAM,
  ATTENDANCE_WEIGHT,
  EFFORT,
} as const;
