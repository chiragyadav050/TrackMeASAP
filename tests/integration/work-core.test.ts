import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile, Project, Workspace } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import {
  getProject,
  getProjectDetail,
  getWorkOverview,
  listProjects,
  listWorkspacesWithCounts,
  searchWork,
} from "@/services/work/work.query";
import { createProjectSchema } from "@/services/work/work.schema";
import {
  createBlocker,
  createMilestone,
  createProject,
  createProjectTask,
  createWorkspace,
  deleteMilestone,
  deleteProject,
  deleteWorkspace,
  linkTaskToProject,
  reorderMilestones,
  resolveBlocker,
  setMilestoneStatus,
  setProjectArchived,
  setProjectStatus,
  updateProject,
} from "@/services/work/work.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Work and projects against a real database.
 *
 * The derive rules themselves are unit-tested in `project-derive.test.ts`;
 * what these tests prove is that the QUERY layer feeds those rules the right
 * numbers — the grouped-count aggregation is where a health band would
 * silently go wrong, not the pure function.
 */

let profile: Profile;
let workspace: Workspace;

const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
  workspace = await createWorkspace(profile.id, {
    name: "[TEST] Freelance",
    type: "FREELANCE",
  } as never);
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

async function makeProject(
  overrides: Record<string, unknown> = {},
): Promise<Project> {
  return createProject(profile.id, profile.timeZone, {
    workspaceId: workspace.id,
    name: "[TEST] Client site",
    status: "ACTIVE",
    priority: "MEDIUM",
    ...overrides,
  } as never);
}

async function addTask(
  project: Project,
  overrides: Record<string, unknown> = {},
) {
  const { taskId } = await createProjectTask(profile.id, profile.timeZone, {
    projectId: project.id,
    title: "[TEST] Task",
    priority: "MEDIUM",
    ...overrides,
  } as never);

  return taskId;
}

const ACTIVE_VIEW = { view: "ACTIVE", sort: "TARGET_DATE" } as never;

describe("workspaces", () => {
  test("are created and listed with live project counts", async () => {
    await makeProject();
    await makeProject({ name: "[TEST] Second", status: "COMPLETED" });

    const [listed] = await listWorkspacesWithCounts(profile);

    expect(listed?.name).toBe("[TEST] Freelance");
    // COMPLETED is not live work, so only one counts.
    expect(listed?.activeProjectCount).toBe(1);
    expect(listed?.blockedProjectCount).toBe(0);
  });

  test("archived workspaces drop out of the default listing", async () => {
    const archived = await createWorkspace(profile.id, {
      name: "[TEST] Old",
      type: "OTHER",
    } as never);

    await db.workspace.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });

    expect(await listWorkspacesWithCounts(profile)).toHaveLength(1);
    expect(await listWorkspacesWithCounts(profile, true)).toHaveLength(2);
  });

  test("deleting a workspace removes its projects but keeps the tasks", async () => {
    const project = await makeProject();
    const taskId = await addTask(project);

    await deleteWorkspace(profile.id, workspace.id);

    expect(
      await db.project.findUnique({ where: { id: project.id } }),
    ).toBeNull();

    // The work the user actually did survives — only the grouping is gone.
    const task = await db.task.findUnique({ where: { id: taskId } });
    expect(task).not.toBeNull();
    expect(task?.projectId).toBeNull();
  });
});

describe("project progress", () => {
  test("is null until the project has tasks, then tracks completion", async () => {
    const project = await makeProject();

    expect(
      (await getProject(profile, project.id, NOW))?.progressPercent,
    ).toBeNull();

    const first = await addTask(project);
    await addTask(project);

    expect((await getProject(profile, project.id, NOW))?.progressPercent).toBe(
      0,
    );

    await db.task.update({
      where: { id: first },
      data: { status: "COMPLETED", completedAt: NOW },
    });

    expect((await getProject(profile, project.id, NOW))?.progressPercent).toBe(
      50,
    );
  });

  test("cancelled tasks leave both sides of the ratio", async () => {
    const project = await makeProject();
    const done = await addTask(project);
    const cancelled = await addTask(project);

    await db.task.update({
      where: { id: done },
      data: { status: "COMPLETED", completedAt: NOW },
    });
    await db.task.update({
      where: { id: cancelled },
      data: { status: "CANCELLED" },
    });

    // 1 of 1, not 1 of 2 — abandoned work must not cap the project below 100%.
    const loaded = await getProject(profile, project.id, NOW);
    expect(loaded?.progressPercent).toBe(100);
    expect(loaded?.taskTotal).toBe(1);
  });

  test("archived tasks are not counted at all", async () => {
    const project = await makeProject();
    const archived = await addTask(project);

    await db.task.update({
      where: { id: archived },
      data: { archivedAt: new Date() },
    });

    expect((await getProject(profile, project.id, NOW))?.taskTotal).toBe(0);
  });
});

describe("project health", () => {
  test("a blocker moves the project to BLOCKED and back again", async () => {
    const project = await makeProject();
    await addTask(project);

    const blocker = await createBlocker(profile.id, {
      projectId: project.id,
      reason: "[TEST] Waiting on client assets",
    } as never);

    let loaded = await getProject(profile, project.id, NOW);
    expect(loaded?.health).toBe("BLOCKED");
    expect(loaded?.openBlockerCount).toBe(1);
    expect(loaded?.status).toBe("BLOCKED");

    await resolveBlocker(profile.id, blocker.id, "[TEST] Assets received");

    loaded = await getProject(profile, project.id, NOW);
    expect(loaded?.health).toBe("ON_TRACK");
    expect(loaded?.openBlockerCount).toBe(0);
    expect(loaded?.status).toBe("ACTIVE");
  });

  test("resolving one of two blockers leaves the project blocked", async () => {
    const project = await makeProject();

    const first = await createBlocker(profile.id, {
      projectId: project.id,
      reason: "[TEST] Blocker one",
    } as never);
    await createBlocker(profile.id, {
      projectId: project.id,
      reason: "[TEST] Blocker two",
    } as never);

    await resolveBlocker(profile.id, first.id);

    const loaded = await getProject(profile, project.id, NOW);
    expect(loaded?.health).toBe("BLOCKED");
    expect(loaded?.openBlockerCount).toBe(1);
  });

  test("resolving the last blocker does not override a deliberate PAUSED", async () => {
    const project = await makeProject();

    const blocker = await createBlocker(profile.id, {
      projectId: project.id,
      reason: "[TEST] Blocked",
    } as never);

    await setProjectStatus(profile.id, project.id, "PAUSED");
    await resolveBlocker(profile.id, blocker.id);

    const reloaded = await db.project.findUnique({ where: { id: project.id } });
    expect(reloaded?.status).toBe("PAUSED");
  });

  test("an overdue task makes an otherwise healthy project AT_RISK", async () => {
    const project = await makeProject({ targetEndDate: "2026-12-31" });
    const taskId = await addTask(project);

    await db.task.update({
      where: { id: taskId },
      data: {
        dueAt: instantFromLocalTime(2026, 9, 10, 9 * 60, TEST_TIME_ZONE),
        isAllDay: false,
      },
    });

    const loaded = await getProject(profile, project.id, NOW);
    expect(loaded?.overdueTaskCount).toBe(1);
    expect(loaded?.health).toBe("AT_RISK");
  });

  test("a passed target date reads OVERDUE", async () => {
    const project = await makeProject({ targetEndDate: "2026-09-01" });
    await addTask(project);

    expect((await getProject(profile, project.id, NOW))?.health).toBe(
      "OVERDUE",
    );
  });

  test("an empty project reads NOT_STARTED rather than 0%", async () => {
    const project = await makeProject();
    const loaded = await getProject(profile, project.id, NOW);

    expect(loaded?.health).toBe("NOT_STARTED");
    expect(loaded?.progressPercent).toBeNull();
  });
});

describe("milestones", () => {
  test("the next milestone is the soonest incomplete one", async () => {
    const project = await makeProject();

    await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] Launch",
      dueDate: "2026-11-01",
    } as never);

    const design = await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] Design sign-off",
      dueDate: "2026-09-25",
    } as never);

    expect(
      (await getProject(profile, project.id, NOW))?.nextMilestoneTitle,
    ).toBe("[TEST] Design sign-off");

    await setMilestoneStatus(profile.id, design.id, "COMPLETED");

    const loaded = await getProject(profile, project.id, NOW);
    expect(loaded?.nextMilestoneTitle).toBe("[TEST] Launch");
    expect(loaded?.milestoneCompleted).toBe(1);
    expect(loaded?.milestoneProgressPercent).toBe(50);
  });

  test("an overdue milestone makes the project AT_RISK", async () => {
    const project = await makeProject();
    await addTask(project);

    await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] Missed checkpoint",
      dueDate: "2026-09-01",
    } as never);

    const detail = await getProjectDetail(profile, project.id, NOW);
    expect(detail?.project.health).toBe("AT_RISK");
    expect(detail?.milestones[0]?.isOverdue).toBe(true);
  });

  test("reordering requires the complete set of milestones", async () => {
    const project = await makeProject();

    const a = await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] A",
    } as never);
    const b = await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] B",
    } as never);

    // A partial list is rejected outright rather than half-applied.
    await expect(
      reorderMilestones(profile.id, project.id, [b.id]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.code === "VALIDATION_FAILED",
    );

    await reorderMilestones(profile.id, project.id, [b.id, a.id]);

    const detail = await getProjectDetail(profile, project.id, NOW);
    expect(detail?.milestones.map((milestone) => milestone.title)).toEqual([
      "[TEST] B",
      "[TEST] A",
    ]);
  });

  test("deleting a milestone leaves the project and its tasks intact", async () => {
    const project = await makeProject();
    const taskId = await addTask(project);

    const milestone = await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] Temporary",
    } as never);

    await deleteMilestone(profile.id, milestone.id);

    expect((await getProject(profile, project.id, NOW))?.milestoneTotal).toBe(
      0,
    );
    expect(await db.task.findUnique({ where: { id: taskId } })).not.toBeNull();
  });
});

describe("task integration", () => {
  test("a project task is an ordinary task, visible everywhere", async () => {
    const project = await makeProject();
    const taskId = await addTask(project, { title: "[TEST] Write copy" });

    const task = await db.task.findUnique({ where: { id: taskId } });

    // Same table, same list — not a parallel project-task model.
    expect(task?.projectId).toBe(project.id);
    expect(task?.category).toBe("PROJECT");
    expect(task?.title).toBe("[TEST] Write copy");
  });

  test("an existing task can be linked and unlinked without being destroyed", async () => {
    const project = await makeProject();

    const standalone = await db.task.create({
      data: { profileId: profile.id, title: "[TEST] Standalone", position: 0 },
    });

    await linkTaskToProject(profile.id, standalone.id, project.id);
    expect((await getProject(profile, project.id, NOW))?.taskTotal).toBe(1);

    await linkTaskToProject(profile.id, standalone.id, null);

    expect((await getProject(profile, project.id, NOW))?.taskTotal).toBe(0);
    expect(
      await db.task.findUnique({ where: { id: standalone.id } }),
    ).not.toBeNull();
  });

  test("deleting a project keeps its tasks and clears the link", async () => {
    const project = await makeProject();
    const taskId = await addTask(project);

    await deleteProject(profile.id, project.id);

    const task = await db.task.findUnique({ where: { id: taskId } });
    expect(task).not.toBeNull();
    expect(task?.projectId).toBeNull();
  });
});

describe("filters, archive and search", () => {
  test("archived projects only appear in the archive view", async () => {
    const project = await makeProject();
    await setProjectArchived(profile.id, project.id, true);

    expect(await listProjects(profile, ACTIVE_VIEW, NOW)).toHaveLength(0);
    expect(
      await listProjects(profile, { view: "ALL", sort: "NAME" } as never, NOW),
    ).toHaveLength(0);

    const archived = await listProjects(
      profile,
      { view: "ARCHIVED", sort: "NAME" } as never,
      NOW,
    );
    expect(archived).toHaveLength(1);
    expect(archived[0]?.isArchived).toBe(true);

    // …and restoring puts it back.
    await setProjectArchived(profile.id, project.id, false);
    expect(await listProjects(profile, ACTIVE_VIEW, NOW)).toHaveLength(1);
  });

  test("an archived project is still reachable by direct id", async () => {
    const project = await makeProject();
    await setProjectArchived(profile.id, project.id, true);

    // Otherwise the archive list would link to a 404.
    expect((await getProject(profile, project.id, NOW))?.isArchived).toBe(true);
  });

  test("the status views filter on status", async () => {
    await makeProject({ name: "[TEST] Planned", status: "PLANNED" });
    await makeProject({ name: "[TEST] Running", status: "ACTIVE" });
    const done = await makeProject({ name: "[TEST] Done" });
    await setProjectStatus(profile.id, done.id, "COMPLETED");

    const planned = await listProjects(
      profile,
      { view: "PLANNED", sort: "NAME" } as never,
      NOW,
    );
    expect(planned.map((p) => p.name)).toEqual(["[TEST] Planned"]);

    const completed = await listProjects(
      profile,
      { view: "COMPLETED", sort: "NAME" } as never,
      NOW,
    );
    expect(completed.map((p) => p.name)).toEqual(["[TEST] Done"]);

    // ACTIVE means live work — the completed one is excluded.
    const active = await listProjects(profile, ACTIVE_VIEW, NOW);
    expect(active).toHaveLength(2);
  });

  test("search matches name and description, case-insensitively", async () => {
    await makeProject({
      name: "[TEST] Portfolio rebuild",
      description: "Migrate to Next.js",
    });
    await makeProject({ name: "[TEST] Unrelated" });

    const byName = await listProjects(
      profile,
      { view: "ALL", sort: "NAME", search: "portfolio" } as never,
      NOW,
    );
    expect(byName).toHaveLength(1);

    const byDescription = await listProjects(
      profile,
      { view: "ALL", sort: "NAME", search: "next.js" } as never,
      NOW,
    );
    expect(byDescription).toHaveLength(1);
  });

  test("command-palette search returns projects and workspaces", async () => {
    await makeProject({ name: "[TEST] Portfolio rebuild" });

    const results = await searchWork(profile, "portfolio");
    expect(results[0]?.kind).toBe("PROJECT");
    expect(results[0]?.href).toContain("/projects/");

    // Too short to be meaningful — no results rather than everything.
    expect(await searchWork(profile, "p")).toHaveLength(0);
  });
});

describe("work overview", () => {
  test("groups blocked and at-risk projects and sums overdue tasks", async () => {
    const blocked = await makeProject({ name: "[TEST] Blocked" });
    await createBlocker(profile.id, {
      projectId: blocked.id,
      reason: "[TEST] Stuck",
    } as never);

    const atRisk = await makeProject({
      name: "[TEST] At risk",
      targetEndDate: "2026-12-31",
    });
    const lateTask = await addTask(atRisk);
    await db.task.update({
      where: { id: lateTask },
      data: {
        dueAt: instantFromLocalTime(2026, 9, 1, 9 * 60, TEST_TIME_ZONE),
        isAllDay: false,
      },
    });

    await createMilestone(profile.id, profile.timeZone, {
      projectId: atRisk.id,
      title: "[TEST] Soon",
      dueDate: "2026-09-20",
    } as never);

    const overview = await getWorkOverview(profile, NOW);

    expect(overview.blockedProjects.map((p) => p.name)).toEqual([
      "[TEST] Blocked",
    ]);
    expect(overview.atRiskProjects.map((p) => p.name)).toEqual([
      "[TEST] At risk",
    ]);
    expect(overview.totalOverdueTasks).toBe(1);
    expect(overview.upcomingMilestones[0]?.title).toBe("[TEST] Soon");
  });

  test("a milestone beyond the horizon is not called upcoming", async () => {
    const project = await makeProject();

    await createMilestone(profile.id, profile.timeZone, {
      projectId: project.id,
      title: "[TEST] Far away",
      dueDate: "2026-12-01",
    } as never);

    const overview = await getWorkOverview(profile, NOW);
    expect(overview.upcomingMilestones).toHaveLength(0);
  });

  test("is empty, not broken, for a profile with no work", async () => {
    const overview = await getWorkOverview(profile, NOW);

    expect(overview.projects).toHaveLength(0);
    expect(overview.upcomingMilestones).toHaveLength(0);
    expect(overview.totalOverdueTasks).toBe(0);
    expect(overview.workspaces).toHaveLength(1);
  });
});

describe("validation", () => {
  test("a project cannot end before it starts", () => {
    // Checked at the schema, which is what every action runs input through —
    // the service takes already-validated input by design.
    const result = createProjectSchema.safeParse({
      workspaceId: workspace.id,
      name: "[TEST] Backwards",
      startDate: "2026-10-01",
      targetEndDate: "2026-09-01",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["targetEndDate"]);
  });

  test("updating to COMPLETED stamps completedAt, and reverting clears it", async () => {
    const project = await makeProject();

    await updateProject(profile.id, profile.timeZone, {
      projectId: project.id,
      status: "COMPLETED",
    } as never);

    let reloaded = await db.project.findUnique({ where: { id: project.id } });
    expect(reloaded?.completedAt).not.toBeNull();

    await setProjectStatus(profile.id, project.id, "ACTIVE");

    reloaded = await db.project.findUnique({ where: { id: project.id } });
    expect(reloaded?.completedAt).toBeNull();
  });
});
