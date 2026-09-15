"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Inbox,
  Plus,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { WorkPanel } from "@/features/today/work-panel";
import { LifePanel } from "@/features/today/life-panel";
import type { LifeSummaryDto } from "@/services/life/life.query";
import type { ProjectsSummaryDto } from "@/types/work";
import { Button } from "@/components/ui/button";
import { QuickCapture } from "@/features/tasks/components/quick-capture";
import { TaskRow } from "@/features/tasks/components/task-row";
import { useTaskDialog } from "@/features/tasks/task-dialog-provider";
import {
  AcademicPanel,
  type TodayAcademics,
} from "@/features/today/academic-panel";
import { NextBestAction } from "@/features/today/next-best-action";
import { cn } from "@/lib/utils";
import type { TaskDto, TodayViewDto } from "@/types/task";

type TodayWorkspaceProps = {
  readonly view: TodayViewDto;
  /** The academic slice. Renders nothing when there is nothing to say. */
  readonly academics: TodayAcademics;
  readonly work: ProjectsSummaryDto;
  readonly life: LifeSummaryDto;
};

/**
 * The interactive body of the Today page.
 *
 * Everything rendered here is real data computed in the user's own time zone
 * by `getTodayView`. When a section is empty it says so honestly — no sample
 * rows, no placeholder counts.
 */
export function TodayWorkspace({
  view,
  academics,
  work,
  life,
}: TodayWorkspaceProps) {
  const { openCreate, openEdit } = useTaskDialog();

  const { statistics } = view;
  const hasAnythingToday =
    view.dueToday.length > 0 ||
    view.overdue.length > 0 ||
    view.completedToday.length > 0;

  return (
    <div className="space-y-4">
      <QuickCapture onOpenFullForm={openCreate} />

      {view.nextBestAction ? (
        <NextBestAction
          recommendation={view.nextBestAction}
          onOpen={openEdit}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {view.overdue.length > 0 ? (
            <SectionCard
              title="Overdue"
              icon={AlertTriangle}
              description="These needed attention before now."
              badge={String(view.overdue.length)}
            >
              <ul>
                {view.overdue.map((task) => (
                  <TaskRow key={task.id} task={task} onEdit={openEdit} />
                ))}
              </ul>
            </SectionCard>
          ) : null}

          <AcademicPanel academics={academics} />

          <SectionCard
            title="Today's tasks"
            icon={Inbox}
            description={view.dateLabel}
          >
            {view.dueToday.length > 0 ? (
              <ul>
                {view.dueToday.map((task) => (
                  <TaskRow key={task.id} task={task} onEdit={openEdit} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Inbox}
                title={
                  hasAnythingToday ? "Nothing left due today" : "No tasks yet"
                }
                description={
                  hasAnythingToday
                    ? "Everything scheduled for today is handled."
                    : "Your daily command center will appear here. Capture something above to begin."
                }
                action={
                  hasAnythingToday ? undefined : (
                    <Button size="sm" onClick={() => openCreate()}>
                      <Plus className="size-3.5" />
                      Create task
                    </Button>
                  )
                }
                className="flex-1"
              />
            )}
          </SectionCard>

          {view.completedToday.length > 0 ? (
            <SectionCard
              title="Completed today"
              icon={CheckCircle2}
              badge={String(view.completedToday.length)}
            >
              <ul>
                {view.completedToday.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onEdit={openEdit}
                    density="compact"
                  />
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>

        <div className="space-y-4">
          <ProgressCard
            completed={statistics.completedToday}
            total={statistics.dueTodayTotal}
            percent={statistics.todayCompletionPercent}
            overdueCount={statistics.overdueCount}
            activeCount={statistics.activeCount}
          />

          <WorkPanel work={work} />

          <LifePanel life={life} />

          <SectionCard
            title="Upcoming"
            icon={CalendarDays}
            description="The next seven days."
          >
            {view.upcoming.length > 0 ? (
              <ul>
                {view.upcoming.map((task) => (
                  <UpcomingRow key={task.id} task={task} onOpen={openEdit} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="Nothing scheduled"
                description="No deadlines in the next week."
                className="flex-1"
              />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/**
 * Today's progress.
 *
 * The denominator is what was DUE today; the numerator is what was COMPLETED
 * today. Completing something that was not due today can therefore exceed the
 * denominator, which is why the percentage is clamped server-side rather than
 * reporting "140%".
 */
function ProgressCard({
  completed,
  total,
  percent,
  overdueCount,
  activeCount,
}: {
  completed: number;
  total: number;
  percent: number;
  overdueCount: number;
  activeCount: number;
}) {
  return (
    <SectionCard title="Progress" icon={CheckCircle2}>
      <div className="space-y-3 px-4 py-4">
        {total === 0 && completed === 0 ? (
          <p className="text-meta text-muted-foreground">
            Nothing was scheduled for today.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-title font-semibold tabular-nums">
                {percent}%
              </span>
              <span className="text-meta text-muted-foreground tabular-nums">
                {completed} of {total} complete
              </span>
            </div>

            <div
              className="h-1.5 overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${percent}% of today's tasks complete`}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  percent === 100 ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        )}

        <dl className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
          <div>
            <dt className="text-label text-muted-foreground">Active</dt>
            <dd className="text-meta font-medium tabular-nums">
              {activeCount}
            </dd>
          </div>
          <div>
            <dt className="text-label text-muted-foreground">Overdue</dt>
            <dd
              className={cn(
                "text-meta font-medium tabular-nums",
                overdueCount > 0 && "text-danger",
              )}
            >
              {overdueCount}
            </dd>
          </div>
        </dl>
      </div>
    </SectionCard>
  );
}

/** A compact upcoming entry — date first, since that is what is being scanned. */
function UpcomingRow({
  task,
  onOpen,
}: {
  task: TaskDto;
  onOpen: (taskId: string) => void;
}) {
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="w-16 shrink-0 text-label text-muted-foreground">
          {task.dueLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-meta">{task.title}</span>
      </button>
    </li>
  );
}
