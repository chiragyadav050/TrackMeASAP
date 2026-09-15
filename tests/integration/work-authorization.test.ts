import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type {
  Profile,
  Project,
  ProjectBlocker,
  ProjectMilestone,
  Workspace,
} from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { db } from "@/server/db";
import {
  getProject,
  getProjectDetail,
  listProjects,
  listWorkspacesWithCounts,
  searchWork,
} from "@/services/work/work.query";
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
  requireOwnedBlocker,
  requireOwnedMilestone,
  requireOwnedProject,
  requireOwnedWorkspace,
  resolveBlocker,
  setMilestoneStatus,
  setProjectArchived,
  setProjectStatus,
  updateMilestone,
  updateProject,
  updateWorkspace,
} from "@/services/work/work.service";
import { cleanupTestData, createTestProfile, disconnect } from "./helpers";

/**
 * Cross-user isolation for Phase 4.
 *
 * Owner creates everything; intruder — a real second profile in the same
 * database — tries to read, change and delete all of it with VALID ids.
 *
 * Every failure must be NOT_FOUND, never FORBIDDEN. "Forbidden" confirms the
 * id exists, which turns a guessed id into an existence oracle; "not found"
 * tells an attacker nothing.
 */

let owner: Profile;
let intruder: Profile;
let workspace: Workspace;
let project: Project;
let milestone: ProjectMilestone;
let blocker: ProjectBlocker;

/** Asserts a rejection is NOT_FOUND — not merely "some error". */
async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
  );
}

beforeEach(async () => {
  await cleanupTestData();

  owner = await createTestProfile();
  intruder = await createTestProfile();

  workspace = await createWorkspace(owner.id, {
    name: "[TEST] Owner workspace",
    type: "BUSINESS",
  } as never);

  project = await createProject(owner.id, owner.timeZone, {
    workspaceId: workspace.id,
    name: "[TEST] Owner project",
    status: "ACTIVE",
    priority: "HIGH",
  } as never);

  milestone = await createMilestone(owner.id, owner.timeZone, {
    projectId: project.id,
    title: "[TEST] Owner milestone",
  } as never);

  blocker = await createBlocker(owner.id, {
    projectId: project.id,
    reason: "[TEST] Owner blocker",
  } as never);
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

describe("ownership guards", () => {
  test("every guard reports NOT_FOUND for another user's record", async () => {
    await expectNotFound(requireOwnedWorkspace(intruder.id, workspace.id));
    await expectNotFound(requireOwnedProject(intruder.id, project.id));
    await expectNotFound(requireOwnedMilestone(intruder.id, milestone.id));
    await expectNotFound(requireOwnedBlocker(intruder.id, blocker.id));
  });

  test("the same guards pass for the owner", async () => {
    await expect(
      requireOwnedProject(owner.id, project.id),
    ).resolves.toMatchObject({ id: project.id });
  });
});

describe("reads are scoped to the caller", () => {
  test("another user's project is invisible to list, get and detail", async () => {
    expect(
      await listProjects(intruder, { view: "ALL", sort: "NAME" } as never),
    ).toHaveLength(0);
    expect(await getProject(intruder, project.id)).toBeNull();
    expect(await getProjectDetail(intruder, project.id)).toBeNull();
    expect(await listWorkspacesWithCounts(intruder)).toHaveLength(0);
  });

  test("search never leaks another user's work", async () => {
    expect(await searchWork(intruder, "Owner")).toHaveLength(0);
    expect((await searchWork(owner, "Owner")).length).toBeGreaterThan(0);
  });
});

describe("writes are rejected", () => {
  test("workspace mutations", async () => {
    await expectNotFound(
      updateWorkspace(intruder.id, {
        workspaceId: workspace.id,
        name: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(deleteWorkspace(intruder.id, workspace.id));

    const untouched = await db.workspace.findUnique({
      where: { id: workspace.id },
    });
    expect(untouched?.name).toBe("[TEST] Owner workspace");
  });

  test("project mutations", async () => {
    await expectNotFound(
      updateProject(intruder.id, intruder.timeZone, {
        projectId: project.id,
        name: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(
      setProjectStatus(intruder.id, project.id, "CANCELLED"),
    );
    await expectNotFound(setProjectArchived(intruder.id, project.id, true));
    await expectNotFound(deleteProject(intruder.id, project.id));

    const untouched = await db.project.findUnique({
      where: { id: project.id },
    });
    expect(untouched?.name).toBe("[TEST] Owner project");
    expect(untouched?.archivedAt).toBeNull();
  });

  test("milestone mutations", async () => {
    await expectNotFound(
      updateMilestone(intruder.id, intruder.timeZone, {
        milestoneId: milestone.id,
        title: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(
      setMilestoneStatus(intruder.id, milestone.id, "COMPLETED"),
    );
    await expectNotFound(deleteMilestone(intruder.id, milestone.id));
    await expectNotFound(
      reorderMilestones(intruder.id, project.id, [milestone.id]),
    );

    const untouched = await db.projectMilestone.findUnique({
      where: { id: milestone.id },
    });
    expect(untouched?.title).toBe("[TEST] Owner milestone");
    expect(untouched?.status).toBe("PENDING");
  });

  test("blocker mutations", async () => {
    await expectNotFound(resolveBlocker(intruder.id, blocker.id));
    await expectNotFound(deleteBlocker(intruder.id, blocker.id));

    const untouched = await db.projectBlocker.findUnique({
      where: { id: blocker.id },
    });
    expect(untouched?.resolvedAt).toBeNull();
  });
});

describe("cross-owner grafting", () => {
  test("a project cannot be created inside another user's workspace", async () => {
    await expectNotFound(
      createProject(intruder.id, intruder.timeZone, {
        workspaceId: workspace.id,
        name: "[TEST] Smuggled",
        status: "ACTIVE",
        priority: "LOW",
      } as never),
    );

    expect(
      await db.project.count({ where: { workspaceId: workspace.id } }),
    ).toBe(1);
  });

  test("a project cannot be moved into another user's workspace", async () => {
    const theirWorkspace = await createWorkspace(intruder.id, {
      name: "[TEST] Intruder workspace",
      type: "PERSONAL",
    } as never);

    const theirProject = await createProject(intruder.id, intruder.timeZone, {
      workspaceId: theirWorkspace.id,
      name: "[TEST] Intruder project",
      status: "ACTIVE",
      priority: "LOW",
    } as never);

    // Their own project, someone else's workspace — still refused.
    await expectNotFound(
      updateProject(intruder.id, intruder.timeZone, {
        projectId: theirProject.id,
        workspaceId: workspace.id,
      } as never),
    );
  });

  test("a milestone or blocker cannot be added to another user's project", async () => {
    await expectNotFound(
      createMilestone(intruder.id, intruder.timeZone, {
        projectId: project.id,
        title: "[TEST] Smuggled",
      } as never),
    );

    await expectNotFound(
      createBlocker(intruder.id, {
        projectId: project.id,
        reason: "[TEST] Smuggled",
      } as never),
    );

    await expectNotFound(
      createProjectTask(intruder.id, intruder.timeZone, {
        projectId: project.id,
        title: "[TEST] Smuggled",
        priority: "LOW",
      } as never),
    );
  });

  test("a task cannot be attached to another user's project", async () => {
    const theirTask = await db.task.create({
      data: {
        profileId: intruder.id,
        title: "[TEST] Intruder task",
        position: 0,
      },
    });

    // A valid task id of their own plus a valid project id of someone else's
    // is exactly the attack the project-side check exists to stop.
    await expectNotFound(
      linkTaskToProject(intruder.id, theirTask.id, project.id),
    );

    const reloaded = await db.task.findUnique({ where: { id: theirTask.id } });
    expect(reloaded?.projectId).toBeNull();
  });

  test("another user's task cannot be pulled into your own project", async () => {
    const ownerTask = await db.task.create({
      data: { profileId: owner.id, title: "[TEST] Owner task", position: 0 },
    });

    const theirWorkspace = await createWorkspace(intruder.id, {
      name: "[TEST] Intruder workspace",
      type: "PERSONAL",
    } as never);

    const theirProject = await createProject(intruder.id, intruder.timeZone, {
      workspaceId: theirWorkspace.id,
      name: "[TEST] Intruder project",
      status: "ACTIVE",
      priority: "LOW",
    } as never);

    await expectNotFound(
      linkTaskToProject(intruder.id, ownerTask.id, theirProject.id),
    );
  });
});

describe("denormalised ownership stays consistent", () => {
  test("nested records carry the owner's profileId", async () => {
    // The guards read `profileId` off the row itself rather than walking the
    // relation, so the column has to be right or the guard checks nothing.
    expect(milestone.profileId).toBe(owner.id);
    expect(blocker.profileId).toBe(owner.id);

    const { taskId } = await createProjectTask(owner.id, owner.timeZone, {
      projectId: project.id,
      title: "[TEST] Owner task",
      priority: "LOW",
    } as never);

    const task = await db.task.findUnique({ where: { id: taskId } });
    expect(task?.profileId).toBe(owner.id);
  });
});
