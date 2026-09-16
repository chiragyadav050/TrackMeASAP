"use client";

import {
  AlertTriangle,
  CalendarCheck,
  GraduationCap,
  LifeBuoy,
  Repeat,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DailyPlanDto } from "@/services/planning/planning.query";

const WORKLOAD_META: Record<
  string,
  { label: string; className: string; note: string }
> = {
  LIGHT: {
    label: "Light day",
    className: "text-success",
    note: "There is room for more if you want it.",
  },
  COMFORTABLE: {
    label: "Comfortable",
    className: "text-success",
    note: "This fits with room to breathe.",
  },
  FULL: {
    label: "Full day",
    className: "text-warning",
    note: "This fits, but only just.",
  },
  OVERCOMMITTED: {
    label: "Overcommitted",
    className: "text-danger",
    note: "Today needs more hours than it has. Something will have to move.",
  },
};

export type PlanBoardProps = {
  readonly plan: DailyPlanDto;
  readonly weekend: readonly DailyPlanDto[];
  readonly recovery: {
    readonly isNeeded: boolean;
    readonly reason: string | null;
    readonly focus: readonly string[];
    readonly defer: readonly string[];
  };
  readonly examMode: {
    readonly isActive: boolean;
    readonly examTitle: string | null;
    readonly daysUntil: number | null;
    readonly dailyStudyMinutes: number | null;
    readonly topicsRemaining: number;
    readonly warning: string | null;
  };
  readonly procrastination: readonly {
    readonly itemId: string;
    readonly title: string;
    readonly rescheduleCount: number;
    readonly severity: string;
  }[];
  readonly review: {
    readonly completedCount: number;
    readonly createdCount: number;
    readonly completionRate: number | null;
    readonly habitConsistency: number | null;
    readonly observations: readonly string[];
  };
};

/**
 * The planning surface.
 *
 * Every figure on this page is arithmetic over the user's own data — no model
 * is involved, and the page says so. A plan that disappears when an API key
 * expires would not be a plan.
 */
export function PlanBoard({
  plan,
  weekend,
  recovery,
  examMode,
  procrastination,
  review,
}: PlanBoardProps) {
  const workload = WORKLOAD_META[plan.workload.verdict] ?? WORKLOAD_META.LIGHT!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan"
        description="A schedule built from your real calendar and your real tasks. Computed, not generated."
        actions={
          <span className={cn("text-meta font-medium", workload.className)}>
            {workload.label}
          </span>
        }
      />

      {recovery.isNeeded ? (
        <SectionCard
          title="You're behind — here's the short version"
          icon={LifeBuoy}
          description={recovery.reason ?? undefined}
        >
          <div className="space-y-4 p-4">
            <div>
              <p className="text-label font-medium text-muted-foreground">
                Do these
              </p>
              <ul className="mt-1 space-y-1">
                {recovery.focus.map((title) => (
                  <li key={title} className="text-meta">
                    • {title}
                  </li>
                ))}
              </ul>
            </div>

            {recovery.defer.length > 0 ? (
              <div>
                <p className="text-label font-medium text-muted-foreground">
                  Let these wait
                </p>
                <ul className="mt-1 space-y-1">
                  {recovery.defer.slice(0, 8).map((title) => (
                    <li key={title} className="text-meta text-muted-foreground">
                      • {title}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-label text-muted-foreground">
                  Deciding what to drop is the hard part, so it is named here
                  rather than left to you.
                </p>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {examMode.isActive ? (
        <SectionCard
          title={`Exam mode — ${examMode.examTitle}`}
          icon={GraduationCap}
          description={
            examMode.daysUntil === 0
              ? "Today."
              : `In ${examMode.daysUntil} ${examMode.daysUntil === 1 ? "day" : "days"}.`
          }
        >
          <div className="space-y-2 p-4">
            {examMode.topicsRemaining === 0 ? (
              <p className="text-meta text-success">
                Every topic is marked covered.
              </p>
            ) : (
              <p className="text-meta">
                {examMode.topicsRemaining} topics left — about{" "}
                {Math.round((examMode.dailyStudyMinutes ?? 0) / 60)}h{" "}
                {(examMode.dailyStudyMinutes ?? 0) % 60}m a day to cover them.
              </p>
            )}

            {examMode.warning ? (
              <p className="flex items-start gap-2 text-meta text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {examMode.warning}
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Today's plan"
          icon={CalendarCheck}
          className="lg:col-span-2"
          description={
            plan.blocks.length === 0
              ? undefined
              : `${Math.round(plan.plannedMinutes / 60)}h planned of ${Math.round(plan.availableMinutes / 60)}h free · ${workload.note}`
          }
        >
          {plan.isEmpty ? (
            <EmptyState
              icon={CalendarCheck}
              title="Nothing to plan."
              description="No tasks are due or overdue, so there is nothing to schedule. That is a real answer, not an empty screen."
              action={
                <Button
                  size="sm"
                  render={<Link href="/tasks">Add a task</Link>}
                />
              }
            />
          ) : plan.blocks.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="No free time today."
              description="Your calendar is full, so nothing could be scheduled. Everything is listed below as unplanned."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {plan.blocks.map((block, index) => (
                <li key={`${block.id}-${index}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-meta font-medium">
                        {block.title}
                      </p>
                      <p className="text-label text-muted-foreground">
                        {block.reasons.join(" · ")}
                      </p>
                    </div>

                    <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                      {block.timeLabel}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {plan.unplanned.length > 0 ? (
            <div className="border-t border-border-subtle p-4">
              <p className="text-label font-medium text-muted-foreground">
                Didn&apos;t fit
              </p>
              <ul className="mt-1 space-y-1">
                {plan.unplanned.map((entry, index) => (
                  <li key={index} className="text-label text-muted-foreground">
                    • {entry.title} — {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="This week"
            icon={TrendingUp}
            description="Counted, not estimated."
          >
            <dl className="space-y-2 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-label text-muted-foreground">Completed</dt>
                <dd className="text-meta font-medium tabular-nums">
                  {review.completedCount}
                </dd>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-label text-muted-foreground">Added</dt>
                <dd className="text-meta font-medium tabular-nums">
                  {review.createdCount}
                </dd>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-label text-muted-foreground">
                  Of what was due
                </dt>
                <dd className="text-meta font-medium tabular-nums">
                  {review.completionRate === null
                    ? "Nothing was due"
                    : `${Math.round(review.completionRate)}%`}
                </dd>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-label text-muted-foreground">Habits</dt>
                <dd className="text-meta font-medium tabular-nums">
                  {review.habitConsistency === null
                    ? "None scheduled"
                    : `${Math.round(review.habitConsistency)}%`}
                </dd>
              </div>
            </dl>

            <ul className="space-y-1 border-t border-border-subtle p-4">
              {review.observations.map((observation) => (
                <li
                  key={observation}
                  className="text-label text-muted-foreground"
                >
                  {observation}
                </li>
              ))}
            </ul>
          </SectionCard>

          {procrastination.length > 0 ? (
            <SectionCard
              title="Keeps getting pushed"
              icon={Repeat}
              description="What happened, not why. Only you know that."
            >
              <ul className="divide-y divide-border-subtle">
                {procrastination.slice(0, 6).map((signal) => (
                  <li
                    key={signal.itemId}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 truncate text-meta">
                      {signal.title}
                    </span>

                    <Badge
                      variant={
                        signal.severity === "STUCK" ? "destructive" : "outline"
                      }
                      className="shrink-0"
                    >
                      moved {signal.rescheduleCount}×
                    </Badge>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>
      </div>

      {weekend.length > 0 ? (
        <SectionCard
          title="The weekend"
          icon={CalendarCheck}
          description="The same arithmetic, run across Saturday and Sunday."
        >
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            {weekend.map((day) => (
              <div key={day.dayKey}>
                <p className="text-label font-medium text-muted-foreground">
                  {day.dayKey}
                </p>

                {day.blocks.length === 0 ? (
                  <p className="mt-1 text-label text-muted-foreground">
                    {day.isEmpty
                      ? "Nothing due."
                      : "No free time to schedule into."}
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {day.blocks.slice(0, 6).map((block, index) => (
                      <li key={index} className="text-label">
                        <span className="text-muted-foreground tabular-nums">
                          {block.timeLabel}
                        </span>{" "}
                        {block.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
