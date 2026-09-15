import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleDot,
  FileCheck2,
  FileClock,
  FileX2,
  HelpCircle,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  AssignmentStatus,
  AttendanceRisk,
  ExamType,
  SubmissionStatus,
} from "@/types/academics";

/**
 * Academic status indicators.
 *
 * Same accessibility rule as the task badges: MEANING NEVER RESTS ON COLOUR.
 * Every risk band and every status carries a distinct icon and a text label,
 * so a greyscale screenshot — or a colour-blind reader — loses nothing.
 */

type RiskMeta = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly className: string;
  readonly description: string;
};

export const RISK_META: Readonly<Record<AttendanceRisk, RiskMeta>> = {
  SAFE: {
    label: "Safe",
    icon: ShieldCheck,
    className: "text-success",
    description: "Comfortably above the requirement.",
  },
  WATCH: {
    label: "Watch",
    icon: CircleAlert,
    className: "text-warning",
    description: "Meeting the requirement, but with no margin.",
  },
  AT_RISK: {
    label: "At risk",
    icon: AlertTriangle,
    className: "text-warning",
    description: "Below the requirement, still recoverable.",
  },
  CRITICAL: {
    label: "Critical",
    icon: AlertTriangle,
    className: "text-danger",
    description: "Below the requirement and hard to recover.",
  },
  UNKNOWN: {
    label: "No data",
    icon: HelpCircle,
    className: "text-muted-foreground",
    description: "No classes have been marked yet.",
  },
};

export function AttendanceRiskBadge({
  risk,
  showLabel = true,
  className,
}: {
  risk: AttendanceRisk;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = RISK_META[risk];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-label font-medium",
        meta.className,
        className,
      )}
      title={meta.description}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {showLabel ? (
        <span>{meta.label}</span>
      ) : (
        <span className="sr-only">{meta.label}</span>
      )}
    </span>
  );
}

const ASSIGNMENT_STATUS_META: Readonly<
  Record<
    AssignmentStatus,
    { label: string; icon: LucideIcon; className: string }
  >
> = {
  NOT_STARTED: {
    label: "Not started",
    icon: CircleDashed,
    className: "text-muted-foreground",
  },
  IN_PROGRESS: {
    label: "In progress",
    icon: CircleDot,
    className: "text-brand-text",
  },
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-success",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: FileX2,
    className: "text-muted-foreground",
  },
};

export function AssignmentStatusBadge({
  status,
}: {
  status: AssignmentStatus;
}) {
  const meta = ASSIGNMENT_STATUS_META[status];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-label",
        meta.className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}

const SUBMISSION_META: Readonly<
  Record<
    SubmissionStatus,
    { label: string; icon: LucideIcon; className: string }
  >
> = {
  NOT_SUBMITTED: {
    label: "Not submitted",
    icon: FileClock,
    className: "text-muted-foreground",
  },
  SUBMITTED: {
    label: "Submitted",
    icon: FileCheck2,
    className: "text-success",
  },
  LATE: {
    label: "Submitted late",
    icon: FileCheck2,
    className: "text-warning",
  },
  ACCEPTED: {
    label: "Accepted",
    icon: FileCheck2,
    className: "text-success",
  },
};

/**
 * The submission badge is shown ALONGSIDE the work status, never instead of
 * it — the two are independent facts and collapsing them in the UI would
 * undo the point of separating them in the schema.
 */
export function SubmissionBadge({ status }: { status: SubmissionStatus }) {
  const meta = SUBMISSION_META[status];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-label",
        meta.className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}

export const EXAM_TYPE_LABELS: Readonly<Record<ExamType, string>> = {
  MIDTERM: "Midterm",
  END_SEMESTER: "End semester",
  PRACTICAL: "Practical",
  VIVA: "Viva",
  SUPPLEMENTARY: "Supplementary",
  BACKLOG: "Backlog",
  OTHER: "Other",
};

/**
 * Attendance percentage against its threshold.
 *
 * Renders the honest "—" when nothing has been marked. A subject with no
 * classes has not failed its requirement; it has no data, and showing 0%
 * would be a lie that panics the reader.
 */
export function AttendanceFigure({
  percentage,
  thresholdPercent,
  className,
}: {
  percentage: number | null;
  thresholdPercent: number;
  className?: string;
}) {
  if (percentage === null) {
    return (
      <span className={cn("text-meta text-muted-foreground", className)}>
        No classes marked
      </span>
    );
  }

  const meets = percentage >= thresholdPercent;

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span
        className={cn(
          "font-semibold tabular-nums",
          meets ? "text-foreground" : "text-danger",
        )}
      >
        {Math.round(percentage * 10) / 10}%
      </span>
      <span className="text-label text-muted-foreground tabular-nums">
        of {thresholdPercent}%
      </span>
    </span>
  );
}

/**
 * Exam preparation.
 *
 * `null` means tracking has not started — explicitly different from 0%.
 */
export function PreparationFigure({
  percentage,
  completedTopics,
  totalTopics,
}: {
  percentage: number | null;
  completedTopics: number;
  totalTopics: number;
}) {
  if (percentage === null) {
    return (
      <span className="text-label text-muted-foreground">
        Preparation tracking not started
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="relative h-1.5 w-16 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${completedTopics} of ${totalTopics} topics complete`}
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            percentage >= 100 ? "bg-success" : "bg-primary",
          )}
          style={{ width: `${percentage}%` }}
        />
      </span>
      <span className="text-label text-muted-foreground tabular-nums">
        {Math.round(percentage)}% · {completedTopics}/{totalTopics}
      </span>
    </span>
  );
}
