import { localDayDifference } from "@/lib/time";

/**
 * Pure project intelligence.
 *
 * No Prisma, no React, no clock of its own — same contract as the task and
 * academic derive modules, and the same reason: the rules a user acts on
 * ("is this project at risk?") must be testable with plain objects and
 * impossible to reimplement by accident in a component.
 */

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type ProgressCounts = {
  readonly completed: number;
  readonly total: number;
};

/**
 * PROJECT PROGRESS = completed tasks / total non-cancelled tasks × 100.
 *
 * Counted from TASKS, not milestones. Milestones are checkpoints a user sets
 * at wildly varying granularity — one project may have two, another twenty —
 * so a milestone-based percentage is not comparable between projects. Task
 * counts are.
 *
 * CANCELLED tasks are excluded from BOTH sides: work that was called off is
 * neither done nor outstanding, and leaving it in the denominator would cap a
 * finished project below 100%.
 *
 * Returns `null` for a project with no tasks — "not started" is different
 * from "0% done", and every surface says so.
 */
export function projectProgress(counts: ProgressCounts): number | null {
  if (counts.total <= 0) {
    return null;
  }

  return Math.min(100, (counts.completed / counts.total) * 100);
}

/** Milestone progress, shown alongside task progress rather than instead. */
export function milestoneProgress(counts: ProgressCounts): number | null {
  return counts.total <= 0 ? null : (counts.completed / counts.total) * 100;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type ProjectHealth =
  "COMPLETED" | "BLOCKED" | "OVERDUE" | "AT_RISK" | "ON_TRACK" | "NOT_STARTED";

export type HealthInput = {
  readonly status: string;
  readonly targetEndAt: Date | null;
  readonly completedAt: Date | null;
  /** Unresolved blockers. Any at all is enough to call a project blocked. */
  readonly openBlockerCount: number;
  readonly taskCounts: ProgressCounts;
  readonly overdueTaskCount: number;
  readonly overdueMilestoneCount: number;
};

/**
 * Project health, evaluated in strict precedence order.
 *
 * The order matters as much as the bands: a blocked project that is also
 * overdue should read BLOCKED, because the blocker is the thing to act on.
 *
 *   COMPLETED     status is COMPLETED, or everything is done
 *   BLOCKED       status BLOCKED, or any unresolved blocker exists
 *   OVERDUE       the target end date has passed and it is not finished
 *   AT_RISK       overdue tasks/milestones exist, OR the deadline is inside
 *                 7 days with less than half the work done
 *   NOT_STARTED   no tasks yet
 *   ON_TRACK      everything else
 *
 * `AT_RISK` deliberately uses the RATIO of work done against time remaining
 * rather than a fixed task count: "three tasks left" means nothing without
 * knowing whether that is three of four or three of forty.
 */
export function projectHealth(
  input: HealthInput,
  now: Date,
  timeZone: string,
): ProjectHealth {
  if (input.status === "COMPLETED" || input.completedAt !== null) {
    return "COMPLETED";
  }

  if (input.status === "BLOCKED" || input.openBlockerCount > 0) {
    return "BLOCKED";
  }

  const isFinished =
    input.taskCounts.total > 0 &&
    input.taskCounts.completed >= input.taskCounts.total;

  if (isFinished) {
    return "COMPLETED";
  }

  if (input.targetEndAt && input.targetEndAt.getTime() < now.getTime()) {
    return "OVERDUE";
  }

  if (input.overdueTaskCount > 0 || input.overdueMilestoneCount > 0) {
    return "AT_RISK";
  }

  if (input.taskCounts.total === 0) {
    return "NOT_STARTED";
  }

  if (input.targetEndAt) {
    const daysLeft = localDayDifference(now, input.targetEndAt, timeZone);
    const progress = projectProgress(input.taskCounts) ?? 0;

    if (daysLeft <= DEADLINE_PRESSURE_DAYS && progress < HALFWAY_PERCENT) {
      return "AT_RISK";
    }
  }

  return "ON_TRACK";
}

/** Inside a week of the deadline, insufficient progress starts to matter. */
const DEADLINE_PRESSURE_DAYS = 7;
const HALFWAY_PERCENT = 50;

// ---------------------------------------------------------------------------
// Next milestone
// ---------------------------------------------------------------------------

export type DerivableMilestone = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly dueAt: Date | null;
  readonly sortOrder: number;
};

/**
 * The milestone to work toward next.
 *
 * Incomplete only, then ordered by due date (soonest first, undated last),
 * then by the user's manual `sortOrder`. Dated milestones win because a
 * deadline is a fact about the world; `sortOrder` is only an intention.
 */
export function nextMilestone(
  milestones: readonly DerivableMilestone[],
): DerivableMilestone | null {
  const open = milestones.filter(
    (milestone) => milestone.status !== "COMPLETED",
  );

  if (open.length === 0) {
    return null;
  }

  return [...open].sort((a, b) => {
    const dueA = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const dueB = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;

    if (dueA !== dueB) {
      return dueA - dueB;
    }

    return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
  })[0]!;
}

/** A milestone is overdue on the same terms as anything else in Life OS. */
export function isMilestoneOverdue(
  milestone: Pick<DerivableMilestone, "status" | "dueAt">,
  now: Date,
): boolean {
  if (milestone.status === "COMPLETED" || !milestone.dueAt) {
    return false;
  }

  return milestone.dueAt.getTime() < now.getTime();
}

/** Whether a project still counts as live work. */
export function isProjectActive(project: {
  readonly status: string;
  readonly archivedAt: Date | null;
}): boolean {
  if (project.archivedAt !== null) {
    return false;
  }

  return !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(project.status);
}

/**
 * Days a project has sat untouched.
 *
 * Feeds the Phase 10 inactive-project scan. `null` when there is nothing to
 * measure from.
 */
export function daysSinceActivity(
  lastActivityAt: Date | null,
  now: Date,
  timeZone: string,
): number | null {
  return lastActivityAt === null
    ? null
    : localDayDifference(lastActivityAt, now, timeZone);
}
