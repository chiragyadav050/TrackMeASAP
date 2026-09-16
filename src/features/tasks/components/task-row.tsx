"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Flag,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteTaskCommand,
  rescheduleTaskCommand,
  setTaskArchivedCommand,
  setTaskCompletionCommand,
  setTaskPriorityCommand,
} from "@/features/tasks/actions";
import {
  CATEGORY_LABELS,
  DueIndicator,
  PRIORITY_META,
  PriorityIndicator,
  StatusIndicator,
  SubtaskProgress,
} from "@/features/tasks/components/task-badges";
import { cn } from "@/lib/utils";
import {
  RESCHEDULE_PRESETS,
  TASK_PRIORITIES,
} from "@/services/task/task.schema";
import type { TaskDto, TaskPriority } from "@/types/task";

const RESCHEDULE_LABELS: Record<(typeof RESCHEDULE_PRESETS)[number], string> = {
  TODAY: "Today",
  TOMORROW: "Tomorrow",
  THIS_WEEKEND: "This weekend",
  NEXT_WEEK: "Next week",
  CLEAR: "Remove due date",
};

type TaskRowProps = {
  readonly task: TaskDto;
  readonly onEdit: (taskId: string) => void;
  /** Omitted where bulk selection is not offered (e.g. the Today page). */
  readonly isSelected?: boolean;
  readonly onSelectedChange?: (taskId: string, isSelected: boolean) => void;
  readonly density?: "default" | "compact";
};

/**
 * One task, as a dense scannable row.
 *
 * Completion is OPTIMISTIC — the checkbox flips immediately and the mutation
 * follows. If the server refuses, the row reverts and an error is shown; a
 * silent failure that leaves the UI lying about persisted state is exactly
 * what optimistic updates get wrong.
 *
 * Everything else (priority, reschedule, archive, delete) waits for the
 * server, because those are either destructive or low-frequency enough that a
 * brief pending state is better than a rollback.
 */
export function TaskRow({
  task,
  onEdit,
  isSelected,
  onSelectedChange,
  density = "default",
}: TaskRowProps) {
  const [isPending, startTransition] = useTransition();

  // `null` means "trust the server". Set while a completion is in flight.
  const [completionOverride, setCompletionOverride] = useState<boolean | null>(
    null,
  );

  // Once the server catches up, drop the override. Adjusting state during
  // render is React's documented pattern for this and avoids the extra pass
  // an effect would cost.
  if (completionOverride !== null && completionOverride === task.isCompleted) {
    setCompletionOverride(null);
  }

  const isCompleted = completionOverride ?? task.isCompleted;

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    onFailure?: () => void,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        onFailure?.();
        toast.error(result.message ?? "Couldn't save your changes.");
      }
    });
  };

  const toggleCompletion = (next: boolean) => {
    setCompletionOverride(next);

    run(
      () => setTaskCompletionCommand({ taskId: task.id, isCompleted: next }),
      // Roll the checkbox back to whatever the server still believes.
      () => setCompletionOverride(null),
    );
  };

  const checkboxId = `task-${task.id}-complete`;

  return (
    <li
      className={cn(
        "group relative flex items-start gap-3 border-b border-border-subtle px-3 transition-colors last:border-b-0",
        density === "compact" ? "py-2" : "py-2.5",
        "hover:bg-muted/40",
        isSelected && "bg-brand-muted/40",
        isPending && "opacity-70",
      )}
    >
      {onSelectedChange ? (
        <Checkbox
          checked={isSelected ?? false}
          onCheckedChange={(checked) =>
            onSelectedChange(task.id, checked === true)
          }
          aria-label={`Select ${task.title}`}
          className="mt-0.5"
        />
      ) : null}

      <Checkbox
        id={checkboxId}
        checked={isCompleted}
        onCheckedChange={(checked) => toggleCompletion(checked === true)}
        aria-label={
          isCompleted ? `Reopen ${task.title}` : `Complete ${task.title}`
        }
        className="mt-0.5"
      />

      <div className="min-w-0 flex-1">
        {/* The title is the primary control: clicking it opens the task. */}
        <button
          type="button"
          onClick={() => onEdit(task.id)}
          className="block max-w-full truncate text-left text-meta transition-colors hover:text-brand-text focus-visible:outline-none"
        >
          <span
            className={cn(isCompleted && "text-muted-foreground line-through")}
          >
            {task.title}
          </span>
        </button>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusIndicator status={task.status} />

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

          <SubtaskProgress
            completed={task.subtaskCompleted}
            total={task.subtaskTotal}
          />

          <span className="text-label text-muted-foreground/80">
            {CATEGORY_LABELS[task.category]}
          </span>
        </div>
      </div>

      {/* Priority doubles as a one-click control (brief §17). */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="mt-0.5 shrink-0"
              aria-label={`Priority: ${PRIORITY_META[task.priority].label}. Change it.`}
            >
              <PriorityIndicator priority={task.priority} />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-40">
          {TASK_PRIORITIES.map((priority) => (
            <DropdownMenuItem
              key={priority}
              onClick={() =>
                run(() => setTaskPriorityCommand({ taskId: task.id, priority }))
              }
            >
              <PriorityIndicator
                priority={priority as TaskPriority}
                showLabel
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="reveal-on-hover mt-0.5 shrink-0 data-[popup-open]:opacity-100"
              aria-label={`Actions for ${task.title}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          }
        />

        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => onEdit(task.id)}>
            <Pencil className="size-4 text-muted-foreground" />
            Edit
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarClock className="size-4 text-muted-foreground" />
              Reschedule
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {RESCHEDULE_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  onClick={() =>
                    run(() =>
                      rescheduleTaskCommand({ taskId: task.id, preset }),
                    )
                  }
                >
                  {RESCHEDULE_LABELS[preset]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag className="size-4 text-muted-foreground" />
              Priority
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TASK_PRIORITIES.map((priority) => (
                <DropdownMenuItem
                  key={priority}
                  onClick={() =>
                    run(() =>
                      setTaskPriorityCommand({ taskId: task.id, priority }),
                    )
                  }
                >
                  <PriorityIndicator
                    priority={priority as TaskPriority}
                    showLabel
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() =>
              run(() =>
                setTaskArchivedCommand({
                  taskId: task.id,
                  isArchived: !task.isArchived,
                }),
              )
            }
          >
            {task.isArchived ? (
              <>
                <ArchiveRestore className="size-4 text-muted-foreground" />
                Restore
              </>
            ) : (
              <>
                <Archive className="size-4 text-muted-foreground" />
                Archive
              </>
            )}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              // Permanent and unrecoverable, so it asks first. Archiving is
              // the reversible default offered directly above.
              const confirmed = window.confirm(
                `Delete "${task.title}" permanently? Archiving keeps it retrievable instead.`,
              );

              if (confirmed) {
                run(() => deleteTaskCommand({ taskId: task.id }));
              }
            }}
            className="text-danger"
          >
            <Trash2 className="size-4" />
            Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
