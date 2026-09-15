import {
  formatDueDateLabel,
  formatDuration,
  formatOverdueBy,
  formatTimeOfDay,
  isSameLocalDay,
  localDayDifference,
} from "@/lib/time";

/**
 * Pure task derivations.
 *
 * Deliberately free of Prisma, React and `server-only`: everything here is a
 * function of (task, now, timeZone), which makes the rules that actually
 * matter — what counts as overdue, what counts as today — testable without a
 * database and impossible to accidentally duplicate in a component.
 */

/** The minimum a task must expose for these rules to apply. */
export type DerivableTask = {
  readonly status: string;
  readonly dueAt: Date | null;
  readonly isAllDay: boolean;
  readonly completedAt: Date | null;
  readonly archivedAt: Date | null;
};

/** Statuses that take a task out of play. */
export const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "CANCELLED"];

export function isTerminal(task: Pick<DerivableTask, "status">): boolean {
  return TERMINAL_STATUSES.includes(task.status);
}

export function isActive(task: DerivableTask): boolean {
  return !isTerminal(task) && task.archivedAt === null;
}

/**
 * The instant by which a task must be done.
 *
 * For an all-day task that is the END of its local day, not the start.
 * Treating "due Friday" as "due 00:00 Friday" would mark it overdue for the
 * entire day it is actually due — the single most common way this gets
 * implemented wrong.
 */
export function effectiveDeadline(
  task: Pick<DerivableTask, "dueAt" | "isAllDay">,
  timeZone: string,
  endOfDay: (date: Date, timeZone: string) => Date,
): Date | null {
  if (!task.dueAt) {
    return null;
  }

  return task.isAllDay ? endOfDay(task.dueAt, timeZone) : task.dueAt;
}

/**
 * Overdue is derived, never stored.
 *
 * A stored flag would be wrong the moment the clock passed the deadline and
 * would need a job to keep it true. Computing it costs nothing and is always
 * right.
 */
export function isOverdue(
  task: DerivableTask,
  now: Date,
  timeZone: string,
  endOfDay: (date: Date, timeZone: string) => Date,
): boolean {
  if (!isActive(task)) {
    return false;
  }

  const deadline = effectiveDeadline(task, timeZone, endOfDay);

  return deadline !== null && deadline.getTime() < now.getTime();
}

/** Whether an active task falls on the user's current local day. */
export function isDueToday(
  task: DerivableTask,
  now: Date,
  timeZone: string,
): boolean {
  if (!task.dueAt || !isActive(task)) {
    return false;
  }

  return isSameLocalDay(task.dueAt, now, timeZone);
}

/** Whether the task was completed during the user's current local day. */
export function wasCompletedToday(
  task: DerivableTask,
  now: Date,
  timeZone: string,
): boolean {
  if (!task.completedAt || task.archivedAt !== null) {
    return false;
  }

  return isSameLocalDay(task.completedAt, now, timeZone);
}

/**
 * Display labels for one task, all resolved in the profile's zone.
 *
 * Computed on the server so the client never needs the zone, the current
 * instant, or a second copy of this logic.
 */
export type TaskLabels = {
  readonly dueLabel: string | null;
  readonly dueTimeLabel: string | null;
  readonly overdueLabel: string | null;
  readonly estimateLabel: string | null;
};

export function buildTaskLabels(
  task: DerivableTask & { readonly estimatedMinutes: number | null },
  now: Date,
  timeZone: string,
  locale: string,
  endOfDay: (date: Date, timeZone: string) => Date,
): TaskLabels {
  const overdue = isOverdue(task, now, timeZone, endOfDay);

  return {
    dueLabel: task.dueAt
      ? formatDueDateLabel(task.dueAt, now, timeZone, locale)
      : null,
    dueTimeLabel:
      task.dueAt && !task.isAllDay
        ? formatTimeOfDay(task.dueAt, timeZone, locale)
        : null,
    overdueLabel:
      overdue && task.dueAt
        ? formatOverdueBy(
            effectiveDeadline(task, timeZone, endOfDay) ?? task.dueAt,
            now,
            timeZone,
          )
        : null,
    estimateLabel:
      task.estimatedMinutes === null
        ? null
        : formatDuration(task.estimatedMinutes),
  };
}

/**
 * Whole days until a task is due, in the user's zone.
 * Negative when the due date has passed. `null` when undated.
 */
export function daysUntilDue(
  task: Pick<DerivableTask, "dueAt">,
  now: Date,
  timeZone: string,
): number | null {
  return task.dueAt === null
    ? null
    : localDayDifference(now, task.dueAt, timeZone);
}

/** Completed / total for a checklist, plus a rounded percentage. */
export function subtaskProgress(
  completed: number,
  total: number,
): { completed: number; total: number; percent: number } {
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}
