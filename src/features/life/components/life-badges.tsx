import {
  Battery,
  CircleDashed,
  Flame,
  Frown,
  Meh,
  Smile,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  BudgetStatus,
  GoalCategory,
  GoalPace,
  ImportantDateKind,
  MoodLevel,
} from "@/types/life";

/**
 * Life status indicators.
 *
 * Same accessibility rule as every other badge set in Life OS: MEANING NEVER
 * RESTS ON COLOUR. Each state carries an icon and a written label.
 */

export const MOOD_META: Readonly<
  Record<MoodLevel, { label: string; icon: LucideIcon; className: string }>
> = {
  VERY_LOW: { label: "Very low", icon: Frown, className: "text-danger" },
  LOW: { label: "Low", icon: Frown, className: "text-warning" },
  NEUTRAL: { label: "Neutral", icon: Meh, className: "text-muted-foreground" },
  GOOD: { label: "Good", icon: Smile, className: "text-success" },
  GREAT: { label: "Great", icon: Smile, className: "text-success" },
};

export const PACE_META: Readonly<
  Record<GoalPace, { label: string; icon: LucideIcon; className: string }>
> = {
  AHEAD: { label: "Ahead", icon: TrendingUp, className: "text-success" },
  ON_TRACK: { label: "On track", icon: TrendingUp, className: "text-success" },
  BEHIND: { label: "Behind", icon: TrendingDown, className: "text-warning" },
  OVERDUE: { label: "Overdue", icon: TrendingDown, className: "text-danger" },
  UNKNOWN: {
    label: "No deadline",
    icon: CircleDashed,
    className: "text-muted-foreground",
  },
};

export const BUDGET_META: Readonly<
  Record<BudgetStatus, { label: string; className: string }>
> = {
  UNDER: { label: "Within budget", className: "text-success" },
  NEAR: { label: "Close to budget", className: "text-warning" },
  OVER: { label: "Over budget", className: "text-danger" },
  UNTRACKED: { label: "No budget set", className: "text-muted-foreground" },
};

export const GOAL_CATEGORY_LABELS: Readonly<Record<GoalCategory, string>> = {
  ACADEMIC: "Academic",
  CAREER: "Career",
  HEALTH: "Health",
  FINANCE: "Finance",
  SKILL: "Skill",
  PERSONAL: "Personal",
  RELATIONSHIP: "Relationships",
  OTHER: "Other",
};

export const IMPORTANT_DATE_LABELS: Readonly<
  Record<ImportantDateKind, string>
> = {
  BIRTHDAY: "Birthday",
  ANNIVERSARY: "Anniversary",
  DEADLINE: "Deadline",
  RENEWAL: "Renewal",
  OTHER: "Date",
};

export function PaceBadge({
  pace,
  className,
}: {
  pace: GoalPace;
  className?: string;
}) {
  const meta = PACE_META[pace];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label font-medium",
        meta.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}

export function MoodBadge({
  mood,
  className,
}: {
  mood: MoodLevel;
  className?: string;
}) {
  const meta = MOOD_META[mood];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label font-medium",
        meta.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * A streak count.
 *
 * Zero is written as "No streak yet" rather than shown as "0 🔥" — a flame
 * next to a zero reads as failure, and a habit someone started today has not
 * failed at anything.
 */
export function StreakBadge({
  days,
  className,
}: {
  days: number;
  className?: string;
}) {
  if (days === 0) {
    return (
      <span className={cn("text-label text-muted-foreground", className)}>
        No streak yet
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label font-medium text-warning",
        className,
      )}
    >
      <Flame className="size-3.5 shrink-0" aria-hidden />
      {days} {days === 1 ? "day" : "days"}
    </span>
  );
}

/** A 1–5 self-report, rendered as filled pips rather than a bare number. */
export function LevelPips({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={`${label}: ${value} of 5`}
    >
      <Battery
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="sr-only">
        {label}: {value} of 5
      </span>
      {[1, 2, 3, 4, 5].map((pip) => (
        <span
          key={pip}
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            pip <= value ? "bg-accent" : "bg-surface-sunken",
          )}
        />
      ))}
    </span>
  );
}

/** A completion percentage, or an honest "not enough data yet". */
export function RateFigure({
  percent,
  className,
}: {
  percent: number | null;
  className?: string;
}) {
  if (percent === null) {
    return (
      <span className={cn("text-label text-muted-foreground", className)}>
        No data yet
      </span>
    );
  }

  return (
    <span className={cn("text-label tabular-nums", className)}>
      {Math.round(percent)}% in 30 days
    </span>
  );
}
