"use client";

import { QuickCapture } from "@/features/tasks/components/quick-capture";
import { TaskFilterBar } from "@/features/tasks/components/task-filter-bar";
import { TaskList } from "@/features/tasks/components/task-list";
import { useTaskDialog } from "@/features/tasks/task-dialog-provider";
import type { TaskFilters } from "@/services/task/task.schema";
import type { TaskDto } from "@/types/task";

type TasksWorkspaceProps = {
  readonly tasks: readonly TaskDto[];
  readonly filters: TaskFilters;
};

/**
 * The interactive half of the Tasks page.
 *
 * The page itself stays a Server Component that queries and renders; this
 * owns only selection state. The task dialog and the `c` shortcut belong to
 * the shell (`TaskDialogProvider`), so they work identically here, on Today,
 * and from the ⌘K palette.
 */
export function TasksWorkspace({ tasks, filters }: TasksWorkspaceProps) {
  const { openCreate, openEdit } = useTaskDialog();

  const isFiltered =
    filters.status !== "ACTIVE" ||
    filters.priority !== undefined ||
    filters.category !== undefined ||
    filters.date !== "ANY" ||
    Boolean(filters.search);

  return (
    <div className="space-y-4">
      <QuickCapture onOpenFullForm={openCreate} />

      <TaskFilterBar filters={filters} resultCount={tasks.length} />

      <TaskList
        tasks={tasks}
        onEdit={openEdit}
        onCreate={() => openCreate()}
        isFiltered={isFiltered}
      />
    </div>
  );
}
