"use server";

import { revalidatePath } from "next/cache";

import {
  createAuthenticatedAction,
  createAuthenticatedCommand,
} from "@/server/action";
import {
  bulkTaskActionSchema,
  createSubtaskSchema,
  createTaskSchema,
  quickCreateTaskSchema,
  rescheduleTaskSchema,
  reorderSubtasksSchema,
  searchTasksSchema,
  setSubtaskCompletionSchema,
  setTaskCompletionSchema,
  subtaskIdSchema,
  taskIdSchema,
  updateSubtaskSchema,
  updateTaskSchema,
  taskPrioritySchema,
} from "@/services/task/task.schema";
import { getTaskDetail, searchTasks } from "@/services/task/task.query";
import {
  bulkUpdateTasks,
  createSubtask,
  createTask,
  deleteSubtask,
  deleteTask,
  quickCreateTask,
  reorderSubtasks,
  rescheduleTask,
  setSubtaskCompletion,
  setTaskArchived,
  setTaskCompletion,
  setTaskPriority,
  updateSubtask,
  updateTask,
} from "@/services/task/task.service";
import { z } from "zod";
import type { TaskDetailDto, TaskDto } from "@/types/task";

/**
 * Task server actions.
 *
 * Every export goes through `createAuthenticatedAction` (form posts) or
 * `createAuthenticatedCommand` (typed arguments). Both resolve identity from
 * the Clerk session, rate limit per profile, validate with Zod and convert
 * thrown errors into safe user-facing copy.
 *
 * No action here accepts a profile id, and no action reaches the database
 * except through a service that requires one.
 */

/** Surfaces whose data changes whenever a task does. */
function revalidateTaskSurfaces(): void {
  revalidatePath("/tasks");
  revalidatePath("/today");
  revalidatePath("/overview");
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createTaskAction = createAuthenticatedAction({
  name: "task.create",
  schema: createTaskSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    const task = await createTask(profile.id, profile.timeZone, input);
    revalidateTaskSurfaces();
    return { taskId: task.id };
  },
});

export const quickCreateTaskAction = createAuthenticatedAction({
  name: "task.quickCreate",
  schema: quickCreateTaskSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    const task = await quickCreateTask(
      profile.id,
      profile.timeZone,
      input.title,
    );
    revalidateTaskSurfaces();
    return { taskId: task.id };
  },
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateTaskAction = createAuthenticatedAction({
  name: "task.update",
  schema: updateTaskSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    const task = await updateTask(profile.id, profile.timeZone, input);
    revalidateTaskSurfaces();
    return { taskId: task.id };
  },
});

export const setTaskCompletionCommand = createAuthenticatedCommand({
  name: "task.setCompletion",
  schema: setTaskCompletionSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await setTaskCompletion(profile.id, input.taskId, input.isCompleted);
    revalidateTaskSurfaces();
    return { taskId: input.taskId };
  },
});

export const setTaskPriorityCommand = createAuthenticatedCommand({
  name: "task.setPriority",
  schema: z.object({
    taskId: z.string().min(1),
    priority: taskPrioritySchema,
  }),
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await setTaskPriority(profile.id, input.taskId, input.priority);
    revalidateTaskSurfaces();
    return { taskId: input.taskId };
  },
});

export const rescheduleTaskCommand = createAuthenticatedCommand({
  name: "task.reschedule",
  schema: rescheduleTaskSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await rescheduleTask(profile.id, profile.timeZone, input);
    revalidateTaskSurfaces();
    return { taskId: input.taskId };
  },
});

// ---------------------------------------------------------------------------
// Archive / delete
// ---------------------------------------------------------------------------

export const setTaskArchivedCommand = createAuthenticatedCommand({
  name: "task.setArchived",
  schema: z.object({
    taskId: z.string().min(1),
    isArchived: z.boolean(),
  }),
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await setTaskArchived(profile.id, input.taskId, input.isArchived);
    revalidateTaskSurfaces();
    return { taskId: input.taskId };
  },
});

export const deleteTaskCommand = createAuthenticatedCommand({
  name: "task.delete",
  schema: taskIdSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await deleteTask(profile.id, input.taskId);
    revalidateTaskSurfaces();
    return { taskId: input.taskId };
  },
});

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

export const bulkTaskCommand = createAuthenticatedCommand({
  name: "task.bulk",
  schema: bulkTaskActionSchema,
  handler: async (input, { profile }): Promise<{ affected: number }> => {
    const affected = await bulkUpdateTasks(profile.id, profile.timeZone, input);
    revalidateTaskSurfaces();
    return { affected };
  },
});

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

export const createSubtaskCommand = createAuthenticatedCommand({
  name: "subtask.create",
  schema: createSubtaskSchema,
  handler: async (input, { profile }): Promise<{ subtaskId: string }> => {
    const subtask = await createSubtask(profile.id, input.taskId, input.title);
    revalidateTaskSurfaces();
    return { subtaskId: subtask.id };
  },
});

export const setSubtaskCompletionCommand = createAuthenticatedCommand({
  name: "subtask.setCompletion",
  schema: setSubtaskCompletionSchema,
  handler: async (input, { profile }): Promise<{ subtaskId: string }> => {
    await setSubtaskCompletion(profile.id, input.subtaskId, input.isCompleted);
    revalidateTaskSurfaces();
    return { subtaskId: input.subtaskId };
  },
});

export const updateSubtaskCommand = createAuthenticatedCommand({
  name: "subtask.update",
  schema: updateSubtaskSchema,
  handler: async (input, { profile }): Promise<{ subtaskId: string }> => {
    await updateSubtask(profile.id, input.subtaskId, input.title);
    revalidateTaskSurfaces();
    return { subtaskId: input.subtaskId };
  },
});

export const deleteSubtaskCommand = createAuthenticatedCommand({
  name: "subtask.delete",
  schema: subtaskIdSchema,
  handler: async (input, { profile }): Promise<{ subtaskId: string }> => {
    await deleteSubtask(profile.id, input.subtaskId);
    revalidateTaskSurfaces();
    return { subtaskId: input.subtaskId };
  },
});

export const reorderSubtasksCommand = createAuthenticatedCommand({
  name: "subtask.reorder",
  schema: reorderSubtasksSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await reorderSubtasks(profile.id, input.taskId, input.orderedIds);
    revalidateTaskSurfaces();
    return { taskId: input.taskId };
  },
});

// ---------------------------------------------------------------------------
// Reads called from client components
// ---------------------------------------------------------------------------

export const getTaskDetailCommand = createAuthenticatedCommand({
  name: "task.detail",
  schema: taskIdSchema,
  handler: async (input, { profile }): Promise<TaskDetailDto | null> => {
    return getTaskDetail(profile, input.taskId);
  },
});

export const searchTasksCommand = createAuthenticatedCommand({
  name: "task.search",
  schema: searchTasksSchema,
  handler: async (input, { profile }): Promise<readonly TaskDto[]> => {
    return searchTasks(profile, input.query, input.limit);
  },
});
