"use client";

import { Archive, CheckCheck, Flag, Inbox, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bulkTaskCommand } from "@/features/tasks/actions";
import { PriorityIndicator } from "@/features/tasks/components/task-badges";
import { TaskRow } from "@/features/tasks/components/task-row";
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

type TaskListProps = {
  readonly tasks: readonly TaskDto[];
  readonly onEdit: (taskId: string) => void;
  readonly onCreate: () => void;
  /** Shown when the list is empty because filters excluded everything. */
  readonly isFiltered: boolean;
};

/**
 * The task list, with multi-select and bulk actions.
 *
 * Bulk mode is deliberately understated: selection checkboxes are always
 * present but the action bar only appears once something is selected, so the
 * common case (scan, tick, move on) is never cluttered by a feature most
 * sessions will not use.
 */
export function TaskList({
  tasks,
  onEdit,
  onCreate,
  isFiltered,
}: TaskListProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [isPending, startTransition] = useTransition();

  const toggleSelected = (taskId: string, isSelected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (isSelected) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }

      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allSelected =
    tasks.length > 0 && tasks.every((task) => selectedIds.has(task.id));

  const toggleSelectAll = (isSelected: boolean) => {
    setSelectedIds(
      isSelected ? new Set(tasks.map((task) => task.id)) : new Set(),
    );
  };

  const runBulk = (
    input: Parameters<typeof bulkTaskCommand>[0],
    successMessage: (count: number) => string,
  ) => {
    startTransition(async () => {
      const result = await bulkTaskCommand(input);

      if (result.status !== "success") {
        toast.error(
          result.status === "error"
            ? result.message
            : "Couldn't apply that to every task.",
        );
        return;
      }

      toast.success(successMessage(result.data.affected));
      clearSelection();
    });
  };

  const selectedArray = [...selectedIds];

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        {isFiltered ? (
          <EmptyState
            size="page"
            icon={Inbox}
            title="Nothing matches those filters"
            description="Try widening the search, or clearing a filter or two."
          />
        ) : (
          <EmptyState
            size="page"
            icon={Inbox}
            title="Your task list is clear."
            description="Capture the next thing you need to do."
            action={
              <Button size="sm" onClick={onCreate}>
                Create task
              </Button>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 ? (
        <div
          className="sticky top-(--spacing-header) z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="text-meta font-medium tabular-nums">
            {selectedIds.size} selected
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                runBulk(
                  { action: "COMPLETE", taskIds: selectedArray },
                  (count) =>
                    `${count} task${count === 1 ? "" : "s"} completed.`,
                )
              }
            >
              <CheckCheck className="size-3.5" />
              Complete
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" disabled={isPending}>
                    <Flag className="size-3.5" />
                    Priority
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-40">
                {TASK_PRIORITIES.map((priority) => (
                  <DropdownMenuItem
                    key={priority}
                    onClick={() =>
                      runBulk(
                        {
                          action: "SET_PRIORITY",
                          taskIds: selectedArray,
                          priority,
                        },
                        (count) => `Priority updated on ${count}.`,
                      )
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
                  <Button variant="outline" size="sm" disabled={isPending}>
                    Reschedule
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                {RESCHEDULE_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset}
                    onClick={() =>
                      runBulk(
                        {
                          action: "RESCHEDULE",
                          taskIds: selectedArray,
                          preset,
                        },
                        (count) => `${count} rescheduled.`,
                      )
                    }
                  >
                    {RESCHEDULE_LABELS[preset]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                runBulk(
                  { action: "ARCHIVE", taskIds: selectedArray },
                  (count) => `${count} archived.`,
                )
              }
            >
              <Archive className="size-3.5" />
              Archive
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
              aria-label="Clear selection"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => toggleSelectAll(checked === true)}
            aria-label={allSelected ? "Deselect all tasks" : "Select all tasks"}
          />
          <span className="text-label-caps text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        </div>

        <ul>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onEdit={onEdit}
              isSelected={selectedIds.has(task.id)}
              onSelectedChange={toggleSelected}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
