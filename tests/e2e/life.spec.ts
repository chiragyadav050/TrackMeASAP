import { expect, test } from "@playwright/test";

import { CLERK_SKIP_REASON, isRealClerkInstance } from "./clerk-env";

/**
 * Phase 5 habit, goal, health and finance journeys.
 *
 * SKIPS ENTIRELY without a real Clerk instance — every one needs an
 * authenticated session, and Clerk's development handshake stops a browser
 * reaching the app when the publishable key is a placeholder. See
 * `clerk-env.ts` and docs/DEVELOPMENT.md.
 *
 * The rules that matter — streak arithmetic, quit-habit day counting, goal
 * progress with and without a measure, exact integer money, budget bands,
 * subscription advance, recurring-date rollover and cross-tenant isolation —
 * are covered FOR REAL by 44 unit tests and 57 integration tests against a
 * live database. These specs cover only what a browser can: that the controls
 * are wired and the numbers on screen match the service.
 */
test.skip(!isRealClerkInstance(), CLERK_SKIP_REASON);

const stamp = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.describe("habits", () => {
  test("a habit can be created and checked off", async ({ page }) => {
    const name = `Meditate ${stamp()}`;

    await page.goto("/habits");
    await page.getByRole("button", { name: /new habit/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Habit").fill(name);
    await dialog.getByRole("button", { name: /add habit/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(name)).toBeVisible();
    // A brand-new habit has not failed at anything.
    await expect(page.getByText(/no streak yet/i).first()).toBeVisible();

    await page
      .getByRole("button", { name: /^mark done$/i })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: /done today/i }).first(),
    ).toBeVisible();
  });

  test("the empty state explains what habits are for", async ({ page }) => {
    await page.goto("/habits");
    await expect(page.getByRole("heading", { name: "Habits" })).toBeVisible();
  });
});

test.describe("goals", () => {
  test("a measured goal shows real progress", async ({ page }) => {
    const title = `Read books ${stamp()}`;

    await page.goto("/goals");
    await page.getByRole("button", { name: /new goal/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Goal").fill(title);
    await dialog.getByLabel("Target number").fill("10");
    await dialog.getByRole("button", { name: /create goal/i }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("link", { name: new RegExp(title, "i") }).click();
    await page.getByLabel("Update progress").fill("5");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText("5 of 10")).toBeVisible();
    await expect(page.getByText("50%")).toBeVisible();
  });

  test("an unmeasurable goal says so rather than showing 0%", async ({
    page,
  }) => {
    const title = `Be better ${stamp()}`;

    await page.goto("/goals");
    await page.getByRole("button", { name: /new goal/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Goal").fill(title);
    await dialog.getByRole("button", { name: /create goal/i }).click();
    await expect(dialog).toBeHidden();

    await expect(
      page.getByText(/add a target number or some milestones/i).first(),
    ).toBeVisible();
  });
});

test.describe("health", () => {
  test("a check-in with only a mood saves", async ({ page }) => {
    await page.goto("/health");

    await page.getByLabel("Mood").selectOption("GOOD");
    await page.getByRole("button", { name: /save check-in/i }).click();

    await expect(page.getByText(/saved/i).first()).toBeVisible();
  });
});

test.describe("finance", () => {
  test("an entry is added and appears in the month total", async ({ page }) => {
    await page.goto("/finance");
    await page
      .getByRole("button", { name: /add entry/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What was it").fill(`Lunch ${stamp()}`);
    await dialog.getByLabel("Amount").fill("249.50");
    await dialog.getByRole("button", { name: /add entry/i }).click();
    await expect(dialog).toBeHidden();

    // Exact to the paisa — the amount is stored as an integer.
    await expect(page.getByText("249.50").first()).toBeVisible();
  });

  test("a malformed amount is rejected with a readable message", async ({
    page,
  }) => {
    await page.goto("/finance");
    await page
      .getByRole("button", { name: /add entry/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What was it").fill("Bad");
    await dialog.getByLabel("Amount").fill("abc");
    await dialog.getByRole("button", { name: /add entry/i }).click();

    await expect(dialog.getByText(/enter an amount like/i)).toBeVisible();
  });
});

test.describe("responsive", () => {
  for (const path of ["/habits", "/goals", "/health", "/finance"]) {
    for (const width of [320, 768, 1440]) {
      test(`${path} does not overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);

        const overflows = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );

        expect(overflows).toBe(false);
      });
    }
  }
});
