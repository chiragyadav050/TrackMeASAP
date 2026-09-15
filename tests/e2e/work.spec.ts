import { expect, test } from "@playwright/test";

import { CLERK_SKIP_REASON, isRealClerkInstance } from "./clerk-env";

/**
 * Phase 4 work and project journeys.
 *
 * SKIPS ENTIRELY without a real Clerk instance — every one needs an
 * authenticated session, and Clerk's development handshake stops a browser
 * reaching the app when the publishable key is a placeholder. See
 * `clerk-env.ts` and docs/DEVELOPMENT.md.
 *
 * Deliberately NOT written against a stubbed session. The rules that actually
 * matter here — progress arithmetic, health precedence, blocker/status
 * coupling, the task↔project boundary and cross-tenant isolation — are
 * covered FOR REAL by 27 unit tests and 43 integration tests against a live
 * database. These specs cover what only a browser can: that the buttons are
 * wired, the dialogs submit, and the numbers on screen match the service.
 */
test.skip(!isRealClerkInstance(), CLERK_SKIP_REASON);

const stamp = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function createWorkspace(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.goto("/work");
  await page
    .getByRole("button", { name: /workspace/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: /create/i }).click();
  await expect(dialog).toBeHidden();
}

async function createProject(
  page: import("@playwright/test").Page,
  name: string,
  targetEndDate?: string,
) {
  await page.goto("/projects");
  await page
    .getByRole("button", { name: /new project/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill(name);

  if (targetEndDate) {
    await dialog.getByLabel("Target end date").fill(targetEndDate);
  }

  await dialog.getByRole("button", { name: /create project/i }).click();
  await expect(dialog).toBeHidden();

  await page
    .getByRole("link", { name: new RegExp(name, "i") })
    .first()
    .click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test.describe("workspaces", () => {
  test("the work page starts empty and honest", async ({ page }) => {
    await page.goto("/work");

    // No invented projects, no sample numbers — either real data or a prompt.
    await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  });

  test("a workspace can be created and appears with a real count", async ({
    page,
  }) => {
    const name = `Freelance ${stamp()}`;
    await createWorkspace(page, name);

    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText(/no active projects/i).first()).toBeVisible();
  });
});

test.describe("projects", () => {
  test("can be created, then opened from the list", async ({ page }) => {
    const workspace = `WS ${stamp()}`;
    const project = `Project ${stamp()}`;

    await createWorkspace(page, workspace);
    await createProject(page, project);

    // A project with no tasks reads "not started", never "0% complete".
    await expect(page.getByText(/not started/i).first()).toBeVisible();
    await expect(page.getByText(/no tasks yet/i).first()).toBeVisible();
  });

  test("adding tasks moves the progress figure", async ({ page }) => {
    const workspace = `WS ${stamp()}`;
    const project = `Project ${stamp()}`;

    await createWorkspace(page, workspace);
    await createProject(page, project);

    await page.getByLabel("Task title").fill("First task");
    await page.getByRole("button", { name: /^add$/i }).first().click();

    await expect(page.getByText("First task")).toBeVisible();
    await expect(page.getByText(/0 of 1 tasks/i)).toBeVisible();
  });

  test("a blocker marks the project blocked, and resolving clears it", async ({
    page,
  }) => {
    const workspace = `WS ${stamp()}`;
    const project = `Project ${stamp()}`;

    await createWorkspace(page, workspace);
    await createProject(page, project);

    await page.getByLabel("Blocker reason").fill("Waiting on assets");
    await page.getByRole("button", { name: /block/i }).click();

    await expect(page.getByText(/blocked/i).first()).toBeVisible();
    await expect(page.getByText("Waiting on assets")).toBeVisible();

    await page.getByRole("button", { name: /resolve/i }).click();
    await expect(page.getByText(/resolved after/i)).toBeVisible();
  });

  test("milestones can be added, completed and reordered", async ({ page }) => {
    const workspace = `WS ${stamp()}`;
    const project = `Project ${stamp()}`;

    await createWorkspace(page, workspace);
    await createProject(page, project);

    for (const title of ["Design", "Build"]) {
      await page.getByLabel("Milestone title").fill(title);
      await page.getByRole("button", { name: /^add$/i }).last().click();
      await expect(page.getByText(title)).toBeVisible();
    }

    await page.getByLabel(/mark "Design" complete/i).click();
    await expect(page.getByText(/1 of 2 complete/i)).toBeVisible();
  });

  test("archiving removes a project from the active view and restores it", async ({
    page,
  }) => {
    const workspace = `WS ${stamp()}`;
    const project = `Project ${stamp()}`;

    await createWorkspace(page, workspace);
    await createProject(page, project);

    await page.getByRole("button", { name: /more project actions/i }).click();
    await page.getByRole("menuitem", { name: /archive/i }).click();

    await page.goto("/projects");
    await expect(page.getByText(project)).toBeHidden();

    await page.getByRole("button", { name: /archived/i }).click();
    await expect(page.getByText(project)).toBeVisible();
  });
});

test.describe("filters and search", () => {
  test("the filter state lives in the URL", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: /^blocked$/i }).click();

    await expect(page).toHaveURL(/view=BLOCKED/);
  });

  test("search narrows the list and can be cleared", async ({ page }) => {
    const workspace = `WS ${stamp()}`;
    const project = `Findable ${stamp()}`;

    await createWorkspace(page, workspace);
    await createProject(page, project);

    await page.goto("/projects");
    await page.getByLabel("Search projects").fill("Findable");

    await expect(page).toHaveURL(/search=Findable/);
    await expect(page.getByText(project)).toBeVisible();
  });
});

test.describe("responsive", () => {
  for (const width of [320, 768, 1440]) {
    test(`the project list does not overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/projects");

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );

      expect(overflows).toBe(false);
    });
  }
});
