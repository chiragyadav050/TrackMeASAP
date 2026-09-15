import type {
  MilestoneStatus,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceType,
} from "@/generated/prisma/client";
import type { ProjectHealth } from "@/services/work/project.derive";

export type {
  MilestoneStatus,
  ProjectStatus,
  WorkspaceType,
} from "@/generated/prisma/client";
export type { ProjectHealth } from "@/services/work/project.derive";

/**
 * Work view models.
 *
 * Same contract as `TaskDto` and the academic DTOs: every date-derived label
 * is computed on the SERVER in the profile's zone, so a client component
 * never calls `getHours()` and never disagrees with the server about what day
 * it is. These types live here rather than in the query module because that
 * module is `server-only` and these cross the boundary.
 */

export type ProjectDto = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly status: ProjectStatus;
  readonly priority: TaskPriority;
  readonly startAt: Date | null;
  readonly targetEndAt: Date | null;
  /**
   * `YYYY-MM-DD` in the PROFILE's zone, ready for an `<input type="date">`.
   *
   * Sent from the server for the same reason Phase 2 sends `dueDateInput`:
   * deriving it in the browser with `toISOString()` silently shifts the date
   * by a day for anyone east or west of UTC.
   */
  readonly startDateInput: string | null;
  readonly targetEndDateInput: string | null;
  /** Pre-formatted target date, e.g. "30 Nov". */
  readonly targetLabel: string | null;
  /** Local calendar days until the target; negative once it has passed. */
  readonly daysRemaining: number | null;
  readonly health: ProjectHealth;
  /** `null` when the project has no tasks — "not started", not 0%. */
  readonly progressPercent: number | null;
  readonly taskTotal: number;
  readonly taskCompleted: number;
  readonly overdueTaskCount: number;
  readonly milestoneTotal: number;
  readonly milestoneCompleted: number;
  readonly milestoneProgressPercent: number | null;
  readonly openBlockerCount: number;
  readonly nextMilestoneTitle: string | null;
  readonly nextMilestoneDueLabel: string | null;
  readonly isArchived: boolean;
  readonly updatedAt: Date;
};

export type WorkspaceDto = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: WorkspaceType;
  readonly icon: string | null;
  readonly isArchived: boolean;
  readonly activeProjectCount: number;
  readonly blockedProjectCount: number;
};

export type MilestoneDto = {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: MilestoneStatus;
  readonly dueAt: Date | null;
  readonly dueLabel: string | null;
  readonly isOverdue: boolean;
  readonly sortOrder: number;
};

export type BlockerDto = {
  readonly id: string;
  readonly reason: string;
  readonly isResolved: boolean;
  readonly resolutionNote: string | null;
  readonly createdLabel: string;
  /** Days between being raised and being resolved — or today, if still open. */
  readonly daysOpen: number;
};

export type ProjectTaskDto = {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly isCompleted: boolean;
  readonly dueLabel: string | null;
};

export type ProjectDetailDto = {
  readonly project: ProjectDto;
  readonly milestones: readonly MilestoneDto[];
  readonly blockers: readonly BlockerDto[];
  readonly tasks: readonly ProjectTaskDto[];
};

export type UpcomingMilestoneDto = {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly dueLabel: string | null;
};

export type WorkOverviewDto = {
  readonly workspaces: readonly WorkspaceDto[];
  readonly projects: readonly ProjectDto[];
  readonly blockedProjects: readonly ProjectDto[];
  readonly atRiskProjects: readonly ProjectDto[];
  readonly upcomingMilestones: readonly UpcomingMilestoneDto[];
  readonly totalOverdueTasks: number;
};

/** The compact shape the Overview tile and the Phase 8 AI tools both read. */
export type ProjectsSummaryDto = {
  readonly activeCount: number;
  readonly blockedCount: number;
  readonly atRiskCount: number;
  /** The few most pressing, already ordered. */
  readonly projects: readonly ProjectDto[];
};

export type WorkSearchResult = {
  readonly id: string;
  readonly kind: "PROJECT" | "WORKSPACE";
  readonly title: string;
  readonly subtitle: string | null;
  readonly href: string;
};
