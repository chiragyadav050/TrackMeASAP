import type {
  EnergyLevel,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/client";

export type {
  EnergyLevel,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/client";

/**
 * What the UI receives for a task.
 *
 * This is a VIEW MODEL, not a row. Every date-derived label — "Today",
 * "2 days overdue", "9:30 pm" — is computed on the server in the profile's
 * time zone and handed over as a finished string.
 *
 * That is deliberate. If the client re-derived these it would need the user's
 * zone, the current instant and a duplicate copy of the day-boundary maths,
 * and the two copies would eventually disagree. Time-zone logic lives in
 * exactly one place: `src/lib/time.ts`, called from the server.
 */
export type TaskDto = {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly notes: string | null;

  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly category: TaskCategory;
  readonly energy: EnergyLevel;

  readonly dueAt: Date | null;
  readonly isAllDay: boolean;
  readonly estimatedMinutes: number | null;
  readonly actualMinutes: number | null;

  readonly isCompleted: boolean;
  readonly completedAt: Date | null;
  readonly isArchived: boolean;

  /** Derived from `dueAt` + now, in the profile's zone. Never stored. */
  readonly isOverdue: boolean;
  /** e.g. "2 days overdue". `null` when not overdue. */
  readonly overdueLabel: string | null;
  /** e.g. "Today", "Tomorrow", "Friday", "2 Nov". `null` when no due date. */
  readonly dueLabel: string | null;
  /** e.g. "9:30 pm". `null` for all-day tasks and tasks with no due date. */
  readonly dueTimeLabel: string | null;
  /** e.g. "45m", "1h 30m". `null` when unestimated. */
  readonly estimateLabel: string | null;

  /**
   * Raw values for `<input type="date">` / `<input type="time">`, in the
   * PROFILE's zone.
   *
   * Sent from the server rather than derived on the client: `Date#getHours()`
   * reads the BROWSER's zone, which is wrong whenever it differs from the
   * zone the user configured in Settings.
   */
  readonly dueDateInput: string | null;
  readonly dueTimeInput: string | null;

  readonly subtaskTotal: number;
  readonly subtaskCompleted: number;

  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type SubtaskDto = {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly isCompleted: boolean;
  readonly position: number;
};

/** A task plus its checklist, for the detail view. */
export type TaskDetailDto = TaskDto & {
  readonly subtasks: readonly SubtaskDto[];
};

/**
 * The single task the Today page leads with, plus the reasons it won.
 *
 * `reasons` exists so the recommendation can explain itself. A ranking the
 * user cannot interrogate is indistinguishable from a random pick, and this
 * is the deterministic groundwork for Phase 9's AI planner.
 */
export type NextBestActionDto = {
  readonly task: TaskDto;
  readonly reasons: readonly string[];
};

/** Counts for the Today page and the Overview dashboard. */
export type TaskStatisticsDto = {
  readonly activeCount: number;
  readonly dueTodayTotal: number;
  readonly completedToday: number;
  readonly overdueCount: number;
  /** 0–100, of today's tasks. `0` when nothing is due today. */
  readonly todayCompletionPercent: number;
};

/** Everything the Today page renders, assembled in one server round-trip. */
export type TodayViewDto = {
  readonly greeting: string;
  readonly dateLabel: string;
  readonly timeZone: string;
  readonly nextBestAction: NextBestActionDto | null;
  readonly dueToday: readonly TaskDto[];
  readonly completedToday: readonly TaskDto[];
  readonly overdue: readonly TaskDto[];
  readonly upcoming: readonly TaskDto[];
  readonly statistics: TaskStatisticsDto;
};
