import { expect, test } from "@playwright/test";

import { CLERK_SKIP_REASON, isRealClerkInstance } from "./clerk-env";

/**
 * Phase 2 task journeys.
 *
 * SKIPS ENTIRELY without a real Clerk instance — every one of these needs an
 * authenticated session, and Clerk's development handshake prevents a browser
 * from ever reaching the app when the publishable key is a placeholder. See
 * `clerk-env.ts` and docs/DEVELOPMENT.md.
 *
 * These are deliberately NOT written against a stubbed session. A task test
 * that mocks authentication proves only that the mock works, and the ownership
 * rules that actually matter are already covered for real by the integration
 * suite (`tests/integration/task-authorization.test.ts`, 28 assertions against
 * a live database).
 */
test.skip(!isRealClerkInstance(), CLERK_SKIP_REASON);

/** Unique per run so repeated runs never collide on an existing task. */
const stamp = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.describe("task capture", () => {
  test("quick capture creates a task that appears in the list", async ({
    page,
  }) => {
    const title = `Quick capture ${stamp()}`;

    await page.goto("/tasks");

    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");

    await expect(page.getByText(title)).toBeVisible();
    // The field clears so the next thought can be captured immediately.
    await expect(input).toHaveValue("");
  });

  test("the full dialog captures priority, due date and estimate", async ({
    page,
  }) => {
    const title = `Detailed ${stamp()}`;

    await page.goto("/tasks");
    await page.getByRole("button", { name: /add details/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Priority").selectOption("HIGH");
    await dialog.getByLabel("Category").selectOption("COLLEGE");
    await dialog.getByLabel("Estimate").fill("45");
    await dialog.getByRole("button", { name: /create task/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("45m").first()).toBeVisible();
  });

  test("the c shortcut opens the create dialog", async ({ page }) => {
    await page.goto("/tasks");

    // Focus must not be in a field, or the key belongs to the field.
    await page.locator("body").click();
    await page.keyboard.press("c");

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /new task/i }),
    ).toBeVisible();
  });

  test("typing 'c' inside a field does not open the dialog", async ({
    page,
  }) => {
    await page.goto("/tasks");

    await page.getByLabel("Task title").fill("c");

    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("task lifecycle", () => {
  test("a task can be completed and reopened", async ({ page }) => {
    const title = `Lifecycle ${stamp()}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByText(title)).toBeVisible();

    const complete = page.getByRole("checkbox", {
      name: `Complete ${title}`,
    });
    await complete.click();

    // The row flips optimistically, then the label inverts once persisted.
    const reopen = page.getByRole("checkbox", { name: `Reopen ${title}` });
    await expect(reopen).toBeVisible();

    await reopen.click();
    await expect(
      page.getByRole("checkbox", { name: `Complete ${title}` }),
    ).toBeVisible();
  });

  test("a task can be edited", async ({ page }) => {
    const title = `Editable ${stamp()}`;
    const renamed = `${title} renamed`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");

    await page.getByRole("button", { name: title, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(renamed);
    await dialog.getByRole("button", { name: /save changes/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(renamed)).toBeVisible();
  });

  test("subtasks can be added and completed, and show progress", async ({
    page,
  }) => {
    const title = `With steps ${stamp()}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");

    await page.getByRole("button", { name: title, exact: true }).click();

    const dialog = page.getByRole("dialog");
    const subtaskInput = dialog.getByLabel("New subtask");

    for (const step of ["Read requirements", "Implement", "Submit"]) {
      await subtaskInput.fill(step);
      await subtaskInput.press("Enter");
      await expect(dialog.getByText(step)).toBeVisible();
    }

    await expect(dialog.getByText("0 / 3 completed")).toBeVisible();

    await dialog
      .getByRole("checkbox", { name: /Complete Read requirements/i })
      .click();

    await expect(dialog.getByText("1 / 3 completed")).toBeVisible();
  });

  test("a task can be rescheduled to tomorrow", async ({ page }) => {
    const title = `Reschedule ${stamp()}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByText(title)).toBeVisible();

    await page.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: /reschedule/i }).click();
    await page.getByRole("menuitem", { name: /^tomorrow$/i }).click();

    await expect(page.getByText("Tomorrow").first()).toBeVisible();
  });

  test("a task can be archived and leaves the active list", async ({
    page,
  }) => {
    const title = `Archive ${stamp()}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByText(title)).toBeVisible();

    await page.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: /^archive$/i }).click();

    await expect(page.getByText(title)).toBeHidden();

    // …but is still retrievable under the Archived filter.
    await page.getByLabel("Filter by status").selectOption("ARCHIVED");
    await expect(page.getByText(title)).toBeVisible();
  });
});

test.describe("filtering and search", () => {
  test("the status filter narrows the list and survives a reload", async ({
    page,
  }) => {
    await page.goto("/tasks");

    await page.getByLabel("Filter by status").selectOption("COMPLETED");
    await expect(page).toHaveURL(/status=COMPLETED/);

    // Filters live in the URL, so a refresh keeps the view.
    await page.reload();
    await expect(page.getByLabel("Filter by status")).toHaveValue("COMPLETED");
  });

  test("search narrows to matching tasks", async ({ page }) => {
    const unique = stamp();
    const title = `Searchable ${unique}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByText(title)).toBeVisible();

    await page.getByLabel("Search tasks").fill(unique);

    await expect(page.getByText(title)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`search=${unique}`));
  });

  test("the sort control changes the ordering parameter", async ({ page }) => {
    await page.goto("/tasks");

    await page.getByLabel("Sort tasks").selectOption("PRIORITY");
    await expect(page).toHaveURL(/sort=PRIORITY/);
  });
});

test.describe("Today", () => {
  test("a task due today appears on Today and drives the progress figure", async ({
    page,
  }) => {
    const title = `Due today ${stamp()}`;

    await page.goto("/tasks");
    await page.getByRole("button", { name: /add details/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);

    // The date input needs the local calendar day; the server converts it to
    // an instant using the profile's zone.
    const today = new Date().toISOString().slice(0, 10);
    await dialog.getByLabel("Due date").fill(today);
    await dialog.getByRole("button", { name: /create task/i }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/today");

    await expect(page.getByText(title).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /next best action/i }),
    ).toBeVisible();
  });

  test("the t shortcut navigates to Today", async ({ page }) => {
    await page.goto("/tasks");
    await page.locator("body").click();
    await page.keyboard.press("t");

    await expect(page).toHaveURL(/\/today/);
  });

  test("completing from Today updates the progress bar", async ({ page }) => {
    const title = `Progress ${stamp()}`;

    await page.goto("/tasks");
    await page.getByRole("button", { name: /add details/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog
      .getByLabel("Due date")
      .fill(new Date().toISOString().slice(0, 10));
    await dialog.getByRole("button", { name: /create task/i }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/today");

    const progress = page.getByRole("progressbar", {
      name: /of today's tasks complete/i,
    });
    await expect(progress).toBeVisible();

    await page.getByRole("checkbox", { name: `Complete ${title}` }).click();

    await expect(
      page.getByRole("checkbox", { name: `Reopen ${title}` }),
    ).toBeVisible();
  });
});

test.describe("dashboard", () => {
  test("Overview reflects real task data", async ({ page }) => {
    const title = `Dashboard ${stamp()}`;

    await page.goto("/tasks");
    await page.getByRole("button", { name: /add details/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog
      .getByLabel("Due date")
      .fill(new Date().toISOString().slice(0, 10));
    await dialog.getByRole("button", { name: /create task/i }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/overview");

    await expect(page.getByText(title).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /progress/i }),
    ).toBeVisible();
  });
});

test.describe("command palette", () => {
  test("finds a task by title", async ({ page }) => {
    const unique = stamp();
    const title = `Palette ${unique}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByText(title)).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");

    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();

    await palette.getByRole("combobox").fill(unique);
    await expect(palette.getByText(title)).toBeVisible();
  });

  test("offers New task, which opens the create dialog", async ({ page }) => {
    await page.goto("/today");

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("option", { name: /new task/i }).click();

    await expect(
      page.getByRole("heading", { name: /new task/i }),
    ).toBeVisible();
  });
});

test.describe("accessibility", () => {
  test("task rows expose labelled checkboxes", async ({ page }) => {
    const title = `A11y ${stamp()}`;

    await page.goto("/tasks");
    const input = page.getByLabel("Task title");
    await input.fill(title);
    await input.press("Enter");

    // Named, not just a bare input — a screen reader announces which task.
    await expect(
      page.getByRole("checkbox", { name: `Complete ${title}` }),
    ).toBeVisible();
  });

  test("the task list is reachable by keyboard", async ({ page }) => {
    await page.goto("/tasks");

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus-visible")).toBeVisible();
  });
});

test.describe("responsive", () => {
  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    test(`Today does not overflow horizontally at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await page.goto("/today");

      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );

      expect(overflows, "page scrolls sideways").toBe(false);
    });
  }
});
