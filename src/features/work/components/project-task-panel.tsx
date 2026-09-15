"use client";

import { ListTodo, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PriorityIndicator } from "@/features/tasks/components/task-badges";
import { createProjectTaskCommand } from "@/features/work/actions";
import { cn } from "@/lib/utils";
import type { ProjectTaskDto } from "@/types/work";

/**
 * The project's tasks.
 *
 * These are ORDINARY tasks that happen to carry a project id — the same rows
 * that appear in Tasks, Today and search. Completion here is what drives the
 * project's progress percentage, which is why the footer links out rather
 * than duplicating the task editor.
 */
export function ProjectTaskPanel({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: readonly ProjectTaskDto[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const addTask = () => {
    const trimmed = title.trim();

    if (trimmed === "") {
      return;
    }

    setTitle("");
    setDueDate("");

    startTransition(async () => {
      const result = await createProjectTaskCommand({
        projectId,
        title: trimmed,
        priority: "MEDIUM",
        dueDate: dueDate || undefined,
      });

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't add the task.");
        return;
      }

      router.refresh();
    });
  };

  const open = tasks.filter((task) => !task.isCompleted);

  return (
    <SectionCard
      title="Tasks"
      icon={ListTodo}
      description={
        tasks.length === 0
          ? undefined
          : `${open.length} open of ${tasks.length}`
      }
      footer={
        <Link href="/tasks" className="underline-offset-4 hover:underline">
          Manage these in Tasks →
        </Link>
      }
    >
      {tasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks yet."
          description="Progress is measured from tasks, so this project has nothing to measure until you add some."
        />
      ) : (
        <ul className="divide-y divide-border-subtle" aria-busy={isPending}>
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 px-4 py-2 text-meta"
            >
              <PriorityIndicator priority={task.priority} />

              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  task.isCompleted && "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </span>

              {task.dueLabel ? (
                <span className="shrink-0 text-label text-muted-foreground">
                  {task.dueLabel}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle p-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTask();
            }
          }}
          placeholder="Add a task to this project"
          aria-label="Task title"
          className="h-9 min-w-40 flex-1"
        />

        <Input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          aria-label="Task due date"
          className="h-9 w-auto"
        />

        <Button
          size="sm"
          onClick={addTask}
          disabled={isPending || title.trim() === ""}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </SectionCard>
  );
}
