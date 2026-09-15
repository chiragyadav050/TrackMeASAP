"use client";

import { CalendarClock, Check, Play, Sparkles } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  rescheduleTaskCommand,
  setTaskCompletionCommand,
  updateTaskAction,
} from "@/features/tasks/actions";
import {
  CATEGORY_LABELS,
  DueIndicator,
  PriorityIndicator,
} from "@/features/tasks/components/task-badges";
import { RESCHEDULE_PRESETS } from "@/services/task/task.schema";
import type { NextBestActionDto } from "@/types/task";

const SNOOZE_LABELS: Record<(typeof RESCHEDULE_PRESETS)[number], string> = {
  TODAY: "Later today",
  TOMORROW: "Tomorrow",
  THIS_WEEKEND: "This weekend",
  NEXT_WEEK: "Next week",
  CLEAR: "Remove due date",
};

type NextBestActionProps = {
  readonly recommendation: NextBestActionDto;
  readonly onOpen: (taskId: string) => void;
};

/**
 * The single task to do next.
 *
 * The ranking behind it is deterministic and explainable — see
 * `task.prioritization.ts`. The `reasons` chips are not decoration: a
 * recommendation the user cannot interrogate is indistinguishable from a
 * random pick, and this is the groundwork Phase 9's planner builds on.
 *
 * NOTHING HERE IS AI-GENERATED. The copy is fixed and the ordering is
 * arithmetic.
 */
export function NextBestAction({
  recommendation,
  onOpen,
}: NextBestActionProps) {
  const { task, reasons } = recommendation;
  const [isPending, startTransition] = useTransition();

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't update the task.");
      }
    });
  };

  const start = () => {
    // "Start" is a real state change, not a timer: it moves the task to
    // IN_PROGRESS, which the ranking engine then favours.
    const formData = new FormData();
    formData.set("taskId", task.id);
    formData.set("status", "IN_PROGRESS");

    startTransition(async () => {
      const result = await updateTaskAction({ status: "idle" }, formData);

      if (result.status === "error") {
        toast.error(result.message);
        return;
      }

      toast.success("Marked as in progress.");
    });
  };

  return (
    <section
      aria-labelledby="next-best-action"
      className="relative overflow-hidden rounded-xl border border-border bg-surface"
    >
      {/* A restrained accent rail: this is the one thing on the page that
          should pull the eye first. */}
      <div className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />

      <div className="space-y-3 p-4 pl-5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-brand-text" aria-hidden />
          <h2
            id="next-best-action"
            className="text-label-caps text-muted-foreground"
          >
            Next best action
          </h2>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="block text-left text-heading font-semibold tracking-tight transition-colors hover:text-brand-text"
          >
            {task.title}
          </button>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PriorityIndicator priority={task.priority} showLabel />

            <DueIndicator
              dueLabel={task.dueLabel}
              dueTimeLabel={task.dueTimeLabel}
              overdueLabel={task.overdueLabel}
              isOverdue={task.isOverdue}
            />

            {task.estimateLabel ? (
              <span className="text-label text-muted-foreground tabular-nums">
                {task.estimateLabel}
              </span>
            ) : null}

            <span className="text-label text-muted-foreground/80">
              {CATEGORY_LABELS[task.category]}
            </span>
          </div>

          {reasons.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 pt-0.5">
              {reasons.map((reason) => (
                <li
                  key={reason}
                  className="rounded-md border border-border-subtle bg-surface-sunken px-1.5 py-0.5 text-label text-muted-foreground"
                >
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            disabled={isPending || task.status === "IN_PROGRESS"}
            onClick={start}
          >
            <Play className="size-3.5" />
            {task.status === "IN_PROGRESS" ? "In progress" : "Start"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() =>
                setTaskCompletionCommand({
                  taskId: task.id,
                  isCompleted: true,
                }),
              )
            }
          >
            <Check className="size-3.5" />
            Complete
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" disabled={isPending}>
                  <CalendarClock className="size-3.5" />
                  Snooze
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-44">
              {RESCHEDULE_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  onClick={() =>
                    run(() =>
                      rescheduleTaskCommand({ taskId: task.id, preset }),
                    )
                  }
                >
                  {SNOOZE_LABELS[preset]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </section>
  );
}
