"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  createSubtaskCommand,
  deleteSubtaskCommand,
  setSubtaskCompletionCommand,
} from "@/features/tasks/actions";
import { cn } from "@/lib/utils";
import type { SubtaskDto } from "@/types/task";

type SubtaskListProps = {
  readonly taskId: string;
  readonly subtasks: readonly SubtaskDto[];
  readonly onChanged: () => void;
  /** Called when the last open subtask is ticked. */
  readonly onAllComplete?: () => void;
};

/**
 * The checklist beneath a task.
 *
 * DESIGN DECISION — completing every subtask does NOT complete the parent.
 * It surfaces a suggestion and leaves the decision to the user. The last
 * subtask is very often ticked while the parent still needs review, sign-off
 * or submission, and silently closing it would take an action the user never
 * asked for. `onAllComplete` is how the parent dialog offers the shortcut.
 */
export function SubtaskList({
  taskId,
  subtasks,
  onChanged,
  onAllComplete,
}: SubtaskListProps) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  const completed = subtasks.filter((subtask) => subtask.isCompleted).length;
  const total = subtasks.length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't update the checklist.");
        return;
      }

      onChanged();
    });
  };

  const addSubtask = () => {
    const title = draft.trim();

    if (title === "") {
      return;
    }

    setDraft("");
    run(() => createSubtaskCommand({ taskId, title }));
  };

  const toggle = (subtask: SubtaskDto, isCompleted: boolean) => {
    run(() =>
      setSubtaskCompletionCommand({ subtaskId: subtask.id, isCompleted }),
    );

    const wouldBeComplete =
      isCompleted &&
      subtasks
        .filter((entry) => entry.id !== subtask.id)
        .every((entry) => entry.isCompleted) &&
      total > 0;

    if (wouldBeComplete) {
      onAllComplete?.();
    }
  };

  return (
    <section aria-labelledby={`subtasks-${taskId}`} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3
          id={`subtasks-${taskId}`}
          className="text-meta font-medium tracking-tight"
        >
          Checklist
        </h3>

        {total > 0 ? (
          <span
            className="text-label text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {completed} / {total} completed
          </span>
        ) : null}
      </div>

      {total > 0 ? (
        <div
          className="h-1 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${completed} of ${total} subtasks complete`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              completed === total ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      <ul className="space-y-0.5">
        {subtasks.map((subtask) => (
          <li
            key={subtask.id}
            className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/50"
          >
            <Checkbox
              id={`subtask-${subtask.id}`}
              checked={subtask.isCompleted}
              onCheckedChange={(checked) => toggle(subtask, checked === true)}
              disabled={isPending}
              aria-label={
                subtask.isCompleted
                  ? `Reopen ${subtask.title}`
                  : `Complete ${subtask.title}`
              }
            />

            <label
              htmlFor={`subtask-${subtask.id}`}
              className={cn(
                "flex-1 cursor-pointer text-meta",
                subtask.isCompleted && "text-muted-foreground line-through",
              )}
            >
              {subtask.title}
            </label>

            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${subtask.title}`}
              className="reveal-on-hover"
              onClick={() =>
                run(() => deleteSubtaskCommand({ subtaskId: subtask.id }))
              }
            >
              <X className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a step…"
          aria-label="New subtask"
          maxLength={200}
          className="h-8"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Inside a dialog that also has a form — never let this submit it.
              event.preventDefault();
              addSubtask();
            }
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addSubtask}
          disabled={isPending || draft.trim() === ""}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </section>
  );
}
