import "server-only";

import type { Prisma, Profile } from "@/generated/prisma/client";
import {
  formatInTimeZone,
  localDateKey,
  localDayDifference,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  isMilestoneOverdue,
  milestoneProgress,
  nextMilestone,
  projectHealth,
  projectProgress,
} from "@/services/work/project.derive";
import type { ProjectFilters } from "@/services/work/work.schema";
import type {
  ProjectDetailDto,
  ProjectDto,
  ProjectsSummaryDto,
  WorkOverviewDto,
  WorkSearchResult,
  WorkspaceDto,
} from "@/types/work";

/**
 * Work reads.
 *
 * Every query scoped by a `profileId` from the Clerk session. Date-derived
 * labels are produced HERE, in the profile's zone, as everywhere else.
 *
 * PERFORMANCE NOTE: the project list is the page most at risk of N+1 — each
 * project needs task counts, milestone counts and blocker counts. Those come
 * from three GROUPED queries over the whole page rather than three queries
 * per project, so cost is constant in the number of projects.
 */

function buildProjectWhere(
  profileId: string,
  filters: ProjectFilters,
): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { profileId };

  where.archivedAt = filters.view === "ARCHIVED" ? { not: null } : null;

  switch (filters.view) {
    case "ACTIVE":
      where.status = { in: ["PLANNED", "ACTIVE", "PAUSED", "BLOCKED"] };
      break;
    case "PLANNED":
      where.status = "PLANNED";
      break;
    case "BLOCKED":
      where.status = "BLOCKED";
      break;
    case "COMPLETED":
      where.status = "COMPLETED";
      break;
    default:
      break;
  }

  if (filters.workspaceId) where.workspaceId = filters.workspaceId;
  if (filters.priority) where.priority = filters.priority;

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return where;
}

function projectOrderBy(
  sort: ProjectFilters["sort"],
): Prisma.ProjectOrderByWithRelationInput[] {
  switch (sort) {
    case "PRIORITY":
      return [
        { priority: "desc" },
        { targetEndAt: { sort: "asc", nulls: "last" } },
      ];
    case "RECENTLY_UPDATED":
      return [{ updatedAt: "desc" }];
    case "NAME":
      return [{ name: "asc" }];
    case "TARGET_DATE":
    default:
      return [
        { targetEndAt: { sort: "asc", nulls: "last" } },
        { priority: "desc" },
      ];
  }
}

type ProjectRow = Prisma.ProjectGetPayload<{
  include: { workspace: { select: { name: true } } };
}>;

/**
 * Attaches every derived figure to a set of project rows.
 *
 * Shared by the list and the detail page so a project's health can never read
 * differently depending on which screen you are looking at.
 */
async function hydrateProjects(
  profile: Profile,
  projects: readonly ProjectRow[],
  now: Date,
): Promise<readonly ProjectDto[]> {
  if (projects.length === 0) {
    return [];
  }

  const projectIds = projects.map((project) => project.id);

  // Four grouped queries for the whole page, not four per project.
  const [taskRows, overdueRows, milestoneRows, blockerRows] = await Promise.all(
    [
      db.task.groupBy({
        by: ["projectId", "status"],
        where: {
          profileId: profile.id,
          projectId: { in: projectIds },
          archivedAt: null,
        },
        _count: { _all: true },
      }),
      db.task.groupBy({
        by: ["projectId"],
        where: {
          profileId: profile.id,
          projectId: { in: projectIds },
          archivedAt: null,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          OR: [
            { isAllDay: false, dueAt: { lt: now } },
            {
              isAllDay: true,
              dueAt: { lt: startOfLocalDay(now, profile.timeZone) },
            },
          ],
        },
        _count: { _all: true },
      }),
      db.projectMilestone.findMany({
        where: { profileId: profile.id, projectId: { in: projectIds } },
        select: {
          id: true,
          projectId: true,
          title: true,
          status: true,
          dueAt: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      }),
      db.projectBlocker.groupBy({
        by: ["projectId"],
        where: {
          profileId: profile.id,
          projectId: { in: projectIds },
          resolvedAt: null,
        },
        _count: { _all: true },
      }),
    ],
  );

  const tasksByProject = new Map<
    string,
    { completed: number; total: number }
  >();

  for (const row of taskRows) {
    if (!row.projectId) continue;
    // CANCELLED tasks are excluded from both sides — see project.derive.ts.
    if (row.status === "CANCELLED") continue;

    const current = tasksByProject.get(row.projectId) ?? {
      completed: 0,
      total: 0,
    };

    tasksByProject.set(row.projectId, {
      completed:
        current.completed + (row.status === "COMPLETED" ? row._count._all : 0),
      total: current.total + row._count._all,
    });
  }

  const overdueByProject = new Map(
    overdueRows
      .filter((row) => row.projectId)
      .map((row) => [row.projectId!, row._count._all]),
  );

  const blockersByProject = new Map(
    blockerRows.map((row) => [row.projectId, row._count._all]),
  );

  const milestonesByProject = new Map<string, typeof milestoneRows>();

  for (const milestone of milestoneRows) {
    const list = milestonesByProject.get(milestone.projectId) ?? [];
    list.push(milestone);
    milestonesByProject.set(milestone.projectId, list);
  }

  return projects.map((project) => {
    const taskCounts = tasksByProject.get(project.id) ?? {
      completed: 0,
      total: 0,
    };
    const milestones = milestonesByProject.get(project.id) ?? [];
    const overdueMilestones = milestones.filter((milestone) =>
      isMilestoneOverdue(milestone, now),
    ).length;
    const openBlockerCount = blockersByProject.get(project.id) ?? 0;
    const next = nextMilestone(milestones);

    const milestoneCounts = {
      completed: milestones.filter((m) => m.status === "COMPLETED").length,
      total: milestones.length,
    };

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      workspaceId: project.workspaceId,
      workspaceName: project.workspace.name,
      status: project.status,
      priority: project.priority,
      startAt: project.startAt,
      targetEndAt: project.targetEndAt,
      startDateInput: project.startAt
        ? localDateKey(project.startAt, profile.timeZone)
        : null,
      targetEndDateInput: project.targetEndAt
        ? localDateKey(project.targetEndAt, profile.timeZone)
        : null,
      targetLabel: project.targetEndAt
        ? formatInTimeZone(
            project.targetEndAt,
            profile.timeZone,
            { day: "numeric", month: "short" },
            profile.locale,
          )
        : null,
      daysRemaining: project.targetEndAt
        ? localDayDifference(now, project.targetEndAt, profile.timeZone)
        : null,
      health: projectHealth(
        {
          status: project.status,
          targetEndAt: project.targetEndAt,
          completedAt: project.completedAt,
          openBlockerCount,
          taskCounts,
          overdueTaskCount: overdueByProject.get(project.id) ?? 0,
          overdueMilestoneCount: overdueMilestones,
        },
        now,
        profile.timeZone,
      ),
      progressPercent: projectProgress(taskCounts),
      taskTotal: taskCounts.total,
      taskCompleted: taskCounts.completed,
      overdueTaskCount: overdueByProject.get(project.id) ?? 0,
      milestoneTotal: milestoneCounts.total,
      milestoneCompleted: milestoneCounts.completed,
      milestoneProgressPercent: milestoneProgress(milestoneCounts),
      openBlockerCount,
      nextMilestoneTitle: next?.title ?? null,
      nextMilestoneDueLabel: next?.dueAt
        ? formatInTimeZone(
            next.dueAt,
            profile.timeZone,
            { day: "numeric", month: "short" },
            profile.locale,
          )
        : null,
      isArchived: project.archivedAt !== null,
      updatedAt: project.updatedAt,
    };
  });
}

/**
 * Loads projects with every derived figure, in a constant number of queries.
 */
export async function listProjects(
  profile: Profile,
  filters: ProjectFilters,
  now: Date = new Date(),
): Promise<readonly ProjectDto[]> {
  const projects = await db.project.findMany({
    where: buildProjectWhere(profile.id, filters),
    orderBy: projectOrderBy(filters.sort),
    include: { workspace: { select: { name: true } } },
    take: PROJECT_PAGE_SIZE,
  });

  return hydrateProjects(profile, projects, now);
}

const PROJECT_PAGE_SIZE = 100;

/**
 * A single project, archived or not.
 *
 * `profileId` is in the WHERE clause rather than checked afterwards, so
 * another user's project is indistinguishable from one that does not exist.
 */
export async function getProject(
  profile: Profile,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectDto | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, profileId: profile.id },
    include: { workspace: { select: { name: true } } },
  });

  if (!project) {
    return null;
  }

  const [hydrated] = await hydrateProjects(profile, [project], now);

  return hydrated ?? null;
}

export async function getProjectDetail(
  profile: Profile,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectDetailDto | null> {
  const project = await getProject(profile, projectId, now);

  if (!project) {
    return null;
  }

  const [milestones, blockers, tasks] = await Promise.all([
    db.projectMilestone.findMany({
      where: { profileId: profile.id, projectId },
      orderBy: { sortOrder: "asc" },
    }),
    db.projectBlocker.findMany({
      where: { profileId: profile.id, projectId },
      orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
    }),
    db.task.findMany({
      where: { profileId: profile.id, projectId, archivedAt: null },
      orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
      take: 100,
    }),
  ]);

  return {
    project,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      status: milestone.status,
      dueAt: milestone.dueAt,
      dueLabel: milestone.dueAt
        ? formatInTimeZone(
            milestone.dueAt,
            profile.timeZone,
            { day: "numeric", month: "short" },
            profile.locale,
          )
        : null,
      isOverdue: isMilestoneOverdue(milestone, now),
      sortOrder: milestone.sortOrder,
    })),
    blockers: blockers.map((blocker) => ({
      id: blocker.id,
      reason: blocker.reason,
      isResolved: blocker.resolvedAt !== null,
      resolutionNote: blocker.resolutionNote,
      createdLabel: formatInTimeZone(
        blocker.createdAt,
        profile.timeZone,
        { day: "numeric", month: "short" },
        profile.locale,
      ),
      daysOpen: localDayDifference(
        blocker.createdAt,
        blocker.resolvedAt ?? now,
        profile.timeZone,
      ),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      isCompleted: task.status === "COMPLETED",
      dueLabel: task.dueAt
        ? formatInTimeZone(
            task.dueAt,
            profile.timeZone,
            { day: "numeric", month: "short" },
            profile.locale,
          )
        : null,
    })),
  };
}

export async function listWorkspacesWithCounts(
  profile: Profile,
  includeArchived = false,
): Promise<readonly WorkspaceDto[]> {
  const workspaces = await db.workspace.findMany({
    where: {
      profileId: profile.id,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { name: "asc" },
  });

  if (workspaces.length === 0) {
    return [];
  }

  // One grouped query for every workspace, not one per workspace.
  const counts = await db.project.groupBy({
    by: ["workspaceId", "status"],
    where: {
      profileId: profile.id,
      workspaceId: { in: workspaces.map((workspace) => workspace.id) },
      archivedAt: null,
    },
    _count: { _all: true },
  });

  const active = new Map<string, number>();
  const blocked = new Map<string, number>();

  for (const row of counts) {
    if (["PLANNED", "ACTIVE", "PAUSED", "BLOCKED"].includes(row.status)) {
      active.set(
        row.workspaceId,
        (active.get(row.workspaceId) ?? 0) + row._count._all,
      );
    }

    if (row.status === "BLOCKED") {
      blocked.set(
        row.workspaceId,
        (blocked.get(row.workspaceId) ?? 0) + row._count._all,
      );
    }
  }

  return workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    type: workspace.type,
    icon: workspace.icon,
    isArchived: workspace.archivedAt !== null,
    activeProjectCount: active.get(workspace.id) ?? 0,
    blockedProjectCount: blocked.get(workspace.id) ?? 0,
  }));
}

/** The Work dashboard, assembled in one pass. */
export async function getWorkOverview(
  profile: Profile,
  now: Date = new Date(),
): Promise<WorkOverviewDto> {
  const [workspaces, projects] = await Promise.all([
    listWorkspacesWithCounts(profile),
    listProjects(
      profile,
      { view: "ACTIVE", sort: "TARGET_DATE" } as ProjectFilters,
      now,
    ),
  ]);

  const horizon = startOfLocalDayOffset(now, profile.timeZone, 14);

  const upcomingMilestones = await db.projectMilestone.findMany({
    where: {
      profileId: profile.id,
      status: { not: "COMPLETED" },
      dueAt: { gte: startOfLocalDay(now, profile.timeZone), lt: horizon },
      project: { archivedAt: null },
    },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { dueAt: "asc" },
    take: 8,
  });

  return {
    workspaces,
    projects,
    blockedProjects: projects.filter((project) => project.health === "BLOCKED"),
    atRiskProjects: projects.filter(
      (project) => project.health === "AT_RISK" || project.health === "OVERDUE",
    ),
    upcomingMilestones: upcomingMilestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      projectId: milestone.project.id,
      projectName: milestone.project.name,
      dueLabel: milestone.dueAt
        ? formatInTimeZone(
            milestone.dueAt,
            profile.timeZone,
            { day: "numeric", month: "short" },
            profile.locale,
          )
        : null,
    })),
    totalOverdueTasks: projects.reduce(
      (total, project) => total + project.overdueTaskCount,
      0,
    ),
  };
}

/** AI-tool shape (Phase 8), and the Overview widget's source. */
export async function getProjectsSummary(
  profile: Profile,
  now: Date = new Date(),
): Promise<ProjectsSummaryDto> {
  const projects = await listProjects(
    profile,
    { view: "ACTIVE", sort: "TARGET_DATE" } as ProjectFilters,
    now,
  );

  return {
    activeCount: projects.length,
    blockedCount: projects.filter((p) => p.health === "BLOCKED").length,
    atRiskCount: projects.filter(
      (p) => p.health === "AT_RISK" || p.health === "OVERDUE",
    ).length,
    projects: projects.slice(0, 5),
  };
}

/** Work results for the global command palette. */
export async function searchWork(
  profile: Profile,
  query: string,
  limit = 6,
): Promise<readonly WorkSearchResult[]> {
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const contains = { contains: trimmed, mode: "insensitive" as const };

  const [projects, workspaces] = await Promise.all([
    db.project.findMany({
      where: {
        profileId: profile.id,
        archivedAt: null,
        OR: [{ name: contains }, { description: contains }],
      },
      select: { id: true, name: true, workspace: { select: { name: true } } },
      take: 4,
    }),
    db.workspace.findMany({
      where: { profileId: profile.id, archivedAt: null, name: contains },
      select: { id: true, name: true, type: true },
      take: 3,
    }),
  ]);

  return [
    ...projects.map((project) => ({
      id: project.id,
      kind: "PROJECT" as const,
      title: project.name,
      subtitle: project.workspace.name,
      href: `/projects/${project.id}`,
    })),
    ...workspaces.map((workspace) => ({
      id: workspace.id,
      kind: "WORKSPACE" as const,
      title: workspace.name,
      subtitle: workspace.type,
      href: `/work`,
    })),
  ].slice(0, limit);
}
