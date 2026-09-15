import "server-only";

import type {
  Prisma,
  Project,
  ProjectBlocker,
  ProjectMilestone,
  Workspace,
} from "@/generated/prisma/client";
import { notFound, validationFailed } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import { recordActivity } from "@/services/activity/activity.service";
import { toInstant } from "@/services/academics/academic.dates";
import type { z } from "zod";
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  createBlockerSchema,
  createMilestoneSchema,
  createProjectTaskSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateWorkspaceSchema,
} from "@/services/work/work.schema";

/**
 * Workspace, project, milestone and blocker mutations.
 *
 * Same contract as every other service: `profileId` first, always from the
 * Clerk session, never read from ambient state. Guards put `profileId` in the
 * WHERE clause and throw NOT_FOUND rather than FORBIDDEN.
 */

const log = logger.child({ service: "work" });
const POSITION_STEP = 1000;

export const ENTITY_WORKSPACE = "workspace";
export const ENTITY_PROJECT = "project";
export const ENTITY_MILESTONE = "project_milestone";
export const ENTITY_BLOCKER = "project_blocker";

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export async function requireOwnedWorkspace(
  profileId: string,
  workspaceId: string,
): Promise<Workspace> {
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, profileId },
  });

  if (!workspace) {
    throw notFound("Workspace");
  }

  return workspace;
}

export async function requireOwnedProject(
  profileId: string,
  projectId: string,
): Promise<Project> {
  const project = await db.project.findFirst({
    where: { id: projectId, profileId },
  });

  if (!project) {
    throw notFound("Project");
  }

  return project;
}

export async function requireOwnedMilestone(
  profileId: string,
  milestoneId: string,
): Promise<ProjectMilestone> {
  const milestone = await db.projectMilestone.findFirst({
    where: { id: milestoneId, profileId },
  });

  if (!milestone) {
    throw notFound("Milestone");
  }

  return milestone;
}

export async function requireOwnedBlocker(
  profileId: string,
  blockerId: string,
): Promise<ProjectBlocker> {
  const blocker = await db.projectBlocker.findFirst({
    where: { id: blockerId, profileId },
  });

  if (!blocker) {
    throw notFound("Blocker");
  }

  return blocker;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export async function createWorkspace(
  profileId: string,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  const workspace = await db.workspace.create({
    data: {
      profileId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      icon: input.icon ?? null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_WORKSPACE,
    entityId: workspace.id,
    action: "CREATED",
  });

  return workspace;
}

export async function updateWorkspace(
  profileId: string,
  input: z.infer<typeof updateWorkspaceSchema>,
): Promise<Workspace> {
  const existing = await requireOwnedWorkspace(profileId, input.workspaceId);

  const workspace = await db.workspace.update({
    where: { id: existing.id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.type === undefined ? {} : { type: input.type }),
      description: input.description ?? null,
      icon: input.icon ?? null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_WORKSPACE,
    entityId: workspace.id,
    action: "UPDATED",
  });

  return workspace;
}

export async function setWorkspaceArchived(
  profileId: string,
  workspaceId: string,
  isArchived: boolean,
): Promise<Workspace> {
  const existing = await requireOwnedWorkspace(profileId, workspaceId);

  const workspace = await db.workspace.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_WORKSPACE,
    entityId: workspace.id,
    action: isArchived ? "ARCHIVED" : "UNARCHIVED",
  });

  return workspace;
}

export async function deleteWorkspace(
  profileId: string,
  workspaceId: string,
): Promise<void> {
  const existing = await requireOwnedWorkspace(profileId, workspaceId);

  // Projects, milestones and blockers cascade. TASKS DO NOT — `Task.projectId`
  // is SetNull, so the work the user actually did survives.
  await db.workspace.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_WORKSPACE,
    entityId: existing.id,
    action: "DELETED",
    metadata: { name: existing.name.slice(0, 60) },
  });
}

export async function listWorkspaces(
  profileId: string,
  includeArchived = false,
): Promise<readonly Workspace[]> {
  return db.workspace.findMany({
    where: { profileId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ name: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export async function createProject(
  profileId: string,
  timeZone: string,
  input: CreateProjectInput,
): Promise<Project> {
  await requireOwnedWorkspace(profileId, input.workspaceId);

  const project = await db.project.create({
    data: {
      profileId,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      startAt: input.startDate
        ? toInstant(input.startDate, undefined, timeZone)
        : null,
      targetEndAt: input.targetEndDate
        ? toInstant(input.targetEndDate, input.targetEndTime, timeZone)
        : null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_PROJECT,
    entityId: project.id,
    action: "CREATED",
    metadata: { workspaceId: input.workspaceId },
  });

  return project;
}

export async function updateProject(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateProjectSchema>,
): Promise<Project> {
  const existing = await requireOwnedProject(profileId, input.projectId);

  if (input.workspaceId && input.workspaceId !== existing.workspaceId) {
    await requireOwnedWorkspace(profileId, input.workspaceId);
  }

  const data: Prisma.ProjectUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.workspaceId) {
    data.workspace = { connect: { id: input.workspaceId } };
  }

  data.description = input.description ?? null;

  if (input.startDate) {
    data.startAt = toInstant(input.startDate, undefined, timeZone);
  }

  if (input.clearTargetEnd) {
    data.targetEndAt = null;
  } else if (input.targetEndDate) {
    data.targetEndAt = toInstant(
      input.targetEndDate,
      input.targetEndTime,
      timeZone,
    );
  }

  if (input.status !== undefined && input.status !== existing.status) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }

  const project = await db.project.update({
    where: { id: existing.id },
    data,
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_PROJECT,
    entityId: project.id,
    action: "UPDATED",
  });

  return project;
}

export async function setProjectStatus(
  profileId: string,
  projectId: string,
  status: Project["status"],
): Promise<Project> {
  const existing = await requireOwnedProject(profileId, projectId);

  const project = await db.project.update({
    where: { id: existing.id },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_PROJECT,
    entityId: project.id,
    action: status === "COMPLETED" ? "COMPLETED" : "UPDATED",
    metadata: { status },
  });

  return project;
}

export async function setProjectArchived(
  profileId: string,
  projectId: string,
  isArchived: boolean,
): Promise<Project> {
  const existing = await requireOwnedProject(profileId, projectId);

  const project = await db.project.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_PROJECT,
    entityId: project.id,
    action: isArchived ? "ARCHIVED" : "UNARCHIVED",
  });

  return project;
}

export async function deleteProject(
  profileId: string,
  projectId: string,
): Promise<void> {
  const existing = await requireOwnedProject(profileId, projectId);

  await db.project.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_PROJECT,
    entityId: existing.id,
    action: "DELETED",
    metadata: { name: existing.name.slice(0, 60) },
  });
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function createMilestone(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof createMilestoneSchema>,
): Promise<ProjectMilestone> {
  await requireOwnedProject(profileId, input.projectId);

  const highest = await db.projectMilestone.aggregate({
    where: { projectId: input.projectId },
    _max: { sortOrder: true },
  });

  const milestone = await db.projectMilestone.create({
    data: {
      profileId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueDate
        ? toInstant(input.dueDate, undefined, timeZone)
        : null,
      sortOrder: (highest._max.sortOrder ?? 0) + POSITION_STEP,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_MILESTONE,
    entityId: milestone.id,
    action: "CREATED",
    metadata: { projectId: input.projectId },
  });

  return milestone;
}

export async function updateMilestone(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateMilestoneSchema>,
): Promise<ProjectMilestone> {
  const existing = await requireOwnedMilestone(profileId, input.milestoneId);

  const data: Prisma.ProjectMilestoneUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  data.description = input.description ?? null;

  if (input.clearDue) {
    data.dueAt = null;
  } else if (input.dueDate) {
    data.dueAt = toInstant(input.dueDate, undefined, timeZone);
  }

  if (input.status !== undefined) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }

  return db.projectMilestone.update({ where: { id: existing.id }, data });
}

export async function setMilestoneStatus(
  profileId: string,
  milestoneId: string,
  status: ProjectMilestone["status"],
): Promise<ProjectMilestone> {
  const existing = await requireOwnedMilestone(profileId, milestoneId);

  const milestone = await db.projectMilestone.update({
    where: { id: existing.id },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_MILESTONE,
    entityId: milestone.id,
    action: status === "COMPLETED" ? "COMPLETED" : "UPDATED",
    metadata: { status, projectId: milestone.projectId },
  });

  return milestone;
}

export async function deleteMilestone(
  profileId: string,
  milestoneId: string,
): Promise<void> {
  const existing = await requireOwnedMilestone(profileId, milestoneId);

  await db.projectMilestone.delete({ where: { id: existing.id } });
}

/**
 * Rewrites milestone order.
 *
 * The submitted ids must be exactly this project's milestones — anything else
 * is rejected rather than partially applied, so a malformed request cannot
 * reorder half a list or pull in another project's milestone.
 */
export async function reorderMilestones(
  profileId: string,
  projectId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await requireOwnedProject(profileId, projectId);

  const existing = await db.projectMilestone.findMany({
    where: { projectId, profileId },
    select: { id: true },
  });

  const existingIds = new Set(existing.map((entry) => entry.id));
  const submitted = new Set(orderedIds);

  const isCompleteSet =
    existingIds.size === submitted.size &&
    [...submitted].every((id) => existingIds.has(id));

  if (!isCompleteSet) {
    throw validationFailed({
      orderedIds: [
        "The reordered list does not match this project's milestones.",
      ],
    });
  }

  await db.$transaction(
    orderedIds.map((id, index) =>
      db.projectMilestone.update({
        where: { id },
        data: { sortOrder: (index + 1) * POSITION_STEP },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

export async function createBlocker(
  profileId: string,
  input: z.infer<typeof createBlockerSchema>,
): Promise<ProjectBlocker> {
  await requireOwnedProject(profileId, input.projectId);

  const blocker = await db.projectBlocker.create({
    data: { profileId, projectId: input.projectId, reason: input.reason },
  });

  // The project's own status follows, so "blocked" is visible without having
  // to open the project to find out.
  await db.project.update({
    where: { id: input.projectId },
    data: { status: "BLOCKED" },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_BLOCKER,
    entityId: blocker.id,
    action: "CREATED",
    metadata: { projectId: input.projectId },
  });

  log.info("Project blocked", { projectId: input.projectId });

  return blocker;
}

/**
 * Resolves a blocker and, if it was the last one, returns the project to
 * ACTIVE — a project should not stay BLOCKED once nothing is blocking it.
 */
export async function resolveBlocker(
  profileId: string,
  blockerId: string,
  resolutionNote?: string,
): Promise<ProjectBlocker> {
  const existing = await requireOwnedBlocker(profileId, blockerId);

  const blocker = await db.$transaction(async (tx) => {
    const resolved = await tx.projectBlocker.update({
      where: { id: existing.id },
      data: { resolvedAt: new Date(), resolutionNote: resolutionNote ?? null },
    });

    const remaining = await tx.projectBlocker.count({
      where: { projectId: existing.projectId, resolvedAt: null },
    });

    if (remaining === 0) {
      const project = await tx.project.findUnique({
        where: { id: existing.projectId },
        select: { status: true },
      });

      // Only un-block; never override a deliberate PAUSED/COMPLETED state.
      if (project?.status === "BLOCKED") {
        await tx.project.update({
          where: { id: existing.projectId },
          data: { status: "ACTIVE" },
        });
      }
    }

    return resolved;
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_BLOCKER,
    entityId: blocker.id,
    action: "UPDATED",
    metadata: { resolved: true, projectId: existing.projectId },
  });

  return blocker;
}

export async function deleteBlocker(
  profileId: string,
  blockerId: string,
): Promise<void> {
  const existing = await requireOwnedBlocker(profileId, blockerId);

  await db.projectBlocker.delete({ where: { id: existing.id } });
}

// ---------------------------------------------------------------------------
// Task ↔ project
// ---------------------------------------------------------------------------

/**
 * Attaches an existing task to a project, or detaches it.
 *
 * BOTH sides are ownership-checked. Without checking the project too, a valid
 * task id would let a caller attach their task to someone else's project.
 */
export async function linkTaskToProject(
  profileId: string,
  taskId: string,
  projectId: string | null,
): Promise<void> {
  const task = await db.task.findFirst({ where: { id: taskId, profileId } });

  if (!task) {
    throw notFound("Task");
  }

  if (projectId) {
    await requireOwnedProject(profileId, projectId);
  }

  await db.task.update({ where: { id: task.id }, data: { projectId } });
}

/**
 * Creates an ordinary Task already attached to a project.
 *
 * Note what this is NOT: a project-specific task model. It writes to the same
 * `tasks` table as everything else, so the result appears in Tasks, Today,
 * search and the project page from one source of truth.
 */
export async function createProjectTask(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof createProjectTaskSchema>,
): Promise<{ taskId: string }> {
  const project = await requireOwnedProject(profileId, input.projectId);

  const lowest = await db.task.aggregate({
    where: { profileId, archivedAt: null },
    _min: { position: true },
  });

  const due = input.dueDate
    ? {
        dueAt: toInstant(input.dueDate, input.dueTime, timeZone),
        isAllDay: !input.dueTime,
      }
    : { dueAt: null, isAllDay: false };

  const task = await db.task.create({
    data: {
      profileId,
      projectId: project.id,
      title: input.title,
      category: "PROJECT",
      priority: input.priority,
      dueAt: due.dueAt,
      isAllDay: due.isAllDay,
      estimatedMinutes: input.estimatedMinutes ?? null,
      position: (lowest._min.position ?? 0) - POSITION_STEP,
    },
  });

  return { taskId: task.id };
}
