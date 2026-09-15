import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  OctagonX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  MilestoneStatus,
  ProjectHealth,
  ProjectStatus,
  WorkspaceType,
} from "@/types/work";

/**
 * Project status indicators.
 *
 * Same accessibility rule as the task and academic badges: MEANING NEVER
 * RESTS ON COLOUR. Every health band carries its own icon and a written
 * label, so a greyscale screenshot or a colour-blind reader loses nothing.
 */

type HealthMeta = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly className: string;
  /** Plain-language explanation, used as the tooltip and in detail views. */
  readonly description: string;
};

export const HEALTH_META: Readonly<Record<ProjectHealth, HealthMeta>> = {
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-success",
    description: "Every task is done.",
  },
  BLOCKED: {
    label: "Blocked",
    icon: OctagonX,
    className: "text-danger",
    description:
      "Something is in the way — nothing else moves until it clears.",
  },
  OVERDUE: {
    label: "Overdue",
    icon: Clock,
    className: "text-danger",
    description: "The target date has passed and the work is not finished.",
  },
  AT_RISK: {
    label: "At risk",
    icon: TriangleAlert,
    className: "text-warning",
    description:
      "Work is already late, or the deadline is close and most of it is not done.",
  },
  ON_TRACK: {
    label: "On track",
    icon: CircleDot,
    className: "text-success",
    description: "Progress matches the time remaining.",
  },
  NOT_STARTED: {
    label: "Not started",
    icon: CircleDashed,
    className: "text-muted-foreground",
    description: "No tasks yet, so there is nothing to measure.",
  },
};

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const MILESTONE_STATUS_LABELS: Readonly<
  Record<MilestoneStatus, string>
> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
};

export const WORKSPACE_TYPE_LABELS: Readonly<Record<WorkspaceType, string>> = {
  PERSONAL: "Personal",
  FREELANCE: "Freelance",
  BUSINESS: "Business",
  SAAS: "SaaS",
  CONTENT: "Content",
  RESEARCH: "Research",
  OTHER: "Other",
};

export function HealthBadge({
  health,
  showLabel = true,
  className,
}: {
  health: ProjectHealth;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = HEALTH_META[health];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label font-medium",
        meta.className,
        className,
      )}
      title={meta.description}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {showLabel ? meta.label : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

/**
 * Task-based completion.
 *
 * A project with no tasks gets a written "No tasks yet" rather than an empty
 * bar reading 0% — the two mean different things and the UI must not blur
 * them.
 */
export function ProjectProgress({
  percent,
  completed,
  total,
  className,
}: {
  percent: number | null;
  completed: number;
  total: number;
  className?: string;
}) {
  if (percent === null) {
    return (
      <p className={cn("text-label text-muted-foreground", className)}>
        No tasks yet
      </p>
    );
  }

  const rounded = Math.round(percent);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-label">
        <span className="text-muted-foreground">
          {completed} of {total} tasks
        </span>
        <span className="font-medium tabular-nums">{rounded}%</span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${completed} of ${total} tasks complete`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            rounded === 100 ? "bg-success" : "bg-accent",
          )}
          style={{ width: `${rounded}%` }}
        />
      </div>
    </div>
  );
}

/** Days to the target date, phrased the way a person would say it. */
export function TargetIndicator({
  label,
  daysRemaining,
  className,
}: {
  label: string | null;
  daysRemaining: number | null;
  className?: string;
}) {
  if (!label) {
    return null;
  }

  const suffix =
    daysRemaining === null
      ? null
      : daysRemaining < 0
        ? `${Math.abs(daysRemaining)}d overdue`
        : daysRemaining === 0
          ? "today"
          : `${daysRemaining}d left`;

  const isLate = daysRemaining !== null && daysRemaining < 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label",
        isLate ? "text-danger" : "text-muted-foreground",
        className,
      )}
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span>
        {label}
        {suffix ? ` · ${suffix}` : ""}
      </span>
    </span>
  );
}
