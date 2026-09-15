"use server";

import { revalidatePath } from "next/cache";

import {
  createAuthenticatedAction,
  createAuthenticatedCommand,
} from "@/server/action";
import {
  archiveProjectSchema,
  archiveWorkspaceSchema,
  blockerIdSchema,
  createBlockerSchema,
  createMilestoneSchema,
  createProjectSchema,
  createProjectTaskSchema,
  createWorkspaceSchema,
  linkTaskToProjectSchema,
  milestoneIdSchema,
  projectIdSchema,
  reorderMilestonesSchema,
  resolveBlockerSchema,
  searchWorkSchema,
  setMilestoneStatusSchema,
  setProjectStatusSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateWorkspaceSchema,
  workspaceIdSchema,
} from "@/services/work/work.schema";
import {
  createBlocker,
  createMilestone,
  createProject,
  createProjectTask,
  createWorkspace,
  deleteBlocker,
  deleteMilestone,
  deleteProject,
  deleteWorkspace,
  linkTaskToProject,
  reorderMilestones,
  resolveBlocker,
  setMilestoneStatus,
  setProjectArchived,
  setProjectStatus,
  setWorkspaceArchived,
  updateMilestone,
  updateProject,
  updateWorkspace,
} from "@/services/work/work.service";
import { searchWork } from "@/services/work/work.query";
import type { WorkSearchResult } from "@/types/work";

/**
 * Work server actions.
 *
 * Same two factories as every earlier phase: `createAuthenticatedAction` for
 * form posts, `createAuthenticatedCommand` for typed arguments. Both resolve
 * the profile from the Clerk session — no action takes a profile id, and none
 * touches the database except through a service that demands one.
 */

/** Surfaces whose data changes whenever work data does. */
function revalidateWork(): void {
  revalidatePath("/work", "layout");
  revalidatePath("/projects", "layout");
  revalidatePath("/today");
  revalidatePath("/overview");
}

/** Project task changes also move the task surfaces. */
function revalidateWorkAndTasks(): void {
  revalidateWork();
  revalidatePath("/tasks");
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const createWorkspaceAction = createAuthenticatedAction({
  name: "workspace.create",
  schema: createWorkspaceSchema,
  handler: async (input, { profile }): Promise<{ workspaceId: string }> => {
    const workspace = await createWorkspace(profile.id, input);
    revalidateWork();
    return { workspaceId: workspace.id };
  },
});

export const updateWorkspaceAction = createAuthenticatedAction({
  name: "workspace.update",
  schema: updateWorkspaceSchema,
  handler: async (input, { profile }): Promise<{ workspaceId: string }> => {
    await updateWorkspace(profile.id, input);
    revalidateWork();
    return { workspaceId: input.workspaceId };
  },
});

export const setWorkspaceArchivedCommand = createAuthenticatedCommand({
  name: "workspace.setArchived",
  schema: archiveWorkspaceSchema,
  handler: async (input, { profile }): Promise<{ workspaceId: string }> => {
    await setWorkspaceArchived(profile.id, input.workspaceId, input.isArchived);
    revalidateWork();
    return { workspaceId: input.workspaceId };
  },
});

export const deleteWorkspaceCommand = createAuthenticatedCommand({
  name: "workspace.delete",
  schema: workspaceIdSchema,
  handler: async (input, { profile }): Promise<{ workspaceId: string }> => {
    await deleteWorkspace(profile.id, input.workspaceId);
    revalidateWork();
    return { workspaceId: input.workspaceId };
  },
});

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const createProjectAction = createAuthenticatedAction({
  name: "project.create",
  schema: createProjectSchema,
  handler: async (input, { profile }): Promise<{ projectId: string }> => {
    const project = await createProject(profile.id, profile.timeZone, input);
    revalidateWork();
    return { projectId: project.id };
  },
});

export const updateProjectAction = createAuthenticatedAction({
  name: "project.update",
  schema: updateProjectSchema,
  handler: async (input, { profile }): Promise<{ projectId: string }> => {
    await updateProject(profile.id, profile.timeZone, input);
    revalidateWork();
    return { projectId: input.projectId };
  },
});

export const setProjectStatusCommand = createAuthenticatedCommand({
  name: "project.setStatus",
  schema: setProjectStatusSchema,
  handler: async (input, { profile }): Promise<{ projectId: string }> => {
    await setProjectStatus(profile.id, input.projectId, input.status);
    revalidateWork();
    return { projectId: input.projectId };
  },
});

export const setProjectArchivedCommand = createAuthenticatedCommand({
  name: "project.setArchived",
  schema: archiveProjectSchema,
  handler: async (input, { profile }): Promise<{ projectId: string }> => {
    await setProjectArchived(profile.id, input.projectId, input.isArchived);
    revalidateWork();
    return { projectId: input.projectId };
  },
});

/**
 * Deletes a project outright.
 *
 * Destructive, so the UI confirms first and offers archiving instead —
 * archiving is what a user almost always means by "get this off my screen".
 */
export const deleteProjectCommand = createAuthenticatedCommand({
  name: "project.delete",
  schema: projectIdSchema,
  handler: async (input, { profile }): Promise<{ projectId: string }> => {
    await deleteProject(profile.id, input.projectId);
    revalidateWorkAndTasks();
    return { projectId: input.projectId };
  },
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const createMilestoneAction = createAuthenticatedAction({
  name: "milestone.create",
  schema: createMilestoneSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    const milestone = await createMilestone(
      profile.id,
      profile.timeZone,
      input,
    );
    revalidateWork();
    return { milestoneId: milestone.id };
  },
});

/**
 * Typed sibling of `createMilestoneAction`.
 *
 * The milestone panel adds items inline from a single text field, which has
 * no form to post; the ACTION stays for the full dialog. Both land on the
 * same service, so the two paths cannot drift apart.
 */
export const createMilestoneCommand = createAuthenticatedCommand({
  name: "milestone.create",
  schema: createMilestoneSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    const milestone = await createMilestone(
      profile.id,
      profile.timeZone,
      input,
    );
    revalidateWork();
    return { milestoneId: milestone.id };
  },
});

export const updateMilestoneAction = createAuthenticatedAction({
  name: "milestone.update",
  schema: updateMilestoneSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    await updateMilestone(profile.id, profile.timeZone, input);
    revalidateWork();
    return { milestoneId: input.milestoneId };
  },
});

export const setMilestoneStatusCommand = createAuthenticatedCommand({
  name: "milestone.setStatus",
  schema: setMilestoneStatusSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    await setMilestoneStatus(profile.id, input.milestoneId, input.status);
    revalidateWork();
    return { milestoneId: input.milestoneId };
  },
});

export const deleteMilestoneCommand = createAuthenticatedCommand({
  name: "milestone.delete",
  schema: milestoneIdSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    await deleteMilestone(profile.id, input.milestoneId);
    revalidateWork();
    return { milestoneId: input.milestoneId };
  },
});

export const reorderMilestonesCommand = createAuthenticatedCommand({
  name: "milestone.reorder",
  schema: reorderMilestonesSchema,
  handler: async (input, { profile }): Promise<{ projectId: string }> => {
    await reorderMilestones(profile.id, input.projectId, input.orderedIds);
    revalidateWork();
    return { projectId: input.projectId };
  },
});

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

export const createBlockerAction = createAuthenticatedAction({
  name: "blocker.create",
  schema: createBlockerSchema,
  handler: async (input, { profile }): Promise<{ blockerId: string }> => {
    const blocker = await createBlocker(profile.id, input);
    revalidateWork();
    return { blockerId: blocker.id };
  },
});

export const createBlockerCommand = createAuthenticatedCommand({
  name: "blocker.create",
  schema: createBlockerSchema,
  handler: async (input, { profile }): Promise<{ blockerId: string }> => {
    const blocker = await createBlocker(profile.id, input);
    revalidateWork();
    return { blockerId: blocker.id };
  },
});

export const resolveBlockerCommand = createAuthenticatedCommand({
  name: "blocker.resolve",
  schema: resolveBlockerSchema,
  handler: async (input, { profile }): Promise<{ blockerId: string }> => {
    await resolveBlocker(profile.id, input.blockerId, input.resolutionNote);
    revalidateWork();
    return { blockerId: input.blockerId };
  },
});

export const resolveBlockerAction = createAuthenticatedAction({
  name: "blocker.resolve",
  schema: resolveBlockerSchema,
  handler: async (input, { profile }): Promise<{ blockerId: string }> => {
    await resolveBlocker(profile.id, input.blockerId, input.resolutionNote);
    revalidateWork();
    return { blockerId: input.blockerId };
  },
});

export const deleteBlockerCommand = createAuthenticatedCommand({
  name: "blocker.delete",
  schema: blockerIdSchema,
  handler: async (input, { profile }): Promise<{ blockerId: string }> => {
    await deleteBlocker(profile.id, input.blockerId);
    revalidateWork();
    return { blockerId: input.blockerId };
  },
});

// ---------------------------------------------------------------------------
// Task ↔ project
// ---------------------------------------------------------------------------

export const linkTaskToProjectCommand = createAuthenticatedCommand({
  name: "project.linkTask",
  schema: linkTaskToProjectSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    await linkTaskToProject(profile.id, input.taskId, input.projectId);
    revalidateWorkAndTasks();
    return { taskId: input.taskId };
  },
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Powers the Work section of the ⌘K palette. */
export const searchWorkCommand = createAuthenticatedCommand({
  name: "work.search",
  schema: searchWorkSchema,
  handler: async (input, { profile }): Promise<readonly WorkSearchResult[]> =>
    searchWork(profile, input.query, input.limit),
});

export const createProjectTaskCommand = createAuthenticatedCommand({
  name: "project.createTask",
  schema: createProjectTaskSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    const result = await createProjectTask(profile.id, profile.timeZone, input);
    revalidateWorkAndTasks();
    return result;
  },
});

export const createProjectTaskAction = createAuthenticatedAction({
  name: "project.createTask",
  schema: createProjectTaskSchema,
  handler: async (input, { profile }): Promise<{ taskId: string }> => {
    const result = await createProjectTask(profile.id, profile.timeZone, input);
    revalidateWorkAndTasks();
    return result;
  },
});
