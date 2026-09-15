import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Battery,
  BatteryFull,
  BatteryMedium,
  CircleDot,
  Clock,
  Equal,
  Flame,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  EnergyLevel,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@/types/task";

/**
 * Status indicators for a task row.
 *
 * ACCESSIBILITY RULE THIS FILE ENFORCES: meaning never rests on colour alone.
 * Every priority carries a distinct ICON as well as a hue, and every badge
 * has a text label available to assistive technology. A user with any form of
 * colour vision deficiency — or a greyscale screenshot — can still tell an
 * urgent task from a low one.
 */

type PriorityMeta = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly className: string;
};

export const PRIORITY_META: Readonly<Record<TaskPriority, PriorityMeta>> = {
  URGENT: {
    label: "Urgent",
    icon: Flame,
    className: "text-danger",
  },
  HIGH: {
    label: "High",
    icon: ArrowUp,
    className: "text-warning",
  },
  MEDIUM: {
    label: "Medium",
    icon: Equal,
    className: "text-muted-foreground",
  },
  LOW: {
    label: "Low",
    icon: ArrowDown,
    className: "text-muted-foreground/70",
  },
};

export const CATEGORY_LABELS: Readonly<Record<TaskCategory, string>> = {
  PERSONAL: "Personal",
  COLLEGE: "College",
  WORK: "Work",
  PROJECT: "Project",
  OTHER: "Other",
};

export const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ENERGY_META: Readonly<
  Record<EnergyLevel, { label: string; icon: LucideIcon }>
> = {
  LOW: { label: "Low energy", icon: Battery },
  MEDIUM: { label: "Medium energy", icon: BatteryMedium },
  HIGH: { label: "High energy", icon: BatteryFull },
};

/** Priority as icon + accessible label. */
export function PriorityIndicator({
  priority,
  showLabel = false,
  className,
}: {
  priority: TaskPriority;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-label",
        meta.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {showLabel ? (
        <span>{meta.label}</span>
      ) : (
        <span className="sr-only">{meta.label} priority</span>
      )}
    </span>
  );
}

/** Due date, or the overdue warning when the deadline has passed. */
export function DueIndicator({
  dueLabel,
  dueTimeLabel,
  overdueLabel,
  isOverdue,
}: {
  dueLabel: string | null;
  dueTimeLabel: string | null;
  overdueLabel: string | null;
  isOverdue: boolean;
}) {
  if (!dueLabel) {
    return null;
  }

  if (isOverdue) {
    return (
      <span className="inline-flex items-center gap-1 text-label font-medium text-danger">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span>{overdueLabel ?? "Overdue"}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-label text-muted-foreground">
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span>
        {dueLabel}
        {dueTimeLabel ? `, ${dueTimeLabel}` : ""}
      </span>
    </span>
  );
}

/** Small marker for statuses that change how a task should be read. */
export function StatusIndicator({ status }: { status: TaskStatus }) {
  if (status === "IN_PROGRESS") {
    return (
      <span className="inline-flex items-center gap-1 text-label font-medium text-brand-text">
        <CircleDot className="size-3.5 shrink-0" aria-hidden />
        In progress
      </span>
    );
  }

  if (status === "BLOCKED") {
    return (
      <span className="inline-flex items-center gap-1 text-label font-medium text-warning">
        <Ban className="size-3.5 shrink-0" aria-hidden />
        Blocked
      </span>
    );
  }

  return null;
}

/** "3 / 5" with a thin progress bar. */
export function SubtaskProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  if (total === 0) {
    return null;
  }

  const percent = Math.round((completed / total) * 100);
  const isComplete = completed === total;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-label text-muted-foreground"
      title={`${completed} of ${total} subtasks complete`}
    >
      <span
        className="relative h-1 w-8 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${completed} of ${total} subtasks complete`}
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
            isComplete ? "bg-success" : "bg-brand-text/70",
          )}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="tabular-nums">
        {completed}/{total}
      </span>
    </span>
  );
}
